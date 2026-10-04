#ifndef SPEAKSMART_HARDWARE_FREEWILI_H
#define SPEAKSMART_HARDWARE_FREEWILI_H

/* The only Phase 1 file allowed to name FreeWili hardware operations.
 * It does not call them. See the comment block in hardware_freewili.c.
 */

typedef enum {
  HARDWARE_OK = 0,
  HARDWARE_API_UNVERIFIED = 1,
  HARDWARE_NO_SAMPLE = 2
} HardwareResult;

/* Named fields copied only from a verified AccelData read.
 * x, y, and z are required there. g is optional. Units are unknown.
 */
typedef struct {
  float x;
  float y;
  float z;
  int has_g;
  float g;
} HardwareAccelSample;

const char *hardware_unverified_reason(void);
HardwareResult hardware_wifi_join(const char *ssid, const char *password);
HardwareResult hardware_accel_poll(HardwareAccelSample *sample);

#endif
