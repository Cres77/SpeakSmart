#ifndef SPEAKSMART_FREEWILI_MAIN_H
#define SPEAKSMART_FREEWILI_MAIN_H

#include "WiFi.h"

#include <stdint.h>

/* One turn of the coach loop. Safe to call while the radio is still connecting. */
void freewili_main_poll(CoachRadio *radio, uint32_t now_ms);

#endif
