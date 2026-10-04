#ifndef SPEAKSMART_HARDWARE_FREEWILI_H
#define SPEAKSMART_HARDWARE_FREEWILI_H

/* The only Phase 1 file allowed to name FreeWili hardware operations.
 * It does not call them. See the comment block in hardware_freewili.c.
 */

typedef enum {
  HARDWARE_OK = 0,
  HARDWARE_API_UNVERIFIED = 1
} HardwareResult;

const char *hardware_unverified_reason(void);
HardwareResult hardware_wifi_join(const char *ssid, const char *password);

#endif
