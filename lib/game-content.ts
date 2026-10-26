import type { Profile, ProfileId, TestKey } from "./game-types.ts";

export const TEST_KEYS: TestKey[] = ["weigh", "listen", "scan"];
export const TEST_LABELS: Record<TestKey, { label: string; positive: string; negative: string }> = {
  weigh: { label: "WEIGH", positive: "HEAVY", negative: "LIGHT" },
  listen: { label: "LISTEN", positive: "RATTLE", negative: "QUIET" },
  scan: { label: "SCAN", positive: "SHADOW", negative: "CLEAR" },
};
export const PROFILES: Record<ProfileId, Profile> = {
  ballast: { id: "ballast", label: "Weighted shell", full: false, tests: { weigh: true, listen: false, scan: false }, explanation: "The weight was built into the shell." },
  latch: { id: "latch", label: "Loose latch", full: false, tests: { weigh: false, listen: true, scan: false }, explanation: "The latch made the noise." },
  liner: { id: "liner", label: "Printed liner", full: false, tests: { weigh: false, listen: false, scan: true }, explanation: "The liner cast the shadow." },
  key: { id: "key", label: "Clockwork key", full: true, tests: { weigh: true, listen: true, scan: false }, explanation: "The key rattles, but the scanner misses its glass housing." },
  moon: { id: "moon", label: "Felt-wrapped moon", full: true, tests: { weigh: true, listen: false, scan: true }, explanation: "Felt muffled the object; silence was not emptiness." },
  moth: { id: "moth", label: "Glass moth", full: true, tests: { weigh: false, listen: true, scan: true }, explanation: "A light object can still be inside." },
};
export const PROFILE_LIST = Object.values(PROFILES);
export const MAX_PLAYERS = 10;
export const MIN_PLAYERS = 2;
export const ROUND_COUNT = 5;
export const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const PRESENCE_WRITE_MS = 12_000;
export const DISCONNECT_MS = 60_000;
export const MIN_REVEAL_MS = 2_000;
export const BOT_DELAY_MS = 1_800;
export const DURATIONS = {
  standard: { prepare: 45_000, judge: 60_000, reveal: 14_000 },
  relaxed: { prepare: 90_000, judge: 120_000, reveal: 22_000 },
} as const;
export const PITCH_PRESETS = [
  "The evidence speaks for itself.",
  "You are looking at the wrong clue.",
  "I would clear this case.",
  "Go on. Put it on record.",
  "Every test is true. Choose carefully.",
];
export function testResultLabel(test: TestKey, result: boolean): string {
  return result ? TEST_LABELS[test].positive : TEST_LABELS[test].negative;
}
