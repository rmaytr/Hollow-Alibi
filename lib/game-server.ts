import { env } from "cloudflare:workers";
import {voiceUpdate,voiceProjection} from './voice-state.ts';
import {voiceIceConfiguration} from './voice-config.ts';
import { applyAction, cleanText, createRoom, GameError, joinRoom, parseAction, projectRoom } from "./game-engine.ts";
import { cleanupExpired, enforceLimit, insertRoom, loadRoom, normalizeCode, updateRoom } from "./game-store.ts";
import type { ApiError, BotDifficulty, GameMode, Pace } from "./game-types.ts";

const COOKIE_NAME = "hollow_guest";
const MAX_BODY = 8 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const responseHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};
function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { ...responseHeaders, ...headers } });
}
function database(): D1Database {
  if (!env.DB) throw new GameError("SERVICE_UNAVAILABLE", "The game service is starting. Please try again shortly.", 503);
  return env.DB;
}
function cookie(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
async function session(request: Request): Promise<string> {
  const token = cookie(request);
  if (!token) throw new GameError("SESSION_REQUIRED", "Connect this browser before joining. Please retry.", 401);
  return hash(token);
}
function sameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  // Browser fetches send Origin on these POSTs. Explicitly reject absent origins too.
  if (!origin || origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new GameError("ORIGIN_REJECTED", "Open the game directly to perform this action.", 403);
  }
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new GameError("INVALID_CONTENT_TYPE", "Send this request as JSON.", 415);
}
async function body(request: Request, maximum=MAX_BODY): Promise<Record<string, unknown>> {
  sameOrigin(request);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximum) throw new GameError("BODY_TOO_LARGE", "That request is too large.", 413);
  if (!request.body) throw new GameError("INVALID_JSON", "The request body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new GameError("BODY_TOO_LARGE", "That request is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new GameError("INVALID_JSON", "The request is not valid JSON."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new GameError("INVALID_JSON", "The request must be a JSON object.");
  return result as Record<string, unknown>;
}
async function ipIdentity(request: Request): Promise<string> {
  return hash(`hollow-ip:${request.headers.get("cf-connecting-ip") ?? "local"}`);
}
export async function route(operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof GameError) {
      const payload: ApiError = { error: { code: error.code, message: error.message } };
      return json(payload, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
    }
    // No room state, request body, cookies, or database detail is logged or returned.
    console.error("Hollow Alibi API operation failed.");
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "The game service could not complete that request. Retry in a moment." } }, 503);
  }
}
export async function establishSession(request: Request): Promise<Response> {
  await body(request);
  if (cookie(request)) return json({ ok: true });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`,
  });
}
export async function createRoomResponse(request: Request): Promise<Response> {
  const input = await body(request);
  const sessionHash = await session(request);
  const name = cleanText(input.name, 18, "Name", 2);
  if (input.mode !== "human" && input.mode !== "practice") throw new GameError("INVALID_ACTION", "Choose friends or solo practice.");
  if (input.pace !== "standard" && input.pace !== "relaxed") throw new GameError("INVALID_ACTION", "Choose standard or relaxed pace.");
  if (input.botDifficulty !== undefined && !["casual","sharp","expert","mixed"].includes(String(input.botDifficulty))) throw new GameError("INVALID_ACTION", "Choose a listed bot difficulty.");
  const db = database();
  const now = Date.now();
  await enforceLimit(db, "create-session", sessionHash, 12, 3_600_000, now);
  await enforceLimit(db, "create-ip", await ipIdentity(request), 40, 3_600_000, now);
  await cleanupExpired(db, now);
  for (let attempt = 0; attempt < 8; attempt++) {
    const randomBytes = crypto.getRandomValues(new Uint32Array(7));
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
    const code = Array.from(randomBytes.slice(0, 5), (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
    const room = createRoom({
      code, instanceId: crypto.randomUUID(), sessionHash, name, mode: input.mode as GameMode,
      pace: input.pace as Pace, seed, now, botDifficulty: input.botDifficulty as BotDifficulty | "mixed" | undefined,
      rules:'showdown',
    });
    if (await insertRoom(db, room)) return json(projectRoom(room, sessionHash, now), 201);
  }
  throw new GameError("ROOM_BUSY", "Could not reserve a room code. Try again.", 503);
}
export async function joinRoomResponse(request: Request): Promise<Response> {
  const input = await body(request);
  const sessionHash = await session(request);
  const name = cleanText(input.name, 18, "Name", 2);
  const code = normalizeCode(input.code);
  const db = database();
  const now = Date.now();
  await enforceLimit(db, "join-session", sessionHash, 60, 600_000, now);
  await enforceLimit(db, "join-ip", await ipIdentity(request), 300, 600_000, now);
  const room = await updateRoom(db, code, {
    operation: (state, clock) => joinRoom(state, sessionHash, name, clock),
  });
  return json(projectRoom(room, sessionHash, Date.now()));
}
export async function readRoomResponse(request: Request, code: string): Promise<Response> {
  const sessionHash = await session(request);
  const room = await updateRoom(database(), code, { sessionHash });
  return json(projectRoom(room, sessionHash, Date.now()));
}
export async function actionResponse(request: Request, code: string): Promise<Response> {
  const input = await body(request);
  const sessionHash = await session(request);
  const action = parseAction(input);
  const db = database();
  // Authorize before allocating a quota record for a purported membership.
  const snapshot = await loadRoom(db, code);
  const view = projectRoom(snapshot, sessionHash, Date.now(), true);
  await enforceLimit(db, "action", `${snapshot.instanceId}:${view.viewerId}`, 120, 60_000, Date.now());
  const room = await updateRoom(db, code, {
    sessionHash, allowLeft: true,
    operation: (state, now) => applyAction(action.type === 'start' || action.type === 'rematch' ? {...state,rules:'showdown'} : state, sessionHash, action, now),
  });
  return json(projectRoom(room, sessionHash, Date.now(), action.type === "leave"));
}
export async function voiceResponse(request:Request,code:string):Promise<Response>{
  const input=await body(request,16*1024),sessionHash=await session(request),db=database();
  const snapshot=await loadRoom(db,code),view=projectRoom(snapshot,sessionHash,Date.now());
  await enforceLimit(db,'voice',snapshot.instanceId+':'+view.viewerId,120,60000,Date.now());
  const room=await updateRoom(db,code,{sessionHash,operation:(state,now)=>voiceUpdate(state,view.viewerId,input,now)});
  // Optional relay configuration. Never expose provider API keys: only scoped ICE credentials.
  const config=(env as unknown as Record<string,unknown>).HOLLOW_ICE_SERVERS;
  return json({...voiceProjection(room,view.viewerId,String(input.epoch)),...voiceIceConfiguration(config)});
}
