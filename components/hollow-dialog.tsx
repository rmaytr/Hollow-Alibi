"use client";
import { useEffect, useId, useRef } from "react";
import { PROFILE_LIST, TEST_KEYS, testResultLabel } from "@/lib/game-content.ts";
import type { RoundResult } from "@/lib/game-types.ts";
import { Specimen } from "./hollow-art";

export function Dialog({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`paper-dialog ${wide ? "wide" : ""}`} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><span className="eyebrow">HOLLOW ALIBI / FIELD NOTES</span><button autoFocus className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></header>
    <h2 id={titleId}>{title}</h2>
    <div className="dialog-body">{children}</div>
    <button className="button ink" onClick={onClose}>Back to the game <span aria-hidden="true">↗</span></button>
  </dialog>;
}

export function Rules({ guide = false }: { guide?: boolean }) {
  return <div className="rules-content">
    {!guide && <>
      <p className="lede">Every test is true. What people choose to show you is another matter.</p>
      <ol className="rule-steps">
        <li><strong>Choose your evidence.</strong> Your case is secretly empty or full. Publish one true test. Make it look as innocent—or suspicious—as you like.</li>
        <li><strong>Read between the lines.</strong> You get a private second test of another case. Two positive signs prove it full. Two negative signs prove it empty. Mixed signs leave two possibilities.</li>
        <li><strong>Make your judgment.</strong> With 4–10 seats, inspect a case you think is full AND clear a different case you think is empty. With 2–3 seats, Face-off asks for just ONE judgment: inspect OR clear another player’s case. Never choose your own.</li>
        <li><strong>Open everything.</strong> Correct verdicts earn +2 each. You earn +1 for each wrong verdict your case attracts, up to +3. Most points after five rounds wins. Ties share the win.</li>
      </ol>
      <aside className="example"><strong>Feeling certain? Put it on record.</strong><p>Make one verdict bold: <b>+4 if right, −2 if wrong.</b> Ordinary wrong verdicts earn 0. Bold is always optional.</p></aside>
      <h3>A rattle is not a confession.</h3>
      <p>Alex shows RATTLE. You inspect, but the case is empty: its loose latch made the sound. You earn 0; Alex earns +1 for misleading you. If you had made that verdict bold, you would lose 2.</p>
      <p>Talk in person or use the short in-game comments. You may lie about your private receipt. The actual instrument results are always true.</p>
    </>}
    <h3>The six possible cases</h3>
    <p>Empty cases have one positive sign. Full cases have two. “Heavy,” “rattle,” and “shadow” are positive signs. This fictional six-case system is the whole rule—there are no hidden exceptions.</p>
    <div className="guide-table"><table>
      <thead><tr><th scope="col">Case</th><th scope="col">Inside</th><th scope="col">Weigh</th><th scope="col">Listen</th><th scope="col">Scan</th></tr></thead>
      <tbody>{PROFILE_LIST.map(profile => <tr key={profile.id}><th scope="row">{profile.label}</th><td>{profile.full ? "FULL" : "EMPTY"}</td>{TEST_KEYS.map(test => <td key={test} className={profile.tests[test] ? "positive" : ""}>{testResultLabel(test, profile.tests[test])}</td>)}</tr>)}</tbody>
    </table></div>
    <p className="small-note">A chosen test is selective evidence, not a probability estimate. Party tables (4–10 seats) have at least two empty and two full cases. Face-off (2–3 seats) deals every case independently, so both rivals can be empty or both full; your own case does not give away theirs. Missing verdicts pass for 0. Idle cases get an automatic proof and earn no misdirection points.</p>
    {!guide && <><h3>Any size of gathering.</h3><p>Play solo with bots, face one friend directly, or mix humans and NPCs up to ten seats. The host can set bot count and difficulty before starting and between matches. Casual bots guess; Sharp bots use their private receipt; Expert bots also deduce what the table’s remaining case counts allow. Mixed gives each style a seat. Bots never see opponents’ secret cases.</p><h3>No one sits out.</h3><p>Every player chooses evidence and judgments each round. Refresh keeps your seat. A disconnected host is replaced after about a minute. Rooms expire after 12 hours; friends join by invitation between matches. Quick solo starts with three labeled bots. Changing seats changes the next match’s format, never the current one.</p></>}
  </div>;
}

export function Recap({ history }: { history: RoundResult[] }) {
  if(history.some(r=>r.scores.some(s=>s.story))) return <div className="recap-list">{history.map(r=><section key={r.round}><h3>Round {r.round}</h3>{r.cases.map(c=>{const score=r.scores.find(s=>s.playerId===c.playerId)!;return <p key={c.playerId}><b>{c.name}</b>: {c.proof.automatic?"no claim":`claimed ${c.proof.claim?"FULL":"EMPTY"}`} · actually {c.profile.full?"FULL":"EMPTY"} · {score.story} · Claim {score.deception>=0?"+":""}{score.deception}, judgment {score.investigation>=0?"+":""}{score.investigation} · {score.scoreAfter} total</p>})}</section>)}</div>;
  return <div className="recap-list">{history.length ? history.map(result => <section key={result.round}><h3>Round {result.round}</h3><div className="recap-cases">{result.cases.map(item => <div className="recap-case" key={item.playerId}><Specimen profile={item.profile.id}/><div><strong>{item.name}{item.bot ? " · BOT" : ""}</strong><p>{item.profile.full ? "FULL" : "EMPTY"} · {item.profile.label}</p><small>{item.profile.explanation}</small><p>Showed {testResultLabel(item.proof.test, item.proof.result)}{item.proof.automatic ? " (automatic)" : ""}.</p></div></div>)}</div><details className="recap-ledger"><summary>Read the verdicts & private receipts</summary>{result.scores.map(score => {
    const name = (id: string) => result.cases.find(c => c.playerId === id)?.name || "Former player";
    const receipt = result.receipts[score.playerId];
    return <div key={score.playerId}><strong>{name(score.playerId)} · {score.total >= 0 ? "+" : ""}{score.total} this round · {score.scoreAfter} total</strong><p>{score.verdicts.length ? score.verdicts.map(v => `${v.bold ? "Bold " : ""}${v.kind} ${name(v.targetId)}: ${v.correct ? "right" : "wrong"} (${v.points >= 0 ? "+" : ""}${v.points})`).join(" · ") : "No verdict submitted."}</p><p>Misdirection: +{score.deception}{score.deceptionEligible ? ` from ${score.wrongReceived} wrong judgments (cap +3).` : " — automatic or departed case."}</p>{receipt && <p>Private receipt: {name(receipt.subjectId)} · {testResultLabel(receipt.test, receipt.result)} · {receipt.conclusion}.</p>}</div>;
  })}</details></section>) : <p>No cases have opened yet. Your first reveal will appear here.</p>}</div>;
}
