import { createHash, createHmac } from "node:crypto";
import { SCENES, showdownBot, showdownPayoff } from './showdown.ts';
import {
  BOT_DELAY_MS, DISCONNECT_MS, DURATIONS, MAX_PLAYERS, MIN_PLAYERS, MIN_REVEAL_MS,
  PRESENCE_WRITE_MS, PROFILES, ROOM_LIFETIME_MS, ROUND_COUNT, TEST_KEYS,
} from "./game-content.ts";
import type {
  ActionPayload, Bold, BotDifficulty, GameAction, GameMode, Pace, Phase, PlayerState, ProfileId,
  Receipt, RoomState, RoomView, RoundResult, ScoreBreakdown, TestKey, Verdict,
} from "./game-types.ts";

export class GameError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "GameError";
    this.code = code;
    this.status = status;
  }
}
function fail(code: string, message: string, status = 400): never {
  throw new GameError(code, message, status);
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function clone<T>(value: T): T { return structuredClone(value); }
function finish(before: RoomState, next: RoomState): RoomState {
  if (JSON.stringify(before) === JSON.stringify(next)) return before;
  next.version = before.version + 1;
  return next;
}
function random(room: RoomState): number {
  // Keyed deterministic randomness: persisted counter makes retries stable, while
  // a production 256-bit secret key prevents public observations predicting deals.
  const digest = createHmac("sha256", room.rngKey).update(`hollow-draw:${room.rng++}`).digest();
  return digest.readUInt32BE(0) / 4_294_967_296;
}
function pick<T>(room: RoomState, values: readonly T[]): T {
  return values[Math.floor(random(room) * values.length)];
}
function shuffle<T>(room: RoomState, values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random(room) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function id(room: RoomState, prefix: string): string {
  // Public identifiers are independent of the private random stream.
  return `${prefix}_${room.instanceId}_${++room.serial}`;
}
export function cleanText(value: unknown, max: number, field: string, min = 0): string {
  if (typeof value !== "string") fail("INVALID_ACTION", `${field} must be text.`);
  const text = value.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim();
  if (Array.from(text).length < min || Array.from(text).length > max) {
    fail("INVALID_ACTION", `${field} must be ${min ? `${min}–` : "at most "}${max} characters.`);
  }
  return text;
}
function connected(player: PlayerState, now: number): boolean {
  return !player.left && (player.bot || now - player.lastSeen <= DISCONNECT_MS);
}
function member(room: RoomState, sessionHash: string, allowLeft = false): PlayerState {
  const player = room.players.find((p) => !p.bot && p.sessionHash === sessionHash);
  if (!player || (player.left && !allowLeft)) fail("NOT_MEMBER", "This browser no longer has an active seat in the room.", 403);
  return player;
}
function ensureLive(room: RoomState, now: number): void {
  if (now >= room.expiresAt) fail("ROOM_EXPIRED", "This room has expired. Create a new room to play again.", 410);
}
function activeHumans(room: RoomState): PlayerState[] {
  return room.players.filter((p) => !p.bot && !p.left);
}
function playable(room: RoomState): boolean {
  const humans = activeHumans(room).length;
  const count = room.players.filter((p) => !p.left).length;
  return humans >= 1 && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}
function migrateHost(room: RoomState, now: number): void {
  const current = room.players.find((p) => p.id === room.hostId);
  if (current && connected(current, now) && !current.bot) return;
  const replacement = room.players.find((p) => !p.bot && connected(p, now));
  room.hostId = replacement?.id ?? null;
}
function setPhase(room: RoomState, phase: Phase, now: number): void {
  room.phase = phase;
  room.phaseStartedAt = now;
  room.deadline = phase === "prepare" || phase === "judge" || phase === "reveal"
    ? now + (phase === 'reveal' && room.rules === 'showdown' ? (room.pace === 'relaxed' ? 45000 : 30000) + Math.max(0, room.players.length - 2) * 2000 : DURATIONS[room.pace][phase])
    : null;
}
function newPlayer(room: RoomState, name: string, sessionHash: string | null, now: number, bot = false): PlayerState {
  const occupied = new Set(room.players.filter((p) => !p.left).map((p) => p.seat));
  let seat = 0;
  while (occupied.has(seat)) seat++;
  return { id: id(room, "p"), name, seat, bot, sessionHash, joinedAt: now, lastSeen: now, left: false, score: 0 };
}
export function createRoom(options: {
  code: string; instanceId: string; sessionHash: string; name: string;
  mode: GameMode; pace: Pace; seed: number | string; now: number; botDifficulty?: BotDifficulty | "mixed"; rules?: "showdown";
}): RoomState {
  const { code, instanceId, sessionHash, mode, pace, seed, now } = options;
  if (mode !== "human" && mode !== "practice") fail("INVALID_ACTION", "Choose a human room or solo practice.");
  if (pace !== "standard" && pace !== "relaxed") fail("INVALID_ACTION", "Choose standard or relaxed pace.");
  if (options.botDifficulty !== undefined && !["casual","sharp","expert","mixed"].includes(options.botDifficulty)) fail("INVALID_ACTION", "Choose a listed bot difficulty.");
  const name = cleanText(options.name, 18, "Name", 2);
  const room: RoomState = {
    ...(options.rules ? {rules:options.rules} : {}),
    code, instanceId, version: 1, createdAt: now, expiresAt: now + ROOM_LIFETIME_MS,
    hostId: null, mode, pace, phase: "lobby", matchId: null, round: 0,
    phaseStartedAt: now, deadline: null, players: [], current: null,
    history: [], receipts: [], rng: 0,
    // Numeric seeds are for deterministic tests only; HTTP creation supplies 256 random bits.
    rngKey: typeof seed === "string" ? seed : createHash("sha256").update(`fixture:${seed}`).digest("hex"),
    serial: 0,
  };
  const human = newPlayer(room, name, sessionHash, now);
  room.players.push(human);
  room.hostId = human.id;
  if (mode === "practice") {
    for (const [i, botName] of ["Vesper", "Flint", "Echo"].entries()) {
      const bot = newPlayer(room, botName, null, now, true);
      bot.difficulty = options.botDifficulty === "mixed" ? (["casual","sharp","expert"] as const)[i] : options.botDifficulty ?? "sharp";
      room.players.push(bot);
    }
  }
  return room;
}
export function joinRoom(before: RoomState, sessionHash: string, nameInput: string, now: number): RoomState {
  ensureLive(before, now);
  const old = before.players.find((p) => p.sessionHash === sessionHash && !p.bot && !p.left);
  if (old) return advanceRoom(before, now, sessionHash);
  if (before.mode === "practice") fail("PRACTICE_PRIVATE", "Solo practice uses three simulated players. Create a friends room to invite people.", 403);
  if (before.phase !== "lobby" && before.phase !== "finale") {
    fail("MATCH_STARTED", "This match is already in progress. Join after the final reveal, before the rematch.", 409);
  }
  if (before.players.filter(p => !p.left).length >= MAX_PLAYERS) fail("ROOM_FULL", "This room has 10 seats. Ask the host to remove a bot to make space.", 409);
  const name = cleanText(nameInput, 18, "Name", 2);
  if (before.players.some((p) => !p.left && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    fail("NAME_TAKEN", "That name is already in the room. Add an initial or choose another.", 409);
  }
  const room = clone(before);
  // Result snapshots hold their own names and scores; old lobby tombstones need not grow forever.
  const matchSeats = new Set(room.current?.seats ?? []);
  room.players = room.players.filter((p) => !p.left || matchSeats.has(p.id));
  // A returning departed match seat remains departed in the old result, but may rejoin the next match.
  const returning = room.players.find((p) => p.sessionHash === sessionHash && p.left);
  if (returning) {
    returning.left = false;
    returning.lastSeen = now;
    returning.name = name;
  } else {
    room.players.push(newPlayer(room, name, sessionHash, now));
  }
  migrateHost(room, now);
  return finish(before, room);
}
function beginRound(room: RoomState, now: number): void {
  // Match seats remain stable after departure; their cases use labeled defaults.
  const seats = room.current?.seats ?? room.players.filter((p) => !p.left).map((p) => p.id);
  const empty: ProfileId[] = ["ballast", "latch", "liner"];
  const full: ProfileId[] = ["key", "moon", "moth"];
  // Small tables cannot guarantee a composition: at two seats a known split
  // would reveal the opponent immediately from your own private case.
  const fullness = room.rules === 'showdown' || seats.length < 4 ? [] : [false, false, true, true];
  while (fullness.length < seats.length) fullness.push(random(room) >= 0.5);
  const statuses = shuffle(room, fullness);
  room.current = {
    seats, profiles: {}, proofs: {}, receipts: {}, ballots: {}, comments: {}, ready: [], result: null,
  };
  seats.forEach((playerId, index) => {
    room.current!.profiles[playerId] = pick(room, statuses[index] ? full : empty);
  });
  setPhase(room, "prepare", now);
}
function beginMatch(room: RoomState, now: number): void {
  if (!playable(room)) fail("NOT_ENOUGH_PLAYERS", "Add a friend or a bot. A match needs 2–10 seats and at least one human.", 409);
  room.players = room.players.filter((p) => !p.left);
  room.players.forEach((p) => { p.score = 0; p.doublesLeft = 2; });
  if (room.rules === "showdown") {
    const previous = new Set(room.sceneOrder ?? []);
    const fresh = shuffle(room, SCENES.map((_, i) => i).filter(i => !previous.has(i)));
    room.sceneOrder = [...fresh, ...shuffle(room, [...previous])].slice(0, ROUND_COUNT);
  }
  room.matchId = id(room, "m");
  room.round = 1;
  room.history = [];
  room.current = null;
  beginRound(room, now);
}
function beginJudging(room: RoomState, now: number): void {
  const current = room.current!;
  const ring = shuffle(room, current.seats);
  ring.forEach((holder, i) => {
    const subjectId = ring[(i + 1) % ring.length];
    const test = pick(room, TEST_KEYS.filter((key) => key !== current.proofs[subjectId].test));
    const result = PROFILES[current.profiles[subjectId]].tests[test];
    const positiveCount = Number(current.proofs[subjectId].result) + Number(result);
    current.receipts[holder] = {
      subjectId, test, result,
      conclusion: positiveCount === 2 ? "proved full" : positiveCount === 0 ? "proved empty" : "still uncertain",
    };
  });
  setPhase(room, "judge", now);
}
function resolveRound(room: RoomState, now: number): void {
  const current = room.current!;
  if (current.result) return;
  const wrongReceived: Record<string, number> = Object.fromEntries(current.seats.map((pid) => [pid, 0]));
  const scores: ScoreBreakdown[] = current.seats.map((playerId) => {
    const ballot = current.ballots[playerId];
    const verdicts = ballot ? (["inspect", "clear"] as const).filter(kind => kind === "inspect" ? ballot.inspectId : ballot.clearId).map((kind) => {
      const targetId = kind === "inspect" ? ballot.inspectId : ballot.clearId;
      const isFull = PROFILES[current.profiles[targetId]].full;
      const correct = kind === "inspect" ? isFull : !isFull;
      if (!correct) wrongReceived[targetId]++;
      const bold = ballot.bold === kind;
      return { kind, targetId, correct, bold, points: correct ? (bold ? 4 : 2) : (bold ? -2 : 0) };
    }) : [];
    const owner = room.players.find((p) => p.id === playerId)!;
    return {
      playerId, verdicts, investigation: verdicts.reduce((n, v) => n + v.points, 0),
      deception: 0, wrongReceived: 0,
      deceptionEligible: !current.proofs[playerId].automatic && connected(owner, now),
      total: 0, scoreAfter: 0,
    };
  });
  if(room.rules==='showdown') {
    scores.forEach(s=>{s.verdicts=[];s.investigation=0;s.deception=0;s.story='NO JUDGMENT';s.inactivityPenalty=0;});
    for(const judge of scores){
      const ballot=current.ballots[judge.playerId];
      judge.inactivityPenalty=ballot?.automatic ? -2 : 0;
      const targetId=current.receipts[judge.playerId].subjectId;
      const target=scores.find(s=>s.playerId===targetId)!;
      const proof=current.proofs[targetId];
      if(!ballot?.call || proof.automatic)continue;
      const truth=proof.claim===PROFILES[current.profiles[targetId]].full;
      const payoff=showdownPayoff(truth,ballot.call,!!ballot.bold);
      judge.investigation=payoff.judgment;
      judge.verdicts=[{kind:ballot.call==='liar'?'inspect':'clear',targetId,correct:ballot.call==='trust'?truth:!truth,bold:!!ballot.bold,points:payoff.judgment}];
      target.deception=payoff.claim;
      target.story=payoff.story;
    }
  }
  scores.forEach((score) => {
    score.wrongReceived = wrongReceived[score.playerId];
    if(room.rules!=='showdown')score.deception = score.deceptionEligible ? Math.min(3, score.wrongReceived) : 0;
    score.total = score.investigation + score.deception + (score.inactivityPenalty ?? 0);
    const owner = room.players.find((p) => p.id === score.playerId)!;
    owner.score += score.total;
    score.scoreAfter = owner.score;
  });
  const result: RoundResult = {
    round: room.round, resolvedAt: now,
    cases: current.seats.map((playerId) => {
      const p = room.players.find((player) => player.id === playerId)!;
      return {
        playerId, name: p.name, bot: p.bot, left: p.left,
        profile: clone(PROFILES[current.profiles[playerId]]),
        proof: clone(current.proofs[playerId]), comment: current.comments[playerId]?.text ?? "",
      };
    }),
    receipts: clone(current.receipts), verdicts: clone(current.ballots), scores,
  };
  current.result = result;
  room.history.push(clone(result));
  setPhase(room, "reveal", now);
}

/** A bot has exactly its own projected information, never the authoritative table. */
export function chooseBotAction(view: RoomView, rng: () => number): ActionPayload | null {
  if(view.rules==='showdown')return showdownBot(view,rng);
  const choose = <T,>(values: T[]): T => values[Math.floor(rng() * values.length)];
  const difficulty = view.players.find(p => p.id === view.viewerId)?.difficulty ?? "sharp";
  if (view.phase === "prepare" && !view.myProof && view.myCase) {
    const misleading = TEST_KEYS.filter((key) => view.myCase!.tests[key] !== view.myCase!.full);
    const reinforcing = TEST_KEYS.filter((key) => view.myCase!.tests[key] === view.myCase!.full);
    const test = difficulty === "casual" ? choose(TEST_KEYS) : rng() < 0.5 ? choose(misleading) : choose(reinforcing);
    return { type: "proof", test, pitch: choose(["The instrument is telling the truth.", "Consider what this test cannot tell you.", "I stand by the evidence."]) };
  }
  if (view.phase === "judge" && !view.myVerdict) {
    const others = view.cases.filter((c) => c.playerId !== view.viewerId);
    const probabilities = difficulty === "expert" ? inferBotProbabilities(view) : null;
    const weights = others.map((c) => {
      const receipt = view.myReceipt?.subjectId === c.playerId ? view.myReceipt : null;
      const certain = receipt?.conclusion === "proved full" ? 1 : receipt?.conclusion === "proved empty" ? -1 : 0;
      const probability = probabilities?.[c.playerId] ?? (certain === 1 ? 1 : certain === -1 ? 0 : 0.5);
      return { id: c.playerId, certain, probability, weight: difficulty === "casual" ? rng() : difficulty === "expert" ? probability * 10 + rng() * 0.05 : certain * 10 + rng() };
    }).sort((a, b) => b.weight - a.weight);
    if (view.cases.length < 4) {
      const candidate = difficulty === "expert" ? [...weights].sort((a,b) => Math.abs(b.probability - .5) - Math.abs(a.probability - .5))[0] : weights.find(w => difficulty !== "casual" && w.certain !== 0) ?? choose(weights);
      const full = difficulty === "casual" ? rng() < .5 : candidate.probability === .5 ? rng() < .5 : candidate.probability > .5;
      const kind = full ? "inspect" : "clear";
      return { type: "verdict", inspectId: full ? candidate.id : "", clearId: full ? "" : candidate.id, bold: difficulty !== "casual" && Math.max(candidate.probability, 1-candidate.probability) >= .75 ? kind : null };
    }
    const inspectId = weights[0].id;
    const clearId = weights[weights.length - 1].id;
    let bold: Bold = null;
    if (difficulty !== "casual") {
      if (weights[0].certain === 1 || (difficulty === "expert" && weights[0].probability >= .75)) bold = "inspect";
      else if (weights[weights.length - 1].certain === -1 || (difficulty === "expert" && weights[weights.length - 1].probability <= .25)) bold = "clear";
      else if (difficulty === "sharp" && rng() < 0.1) bold = rng() < 0.5 ? "inspect" : "clear";
    }
    return { type: "verdict", inspectId, clearId, bold };
  }
  return null;
}
/** Exact composition inference from this bot's projection only. No hidden table.
 * Public proof is treated as selectively disclosed, not a trustworthy prior. */
export function inferBotProbabilities(view: RoomView): Record<string, number> {
  const others = view.cases.filter(c => c.playerId !== view.viewerId);
  const n = view.cases.length, sums: Record<string, number> = Object.fromEntries(others.map(c => [c.playerId, 0]));
  const binomial = (a: number, b: number) => { if (b < 0 || b > a) return 0; let v = 1; for(let i=1;i<=b;i++) v = v * (a-i+1)/i; return v; };
  let total = 0;
  for(let mask=0; mask < 2 ** others.length; mask++) {
    const statuses = others.map((_,i) => !!(mask & (1 << i)));
    const receipt = view.myReceipt;
    const at = others.findIndex(c => c.playerId === receipt?.subjectId);
    if (receipt && at >= 0 && receipt.conclusion !== "still uncertain" && statuses[at] !== (receipt.conclusion === "proved full")) continue;
    const full = Number(view.myCase?.full) + statuses.filter(Boolean).length;
    const weight = n < 4 ? 1 : binomial(n-4, full-2) / binomial(n, full);
    total += weight;
    others.forEach((c,i) => { if(statuses[i]) sums[c.playerId] += weight; });
  }
  return Object.fromEntries(others.map(c => [c.playerId, total ? sums[c.playerId]/total : .5]));
}
function botView(room: RoomState, player: PlayerState, now: number): RoomView {
  return projectForPlayer(room, player, now);
}
function advanceInternal(room: RoomState, now: number): void {
  migrateHost(room, now);
  const current = room.current;
  if (!current || room.phase === "lobby" || room.phase === "finale") return;
  if (room.phase === "prepare") {
    for (const pid of current.seats) {
      const player = room.players.find((p) => p.id === pid)!;
      if (current.proofs[pid]) continue;
      if (player.bot && now - room.phaseStartedAt >= BOT_DELAY_MS) {
        const action = chooseBotAction(botView(room, player, now), () => random(room));
        if (action?.type === "proof") {
          current.proofs[pid] = {
            test: action.test, result: PROFILES[current.profiles[pid]].tests[action.test],
            pitch: action.pitch ?? "", automatic: false,
            ...(action.claim!==undefined?{claim:action.claim}:{}),
          };
        }
      } else if (player.left || now >= room.deadline!) {
        const test = pick(room, TEST_KEYS);
        current.proofs[pid] = {
          test, result: PROFILES[current.profiles[pid]].tests[test], pitch: "", automatic: true,
        };
      }
    }
    if (current.seats.every((pid) => Boolean(current.proofs[pid]))) beginJudging(room, now);
  } else if (room.phase === "judge") {
    for (const pid of current.seats) {
      const player = room.players.find((p) => p.id === pid)!;
      if (own(current.ballots, pid)) continue;
      if (player.bot && now - room.phaseStartedAt >= BOT_DELAY_MS) {
        const view = botView(room, player, now);
        const action = chooseBotAction(view, () => random(room));
        if (action?.type === "challenge") {
          const target=current.receipts[pid].subjectId;
          const useDouble=action.double && !current.proofs[target].automatic;
          const asFull=action.call==='trust'?current.proofs[target].claim:!current.proofs[target].claim;
          current.ballots[pid]={inspectId:asFull?target:'',clearId:asFull?'':target,bold:useDouble?(asFull?'inspect':'clear'):null,call:action.call};
          if(useDouble)player.doublesLeft=(player.doublesLeft??0)-1;
          current.comments[pid]={text:pick(room,['My lawyer has advised me to look offended.','Interesting story. Did the case write it?','I have never been more confidently uncertain.']),updates:1};
        } else if (action?.type === "verdict") {
          current.ballots[pid] = { inspectId: action.inspectId, clearId: action.clearId, bold: action.bold };
          const receipt = view.myReceipt!;
          const subject = view.cases.find((c) => c.playerId === receipt.subjectId)!;
          current.comments[pid] = {
            text: receipt.conclusion === "still uncertain"
              ? "My extra test leaves the case uncertain."
              : `My receipt: ${subject.name} is ${receipt.conclusion}.`,
            updates: 1,
          };
        }
      } else if (player.left || now >= room.deadline!) {
        if (room.rules === 'showdown') {
          const target=current.receipts[pid].subjectId;
          const asFull=current.proofs[target].claim;
          current.ballots[pid]={call:'trust',inspectId:asFull?target:'',clearId:asFull?'':target,bold:null,automatic:true};
        } else current.ballots[pid] = null;
      }
    }
    if (current.seats.every((pid) => own(current.ballots, pid))) resolveRound(room, now);
  } else if (room.phase === "reveal") {
    const humans = current.seats.filter((pid) => {
      const p = room.players.find((player) => player.id === pid)!;
      return !p.bot && !p.left;
    });
    const allReady = humans.length > 0 && humans.every((pid) => current.ready.includes(pid));
    if (now >= room.deadline! || (allReady && now - room.phaseStartedAt >= MIN_REVEAL_MS)) {
      if (room.round >= ROUND_COUNT) setPhase(room, "finale", now);
      else {
        room.round++;
        beginRound(room, now);
      }
    }
  }
}
export function advanceRoom(before: RoomState, now: number, sessionHash?: string): RoomState {
  ensureLive(before, now);
  const room = clone(before);
  if (sessionHash) {
    const player = member(room, sessionHash);
    if (now - player.lastSeen >= PRESENCE_WRITE_MS) player.lastSeen = now;
  }
  advanceInternal(room, now);
  return finish(before, room);
}
const PHASES: Phase[] = ["lobby", "prepare", "judge", "reveal", "finale"];
/** Normalizes exactly the accepted command fields before fingerprinting. */
export function parseAction(input: unknown): GameAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_ACTION", "A command must be a JSON object.");
  const raw = input as Record<string, unknown>;
  if (typeof raw.requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.requestId)) fail("INVALID_ACTION", "A valid request ID is required.");
  if (typeof raw.instanceId !== "string" || raw.instanceId.length < 8 || raw.instanceId.length > 100) fail("INVALID_ACTION", "A room identity is required.");
  if (raw.matchId !== undefined && raw.matchId !== null && (typeof raw.matchId !== "string" || raw.matchId.length > 100)) fail("INVALID_ACTION", "Invalid match identity.");
  if (raw.round !== undefined && (!Number.isInteger(raw.round) || Number(raw.round) < 0 || Number(raw.round) > ROUND_COUNT)) fail("INVALID_ACTION", "Invalid round.");
  if (raw.phase !== undefined && !PHASES.includes(raw.phase as Phase)) fail("INVALID_ACTION", "Invalid phase.");
  const identity = {
    requestId: raw.requestId, instanceId: raw.instanceId,
    ...(raw.matchId !== undefined ? { matchId: raw.matchId as string | null } : {}),
    ...(raw.round !== undefined ? { round: raw.round as number } : {}),
    ...(raw.phase !== undefined ? { phase: raw.phase as Phase } : {}),
  };
  let payload: ActionPayload;
  let allowed: string[] = [];
  switch (raw.type) {
    case "start": case "rematch": case "ready": case "leave":
      payload = { type: raw.type }; break;
    case "bots":
      if (!Number.isInteger(raw.count) || Number(raw.count) < 0 || Number(raw.count) > 9 || !["casual","sharp","expert","mixed"].includes(String(raw.difficulty))) fail("INVALID_ACTION", "Choose 0–9 bots and a listed difficulty.");
      payload = { type: "bots", count: Number(raw.count), difficulty: raw.difficulty as BotDifficulty | "mixed" };
      allowed = ["count", "difficulty"]; break;
    case "proof":
      if (!TEST_KEYS.includes(raw.test as TestKey)) fail("INVALID_ACTION", "Choose WEIGH, LISTEN, or SCAN.");
      if(raw.claim!==undefined && typeof raw.claim!=='boolean')fail('INVALID_ACTION','Choose FULL or EMPTY.');
      payload = { type: "proof", test: raw.test as TestKey, pitch: cleanText(raw.pitch ?? "", 80, "Pitch"),...(raw.claim!==undefined?{claim:raw.claim as boolean}:{}) };
      allowed = ["test", "pitch", "claim"]; break;
    case 'challenge':
      if(!['trust','liar'].includes(String(raw.call))||typeof raw.double!=='boolean')fail('INVALID_ACTION','Choose Trust or Liar and a valid wager.');
      payload={type:'challenge',call:raw.call as 'trust'|'liar',double:raw.double};allowed=['call','double'];break;
    case "comment":
      payload = { type: "comment", text: cleanText(raw.text, 80, "Comment") };
      allowed = ["text"]; break;
    case "verdict":
      if (typeof raw.inspectId !== "string" || typeof raw.clearId !== "string" || raw.inspectId.length > 100 || raw.clearId.length > 100) fail("INVALID_ACTION", "Choose two case owners.");
      if (raw.bold !== null && raw.bold !== "inspect" && raw.bold !== "clear") fail("INVALID_ACTION", "Bold must be inspect, clear, or null.");
      payload = { type: "verdict", inspectId: raw.inspectId, clearId: raw.clearId, bold: raw.bold };
      allowed = ["inspectId", "clearId", "bold"]; break;
    case "kick":
      if (typeof raw.playerId !== "string" || raw.playerId.length > 100) fail("INVALID_ACTION", "Choose a player to remove.");
      payload = { type: "kick", playerId: raw.playerId }; allowed = ["playerId"]; break;
    default: fail("INVALID_ACTION", "That command is not available.");
  }
  const keys = new Set(["type", "requestId", "instanceId", "matchId", "round", "phase", ...allowed]);
  if (Object.keys(raw).some((key) => !keys.has(key))) fail("INVALID_ACTION", "The command contained unsupported fields.");
  return { ...identity, ...payload };
}
function requirePhase(room: RoomState, expected: Phase): void {
  if (room.phase !== expected) fail("STALE_PHASE", "The room has moved to a different phase. Your screen will refresh.", 409);
}
export function applyAction(before: RoomState, sessionHash: string, input: unknown, now: number): RoomState {
  ensureLive(before, now);
  const action = parseAction(input);
  const actor = member(before, sessionHash, true);
  if (action.instanceId !== before.instanceId) fail("STALE_ROOM", "That invitation belongs to an older room. Open the current invitation.", 409);
  const fingerprint = JSON.stringify(action);
  const receipt = before.receipts.find((r) => r.playerId === actor.id && r.requestId === action.requestId);
  if (receipt) {
    if (actor.left && action.type !== "leave") fail("NOT_MEMBER", "You have left this room.", 403);
    if (receipt.fingerprint !== fingerprint) fail("REQUEST_REUSED", "This request ID was already used for a different command.", 409);
    return before;
  }
  if (actor.left) fail("NOT_MEMBER", "You have left this room.", 403);
  const current = advanceRoom(before, now, sessionHash);
  const room = clone(current);
  const player = member(room, sessionHash);
  const strict = !["start", "leave", "kick"].includes(action.type);
  if ((strict || action.matchId !== undefined) && action.matchId !== room.matchId) fail("STALE_MATCH", "That action belongs to another match.", 409);
  if ((strict || action.round !== undefined) && action.round !== room.round) fail("STALE_ROUND", "That action belongs to another round.", 409);
  if ((strict || action.phase !== undefined) && action.phase !== room.phase) fail("STALE_PHASE", "That action belongs to another phase.", 409);
  const hostOnly = () => { if (player.id !== room.hostId) fail("HOST_ONLY", "Only the current host can do that.", 403); };
  switch (action.type) {
    case "bots": {
      hostOnly();
      if (room.phase !== "lobby" && room.phase !== "finale") fail("STALE_PHASE", "Change bots between matches.", 409);
      if (activeHumans(room).length + action.count > MAX_PLAYERS) fail("ROOM_FULL", "Humans and bots share the ten seats.", 409);
      const existing = room.players.filter(p => p.bot && !p.left);
      // Preserve current-match identities and scores until rematch; retired bots
      // remain available to the finale's old score ledger.
      existing.slice(action.count).forEach(p => { p.left = true; });
      const levels: BotDifficulty[] = ["casual","sharp","expert"];
      const names = ["Vesper","Flint","Echo","Marlow","Sable","Rook","Iris","Ash","Wren"];
      for(let i=0; i<action.count; i++) {
        let bot = existing[i];
        if (!bot) {
          let name = names.find(n => !room.players.some(p => !p.left && p.name.toLowerCase() === n.toLowerCase())) ?? "Archive bot";
          while(room.players.some(p => !p.left && p.name.toLowerCase() === name.toLowerCase())) name = "Bot " + (++room.serial);
          bot = newPlayer(room, name, null, now, true); room.players.push(bot);
        }
        bot.difficulty = action.difficulty === "mixed" ? levels[i%3] : action.difficulty;
      }
      room.players = room.players.filter(p => !p.left || !!room.current?.seats.includes(p.id));
      break;
    }
    case "start":
      hostOnly(); requirePhase(room, "lobby"); beginMatch(room, now); break;
    case "rematch":
      hostOnly(); requirePhase(room, "finale"); beginMatch(room, now); break;
    case "proof": {
      requirePhase(room, "prepare");
      if (!room.current!.seats.includes(player.id)) fail("NOT_PLAYING", "Your seat joins the next match.", 409);
      if (room.current!.proofs[player.id]) fail("ALREADY_LOCKED", "Your evidence is already locked.", 409);
      if(room.rules==='showdown' && typeof action.claim!=='boolean')fail('INVALID_ACTION','Make a FULL or EMPTY claim. You may lie.');
      room.current!.proofs[player.id] = {
        test: action.test, result: PROFILES[room.current!.profiles[player.id]].tests[action.test],
        pitch: action.pitch ?? "", automatic: false,
        ...(action.claim!==undefined?{claim:action.claim}:{}),
      };
      break;
    }
    case "comment": {
      requirePhase(room, "judge");
      if (!room.current!.seats.includes(player.id)) fail("NOT_PLAYING", "Your seat joins the next match.", 409);
      const old = room.current!.comments[player.id];
      if ((old?.updates ?? 0) >= 3) fail("COMMENT_LIMIT", "You have used your three statement updates this round.", 409);
      room.current!.comments[player.id] = { text: action.text, updates: (old?.updates ?? 0) + 1 };
      break;
    }
    case "verdict": {
      if(room.rules==='showdown')fail('INVALID_ACTION','Trust your rival or call LIAR.');
      requirePhase(room, "judge");
      const round = room.current!;
      if (!round.seats.includes(player.id)) fail("NOT_PLAYING", "Your seat joins the next match.", 409);
      if (own(round.ballots, player.id)) fail("ALREADY_LOCKED", "Your verdicts are already locked.", 409);
      const targets = [action.inspectId, action.clearId].filter(Boolean);
      if (round.seats.length < 4 ? targets.length !== 1 : targets.length !== 2) fail("INVALID_TARGET", round.seats.length < 4 ? "Face-off: make exactly one inspect OR clear judgment." : "Inspect and clear two different cases.");
      if (action.inspectId === action.clearId || action.inspectId === player.id || action.clearId === player.id) {
        fail("INVALID_TARGET", "Inspect and clear two different cases, neither your own.");
      }
      if (targets.some(id => !round.seats.includes(id))) fail("INVALID_TARGET", "Choose cases dealt in this round.");
      if (action.bold && !(action.bold === "inspect" ? action.inspectId : action.clearId)) fail("INVALID_TARGET", "Only a selected verdict can be bold.");
      round.ballots[player.id] = { inspectId: action.inspectId, clearId: action.clearId, bold: action.bold };
      break;
    }
    case 'challenge': {
      requirePhase(room,'judge');
      if(room.rules!=='showdown')fail('INVALID_ACTION','This room uses the original rules.');
      const round=room.current!;
      if(!round.seats.includes(player.id))fail('NOT_PLAYING','Your seat joins the next match.',409);
      if(own(round.ballots,player.id))fail('ALREADY_LOCKED','Your judgment is sealed.',409);
      const target=round.receipts[player.id].subjectId;
      const useDouble=action.double && !round.proofs[target].automatic;
      if(useDouble&&(player.doublesLeft??0)<1)fail('NO_CHIPS','You used both double-down chips.',409);
      const asFull=action.call==='trust'?round.proofs[target].claim:!round.proofs[target].claim;
      round.ballots[player.id]={inspectId:asFull?target:'',clearId:asFull?'':target,bold:useDouble?(asFull?'inspect':'clear'):null,call:action.call};
      if(useDouble)player.doublesLeft=(player.doublesLeft??0)-1;
      break;
    }
    case "ready":
      requirePhase(room, "reveal");
      if (!room.current!.seats.includes(player.id)) fail("NOT_PLAYING", "Your seat joins the next match.", 409);
      if (!room.current!.ready.includes(player.id)) room.current!.ready.push(player.id);
      break;
    case "leave":
      player.left = true;
      break;
    case "kick": {
      hostOnly(); requirePhase(room, "lobby");
      const target = room.players.find((p) => p.id === action.playerId && !p.left);
      if (!target || target.id === player.id) fail("INVALID_TARGET", "Choose another lobby seat.");
      target.left = true; break;
    }
  }
  room.receipts.push({ playerId: player.id, requestId: action.requestId, fingerprint, at: now });
  room.receipts = room.receipts.slice(-256);
  advanceInternal(room, now);
  return finish(before, room);
}

function projectForPlayer(room: RoomState, viewer: PlayerState, now: number): RoomView {
  const current = room.current;
  const evidencePublic = room.phase === "judge" || room.phase === "reveal" || room.phase === "finale";
  const hasOwnCase = !viewer.left && current && own(current.profiles, viewer.id);
  const eligible = !viewer.left && viewer.id === room.hostId && playable(room);
  const matchPlayers = room.players.filter((p) => current?.seats.includes(p.id));
  const high = Math.max(...matchPlayers.map((p) => p.score));
  return {
    ...(room.rules?{rules:room.rules,rivalId:evidencePublic?current?.receipts[viewer.id]?.subjectId:undefined,judgeId:evidencePublic?Object.entries(current?.receipts??{}).find(([,r])=>r.subjectId===viewer.id)?.[0]:undefined,sceneIndex:room.sceneOrder?.[room.round-1],doublesLeft:viewer.doublesLeft??2}:{}),
    code: room.code, instanceId: room.instanceId, version: room.version, serverNow: now,
    expiresAt: room.expiresAt, mode: room.mode, pace: room.pace, phase: room.phase,
    hostId: room.hostId, viewerId: viewer.id, matchId: room.matchId, round: room.round,
    maxRounds: ROUND_COUNT, deadline: room.deadline, phaseStartedAt: room.phaseStartedAt,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, bot: p.bot, score: p.score, left: p.left,
      ...(p.bot ? { difficulty: p.difficulty ?? "sharp" } : {}),
      connected: connected(p, now), isHost: p.id === room.hostId,
      proofSubmitted: Boolean(current?.proofs[p.id]),
      verdictSubmitted: Boolean(current && own(current.ballots, p.id)),
      ready: Boolean(current?.ready.includes(p.id)),
    })),
    cases: (viewer.left ? [] : current?.seats ?? []).map((pid) => {
      const p = room.players.find((player) => player.id === pid)!;
      return {
        playerId: pid, name: p.name, bot: p.bot, left: p.left,
        proof: evidencePublic && current!.proofs[pid] ? clone(current!.proofs[pid]) : null,
        comment: evidencePublic ? current!.comments[pid]?.text ?? "" : "",
      };
    }),
    myCase: hasOwnCase ? clone(PROFILES[current!.profiles[viewer.id]]) : null,
    myProof: hasOwnCase && current!.proofs[viewer.id] ? clone(current!.proofs[viewer.id]) : null,
    myReceipt: room.rules!=='showdown' && hasOwnCase && evidencePublic && current!.receipts[viewer.id] ? clone(current!.receipts[viewer.id]) : null,
    myVerdict: hasOwnCase && current!.ballots[viewer.id] ? clone(current!.ballots[viewer.id]) : null,
    myCommentUpdates: current?.comments[viewer.id]?.updates ?? 0,
    history: viewer.left ? [] : clone(room.history),
    result: !viewer.left && current?.result ? clone(current.result) : null,
    winnerIds: room.phase === "finale" ? matchPlayers.filter((p) => p.score === high).map((p) => p.id) : [],
    canStart: eligible && room.phase === "lobby", canRematch: eligible && room.phase === "finale",
  };
}
export function projectRoom(room: RoomState, sessionHash: string, now: number, allowLeft = false): RoomView {
  ensureLive(room, now);
  return projectForPlayer(room, member(room, sessionHash, allowLeft), now);
}
