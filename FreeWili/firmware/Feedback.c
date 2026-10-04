#include "Feedback.h"

static int reserved_count;

void feedback_reset(void) {
  reserved_count = 0;
}

void feedback_note_buzz_reserved(void) {
  reserved_count += 1;
}

int feedback_buzz_reserved_count(void) {
  return reserved_count;
}

int feedback_hardware_invocations(void) {
  return 0;
}
