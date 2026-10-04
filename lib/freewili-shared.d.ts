declare module "@/FreeWili/shared/motion.mjs" {
  export function createMotionDetector(config: {
    gestureThreshold: number;
    gestureMinDurationMs: number;
    gestureCooldownMs: number;
    stillnessThreshold: number;
    excessiveLevel: number;
    excessiveHoldMs: number;
    excessiveCooldownMs: number;
  }): {
    reset(): void;
    push(sample: { timestamp: number; magnitude: number; movement: number }): {
      gestureEvent: { timestamp: number; magnitude: number } | null;
      excessiveEvent: { timestamp: number; movement: number } | null;
    };
  };
}

declare module "@/FreeWili/shared/summary.mjs" {
  export function summarizeSession(session: {
    durationMs: number;
    samples: { movement: number }[];
    gestures: { timestamp: number; magnitude: number }[];
    excessive: { movement: number }[];
    buzzes: { reason?: string }[];
  }): {
    durationMs: number;
    durationLabel: string;
    gestures: number;
    excessive: number;
    averageMovement: number | null;
    stillness: number | null;
    lines: string[];
  };
}

declare module "@/FreeWili/shared/grade.mjs" {
  export function gradeMovement(summary: {
    durationMs: number;
    gestures: number;
    excessive: number;
    averageMovement: number | null;
    stillness: number | null;
  }): { letter: "A" | "B" | "C" | "D" | "F"; score: number } | null;
}

declare module "@/FreeWili/shared/buzz.mjs" {
  export function createBuzzGuard(): {
    trySend(now: number, durationMs: number): boolean;
  };
}
