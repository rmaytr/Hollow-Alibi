"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionPayload, BotDifficulty, GameAction, GameMode, Pace, RoomView } from "@/lib/game-types.ts";

const ROOM_KEY = "hollow-alibi-room-v1";
class RequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new RequestError("The connection dropped. Your saved seat is safe. Try again when you are online.", "NETWORK"); }
  let data;
  try { data = await response.json(); }
  catch { throw new RequestError("The server could not respond. Please try again.", "NETWORK"); }
  if (!response.ok) {
    const problem = data as { error?: { message?: string; code?: string } };
    throw new RequestError(problem.error?.message || "That request could not be completed.", problem.error?.code || "REQUEST");
  }
  return data as T;
}
function readSaved(): { code: string; instanceId: string } | null {
  try { return JSON.parse(localStorage.getItem(ROOM_KEY) || "null"); } catch { return null; }
}
function storeRoom(view: RoomView | null) {
  try {
    if (view) localStorage.setItem(ROOM_KEY, JSON.stringify({ code: view.code, instanceId: view.instanceId }));
    else localStorage.removeItem(ROOM_KEY);
  } catch { /* The session cookie still permits rejoining by code. */ }
}
function actionFor(view: RoomView, payload: ActionPayload): GameAction {
  return { ...payload, requestId: crypto.randomUUID(), instanceId: view.instanceId, matchId: view.matchId, round: view.round, phase: view.phase };
}
const lostSeat = (error: unknown) => error instanceof RequestError && ["NOT_MEMBER", "ROOM_NOT_FOUND", "ROOM_EXPIRED", "NOT_FOUND", "EXPIRED", "PLAYER_LEFT"].includes(error.code);

export function useHollowRoom() {
  const [view, setView] = useState<RoomView | null>(null);
  const current = useRef<RoomView | null>(null);
  const generation = useRef(0);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"online" | "connecting" | "offline">("connecting");
  const [retryable, setRetryable] = useState(false);
  const retryAction = useRef<{ code: string; action: GameAction; generation: number } | null>(null);
  const session = useRef<Promise<unknown> | null>(null);
  const clockOffset = useRef(0);
  const [now, setNow] = useState(Date.now());
  const accept = useCallback((next: RoomView, expected: number) => {
    if (generation.current !== expected) return;
    const old = current.current;
    if (old && (old.instanceId !== next.instanceId || old.version > next.version)) return;
    clockOffset.current = next.serverNow - Date.now();
    current.current = next;
    setView(next);
    storeRoom(next);
    setConnection("online");
  }, []);
  const ensureSession = useCallback(async () => {
    if (!session.current) session.current = request("/api/session", {}).catch(error => { session.current = null; throw error; });
    await session.current;
  }, []);
  const forget = useCallback(() => {
    generation.current++;
    current.current = null; setView(null); storeRoom(null);
    retryAction.current = null; setRetryable(false); setRestoring(false);
  }, []);
  const restore = useCallback(async () => {
    const saved = readSaved();
    if (!saved) { setRestoring(false); setConnection("online"); return; }
    const expected = generation.current;
    setRestoring(true); setError("");
    try {
      await ensureSession();
      const next = await request<RoomView>(`/api/rooms/${saved.code}`);
      if (next.instanceId !== saved.instanceId) throw new RequestError("That room has expired. Start a new case below.", "EXPIRED");
      accept(next, expected);
    } catch (err) {
      if (lostSeat(err)) { forget(); setConnection("online"); }
      else setConnection("offline");
      setError(err instanceof Error ? err.message : "Could not restore the room.");
    } finally { setRestoring(false); }
  }, [accept, ensureSession, forget]);
  useEffect(() => {
    const invitation = new URLSearchParams(location.search).get("room")?.toUpperCase();
    const saved = readSaved();
    if (invitation && saved && invitation !== saved.code) { setRestoring(false); setConnection("online"); }
    else void restore();
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [restore]);
  useEffect(() => {
    if (!view) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, inFlight = false;
    const expected = generation.current, code = view.code;
    const poll = async () => {
      if (stopped || inFlight) return;
      clearTimeout(timer); inFlight = true;
      try {
        const next = await request<RoomView>(`/api/rooms/${code}`);
        if (!stopped) { accept(next, expected); }
      } catch (err) {
        if (!stopped && generation.current === expected) {
          if (lostSeat(err)) { forget(); setError(err instanceof Error ? err.message : "Your seat is no longer in this room."); }
          else setConnection("offline");
        }
      } finally {
        inFlight = false;
        if (!stopped) timer = setTimeout(poll, document.hidden ? 5000 : navigator.onLine ? 1200 : 4000);
      }
    };
    timer = setTimeout(poll, 800);
    const resume = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [view?.code, view?.instanceId, accept, forget]); // Poll lifetime follows the room, not every snapshot.
  const enter = async ({ name, mode, pace, code, botDifficulty }: { name: string; mode: GameMode; pace: Pace; code?: string; botDifficulty?: BotDifficulty | "mixed" }) => {
    if (busy) return;
    setBusy(true); setError(""); retryAction.current = null; setRetryable(false);
    const expected = ++generation.current;
    current.current = null; setView(null);
    try {
      await ensureSession();
      const next = await request<RoomView>(code ? "/api/rooms/join" : "/api/rooms", code ? { name, code } : { name, mode, pace, botDifficulty });
      accept(next, expected);
      if (mode === "practice" && !code && next.phase === "lobby") {
        const started = await request<RoomView>(`/api/rooms/${next.code}/action`, actionFor(next, { type: "start" }));
        accept(started, expected);
      }
      history.replaceState({}, "", location.pathname);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not enter room."); }
    finally { setBusy(false); }
  };
  const send = async (item: { code: string; action: GameAction; generation: number }) => {
    setBusy(true); setError(""); setRetryable(false);
    try {
      const next = await request<RoomView>(`/api/rooms/${item.code}/action`, item.action);
      accept(next, item.generation);
      retryAction.current = null;
    } catch (err) {
      if (generation.current !== item.generation) return;
      setError(err instanceof Error ? err.message : "Your action was not confirmed.");
      if (err instanceof RequestError && err.code === "NETWORK") {
        retryAction.current = item; setRetryable(true); setConnection("offline");
      } else {
        retryAction.current = null;
        try { accept(await request<RoomView>(`/api/rooms/${item.code}`), item.generation); } catch { /* Poll will reconnect. */ }
      }
    } finally { setBusy(false); }
  };
  const act = async (payload: ActionPayload) => {
    if (!current.current || busy) return;
    await send({ code: current.current.code, action: actionFor(current.current, payload), generation: generation.current });
  };
  const leave = async () => {
    const old = current.current;
    if (!old) { forget(); setError(""); return; }
    const action = actionFor(old, { type: "leave" });
    forget(); setError("");
    try { await request(`/api/rooms/${old.code}/action`, action); }
    catch { setError("You left this device. The room will handle your absence if the leave message could not arrive."); }
  };
  return {
    view, restoring, busy, error, connection, retryable, enter, act, leave, restore,
    retry: () => retryAction.current ? send(retryAction.current) : restore(),
    dismissError: () => setError(""),
    seconds: view?.deadline ? Math.max(0, Math.ceil((view.deadline - now - clockOffset.current) / 1000)) : null,
  };
}
