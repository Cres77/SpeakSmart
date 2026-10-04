#include "Accelerometer.h"
#include "Feedback.h"
#include "FreeWiliMain.h"
#include "hardware_freewili.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct FakeLink {
  int pending_polls;
  int begin_count;
  int close_count;
  int block_sends;
  char sent[16][256];
  int sent_count;
  char inbox[256];
  int inbox_len;
} FakeLink;

static int begin_connect(void *ctx) {
  FakeLink *fake = ctx;
  fake->begin_count += 1;
  return 0;
}

static int poll_connect(void *ctx) {
  FakeLink *fake = ctx;
  if (fake->pending_polls > 0) {
    fake->pending_polls -= 1;
    return 0;
  }
  return 1;
}

static int try_send(void *ctx, const char *data, int length) {
  FakeLink *fake = ctx;
  if (fake->block_sends > 0) {
    fake->block_sends -= 1;
    return 0;
  }
  assert(fake->sent_count < 16);
  assert(length < 256);
  memcpy(fake->sent[fake->sent_count], data, (size_t)length);
  fake->sent[fake->sent_count][length] = '\0';
  fake->sent_count += 1;
  return 1;
}

static int poll_recv(void *ctx, char *buffer, int capacity) {
  FakeLink *fake = ctx;
  int n = fake->inbox_len;
  if (n <= 0) return 0;
  if (n > capacity) n = capacity;
  memcpy(buffer, fake->inbox, (size_t)n);
  fake->inbox_len = 0;
  return n;
}

static void close_link(void *ctx) {
  FakeLink *fake = ctx;
  fake->close_count += 1;
}

static void queue(FakeLink *fake, const char *json) {
  size_t n = strlen(json);
  assert(n < sizeof fake->inbox);
  memcpy(fake->inbox, json, n);
  fake->inbox_len = (int)n;
}

static CoachLink ops(FakeLink *fake) {
  CoachLink link = {0};
  link.ctx = fake;
  link.begin_connect = begin_connect;
  link.poll_connect = poll_connect;
  link.try_send = try_send;
  link.poll_recv = poll_recv;
  link.close = close_link;
  return link;
}

int main(void) {
  FakeLink fake = {0};
  CoachRadio radio;
  uint32_t polls_before;

  assert(sensor_sample_period_ms() == 20);
  assert(hardware_wifi_join("lab", "secret") == HARDWARE_API_UNVERIFIED);
  assert(strstr(hardware_unverified_reason(), "on_connect_to_station") != NULL);

  feedback_reset();
  coach_radio_init(&radio, "wrist-1", ops(&fake));
  assert(radio.status == COACH_LINK_DISCONNECTED);

  fake.pending_polls = 5;
  coach_radio_request_connect(&radio, 0);
  assert(radio.status == COACH_LINK_CONNECTING);
  assert(fake.begin_count == 1);

  polls_before = sensor_task_polls();
  for (uint32_t t = 0; t < 5; t += 1) freewili_main_poll(&radio, t);
  assert(sensor_task_polls() == polls_before + 5);
  assert(radio.status == COACH_LINK_CONNECTING);
  assert(fake.sent_count == 0);

  fake.block_sends = 1;
  freewili_main_poll(&radio, 10);
  assert(radio.status == COACH_LINK_CONNECTING);
  assert(fake.sent_count == 0);
  assert(sensor_task_polls() == polls_before + 6);

  freewili_main_poll(&radio, 1000);
  assert(radio.status == COACH_LINK_CONNECTED);
  assert(fake.sent_count == 1);
  assert(strstr(fake.sent[0], "\"type\":\"hello\"") != NULL);
  assert(strstr(fake.sent[0], "\"deviceId\":\"wrist-1\"") != NULL);
  assert(strstr(fake.sent[0], "\"timestamp\":1000") != NULL);

  freewili_main_poll(&radio, 2999);
  assert(fake.sent_count == 1);
  freewili_main_poll(&radio, 3000);
  assert(fake.sent_count == 2);
  assert(strstr(fake.sent[1], "\"type\":\"heartbeat\"") != NULL);

  queue(&fake, "{\"type\":\"buzz\",\"frequency\":350,\"duration\":150}");
  freewili_main_poll(&radio, 3100);
  assert(feedback_buzz_reserved_count() == 1);
  assert(feedback_hardware_invocations() == 0);
  assert(radio.status == COACH_LINK_CONNECTED);
  assert(strstr(fake.sent[0], "accel") == NULL);

  queue(&fake, "{\"type\":\"reconnect\"}");
  freewili_main_poll(&radio, 3200);
  assert(radio.status == COACH_LINK_CONNECTING);
  assert(fake.close_count == 1);
  assert(strstr(fake.sent[fake.sent_count - 1], "\"type\":\"disconnect\"") != NULL);
  assert(strstr(fake.sent[fake.sent_count - 1], "\"reason\":\"reconnect\"") != NULL);

  freewili_main_poll(&radio, 4000);
  assert(radio.status == COACH_LINK_CONNECTED);
  assert(strstr(fake.sent[fake.sent_count - 1], "\"type\":\"hello\"") != NULL);

  coach_radio_request_disconnect(&radio, 4500, "shutdown");
  assert(radio.status == COACH_LINK_DISCONNECTED);
  assert(strstr(fake.sent[fake.sent_count - 1], "\"reason\":\"shutdown\"") != NULL);
  int sent_after = fake.sent_count;
  freewili_main_poll(&radio, 9000);
  assert(fake.sent_count == sent_after);
  assert(sensor_task_polls() > polls_before);

  sensor_test_reset();
  FakeLink samples = {0};
  CoachRadio sampler;
  HardwareAccelSample unread = {9, 9, 9, 1, 9};
  AccelSample peeked;
  coach_radio_init(&sampler, "host-test", ops(&samples));
  assert(hardware_accel_poll(&unread) == HARDWARE_NO_SAMPLE);
  assert(unread.x == 9 && unread.y == 9 && unread.z == 9);

  for (int i = 0; i < 20; i += 1) {
    sensor_test_offer((float)i, 0.25f, -3.0f, 1000u + (uint32_t)i);
    freewili_main_poll(&sampler, (uint32_t)i * 20u);
  }
  assert(sampler.status == COACH_LINK_DISCONNECTED);
  assert(samples.sent_count == 0);
  assert(sensor_queue_count() == 8);
  assert(sensor_peek(&peeked) == 1);
  assert(peeked.x == 12.f);

  coach_radio_request_connect(&sampler, 0);
  freewili_main_poll(&sampler, 400);
  assert(sampler.status == COACH_LINK_CONNECTED);
  assert(strstr(samples.sent[0], "\"type\":\"hello\"") != NULL);
  assert(strstr(samples.sent[0], "freewili") == NULL);

  for (int i = 0; i < 8; i += 1) freewili_main_poll(&sampler, 500u + (uint32_t)i);
  assert(sensor_queue_count() == 0);
  assert(samples.sent_count == 9);
  assert(strstr(samples.sent[1], "\"type\":\"sensor\"") != NULL);
  assert(strstr(samples.sent[1], "\"x\":12") != NULL);
  assert(strstr(samples.sent[8], "\"x\":19") != NULL);
  for (int i = 1; i < 9; i += 1) {
    assert(strstr(samples.sent[i], "movement") == NULL);
    assert(strstr(samples.sent[i], "freewili") == NULL);
    assert(strstr(samples.sent[i], "\"deviceId\":\"host-test\"") != NULL);
  }
  int drained = samples.sent_count;
  freewili_main_poll(&sampler, 600);
  assert(samples.sent_count == drained);

  sensor_test_offer(4.5f, 5.5f, 6.5f, 42);
  samples.block_sends = 1;
  polls_before = sensor_task_polls();
  freewili_main_poll(&sampler, 1000);
  assert(sensor_task_polls() == polls_before + 1);
  assert(samples.sent_count == drained);
  assert(sensor_queue_count() == 1);
  freewili_main_poll(&sampler, 1020);
  assert(samples.sent_count == drained + 1);
  assert(strstr(samples.sent[samples.sent_count - 1], "\"x\":4.5") != NULL);
  assert(strstr(samples.sent[samples.sent_count - 1], "freewili") == NULL);
  assert(sensor_queue_count() == 0);

  puts("firmware phase 1 ok");
  return 0;
}
