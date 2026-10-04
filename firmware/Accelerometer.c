#include "Accelerometer.h"

#include "coach_config.h"

static uint32_t polls;

void sensor_task_poll(uint32_t now_ms) {
  (void)now_ms;
  polls += 1;
}

uint32_t sensor_task_polls(void) {
  return polls;
}

uint32_t sensor_sample_period_ms(void) {
  return 1000u / (uint32_t)COACH_SAMPLE_RATE_HZ;
}
