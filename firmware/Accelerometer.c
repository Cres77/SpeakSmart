#include "Accelerometer.h"

#include "hardware_freewili.h"
#include "coach_config.h"

static uint32_t polls;
static AccelSample queue[SENSOR_QUEUE_CAP];
static int queue_head;
static int queue_tail;
static int queue_count;
static int schedule_started;
static uint32_t next_due_ms;
static int offer_ready;
static AccelSample offer;

static void enqueue(AccelSample sample) {
  if (queue_count == SENSOR_QUEUE_CAP) {
    queue_head = (queue_head + 1) % SENSOR_QUEUE_CAP;
    queue_count -= 1;
  }
  queue[queue_tail] = sample;
  queue_tail = (queue_tail + 1) % SENSOR_QUEUE_CAP;
  queue_count += 1;
}

void sensor_task_poll(uint32_t now_ms) {
  HardwareAccelSample hardware;
  polls += 1;
  if (schedule_started && now_ms < next_due_ms) return;
  schedule_started = 1;
  next_due_ms = now_ms + sensor_sample_period_ms();

  if (hardware_accel_poll(&hardware) == HARDWARE_OK) {
    AccelSample sample = {0};
    sample.timestamp_ms = now_ms;
    sample.x = hardware.x;
    sample.y = hardware.y;
    sample.z = hardware.z;
    sample.has_g = hardware.has_g;
    sample.g = hardware.g;
    enqueue(sample);
    return;
  }

  if (!offer_ready) return;
  offer_ready = 0;
  enqueue(offer);
}

uint32_t sensor_task_polls(void) {
  return polls;
}

uint32_t sensor_sample_period_ms(void) {
  return 1000u / (uint32_t)COACH_SAMPLE_RATE_HZ;
}

uint32_t sensor_queue_count(void) {
  return (uint32_t)queue_count;
}

int sensor_peek(AccelSample *out) {
  if (queue_count == 0) return 0;
  *out = queue[queue_head];
  return 1;
}

void sensor_commit(void) {
  if (queue_count == 0) return;
  queue_head = (queue_head + 1) % SENSOR_QUEUE_CAP;
  queue_count -= 1;
}

void sensor_test_offer(float x, float y, float z, uint32_t timestamp_ms) {
  /* Synthetic host-test sample. Not a FreeWili, and not a unit conversion. */
  offer.timestamp_ms = timestamp_ms;
  offer.x = x;
  offer.y = y;
  offer.z = z;
  offer.has_g = 0;
  offer.g = 0;
  offer_ready = 1;
}

void sensor_test_reset(void) {
  queue_head = 0;
  queue_tail = 0;
  queue_count = 0;
  schedule_started = 0;
  next_due_ms = 0;
  offer_ready = 0;
}
