import type { ProfileId, TestKey } from "@/lib/game-types.ts";

export function Mark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M5 15 24 5l19 10v25H5Z" fill="currentColor"/>
    <path d="M8 17h32M16 14v-4h16v4M17 25h14v7H17Z" stroke="var(--paper)" strokeWidth="2.5"/>
    <path d="M24 19v17" stroke="var(--red)" strokeWidth="4"/>
  </svg>;
}

export function TestIcon({ test, size = 28 }: { test: TestKey; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {test === "weigh" && <><path d="M16 4v24M6 9h20M4 28h24M7 9 2 20h10L7 9ZM25 9l-5 11h10L25 9Z"/><circle cx="16" cy="8" r="2" fill="currentColor"/></>}
    {test === "listen" && <><path d="m4 13 6-5v16l-6-5H2v-6Z" fill="currentColor"/><path d="M16 10q6 6 0 12M21 5q12 11 0 22M26 2q12 14 0 28"/></>}
    {test === "scan" && <><path d="M11 3H3v8M21 3h8v8M3 21v8h8M21 29h8v-8M1 16h30"/><path d="m11 10 10 2 2 10-12-1Z" strokeDasharray="3 2"/></>}
  </svg>;
}

export function Specimen({ profile }: { profile: ProfileId }) {
  const common = { stroke: "currentColor", strokeWidth: 2, fill: "none" };
  return <svg viewBox="0 0 140 100" className="specimen" aria-hidden="true">
    {profile === "ballast" && <g {...common}><path d="M18 27h104v49H18Z"/><path d="m18 67 16-9h73l15 9v9H18Z" fill="currentColor" opacity=".3"/><path d="M30 34v15M110 34v15M42 67h57" strokeDasharray="3 4"/></g>}
    {profile === "latch" && <g {...common}><path d="m42 24 45 9-9 48-45-9Z"/><path d="m45 40 28 5-4 24-29-5Z"/><circle cx="54" cy="55" r="5"/><path d="m92 32 12-7m-10 21 17 1m-20 13 13 9M25 25l-9-7M22 45H9"/></g>}
    {profile === "liner" && <g {...common}><path d="m24 18 83 6 11 64-91-9Z" fill="currentColor" opacity=".12"/><path d="m40 37 38-8 20 29-41 18-17-39Z" fill="currentColor" opacity=".5"/><path d="m24 18 83 6 11 64-91-9Z"/><path d="m30 23 79 57M100 29 33 73" strokeDasharray="4 5"/></g>}
    {profile === "key" && <g {...common} transform="rotate(-20 70 50)"><circle cx="42" cy="49" r="24"/><circle cx="42" cy="49" r="11"/><path d="M65 43h55v13h-10v17H97V56H65Z" fill="currentColor" opacity=".3"/><path d="M65 43h55v13h-10v17H97V56H65"/><path d="M42 19v9M42 70v9M13 49h9M61 29l-6 7M24 68l7-7"/></g>}
    {profile === "moon" && <g {...common}><path d="M88 15C28 8 14 81 78 85c-29-18-23-50 10-70Z" fill="currentColor" opacity=".8"/><path d="m26 58 67-14M31 71l57-13M37 81l41-8" stroke="var(--ink)" strokeWidth="5"/><path d="m99 16 2 8 8 2-8 2-2 8-2-8-8-2 8-2Z"/></g>}
    {profile === "moth" && <g {...common}><path d="M70 52Q18 5 18 35q-4 26 46 25Q28 65 41 88q20 4 29-29Q79 92 99 88q13-23-23-28 50 1 46-25 0-30-52 17Z" fill="currentColor" opacity=".25"/><path d="M70 35v48M70 39 59 21m11 18 11-18M29 35l34 19-31-3m79-16L77 54l31-3M45 80l19-16m31 16L76 64"/></g>}
  </svg>;
}

export function CaseArt({ number = 1, open = false, profile, large = false }: { number?: number; open?: boolean; profile?: ProfileId; large?: boolean }) {
  return <div className={`case-art ${open ? "is-open" : ""} ${large ? "large" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 280 180" className="case-drawing">
      <path d="m21 151 232-7 16 13-235 9Z" fill="#000" opacity=".2"/>
      <path d="M28 51 48 35h188l20 17v97H28Z" fill="#141515" stroke="#78766b" strokeWidth="2"/>
      <path d="M99 36V22h62v14" fill="none" stroke="#141515" strokeWidth="12"/>
      <path d="M103 31v-7h54v7" fill="none" stroke="#8f8a7e" strokeWidth="2"/>
      <path d="M36 60h211v80H36Z" fill={open ? "#94d4da" : "#282b29"} stroke="#5a5d55" strokeWidth="1"/>
      <path d="M37 122h209M42 67v65m198-65v65" stroke={open ? "#63999f" : "#494c43"} strokeWidth="1"/>
      <g fill="#aaa99a"><path d="M49 49h22v21H49ZM211 49h22v21h-22Z"/><path d="M52 74h16v13H52ZM214 74h16v13h-16Z"/></g>
      <g fill="#141515"><circle cx="55" cy="57" r="2"/><circle cx="65" cy="57" r="2"/><circle cx="217" cy="57" r="2"/><circle cx="227" cy="57" r="2"/></g>
      {!open && <><path d="m99 53 68-3 7 92-68 4Z" fill="#ef4b32"/><path d="m103 62 65-3m-63 72 67-5" stroke="#141515" strokeWidth="2"/><text x="138" y="114" textAnchor="middle" fill="#141515" fontFamily="Barlow Condensed, sans-serif" fontSize="49" fontWeight="700">{String(number).padStart(2, "0")}</text></>}
      {open && <path d="m31 48 7-29 215 12-9 18Z" fill="#252725" stroke="#797b6d" strokeWidth="2"/>}
      <path d="M31 142h17v10H31ZM232 142h22v10h-22Z" fill="#999887"/>
    </svg>
    {open && profile && <div className="case-specimen"><Specimen profile={profile}/></div>}
  </div>;
}
