#include "WiFi.h"

#include "Feedback.h"
#include "coach_config.h"

#include <stdio.h>
#include <string.h>

static void copy_device_id(char *dst, const char *src) {
  int j = 0;
  if (!src) src = "";
  for (int i = 0; src[i] && j < 39; i += 1) {
    char c = src[i];
    int ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' ||
             c == '_';
    if (ok) dst[j++] = c;
  }
  dst[j] = '\0';
  if (j == 0) memcpy(dst, "coach", 6);
}

static int send_json(CoachRadio *radio, const char *json) {
  int length = (int)strlen(json);
  return radio->link.try_send(radio->link.ctx, json, length);
}

static int send_hello(CoachRadio *radio, uint32_t now_ms) {
  char json[160];
  int n = snprintf(json, sizeof json, "{\"type\":\"hello\",\"role\":\"device\",\"timestamp\":%lu,\"deviceId\":\"%s\"}",
                   (unsigned long)now_ms, radio->device_id);
  if (n < 0 || n >= (int)sizeof json) return -1;
  return send_json(radio, json);
}

static int send_heartbeat(CoachRadio *radio, uint32_t now_ms) {
  char json[160];
  int n = snprintf(json, sizeof json,
                   "{\"type\":\"heartbeat\",\"role\":\"device\",\"timestamp\":%lu,\"deviceId\":\"%s\"}",
                   (unsigned long)now_ms, radio->device_id);
  if (n < 0 || n >= (int)sizeof json) return -1;
  return send_json(radio, json);
}

static int send_disconnect(CoachRadio *radio, uint32_t now_ms, const char *reason) {
  char json[192];
  if (!reason || !reason[0]) reason = "shutdown";
  int n = snprintf(json, sizeof json,
                   "{\"type\":\"disconnect\",\"role\":\"device\",\"timestamp\":%lu,\"deviceId\":\"%s\",\"reason\":\"%s\"}",
                   (unsigned long)now_ms, radio->device_id, reason);
  if (n < 0 || n >= (int)sizeof json) return -1;
  return send_json(radio, json);
}

static int type_is(const char *json, const char *type) {
  const char *p = strstr(json, "\"type\"");
  size_t n;
  if (!p) return 0;
  p = strchr(p, ':');
  if (!p) return 0;
  p += 1;
  while (*p == ' ') p += 1;
  if (*p != '"') return 0;
  p += 1;
  n = strlen(type);
  return strncmp(p, type, n) == 0 && p[n] == '"';
}

static void mark_down(CoachRadio *radio) {
  radio->status = COACH_LINK_DISCONNECTED;
  radio->link_ready = 0;
  radio->hello_sent = 0;
}

static void handle_frame(CoachRadio *radio, const char *json, uint32_t now_ms) {
  if (type_is(json, "buzz")) {
    feedback_note_buzz_reserved();
    return;
  }
  if (!type_is(json, "reconnect")) return;
  send_disconnect(radio, now_ms, "reconnect");
  radio->link.close(radio->link.ctx);
  mark_down(radio);
  coach_radio_request_connect(radio, now_ms);
}

void coach_radio_init(CoachRadio *radio, const char *device_id, CoachLink link) {
  memset(radio, 0, sizeof *radio);
  radio->link = link;
  copy_device_id(radio->device_id, device_id);
  radio->status = COACH_LINK_DISCONNECTED;
}

void coach_radio_request_connect(CoachRadio *radio, uint32_t now_ms) {
  (void)now_ms;
  if (radio->status != COACH_LINK_DISCONNECTED) return;
  if (radio->link.begin_connect(radio->link.ctx) != 0) {
    mark_down(radio);
    return;
  }
  radio->status = COACH_LINK_CONNECTING;
  radio->link_ready = 0;
  radio->hello_sent = 0;
}

void coach_radio_request_disconnect(CoachRadio *radio, uint32_t now_ms, const char *reason) {
  if (radio->status == COACH_LINK_CONNECTED) {
    send_disconnect(radio, now_ms, reason ? reason : "shutdown");
  }
  if (radio->status != COACH_LINK_DISCONNECTED) radio->link.close(radio->link.ctx);
  mark_down(radio);
}

void coach_radio_poll(CoachRadio *radio, uint32_t now_ms) {
  char incoming[256];
  int n;
  int sent;

  if (radio->status == COACH_LINK_DISCONNECTED) return;

  if (radio->status == COACH_LINK_CONNECTING) {
    if (!radio->link_ready) {
      int state = radio->link.poll_connect(radio->link.ctx);
      if (state == 0) return;
      if (state < 0) {
        mark_down(radio);
        return;
      }
      radio->link_ready = 1;
    }
    sent = send_hello(radio, now_ms);
    if (sent == 0) return;
    if (sent < 0) {
      radio->link.close(radio->link.ctx);
      mark_down(radio);
      return;
    }
    radio->hello_sent = 1;
    radio->last_tx_ms = now_ms;
    radio->status = COACH_LINK_CONNECTED;
    return;
  }

  n = radio->link.poll_recv(radio->link.ctx, incoming, (int)sizeof incoming - 1);
  if (n < 0) {
    radio->link.close(radio->link.ctx);
    mark_down(radio);
    return;
  }
  if (n > 0) {
    incoming[n] = '\0';
    handle_frame(radio, incoming, now_ms);
    if (radio->status != COACH_LINK_CONNECTED) return;
  }

  if ((uint32_t)(now_ms - radio->last_tx_ms) < (uint32_t)COACH_HEARTBEAT_INTERVAL_MS) return;
  sent = send_heartbeat(radio, now_ms);
  if (sent == 0) return;
  if (sent < 0) {
    radio->link.close(radio->link.ctx);
    mark_down(radio);
    return;
  }
  radio->last_tx_ms = now_ms;
}
