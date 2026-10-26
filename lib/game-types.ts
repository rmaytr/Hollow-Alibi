/** Shared contract. RoomState is server-only; only RoomView may cross the API. */
export type TestKey = "weigh" | "listen" | "scan";
export type ProfileId = "ballast" | "latch" | "liner" | "key" | "moon" | "moth";
export type Phase = "lobby" | "prepare" | "judge" | "reveal" | "finale";
export type Pace = "standard" | "relaxed";
export type GameMode = "human" | "practice";
export type BotDifficulty = "casual" | "sharp" | "expert";
export type Bold = "inspect" | "clear" | null;
export type Conclusion = "proved empty" | "proved full" | "still uncertain";
export type Tests = Record<TestKey, boolean>;

export interface Profile {
  id: ProfileId;
  label: string;
  full: boolean;
  tests: Tests;
  explanation: string;
}
export interface Proof {
  claim?: boolean;
  test: TestKey;
  result: boolean;
  pitch: string;
  automatic: boolean;
}
export interface Receipt {
  subjectId: string;
  test: TestKey;
  result: boolean;
  conclusion: Conclusion;
}
export interface Verdict {
  automatic?: boolean;
  call?: "trust" | "liar";
  inspectId: string;
  clearId: string;
  bold: Bold;
}
export interface VerdictScore {
  kind: "inspect" | "clear";
  targetId: string;
  correct: boolean;
  bold: boolean;
  points: number;
}
export interface ScoreBreakdown {
  inactivityPenalty?: number;
  story?: string;
  playerId: string;
  verdicts: VerdictScore[];
  investigation: number;
  deception: number;
  wrongReceived: number;
  deceptionEligible: boolean;
  total: number;
  scoreAfter: number;
}
export interface RevealedCase {
  playerId: string;
  name: string;
  bot: boolean;
  left: boolean;
  profile: Profile;
  proof: Proof;
  comment: string;
}
export interface RoundResult {
  round: number;
  resolvedAt: number;
  cases: RevealedCase[];
  receipts: Record<string, Receipt>;
  verdicts: Record<string, Verdict | null>;
  scores: ScoreBreakdown[];
}
export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  bot: boolean;
  difficulty?: BotDifficulty;
  score: number;
  left: boolean;
  connected: boolean;
  isHost: boolean;
  proofSubmitted: boolean;
  verdictSubmitted: boolean;
  ready: boolean;
}
export interface PublicCase {
  playerId: string;
  name: string;
  bot: boolean;
  left: boolean;
  proof: Proof | null;
  comment: string;
}
export interface RoomView {
  rules?: "showdown";
  rivalId?: string;
  judgeId?: string;
  sceneIndex?: number;
  doublesLeft?: number;
  code: string;
  instanceId: string;
  version: number;
  serverNow: number;
  expiresAt: number;
  mode: GameMode;
  pace: Pace;
  phase: Phase;
  hostId: string | null;
  viewerId: string;
  matchId: string | null;
  round: number;
  maxRounds: number;
  deadline: number | null;
  phaseStartedAt: number;
  players: PublicPlayer[];
  cases: PublicCase[];
  myCase: Profile | null;
  myProof: Proof | null;
  myReceipt: Receipt | null;
  myVerdict: Verdict | null;
  myCommentUpdates: number;
  history: RoundResult[];
  result: RoundResult | null;
  winnerIds: string[];
  canStart: boolean;
  canRematch: boolean;
}
export interface ActionIdentity {
  requestId: string;
  instanceId: string;
  matchId?: string | null;
  round?: number;
  phase?: Phase;
}
export type ActionPayload =
  | { type: "challenge"; call: "trust" | "liar"; double: boolean }
  | { type: "start" }
  | { type: "bots"; count: number; difficulty: BotDifficulty | "mixed" }
  | { type: "proof"; test: TestKey; pitch?: string; claim?: boolean }
  | { type: "comment"; text: string }
  | { type: "verdict"; inspectId: string; clearId: string; bold: Bold }
  | { type: "ready" }
  | { type: "rematch" }
  | { type: "leave" }
  | { type: "kick"; playerId: string };
export type GameAction = ActionIdentity & ActionPayload;
export interface ApiError {
  error: { code: string; message: string };
}

// Server persistence types. Never spread these into a response or client props.
export interface PlayerState {
  doublesLeft?: number;
  id: string;
  name: string;
  seat: number;
  bot: boolean;
  difficulty?: BotDifficulty;
  sessionHash: string | null;
  joinedAt: number;
  lastSeen: number;
  left: boolean;
  score: number;
}
export interface RoundState {
  seats: string[];
  profiles: Record<string, ProfileId>;
  proofs: Record<string, Proof>;
  receipts: Record<string, Receipt>;
  ballots: Record<string, Verdict | null>;
  comments: Record<string, { text: string; updates: number }>;
  ready: string[];
  result: RoundResult | null;
}
export interface CommandReceipt {
  playerId: string;
  requestId: string;
  fingerprint: string;
  at: number;
}
export interface RoomState {
  sceneOrder?: number[];
  rules?: "showdown";
  voice?: { peers: Record<string, { epoch: string; seen: number }>; signals: Record<string, { from: string; to: string; fromEpoch: string; toEpoch: string; description: { type: "offer" | "answer"; sdp: string }; at: number }> };
  code: string;
  instanceId: string;
  version: number;
  createdAt: number;
  expiresAt: number;
  hostId: string | null;
  mode: GameMode;
  pace: Pace;
  phase: Phase;
  matchId: string | null;
  round: number;
  phaseStartedAt: number;
  deadline: number | null;
  players: PlayerState[];
  current: RoundState | null;
  history: RoundResult[];
  receipts: CommandReceipt[];
  rng: number;
  rngKey: string;
  serial: number;
}
