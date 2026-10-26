import { advanceRoom, GameError, projectRoom } from "./game-engine.ts";
import type { RoomState } from "./game-types.ts";

const MAX_ROOM_BYTES = 1536 * 1024; // Bounded audio SDP for up to 90 directed peer pairs.
const MAX_CAS_ATTEMPTS = 12;
export function normalizeCode(input: unknown): string {
  if (typeof input !== "string") throw new GameError("INVALID_CODE", "Enter the five-letter room code.");
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(code)) throw new GameError("INVALID_CODE", "Enter the five-letter room code.");
  return code;
}
export async function loadRoom(db: D1Database, rawCode: unknown): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const row = await db.prepare("SELECT state FROM game_rooms WHERE code = ?").bind(code).first<{ state: string }>();
  if (!row) throw new GameError("ROOM_NOT_FOUND", "That room was not found or has expired. Check the invitation code.", 404);
  return JSON.parse(row.state) as RoomState;
}
function serializeRoom(room: RoomState): string {
  const serialized = JSON.stringify(room);
  if (new TextEncoder().encode(serialized).length > MAX_ROOM_BYTES) {
    throw new GameError("ROOM_LIMIT", "This room has reached its storage limit. Create a new room.", 409);
  }
  return serialized;
}
export async function insertRoom(db: D1Database, room: RoomState): Promise<boolean> {
  const result = await db.prepare(
    "INSERT INTO game_rooms (code, instance_id, version, state, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING",
  ).bind(room.code, room.instanceId, room.version, serializeRoom(room), room.expiresAt).run();
  return result.meta.changes === 1;
}
export async function compareAndSwap(db: D1Database, before: RoomState, next: RoomState): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE game_rooms SET version = ?, state = ?, expires_at = ? WHERE code = ? AND instance_id = ? AND version = ?",
  ).bind(next.version, serializeRoom(next), next.expiresAt, before.code, before.instanceId, before.version).run();
  return result.meta.changes === 1;
}
/**
 * A single state record is the transaction: scores, membership, and dedupe receipts
 * either all commit or none do. Rejected actions may still commit due transitions.
 */
export async function updateRoom(
  db: D1Database,
  rawCode: unknown,
  options: {
    sessionHash?: string;
    allowLeft?: boolean;
    now?: () => number;
    operation?: (state: RoomState, now: number) => RoomState;
  } = {},
): Promise<RoomState> {
  const code = normalizeCode(rawCode);
  const clock = options.now ?? Date.now;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const before = await loadRoom(db, code);
    const now = clock();
    let presenceSession = options.sessionHash;
    if (options.sessionHash) {
      projectRoom(before, options.sessionHash, now, options.allowLeft);
      const p = before.players.find((p) => p.sessionHash === options.sessionHash)!;
      if (p.left) presenceSession = undefined;
    }
    const advanced = advanceRoom(before, now, presenceSession);
    let next = advanced;
    let rejected: unknown;
    try { if (options.operation) next = options.operation(advanced, now); }
    catch (error) { rejected = error; }
    const changed = next.version !== before.version;
    if (!changed || await compareAndSwap(db, before, next)) {
      if (rejected) throw rejected;
      return next;
    }
    // Re-read the primary on contention. No uncertain operation is acknowledged.
  }
  throw new GameError("ROOM_BUSY", "Several players acted together. Retry the same action in a moment.", 409);
}
export async function enforceLimit(
  db: D1Database, scope: string, identity: string, maximum: number, windowMs: number, now: number,
): Promise<void> {
  const bucket = Math.floor(now / windowMs);
  const key = `${scope}:${identity}:${bucket}`;
  const row = await db.prepare(
    "INSERT INTO game_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = game_limits.hits + 1 RETURNING hits",
  ).bind(key, (bucket + 1) * windowMs + 60_000).first<{ hits: number }>();
  // Each new quota bucket pays for bounded cleanup, including voice buckets.
  // This keeps expired records bounded even when a table plays many rematches
  // without creating another room. Active buckets are never removed.
  if (row?.hits === 1) {
    await db.prepare("DELETE FROM game_limits WHERE key IN (SELECT key FROM game_limits WHERE expires_at <= ? LIMIT 32)").bind(now).run();
  }
  if (!row || row.hits > maximum) {
    throw new GameError("RATE_LIMITED", "Too many requests. Wait a moment, then retry.", 429);
  }
}
export async function cleanupExpired(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM game_rooms WHERE code IN (SELECT code FROM game_rooms WHERE expires_at <= ? LIMIT 8)").bind(now),
    db.prepare("DELETE FROM game_limits WHERE key IN (SELECT key FROM game_limits WHERE expires_at <= ? LIMIT 32)").bind(now),
  ]);
}
