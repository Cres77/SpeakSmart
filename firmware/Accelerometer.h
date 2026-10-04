#ifndef SPEAKSMART_ACCELEROMETER_H
#define SPEAKSMART_ACCELEROMETER_H

#include <stdint.h>

/* Sample poll. No network I/O. Hardware reads stay in hardware_freewili.c.
 * sensor_test_offer queues a host-test value. It is not a FreeWili reading.
 */

#define SENSOR_QUEUE_CAP 8

typedef struct {
  uint32_t timestamp_ms;
  float x;
  float y;
  float z;
  int has_g;
  float g;
} AccelSample;

void sensor_task_poll(uint32_t now_ms);
uint32_t sensor_task_polls(void);
uint32_t sensor_sample_period_ms(void);
uint32_t sensor_queue_count(void);
int sensor_peek(AccelSample *out);
void sensor_commit(void);
void sensor_test_offer(float x, float y, float z, uint32_t timestamp_ms);
void sensor_test_reset(void);

#endif
