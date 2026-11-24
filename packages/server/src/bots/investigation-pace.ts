/**
 * How FAST bots investigate (Phase 5a, part F). Only the timing lives here;
 * what they look at and conclude is in investigators.ts and judge.ts.
 *
 * Without pauses the analyst and the guard catch a careless hacker about a
 * minute after the alert, which leaves a human no time to react. People read,
 * think, finish what they are doing and walk. All numbers are [shortest,
 * longest] in GAME time; the real pause is random in between, from the bots' own
 * seeded sequences.
 */
import type { SoloDifficulty } from '@insider/shared';

type Range = readonly [number, number];

export interface InvestigationPace {
  /** Seconds between two looks of the SOC analyst at the newest alerts. */
  alertSeconds: Range;
  /** Seconds before it looks after the alert banner went out. */
  alarmSeconds: Range;
  /** Seconds between two queries while it follows a lead. */
  querySeconds: Range;
  /** Minutes the guard thinks about strong evidence before going after somebody. */
  guardMinutes: Range;
  /** Minutes before somebody calls a meeting about convincing evidence. */
  meetingMinutes: Range;
}

/** As fast as they can: for tests, and the pace of part E. */
export const FAST_INVESTIGATION: InvestigationPace = {
  alertSeconds: [60, 150], alarmSeconds: [0, 0], querySeconds: [8, 20], guardMinutes: [0, 0], meetingMinutes: [0, 0],
};

/** The difficulty of Infiltration. (Elsewhere bots look at alerts at the pace of FAST_INVESTIGATION, and do not investigate.) */
export const INVESTIGATION_PACE: Record<SoloDifficulty, InvestigationPace> = {
  easy: { alertSeconds: [180, 360], alarmSeconds: [60, 150], querySeconds: [30, 60], guardMinutes: [2, 4], meetingMinutes: [3, 5] },
  normal: { alertSeconds: [120, 240], alarmSeconds: [30, 80], querySeconds: [18, 35], guardMinutes: [1, 2.5], meetingMinutes: [1.5, 3] },
  hard: { alertSeconds: [60, 150], alarmSeconds: [5, 30], querySeconds: [10, 22], guardMinutes: [0.3, 1], meetingMinutes: [0.5, 1.5] },
};
