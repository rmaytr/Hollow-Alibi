# Testing and evidence

## Automated gates

`npm test` runs 54 engine/store tests: current Showdown scoring and historical rules compatibility, eight truth/call/double combinations, 2/3/4/10-seat matches and bot difficulties, duplicate/stale actions, hidden views, departures, expiry, quotas, SQLite CAS and voice membership/epochs/recipients. `tests/sqlite-d1.ts` exercises production SQL in real in-memory SQLite with async yields to induce contention.

TypeScript, production build and local Markdown target checks are separate gates. `docs:check` verifies paths and rejects machine-specific document links; it is not a full visual Markdown renderer.

`test:api` checks HTTP authorization, privacy, strict actions, assigned targets, voice bounds/isolation and a two-player round. `test:smoke` uses two independent contexts at 1440px and 320px: create/join/start, claims, judgments, score consistency, assigned judges, overflow and refresh. Normal CI runs these against a freshly initialized local database and built Worker, without production secrets. The badge reflects actual GitHub status.

## Optional browser suite

`test:browser` adds synthetic microphone WebRTC, inbound RTP statistics, outgoing mute, incoming mute through local/remote reconnect, a 23-second signaling outage, full five-round duel, independent score oracle, refresh/recap/rematch, and mixed-bot solo. Browser media and NAT traversal make it unsuitable as the only fast PR gate.

## Saved release evidence

| Record | Scope |
| --- | --- |
| [Ten-client run](evidence/ten-client-voice.json) | One Windows machine, local app, isolated contexts, fake microphones: all 90 directed audio paths, recovery and full duel/solo flow |
| [Relay-only run](evidence/turn-relay.json) | Hosted release, two clients, synthetic audio, forced relay: both directions, mute and reconnect checks |

These recorded runs predate publication-only path/CI changes. The relay record verifies the separately configured live service, not a credential in this repository. Neither measures geographic scale, speech quality, many-room throughput or uptime.

The owner reported successful play and voice with real people. No formal participant count, retention percentage, or satisfaction measure was recorded. Physical-device coverage and Safari/Firefox media remain future verification.

## Interpreting metrics

- 54 tests is a count, not a code coverage percentage.
- Ten clients means one room, not a service capacity benchmark.
- 90 directed streams use 45 bidirectional peer connections.
- 320px is a browser viewport, not proof of a physical phone test.
- Human feedback complements automation; it is not a controlled balance study.
