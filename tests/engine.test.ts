import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceRoom, applyAction, chooseBotAction, createRoom, GameError, joinRoom, parseAction, projectRoom,
} from "../lib/game-engine.ts";
import { PROFILES, PROFILE_LIST, TEST_KEYS } from "../lib/game-content.ts";
import {
  cleanupExpired, compareAndSwap, enforceLimit, insertRoom, loadRoom, updateRoom,
} from "../lib/game-store.ts";
import type { ActionPayload, Bold, GameAction, ProfileId, RoomState, TestKey } from "../lib/game-types.ts";
import { sqliteD1 } from "./sqlite-d1.ts";

const NOW = 1_000_000;
let requestSequence = 0;
function command(room: RoomState, payload: ActionPayload): GameAction {
  return {
    requestId: `request_${++requestSequence}`, instanceId: room.instanceId,
    matchId: room.matchId, round: room.round, phase: room.phase, ...payload,
  };
}
function act(room: RoomState, index: number, payload: ActionPayload, now = NOW + 100): RoomState {
  return applyAction(room, `session-${index}`, command(room, payload), now);
}
function lobby(count = 4, seed = 17): RoomState {
  let room = createRoom({
    code: "ABCDE", instanceId: "fixture-instance-1234", sessionHash: "session-0",
    name: "Player 0", mode: "human", pace: "standard", seed, now: NOW,
  });
  for (let i = 1; i < count; i++) room = joinRoom(room, `session-${i}`, `Player ${i}`, NOW);
  return room;
}
function started(count = 4, seed = 17): RoomState { return act(lobby(count, seed), 0, { type: "start" }); }
function publish(room: RoomState, testKey: TestKey = "weigh", now = NOW + 200): RoomState {
  for (let i = 0; i < room.players.length; i++) {
    const player = room.players[i];
    if (!player.bot && !player.left && !room.current!.proofs[player.id]) {
      room = act(room, i, { type: "proof", test: testKey, pitch: `Pitch ${i}` }, now);
    }
  }
  return room;
}
function knownJudge(count = 4): RoomState {
  const room = started(count);
  const profiles: ProfileId[] = ["ballast", "latch", "key", "moon"];
  room.current!.seats.forEach((pid, i) => { room.current!.profiles[pid] = profiles[i % 4]; });
  return publish(room);
}
function zeroRemainder(room: RoomState, now = NOW + 300): RoomState {
  // Departures exercise the real no-verdict behavior without waiting 60s.
  for (let i = 0; i < room.players.length && room.phase === "judge"; i++) {
    if (!Object.hasOwn(room.current!.ballots, room.players[i].id) && !room.players[i].left) {
      room = act(room, i, { type: "leave" }, now);
    }
  }
  return room;
}
function errorCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error) => error instanceof GameError && error.code === code);
}
async function rejection(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof GameError && error.code === code);
}

test("six calibrated profiles have exactly one/two positive tests and overlapping single evidence", () => {
  assert.equal(PROFILE_LIST.length, 6);
  for (const profile of PROFILE_LIST) {
    assert.equal(Object.values(profile.tests).filter(Boolean).length, profile.full ? 2 : 1);
  }
  for (const key of TEST_KEYS) {
    for (const sign of [false, true]) {
      assert.deepEqual(new Set(PROFILE_LIST.filter((p) => p.tests[key] === sign).map((p) => p.full)), new Set([false, true]));
    }
  }
});

test("4–10 deals have at least two of each status; receipt ring is bijective, non-self, distinct test and logically sound", () => {
  for (const count of [4, 7, 10]) {
    for (let seed = 0; seed < 40; seed++) {
      let room = started(count, seed);
      const before = structuredClone(room);
      const fullCount = Object.values(room.current!.profiles).filter((key) => PROFILES[key].full).length;
      assert.ok(fullCount >= 2 && fullCount <= count - 2);
      room = publish(room);
      assert.equal(room.phase, "judge");
      assert.deepEqual(before.current!.receipts, {});
      const receipts = room.current!.receipts;
      assert.equal(Object.keys(receipts).length, count);
      assert.equal(new Set(Object.values(receipts).map((r) => r.subjectId)).size, count);
      for (const [holder, receipt] of Object.entries(receipts)) {
        assert.notEqual(holder, receipt.subjectId);
        const proof = room.current!.proofs[receipt.subjectId];
        assert.notEqual(receipt.test, proof.test);
        const profile = PROFILES[room.current!.profiles[receipt.subjectId]];
        assert.equal(receipt.result, profile.tests[receipt.test]);
        if (receipt.conclusion === "proved full") assert.equal(profile.full, true);
        if (receipt.conclusion === "proved empty") assert.equal(profile.full, false);
      }
    }
  }
});

test("private projection never exposes credentials, RNG, other proofs/ballots/receipts or persistence receipts", () => {
  let room = started();
  const original = structuredClone(room);
  room = act(room, 1, { type: "proof", test: "scan", pitch: "UNPUBLISHED-PITCH" });
  const before = projectRoom(room, "session-0", NOW + 200);
  const text = JSON.stringify(before);
  for (const forbidden of ["session-1", room.rngKey, "UNPUBLISHED-PITCH", "fingerprint", "rngKey", "sessionHash"]) assert.ok(!text.includes(forbidden));
  assert.equal(before.myReceipt, null);
  assert.ok(before.cases.every((c) => c.proof === null));
  assert.equal(before.players[1].proofSubmitted, true);
  assert.equal(original.current!.proofs[room.players[1].id], undefined, "input snapshot remains unchanged");
  room = publish(room);
  const ids = room.current!.seats;
  room = act(room, 1, { type: "verdict", inspectId: ids[2], clearId: ids[3], bold: "inspect" });
  const judgeView = projectRoom(room, "session-0", NOW + 300);
  assert.equal(judgeView.myVerdict, null);
  assert.equal(judgeView.players[1].verdictSubmitted, true);
  assert.equal(judgeView.history.length, 0);
  assert.equal(judgeView.result, null);
  assert.ok(!("receipts" in judgeView));
  assert.ok(!("current" in judgeView));
  assert.ok(!("ballots" in judgeView));
  assert.deepEqual(judgeView.myReceipt, room.current!.receipts[ids[0]]);
  errorCode(() => projectRoom(room, "attacker", NOW + 300), "NOT_MEMBER");
});

for (const bold of [null, "inspect", "clear"] as Bold[]) {
  for (const inspectCorrect of [false, true]) {
    for (const clearCorrect of [false, true]) {
      test(`investigation scoring: bold=${bold}, inspect=${inspectCorrect}, clear=${clearCorrect}`, () => {
        // A fifth empty case makes every branch use distinct, non-self targets.
        let room = knownJudge(5);
        const targetIds = room.current!.seats;
        const inspect = inspectCorrect ? targetIds[2] : targetIds[1];
        const clear = clearCorrect ? targetIds[4] : targetIds[3];
        room = act(room, 0, { type: "verdict", inspectId: inspect, clearId: clear, bold });
        room = zeroRemainder(room);
        assert.equal(room.phase, "reveal");
        const score = room.current!.result!.scores.find((s) => s.playerId === targetIds[0])!;
        const expected = (inspectCorrect ? (bold === "inspect" ? 4 : 2) : (bold === "inspect" ? -2 : 0))
          + (clearCorrect ? (bold === "clear" ? 4 : 2) : (bold === "clear" ? -2 : 0));
        assert.equal(score.investigation, expected);
        assert.equal(score.verdicts.length, 2);
        assert.equal(score.verdicts.filter((v) => v.bold).length, bold ? 1 : 0);
      });
    }
  }
}

test("deception is capped at 3, does not reward departed/automatic owners, and reveal does not rescore", () => {
  let room = knownJudge(10);
  const ids = room.current!.seats;
  for (let i = 0; i < 10; i++) {
    const inspectId = i === 0 ? ids[1] : ids[0]; // Empty case receives nine wrong inspections.
    const clearId = i === 2 ? ids[3] : ids[2];
    room = act(room, i, { type: "verdict", inspectId, clearId, bold: null });
  }
  const owner = room.current!.result!.scores[0];
  assert.equal(owner.wrongReceived, 9);
  assert.equal(owner.deception, 3);
  const scored = room.players.map((p) => p.score);
  room = advanceRoom(room, NOW + 500);
  assert.deepEqual(room.players.map((p) => p.score), scored);
  assert.equal(room.history.length, 1);
  let departed = knownJudge();
  const target = departed.players[1].id;
  departed = act(departed, 1, { type: "leave" });
  departed = act(departed, 0, { type: "verdict", inspectId: target, clearId: departed.players[3].id, bold: null });
  departed = zeroRemainder(departed);
  assert.equal(departed.current!.result!.scores[1].deception, 0);
});

test("timeouts publish a labeled automatic proof, record no verdict, and retain a full reveal duration", () => {
  let room = started();
  const late = room.deadline! + 300_000;
  room = advanceRoom(room, late);
  assert.equal(room.phase, "judge");
  assert.ok(Object.values(room.current!.proofs).every((p) => p.automatic && p.pitch === ""));
  assert.equal(room.deadline, late + 60_000);
  room = advanceRoom(room, room.deadline! + 300_000);
  assert.equal(room.phase, "reveal");
  assert.ok(Object.values(room.current!.ballots).every((b) => b === null));
  assert.ok(room.current!.result!.scores.every((s) => s.total === 0 && !s.deceptionEligible));
  assert.equal(room.deadline, room.phaseStartedAt + 14_000);
  const now = room.phaseStartedAt;
  for (let i = 0; i < 4; i++) room = act(room, i, { type: "ready" }, now);
  assert.equal(room.phase, "reveal", "all ready cannot skip minimum readable reveal");
  room = advanceRoom(room, now + 2_000);
  assert.equal(room.phase, "prepare");
  assert.equal(room.round, 2);
});

test("duplicate commands survive phase advancement; changed payload, self targets, stale identity and phase are rejected", () => {
  let room = started();
  const proof = command(room, { type: "proof", test: "listen", pitch: "Original" });
  room = applyAction(room, "session-0", proof, NOW + 100);
  room = publish(room);
  const duplicate = applyAction(room, "session-0", proof, NOW + 300);
  assert.strictEqual(duplicate, room);
  errorCode(() => applyAction(room, "session-0", { ...proof, pitch: "Changed" }, NOW + 300), "REQUEST_REUSED");
  errorCode(() => act(room, 0, { type: "proof", test: "scan" }), "STALE_PHASE");
  errorCode(() => act(room, 0, { type: "verdict", inspectId: room.players[0].id, clearId: room.players[1].id, bold: null }), "INVALID_TARGET");
  const action = command(room, { type: "verdict", inspectId: room.players[1].id, clearId: room.players[2].id, bold: null });
  errorCode(() => applyAction(room, "session-0", { ...action, instanceId: "wrong-instance" }, NOW + 300), "STALE_ROOM");
  errorCode(() => applyAction(room, "session-0", { ...action, matchId: "wrong-match" }, NOW + 300), "STALE_MATCH");
  errorCode(() => applyAction(room, "session-0", { ...action, round: 2 }, NOW + 300), "STALE_ROUND");
});

test("lobby capacity, host-only start, late join, leave, and refresh membership boundaries", () => {
  let room = lobby(10);
  errorCode(() => joinRoom(room, "extra", "Extra human", NOW), "ROOM_FULL");
  errorCode(() => act(room, 1, { type: "start" }), "HOST_ONLY");
  assert.equal(joinRoom(room, "session-2", "Ignored rename", NOW).players.length, 10);
  room = act(room, 0, { type: "start" });
  errorCode(() => joinRoom(room, "late", "Late arrival", NOW), "MATCH_STARTED");
  const leave = command(room, { type: "leave" });
  room = applyAction(room, "session-0", leave, NOW + 200);
  assert.equal(room.hostId, room.players[1].id);
  errorCode(() => projectRoom(room, "session-0", NOW + 300), "NOT_MEMBER");
  const response = projectRoom(room, "session-0", NOW + 300, true);
  assert.equal(response.myCase, null);
  assert.deepEqual(response.cases, []);
  assert.strictEqual(applyAction(room, "session-0", leave, NOW + 300), room);
  assert.equal(room.current!.seats.length, 10);
});

test("presence is throttled; idle host migrates after grace and does not retake authority", () => {
  let room = lobby();
  assert.strictEqual(advanceRoom(room, NOW + 1_000, "session-1"), room);
  room = advanceRoom(room, NOW + 12_000, "session-1");
  assert.equal(room.players[1].lastSeen, NOW + 12_000);
  room = advanceRoom(room, NOW + 61_000, "session-1");
  assert.equal(room.hostId, room.players[1].id);
  room = advanceRoom(room, NOW + 61_100, "session-0");
  assert.equal(room.hostId, room.players[1].id);
  errorCode(() => act(room, 0, { type: "start" }, NOW + 61_200), "HOST_ONLY");
  errorCode(() => advanceRoom(room, room.expiresAt), "ROOM_EXPIRED");
});

test("comments are replaceable three times and frozen proof cannot change", () => {
  let room = knownJudge();
  for (let i = 0; i < 3; i++) room = act(room, 0, { type: "comment", text: `Claim ${i}` });
  assert.equal(projectRoom(room, "session-0", NOW + 300).cases[0].comment, "Claim 2");
  assert.equal(projectRoom(room, "session-0", NOW + 300).myCommentUpdates, 3);
  errorCode(() => act(room, 0, { type: "comment", text: "Fourth" }), "COMMENT_LIMIT");
});

test("five rounds, repeated rematches, ties and bounded history at 4/7/10 seats", () => {
  for (const count of [4, 7, 10]) {
    let room = started(count);
    let now = NOW + 200;
    for (let match = 0; match < 3; match++) {
      const oldMatch = room.matchId;
      for (let round = 1; round <= 5; round++) {
        assert.equal(room.round, round);
        room = advanceRoom(room, room.deadline!);
        room = advanceRoom(room, room.deadline!);
        assert.equal(room.phase, "reveal");
        now = room.deadline!;
        room = advanceRoom(room, now, "session-0");
      }
      assert.equal(room.phase, "finale");
      assert.equal(room.history.length, 5);
      assert.equal(projectRoom(room, "session-0", now).winnerIds.length, count);
      const stale = command(room, { type: "rematch" });
      room = applyAction(room, "session-0", stale, now + 1);
      assert.equal(room.phase, "prepare");
      assert.notEqual(room.matchId, oldMatch);
      assert.equal(room.history.length, 0);
      assert.ok(room.players.every((p) => p.score === 0));
      assert.strictEqual(applyAction(room, "session-0", stale, now + 2), room);
      errorCode(() => applyAction(room, "session-0", { ...stale, requestId: `new_${++requestSequence}`, type: "ready" }, now + 2), "STALE_MATCH");
    }
  }
});

test("departed cases persist in later rounds but do not reappear in rematch", () => {
  let room = started(5);
  room = act(room, 4, { type: "leave" });
  const leftId = room.players[4].id;
  for (let round = 1; round <= 5; round++) {
    room = advanceRoom(room, room.deadline!);
    assert.ok(room.current!.seats.includes(leftId));
    assert.equal(room.current!.proofs[leftId].automatic, true);
    room = advanceRoom(room, room.deadline!);
    room = advanceRoom(room, room.deadline!, "session-0");
  }
  room = act(room, 0, { type: "rematch" }, room.phaseStartedAt + 1);
  assert.equal(room.current!.seats.length, 4);
  assert.ok(!room.players.some((p) => p.id === leftId));
});

test("practice bots use projected knowledge and the same scoring loop", () => {
  let room = createRoom({
    code: "ABCDE", instanceId: "practice-instance", sessionHash: "session-0", name: "Judge",
    mode: "practice", pace: "standard", seed: 0, now: NOW,
  });
  assert.equal(room.players.filter((p) => p.bot).length, 3);
  errorCode(() => joinRoom(room, "visitor", "Visitor", NOW), "PRACTICE_PRIVATE");
  room = act(room, 0, { type: "start" });
  let now = NOW + 200;
  for (let round = 1; round <= 5; round++) {
    now = room.phaseStartedAt + 1_900;
    room = act(room, 0, { type: "proof", test: "listen" }, now);
    assert.equal(room.phase, "judge");
    const view = projectRoom(room, "session-0", now);
    const botLike = chooseBotAction(view, () => 0.25);
    assert.equal(botLike?.type, "verdict");
    room = act(room, 0, botLike!, now + 1_900);
    assert.equal(room.phase, "reveal");
    assert.ok(room.current!.result!.scores.every((s) => s.verdicts.length === 2));
    now = room.deadline!;
    room = advanceRoom(room, now, "session-0");
  }
  assert.equal(room.phase, "finale");
  assert.equal(room.history.length, 5);
});

test("parser rejects injected result fields, unknown actions, overlong content, malformed IDs and invalid bold", () => {
  const room = started();
  const proof = command(room, { type: "proof", test: "weigh" });
  for (const value of [
    { ...proof, result: true }, { ...proof, type: "score", points: 999 },
    { ...proof, pitch: "x".repeat(81) }, { ...proof, requestId: "bad" },
    { ...proof, test: "__proto__" },
  ]) errorCode(() => parseAction(value), "INVALID_ACTION");
  errorCode(() => parseAction({ ...proof, type: "verdict", test: undefined, inspectId: "a", clearId: "b", bold: true }), "INVALID_ACTION");
});

test("public identifiers consume no private randomness and keyed snapshots replay deterministically", () => {
  const first = lobby(4, 123);
  const second = lobby(4, 456);
  assert.deepEqual(first.players.map((p) => p.id), second.players.map((p) => p.id));
  assert.equal(first.rng, 0);
  const start = command(first, { type: "start" });
  assert.deepEqual(applyAction(first, "session-0", start, NOW), applyAction(first, "session-0", start, NOW));
  const view = projectRoom(first, "session-0", NOW);
  assert.ok(!JSON.stringify(view).includes(first.rngKey));
});

test("real SQLite CAS preserves capacity under concurrent joins and rejects recycled instance identities", async () => {
  const { binding: db, sqlite, stats } = sqliteD1();
  try {
    const room = lobby(1);
    assert.equal(await insertRoom(db, room), true);
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => updateRoom(db, room.code, {
      now: () => NOW,
      operation: (snapshot, now) => joinRoom(snapshot, `parallel-${i}`, `Guest ${i}`, now),
    })));
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 9);
    const final = await loadRoom(db, room.code);
    assert.equal(final.players.length, 10);
    assert.equal(new Set(final.players.map((p) => p.id)).size, 10);
    assert.ok(stats.conflicts > 0, "test actually caused concurrent stale reads");
    const replacement = { ...final, instanceId: "replacement-room" };
    sqlite.prepare("DELETE FROM game_rooms WHERE code = ?").run(final.code);
    assert.equal(await insertRoom(db, replacement), true);
    assert.equal(await compareAndSwap(db, final, { ...final, version: final.version + 1 }), false);
  } finally { sqlite.close(); }
});

test("concurrent duplicate actions lock once; zero-row CAS never acknowledges losing state", async () => {
  const { binding: db, sqlite, stats } = sqliteD1();
  try {
    const initial = started();
    await insertRoom(db, initial);
    const action = command(initial, { type: "proof", test: "scan", pitch: "Only once" });
    await Promise.all(Array.from({ length: 8 }, () => updateRoom(db, initial.code, {
      sessionHash: "session-0", now: () => NOW + 200,
      operation: (room, now) => applyAction(room, "session-0", action, now),
    })));
    const final = await loadRoom(db, initial.code);
    assert.equal(final.receipts.filter((r) => r.requestId === action.requestId).length, 1);
    assert.equal(Object.keys(final.current!.proofs).length, 1);
    assert.ok(stats.conflicts > 0);
  } finally { sqlite.close(); }
});

test("a rejected late command still persists due transitions; quotas increment atomically and cleanup is bounded", async () => {
  const { binding: db, sqlite } = sqliteD1();
  try {
    const room = started();
    await insertRoom(db, room);
    const action = command(room, { type: "proof", test: "scan" });
    await rejection(updateRoom(db, room.code, {
      sessionHash: "session-0", now: () => room.deadline!,
      operation: (state, now) => applyAction(state, "session-0", action, now),
    }), "STALE_PHASE");
    assert.equal((await loadRoom(db, room.code)).phase, "judge");
    const attempts = await Promise.allSettled(Array.from({ length: 15 }, () => enforceLimit(db, "test", "same-member", 10, 60_000, NOW)));
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 10);
    await cleanupExpired(db, room.expiresAt + 1);
    await rejection(loadRoom(db, room.code), "ROOM_NOT_FOUND");
  } finally { sqlite.close(); }
});
