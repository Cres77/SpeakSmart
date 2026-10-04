#ifndef SPEAKSMART_ACCELEROMETER_H
#define SPEAKSMART_ACCELEROMETER_H

#include <stdint.h>

/* Phase 1 interface. No sample is read or synthesized.
 * Later phases replace the body using the APIs named in hardware_freewili.c.
 * This task must not perform network I/O.
 */

void sensor_task_poll(uint32_t now_ms);
uint32_t sensor_task_polls(void);
uint32_t sensor_sample_period_ms(void);

#endif
