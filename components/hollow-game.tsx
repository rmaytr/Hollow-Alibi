"use client";
import { useEffect, useState } from "react";
import { useHollowRoom } from "@/hooks/use-hollow-room";
import { TEST_KEYS, TEST_LABELS, PITCH_PRESETS, testResultLabel } from "@/lib/game-content.ts";
import type { ActionPayload, Bold, BotDifficulty, Pace, RoomView, TestKey } from "@/lib/game-types.ts";
import { playCue } from "@/lib/hollow-audio";
import { CaseArt, Mark, TestIcon } from "./hollow-art";
import { Showdown, ShowdownRules } from "./showdown-game";
import { RoomVoice } from "./room-voice";
import { Dialog, Recap, Rules } from "./hollow-dialog";

type Act = (payload: ActionPayload) => Promise<void>;
const phases = ["prepare", "judge", "reveal"];
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
const nameOf = (view: RoomView, id: string | undefined) => view.players.find(p => p.id === id)?.name || "Choose a case";
const initials = (name: string) => name.slice(0, 2).toUpperCase();
const difficultyLabel = (level: BotDifficulty = "sharp") => ({casual:"Casual",sharp:"Sharp",expert:"Expert"})[level];
function Evidence({ test, result }: { test: TestKey; result: boolean }) {
  return <span className={`evidence ${result ? "positive" : ""}`}><TestIcon test={test} size={21}/><span><small>{TEST_LABELS[test].label}</small><b>{testResultLabel(test, result)}</b></span></span>;
}
function Progress({ view }: { view: RoomView }) {
  const players = view.players.filter(p=>view.cases.some(c=>c.playerId===p.id));
  const committed = (p: typeof players[number]) => view.phase === "prepare" ? p.proofSubmitted : view.phase === "judge" ? p.verdictSubmitted : p.ready || p.bot || p.left;
  const count = players.filter(committed).length;
  return <div className="commit-progress"><span className="status-dot"/><span>{count} / {players.length} {view.phase === "reveal" ? "ready" : "sealed"}</span><span className="progress-pips" aria-hidden="true">{players.map(p => <i key={p.id} className={committed(p) ? "done" : ""}/>)}</span></div>;
}
function Entry({ enter, busy, name, setName }: { enter: ReturnType<typeof useHollowRoom>["enter"]; busy: boolean; name: string; setName: (s: string) => void }) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [code, setCode] = useState("");
  const [pace, setPace] = useState<Pace>("standard");
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty | "mixed">("sharp");
  const practice = () => void enter({ name: name.trim().length >= 2 ? name.trim() : "You", mode: "practice", pace: "relaxed", botDifficulty });
  useEffect(() => { const value = new URLSearchParams(location.search).get("room"); if (value) { setCode(value.toUpperCase().slice(0, 5)); setTab("join"); } }, []);
  return <main className="entry">
    <section className="hero">
      <img className="hero-art" src="/art/key-art.png" alt="A hand slides a red-sealed archive case across a table. An open case hides a felt-wrapped moon." fetchPriority="high"/>
      <div className="hero-shade"/>
      <div className="hero-copy"><p className="eyebrow"><span className="tiny-cross">✳</span> A PARTY GAME OF TERRIBLE LIES</p><h1>HOLLOW<br/><em>ALIBI</em><span className="title-period">.</span></h1><p className="hero-tagline">Show a little truth.<br/>Sell a bigger lie.</p><p className="hero-description">Make a ridiculous claim. Defend it over voice.<br className="desktop-break"/> Trust your friends—or call LIAR and watch the cases open.</p><div className="hero-specs"><span>SOLO · 2–10 SEATS</span><span>5 ROUNDS</span><span>NO ONE SITS OUT</span></div></div>
      <div className="mobile-start"><a href="#entry-desk">Play with friends ↓</a><button disabled={busy} onClick={practice}>Try a solo round ↗</button></div>
      <aside className="entry-sheet paper" id="entry-desk">
        <div className="sheet-serial"><span>ADMIT YOURSELF</span><span>FORM 01 / A</span></div>
        <div className="entry-tabs" role="tablist" aria-label="Enter a game"><button role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")}>Create a room</button><button role="tab" aria-selected={tab === "join"} onClick={() => setTab("join")}>Join a room</button></div>
        <form onSubmit={event => { event.preventDefault(); void enter({ name: name.trim(), mode: "human", pace, ...(tab === "join" ? { code: code.trim() } : {}) }); }}>
          <label className="field-label" htmlFor="player-name">YOUR NAME <span>Leave your real one at the door.</span></label>
          <input id="player-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. The Usual Suspect" autoComplete="nickname" minLength={2} maxLength={18} required/>
          {tab === "join" ? <><label className="field-label" htmlFor="room-code">ROOM CODE</label><input id="room-code" className="code-input" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))} placeholder="ABCDE" minLength={5} maxLength={5} autoCapitalize="characters" autoComplete="off" required/></> : <><label className="field-label" htmlFor="pace">TIME TO TALK</label><select id="pace" value={pace} onChange={event => setPace(event.target.value as Pace)}><option value="standard">Standard · 45s claims / 60s decisions</option><option value="relaxed">Unhurried · 90s claims / 120s decisions</option></select></>}
          <button className="button red entry-submit" disabled={busy}>{busy ? "Opening the archive…" : tab === "create" ? "Open a room" : "Enter the room"}<span aria-hidden="true">↗</span></button>
        </form>
        <div className="practice-entry"><span>No group needed.</span><button className="text-button" disabled={busy} onClick={practice}>Try solo <span aria-hidden="true">→</span></button><small>One you. Three labeled bots. Practice the rules; invite friends for the banter.</small><label className="field-label" htmlFor="solo-difficulty">BOT DIFFICULTY</label><select id="solo-difficulty" value={botDifficulty} onChange={e => setBotDifficulty(e.target.value as BotDifficulty | "mixed")}><option value="casual">Casual · plays on instinct</option><option value="sharp">Sharp · plays the evidence</option><option value="expert">Expert · remembers your lies</option><option value="mixed">Mixed · one of each</option></select></div>
      </aside>
      <span className="hero-caption">EXHIBIT A / NOTHING IS WHAT IT SOUNDS LIKE</span>
    </section>
    <section className="premise-strip" aria-label="How it works">{[["01", "Choose your truth.", "Claim FULL or EMPTY. Tell the truth or sell a ridiculous lie."], ["02", "Make your call.", "Talk it out. Trust your rival or call LIAR. Double down if you dare."], ["03", "Open everything.", "Earn points for successful bluffs, honest claims and catching lies."]].map(([number, title, body]) => <div key={number}><span className="step-number">{number}</span><div><h2>{title}</h2><p>{body}</p></div></div>)}</section>
    <footer className="entry-footer"><Mark/><span>HOLLOW ALIBI</span><span>One browser per person. No account. No download.</span></footer>
  </main>;
}
function BotControls({view,act,busy}: {view:RoomView;act:Act;busy:boolean}) {
  const humans = view.players.filter(p => !p.bot && !p.left).length;
  const bots = view.players.filter(p => p.bot && !p.left);
  const maximum = 10-humans;
  const [count,setCount] = useState(bots.length);
  const [level,setLevel] = useState<BotDifficulty | "mixed">("mixed");
  useEffect(() => setCount(bots.length), [bots.length]);
  const configure = (n:number) => void act({type:"bots",count:Math.min(maximum,n),difficulty:level});
  return <section className="bot-controls"><div className="sheet-serial"><span>BUILD YOUR TABLE</span><span>{humans} HUMAN{humans===1?"":"S"} · {bots.length} BOTS</span></div><p>Play a friend 1 vs 1, or add NPC rivals. Every bot is labeled and gets only its own clues.</p><div className="bot-settings"><label>Bots<select aria-label="Number of bots" value={Math.min(count,maximum)} onChange={e=>setCount(Number(e.target.value))} disabled={busy}>{Array.from({length:maximum+1},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label><label>Difficulty<select aria-label="Room bot difficulty" value={level} onChange={e=>setLevel(e.target.value as BotDifficulty|"mixed")} disabled={busy}><option value="casual">Casual</option><option value="sharp">Sharp</option><option value="expert">Expert</option><option value="mixed">Mixed</option></select></label><button className="button ink" disabled={busy} onClick={()=>configure(count)}>Apply bots</button></div><div className="bot-shortcuts"><button className="text-button" disabled={busy || humans>=4} onClick={()=>configure(Math.max(0,4-humans))}>Fill to 4 seats</button><button className="text-button" disabled={busy || !maximum} onClick={()=>configure(maximum)}>Fill to 10 seats</button>{bots.length>0 && <button className="text-button" disabled={busy} onClick={()=>configure(0)}>Remove all bots</button>}</div><p className="small-note">Casual guesses. Sharp weighs the public evidence. Expert also remembers revealed lies. Bots never hear voice or read your private case.</p></section>;
}
function Lobby({ view, act, busy, copy, guide }: { view: RoomView; act: Act; busy: boolean; copy: () => void; guide: () => void }) {
  const host = view.hostId === view.viewerId;
  return <main className="game-main lobby"><div className="section-heading"><p className="eyebrow">THE ARCHIVE IS OPEN</p><h1>A room full<br/>of <em>suspects.</em></h1><p>Come solo, bring one friend, or build a party. Two to ten seats, humans and bots.</p></div>
    <div className="lobby-grid"><section className="room-ticket paper"><div className="sheet-serial"><span>PASS THIS AROUND</span><span>ROOM / 01</span></div><p className="eyebrow">YOUR ROOM CODE</p><strong className="big-code">{view.code}</strong><button className="button ink" onClick={copy}>Copy invite link <span>↗</span></button><p>Friends can open the link, or enter this code.<br/>Room stays open for 12 hours.</p><div className="ticket-cut"/><span className="eyebrow">{view.pace === "relaxed" ? "UNHURRIED" : "STANDARD"} PACE · FIVE ROUNDS</span></section>
      <section className="roster"><div className="roster-heading"><h2>The usual suspects</h2><span>{view.players.filter(p => !p.left).length} / 10</span></div>{view.players.filter(p => !p.left).map(p => <div className="roster-row" key={p.id}><span className="avatar">{initials(p.name)}</span><div><strong>{p.name}{p.id === view.viewerId ? " (you)" : ""}</strong><small>{p.bot ? difficultyLabel(p.difficulty).toUpperCase() + " BOT" : p.isHost ? "HOST" : p.connected ? "IN THE ROOM" : "RECONNECTING"}</small></div>{host && !p.isHost && <button className="text-button" disabled={busy} aria-label={`Remove ${p.name}`} onClick={() => void act({ type: "kick", playerId: p.id })}>Remove</button>}</div>)}<div className="empty-seat"><span>+</span>{Math.max(0, 2 - view.players.filter(p => !p.left).length) > 0 ? `${2 - view.players.filter(p => !p.left).length} friend or bot to open the first case` : "There is room for more trouble"}</div>
      {host && <BotControls view={view} act={act} busy={busy}/>}
      <p className="format-note">{view.rules === "showdown" ? "BLUFF SHOWDOWN · 2–10 seats. Claim, defend, trust or call LIAR. Five rounds. No elimination." : view.players.filter(p=>!p.left).length < 4 ? "FACE-OFF · 2–3 seats. Make one inspect OR clear judgment. Every case is dealt independently." : "PARTY · 4–10 seats. Inspect one case AND clear another. At least two empty and two full."}</p>
      {host ? <button className="button red start-button" disabled={!view.canStart || busy} onClick={() => void act({ type: "start" })}>Start the investigation <span>→</span></button> : <p className="waiting-note">Waiting for {nameOf(view, view.hostId || undefined)} to start.</p>}
      <button className="text-button" onClick={guide}>Read the rules while you wait ↗</button></section></div>
    </main>;
}
function Prepare({ view, act, busy, sound }: { view: RoomView; act: Act; busy: boolean; sound: boolean }) {
  const [test, setTest] = useState<TestKey | null>(view.myProof?.test || null);
  const [pitch, setPitch] = useState(view.myProof?.pitch || "");
  const locked = !!view.myProof;
  const profile = view.myCase!;
  const seat = view.cases.findIndex(item => item.playerId === view.viewerId) + 1;
  return <><div className="section-heading compact"><p className="eyebrow">01 / PREPARE YOUR EVIDENCE</p><h1>Tell a little <em>truth.</em></h1><p>Choose one true test to show everyone. Make your case look like something it isn’t.</p></div>
    <div className="prepare-grid"><section className="private-case"><div className="sheet-serial"><span>FOR YOUR EYES ONLY</span><span>CASE {String(seat).padStart(2, "0")}</span></div><CaseArt large open profile={profile.id}/><div className={`truth-stamp ${profile.full ? "full" : ""}`}>{profile.full ? "FULL" : "EMPTY"}</div><h2>{profile.label}</h2><p>{profile.explanation}</p><div className="case-footnote">{profile.full ? "There is an object inside. Can you look empty?" : "There is no object inside. Can you look full?"}</div></section>
    <section className="evidence-sheet paper"><div className="sheet-serial"><span>PUBLIC STATEMENT</span><span>CHOOSE ONE TEST</span></div><h2>Which truth will you tell?</h2><div className="test-options">{TEST_KEYS.map(key => <button key={key} disabled={locked || busy} aria-pressed={(view.myProof?.test || test) === key} className={`test-option ${(view.myProof?.test || test) === key ? "selected" : ""}`} onClick={() => { setTest(key); if (sound) playCue("select"); }}><TestIcon test={key}/><small>{TEST_LABELS[key].label}</small><strong>{testResultLabel(key, profile.tests[key])}</strong><span className="test-check">{(view.myProof?.test || test) === key ? "✓ SELECTED" : "SELECT"}</span></button>)}</div><p className="small-note">All three results are true. Only your chosen result becomes public.</p>
      <label className="field-label" htmlFor="pitch">YOUR ALIBI <span>Optional. Honesty optional too.</span></label><textarea id="pitch" value={locked ? view.myProof!.pitch : pitch} maxLength={80} disabled={locked || busy} placeholder="Nothing in here but a very noisy latch…" onChange={event => setPitch(event.target.value)}/><div className="textarea-footer"><span>Keep it short. Keep a straight face.</span><span>{pitch.length}/80</span></div>
      {!locked && <div className="pitch-presets">{PITCH_PRESETS.slice(0, 3).map(text => <button className="preset" key={text} onClick={() => setPitch(text)}>{text}</button>)}</div>}
      <button className={`button ${locked ? "sealed" : "red"}`} disabled={locked || !test || busy} onClick={() => { if (test) { if (sound) playCue("lock"); void act({ type: "proof", test, pitch }); } }}>{locked ? "✓ Evidence sealed" : "Seal my evidence"}<span aria-hidden="true">{locked ? "" : "→"}</span></button>
      <p className="small-note">{locked ? "Your statement is locked. Waiting for the other cases." : "You cannot change this after sealing. No choice in time? A test is published automatically."}</p><Progress view={view}/></section></div></>;
}
function Judge({ view, act, busy, sound, hideComments, setHideComments, guide }: { view: RoomView; act: Act; busy: boolean; sound: boolean; hideComments: boolean; setHideComments: (v: boolean) => void; guide: () => void }) {
  const faceoff = view.cases.length < 4;
  const [inspectId, setInspect] = useState(view.myVerdict?.inspectId || "");
  const [clearId, setClear] = useState(view.myVerdict?.clearId || "");
  const [bold, setBold] = useState<Bold>(view.myVerdict?.bold || null);
  const [comment, setComment] = useState("");
  const receipt = view.myReceipt!;
  const locked = !!view.myVerdict;
  const inspect = view.myVerdict?.inspectId || inspectId, clear = view.myVerdict?.clearId || clearId;
  const selectedBold = view.myVerdict ? view.myVerdict.bold : bold;
  const choose = (type: "inspect" | "clear", id: string) => {
    if (faceoff) {
      setInspect(type === "inspect" && inspectId !== id ? id : "");
      setClear(type === "clear" && clearId !== id ? id : "");
      setBold(null);
      if (sound) playCue("select");
      return;
    }
    if (type === "inspect") { setInspect(id === inspectId ? "" : id); if (clearId === id) setClear(""); }
    else { setClear(id === clearId ? "" : id); if (inspectId === id) setInspect(""); }
    if (sound) playCue("select");
  };
  return <><div className="section-heading compact"><p className="eyebrow">02 / READ THE ROOM</p><h1>Everyone has an <em>alibi.</em></h1><p>{faceoff ? "FACE-OFF: make one judgment. Inspect a case as full OR clear it as empty. Your own case does not reveal theirs." : "Inspect one case you think is full. Clear a different case you think is empty."}</p></div>
    <aside className="receipt-strip"><div className="receipt-heading"><span className="eyebrow">PRIVATE RECEIPT</span><h2>{nameOf(view, receipt.subjectId)}’s case</h2></div><Evidence test={receipt.test} result={receipt.result}/><div className="receipt-conclusion"><strong>{receipt.conclusion === "still uncertain" ? "Still uncertain." : receipt.conclusion === "proved full" ? "Proved FULL." : "Proved EMPTY."}</strong><p>{receipt.conclusion === "still uncertain" ? "Your test + their public test are mixed. One empty and one full profile still fit." : `Your test + their public test are both ${receipt.result ? "positive" : "negative"}. This is certain evidence.`}</p></div><button className="text-button" onClick={guide}>Field guide ↗</button></aside>
    <div className="board-toolbar"><span className="eyebrow">THE PUBLIC RECORD / {view.cases.length} CASES</span><label className="check-label"><input type="checkbox" checked={hideComments} onChange={event => setHideComments(event.target.checked)}/> Hide alibis & comments</label></div>
    <div className={`case-board players-${view.cases.length}`}>{view.cases.map((item, index) => {
      const own = item.playerId === view.viewerId;
      return <article key={item.playerId} className={`case-card ${own ? "own-case" : ""} ${inspect === item.playerId ? "chosen-inspect" : ""} ${clear === item.playerId ? "chosen-clear" : ""}`}><header><span className="case-number">{String(index + 1).padStart(2, "0")}</span><h2>{item.name}{own && <small>YOUR CASE</small>}{item.bot && <small>{difficultyLabel(view.players.find(p=>p.id===item.playerId)?.difficulty).toUpperCase()} BOT</small>}{item.left && <small>LEFT · AUTO</small>}</h2>{item.playerId === receipt.subjectId && <span className="receipt-marker" title="Your private receipt belongs to this case" aria-label="You have a private receipt for this case">↳</span>}</header><CaseArt number={index + 1}/>{item.proof && <Evidence test={item.proof.test} result={item.proof.result}/>}
      {!hideComments && <div className="case-statements"><p className={!item.proof?.pitch ? "no-statement" : ""}>{item.proof?.pitch ? `“${item.proof.pitch}”` : item.proof?.automatic ? "Automatic proof. No alibi filed." : "No alibi filed."}</p>{item.comment && <p className="new-comment"><span>ADDED</span> {item.comment}</p>}</div>}
      <div className="case-actions">{own ? <span className="own-label">Your case is off limits to you.</span> : <><button aria-label={`Inspect ${item.name}`} aria-pressed={inspect === item.playerId} disabled={locked || busy} onClick={() => choose("inspect", item.playerId)}>{inspect === item.playerId ? "✓ " : ""}Inspect <small>FULL</small></button><button aria-label={`Clear ${item.name}`} aria-pressed={clear === item.playerId} disabled={locked || busy} onClick={() => choose("clear", item.playerId)}>{clear === item.playerId ? "✓ " : ""}Clear <small>EMPTY</small></button></>}</div></article>;
    })}</div>
    <section className="comment-row"><label htmlFor="public-comment"><b>Anything to add?</b><span>Share your receipt. Or a very good story.</span></label><div><input id="public-comment" placeholder="A short public comment…" maxLength={80} value={comment} onChange={event => setComment(event.target.value)} disabled={view.myCommentUpdates >= 3 || busy}/><button className="button outline" disabled={!comment.trim() || view.myCommentUpdates >= 3 || busy} onClick={() => { void act({ type: "comment", text: comment }); setComment(""); }}>Post</button><small>{3 - view.myCommentUpdates} updates left · 80 characters</small></div></section>
    <section className={`verdict-dock ${locked ? "locked" : ""}`} aria-label="Your verdict"><div className="verdict-summary"><span className="eyebrow">YOUR VERDICT</span><p>{faceoff ? inspect || clear ? <><b>{inspect ? "Inspect" : "Clear"}</b> {nameOf(view, inspect || clear)}</> : "Choose one inspect OR clear judgment." : <><b>Inspect</b> {nameOf(view, inspect)} <span>·</span> <b>Clear</b> {nameOf(view, clear)}</>}</p></div><div className="bold-choice"><span>Put one on record? <small>Optional · +4 right / −2 wrong</small></span><div><button disabled={locked || busy || !inspect} aria-pressed={selectedBold === "inspect"} onClick={() => setBold(bold === "inspect" ? null : "inspect")}>{selectedBold === "inspect" ? "✓ " : ""}Bold inspect</button><button disabled={locked || busy || !clear} aria-pressed={selectedBold === "clear"} onClick={() => setBold(bold === "clear" ? null : "clear")}>{selectedBold === "clear" ? "✓ " : ""}Bold clear</button></div></div><button className={`button ${locked ? "sealed" : "red"}`} disabled={locked || (faceoff ? !inspect && !clear : !inspect || !clear) || busy} onClick={() => { if (sound) playCue("lock"); void act({ type: "verdict", inspectId: inspect, clearId: clear, bold }); }}>{locked ? "✓ Verdict sealed" : "Seal my verdict"}<span>{locked ? "" : "→"}</span></button><Progress view={view}/></section>
  </>;
}
function Reveal({ view, act, busy }: { view: RoomView; act: Act; busy: boolean }) {
  const result = view.result!;
  const mine = result.scores.find(s => s.playerId === view.viewerId)!;
  const ready = view.players.find(p => p.id === view.viewerId)?.ready;
  return <><div className="section-heading compact reveal-heading"><div><p className="eyebrow">03 / THE TRUTH COMES OUT</p><h1>Nothing stays <em>hidden.</em></h1></div><div className="round-gain"><strong>{signed(mine.total)}</strong><span>YOUR ROUND</span></div></div>
    <section className="score-receipt paper"><div><span className="eyebrow">YOUR SCORE, EXPLAINED</span><div className="score-lines">{mine.verdicts.length ? mine.verdicts.map(v => <span key={v.kind}><b className={v.correct ? "score-good" : ""}>{signed(v.points)}</b> {v.bold ? "Bold " : ""}{v.kind} {nameOf(view, v.targetId)} <small>{v.correct ? "CORRECT" : "WRONG"}</small></span>) : <span>0 · No verdict submitted</span>}<span><b>{signed(mine.deception)}</b> Misdirection <small>{mine.deceptionEligible ? `${mine.wrongReceived} WRONG ON YOUR CASE · CAP +3` : "AUTOMATIC / DEPARTED CASE"}</small></span></div></div><div className="next-round"><button className="button ink" disabled={ready || busy || view.serverNow - view.phaseStartedAt < 2000} onClick={() => void act({ type: "ready" })}>{ready ? "✓ Ready for the next file" : view.round === view.maxRounds ? "Ready for the final scores" : "Ready for the next round"}<span>→</span></button><Progress view={view}/></div></section>
    <div className="case-board reveal-board">{result.cases.map((item, index) => {
      const score = result.scores.find(s => s.playerId === item.playerId)!;
      const received = result.scores.flatMap(s => s.verdicts.filter(v => v.targetId === item.playerId).map(v => ({ ...v, by: nameOf(view, s.playerId) })));
      return <article className="case-card revealed" key={item.playerId}><header><span className="case-number">{String(index + 1).padStart(2, "0")}</span><h2>{item.name}{item.bot && <small>{difficultyLabel(view.players.find(p=>p.id===item.playerId)?.difficulty).toUpperCase()} BOT</small>}</h2><span className="case-round-score">{signed(score.total)}</span></header><CaseArt open profile={item.profile.id}/><div className={`truth-stamp ${item.profile.full ? "full" : ""}`}>{item.profile.full ? "FULL" : "EMPTY"}</div><h3>{item.profile.label}</h3><p className="explanation">{item.profile.explanation}</p><div className="all-tests">{TEST_KEYS.map(test => <span key={test} className={item.proof.test === test ? "published" : ""}>{testResultLabel(test, item.profile.tests[test])}{item.proof.test === test && <small>SHOWN</small>}</span>)}</div><div className="received-verdicts">{received.length ? received.map(v => <p key={v.by + v.kind}><span>{v.correct ? "✓" : "×"}</span><b>{v.by}</b> {v.bold ? "bold " : ""}{v.kind} <em>{v.correct ? "right" : "wrong"}</em></p>) : <p className="small-note">No verdicts on this case.</p>}</div><details><summary>Who had the extra evidence?</summary>{Object.entries(result.receipts).filter(([, r]) => r.subjectId === item.playerId).map(([id, r]) => <p key={id}>{nameOf(view, id)} saw {testResultLabel(r.test, r.result)} · {r.conclusion}.</p>)}</details></article>;
    })}</div></>;
}
function Finale({ view, act, busy, recap }: { view: RoomView; act: Act; busy: boolean; recap: () => void }) {
  const sorted = view.players.filter(p => view.cases.some(c => c.playerId === p.id)).sort((a, b) => b.score - a.score || a.seat - b.seat);
  return <main className="game-main finale"><div className="finale-seal" aria-hidden="true"><Mark/><span>CASE CLOSED</span></div><p className="eyebrow">FIVE ROUNDS. VERY FEW INNOCENT PEOPLE.</p><h1>{view.winnerIds.length > 1 ? "A shared" : "A perfect"}<br/><em>alibi.</em></h1><p className="winner-line">{view.winnerIds.map(id => nameOf(view, id)).join(" & ")} {view.winnerIds.length > 1 ? "share the win." : "takes the win."}</p><div className="final-scoreboard paper"><div className="sheet-serial"><span>FINAL RECORD</span><span>REPUTATION POINTS</span></div>{sorted.map((p, index) => <div className={`final-score-row ${view.winnerIds.includes(p.id) ? "winner" : ""}`} key={p.id}><span className="rank">{sorted.findIndex(q => q.score === p.score) + 1}</span><span className="avatar">{initials(p.name)}</span><strong>{p.name}{p.id === view.viewerId && <small> YOU</small>}{p.bot && <small> BOT</small>}</strong><b>{p.score}</b>{index === 0 && <span className="winner-star">✳</span>}</div>)}</div><div className="finale-actions">{view.hostId === view.viewerId ? <button className="button red" disabled={!view.canRematch || busy} onClick={() => void act({ type: "rematch" })}>One more alibi? <span>↻</span></button> : <p>Waiting for the host to start a rematch.</p>}<button className="button outline" onClick={recap}>Reopen the case files ↗</button></div>{!view.canRematch && view.hostId === view.viewerId && <p>Add a bot or invite a friend to reach two seats and play again.</p>}{view.hostId === view.viewerId && <BotControls view={view} act={act} busy={busy}/>}<p className="small-note">Adjust bots before the next match. Your room keeps the same rules.</p></main>;
}
export default function HollowGame() {
  const room = useHollowRoom();
  const { view, busy, act } = room;
  const [modal, setModal] = useState<"rules" | "guide" | "recap" | "leave" | null>(null);
  const [sound, setSound] = useState(false);
  const [hideComments, setHideComments] = useState(false);
  const [name, setName] = useState("");
  const [prefsReady, setPrefsReady] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem("hollow-alibi-preferences-v1") || "{}"); setSound(!!p.sound); setHideComments(!!p.hideComments); setName(p.name || ""); } catch {}
    setPrefsReady(true);
  }, []);
  useEffect(() => { if (prefsReady) try { localStorage.setItem("hollow-alibi-preferences-v1", JSON.stringify({ sound, hideComments, name })); } catch {} }, [sound, hideComments, name, prefsReady]);
  useEffect(() => {
    if (view?.phase === "reveal" && sound) playCue("reveal");
    if (view?.phase === "finale" && sound) playCue("finish");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view?.phase, view?.round]); // Audio preference applies on the next phase transition.
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); } }, [toast]);
  const copy = async () => { if (!view) return; try { await navigator.clipboard.writeText(`${location.origin}/?room=${view.code}`); setToast("Invite link copied. Bring your suspects."); } catch { setToast(`Share this code with your friends: ${view.code}`); } };
  return <div className={`hollow-app ${view ? `in-room phase-${view.phase}` : ""}`}>
    <a className="skip-link" href="#game-content">Skip to game</a>
    <header className="masthead"><a className="brand" href="/" onClick={event => { if (view) { event.preventDefault(); setModal("leave"); } }} aria-label="Hollow Alibi home"><Mark/><span>HOLLOW ALIBI<span className="brand-dot">.</span></span></a><div className="masthead-actions">{view && <button className="room-code-button" onClick={() => void copy()} aria-label={`Copy invite for room ${view.code}`}>ROOM <b>{view.code}</b> ↗</button>}<button className="utility-button" aria-pressed={sound} onClick={() => { setSound(!sound); if (!sound) playCue("select"); }}>Sound {sound ? "on" : "off"}</button><button className="utility-button" onClick={() => setModal("rules")}>How to play <span>↗</span></button>{view && <button className="utility-button leave-button" onClick={() => setModal("leave")}>Leave</button>}</div></header>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{view ? `Round ${view.round}. ${view.phase === "prepare" ? "Make your claim." : view.phase === "judge" ? "Trust your rival or call liar." : view.phase === "reveal" ? "All cases are open." : view.phase === "finale" ? "Final scores." : "Waiting room."}` : ""}</div>
    {room.error && <div className="error-banner" role="alert"><span>{room.error}</span>{room.retryable ? <button onClick={() => void room.retry()}>Retry this action</button> : !view && room.connection === "offline" ? <button onClick={() => void room.restore()}>Restore my seat</button> : <button aria-label="Dismiss message" onClick={room.dismissError}>×</button>}</div>}
    {view && room.connection === "offline" && <div className="offline-banner" role="status">Connection interrupted. Reconnecting to your saved seat… The room timer continues.</div>}
    {view && <RoomVoice key={view.instanceId} view={view}/>}
    <div id="game-content">{room.restoring ? <main className="restoring"><Mark/><h1>Finding your file…</h1><p>Reconnecting to your saved seat.</p></main> : !view ? <Entry enter={room.enter} busy={busy} name={name} setName={setName}/> : view.phase === "lobby" ? <Lobby view={view} act={act} busy={busy} copy={() => void copy()} guide={() => setModal("rules")}/> : view.phase === "finale" ? <Finale view={view} act={act} busy={busy} recap={() => setModal("recap")}/> : <main className="game-main"><div className="round-bar"><span className="round-label">ROUND <b>{String(view.round).padStart(2, "0")}</b><span>/ {view.maxRounds}</span></span><nav aria-label="Round progress">{phases.map((phase, index) => <span key={phase} aria-current={phase === view.phase ? "step" : undefined} className={phase === view.phase ? "active" : phases.indexOf(view.phase) > index ? "complete" : ""}>{index + 1}<b>{(view.rules ? ["Claim", "Call it", "Reveal"] : ["Evidence", "Verdicts", "Reveal"])[index]}</b></span>)}</nav><span className={`timer ${room.seconds !== null && room.seconds < 15 ? "urgent" : ""}`} aria-label={`${room.seconds} seconds remaining`}><span aria-hidden="true">◷</span> {room.seconds === 0 ? "Opening…" : `${room.seconds}s`}</span></div>
      {view.players.some(p=>p.bot && !p.left) && <div className="practice-banner"><span className="status-dot"/> {view.mode === "practice" ? "SOLO" : "MIXED TABLE"} · {view.players.filter(p=>p.bot && !p.left).length} LABELED BOTS <span>Evidence and history only. Bots don’t hear or read your defense.</span></div>}{!view.rules && view.cases.length < 4 && <div className="format-note">FACE-OFF · One inspect OR clear verdict · Cases are independently empty or full</div>}
      {view.rules === "showdown" && <Showdown key={`${view.matchId}-${view.round}-${view.phase}`} view={view} act={act} busy={busy} hideComments={hideComments} setHideComments={setHideComments}/>}
      {!view.rules && view.phase === "prepare" && <Prepare key={`${view.matchId}-${view.round}-prepare`} view={view} act={act} busy={busy} sound={sound}/>}
      {!view.rules && view.phase === "judge" && <Judge key={`${view.matchId}-${view.round}-judge`} view={view} act={act} busy={busy} sound={sound} hideComments={hideComments} setHideComments={setHideComments} guide={() => setModal("guide")}/>}
      {!view.rules && view.phase === "reveal" && <Reveal view={view} act={act} busy={busy}/>}
    </main>}</div>
    {view && <footer className="game-footer"><span><i className={`status-dot ${room.connection === "offline" ? "offline" : ""}`}/>{room.connection === "offline" ? "RECONNECTING" : "ROOM CONNECTED"}<span className="footer-points"> · YOU: {view.players.find(p => p.id === view.viewerId)?.score || 0} PTS</span></span><button className="text-button" onClick={() => setModal("recap")}>Case files ({view.history.length}) ↗</button></footer>}
    {toast && <div className="toast" role="status">{toast}</div>}
    {modal && <Dialog title={modal === "rules" ? "A little truth goes a long way." : modal === "guide" ? "Know your evidence." : modal === "recap" ? "The case files." : "Leaving so soon?"} wide={modal !== "leave"} onClose={() => setModal(null)}>{modal === "rules" || modal === "guide" ? (!view || view.rules === "showdown" ? <ShowdownRules/> : <Rules guide={modal === "guide"}/>) : modal === "recap" ? <Recap history={view?.history || []}/> : <><p>{view?.phase === "lobby" || view?.phase === "finale" ? "Your seat will be released. You can rejoin with the room code." : "Your dealt cases stay in this match. Missing evidence becomes automatic, and missing verdicts pass for zero."}</p><button className="button red" onClick={() => { setModal(null); void room.leave(); }}>Leave this room →</button></>}</Dialog>}
  </div>;
}
