#ifndef SPEAKSMART_FEEDBACK_H
#define SPEAKSMART_FEEDBACK_H

/* Phase 1 records that a buzz frame arrived. It does not play sound. */

void feedback_reset(void);
void feedback_note_buzz_reserved(void);
int feedback_buzz_reserved_count(void);
int feedback_hardware_invocations(void);

#endif
