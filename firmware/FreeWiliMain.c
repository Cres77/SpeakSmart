#include "FreeWiliMain.h"

#include "Accelerometer.h"
#include "WiFi.h"

void freewili_main_poll(CoachRadio *radio, uint32_t now_ms) {
  /* Sampling and radio stay in separate calls. The sensor task has no link. */
  sensor_task_poll(now_ms);
  coach_radio_poll(radio, now_ms);
}

#ifdef COACH_DEVICE_MAIN
#include "hardware_freewili.h"

#include <stdio.h>

int main(void) {
  HardwareResult join = hardware_wifi_join(NULL, NULL);
  fputs(hardware_unverified_reason(), stdout);
  fputc('\n', stdout);
  return join == HARDWARE_API_UNVERIFIED ? 2 : 1;
}
#endif
