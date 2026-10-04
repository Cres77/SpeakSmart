#ifndef SPEAKSMART_WIFI_H
#define SPEAKSMART_WIFI_H

#include <stdint.h>

/* WebSocket client state machine over a non-blocking link.
 * This file does not call FreeWili. The process that owns the link injects it.
 * poll functions return immediately: 1 ready/sent, 0 still pending, -1 failed.
 */

typedef enum {
  COACH_LINK_DISCONNECTED = 0,
  COACH_LINK_CONNECTING = 1,
  COACH_LINK_CONNECTED = 2
} CoachLinkStatus;

typedef struct CoachLink CoachLink;
struct CoachLink {
  void *ctx;
  int (*begin_connect)(void *ctx);
  int (*poll_connect)(void *ctx);
  int (*try_send)(void *ctx, const char *data, int length);
  int (*poll_recv)(void *ctx, char *buffer, int capacity);
  void (*close)(void *ctx);
};

typedef struct CoachRadio CoachRadio;
struct CoachRadio {
  CoachLink link;
  CoachLinkStatus status;
  char device_id[40];
  uint32_t last_tx_ms;
  int link_ready;
  int hello_sent;
};

void coach_radio_init(CoachRadio *radio, const char *device_id, CoachLink link);
void coach_radio_request_connect(CoachRadio *radio, uint32_t now_ms);
void coach_radio_request_disconnect(CoachRadio *radio, uint32_t now_ms, const char *reason);
void coach_radio_poll(CoachRadio *radio, uint32_t now_ms);

#endif
