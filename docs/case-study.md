# Engineering case study

## From evidence to a social decision

The initial design made benefits of honesty, lying and discussion unclear. Feedback led to explicit FULL/EMPTY claims, one named judge, separate payouts and two double-down chips. Independent deals make duels viable; one chosen public clue preserves uncertainty. No elimination keeps everyone involved for five rounds. The owner directed product/visual decisions, reviewed iterations and tested with people; Codex assisted research, implementation, review and verification.

## Consistency and hidden information

Simultaneous submissions at phase boundaries risk lost writes and repeated scoring. A versioned room aggregate provides one atomic boundary; conditional writes reload/retry on conflicts and a bounded command ledger deduplicates identical retries. Client version/generation checks reject stale responses.

Hiding a card visually is insufficient if its JSON already reached a browser. Explicit player projections keep secrets server-side; bots receive the same constrained information. Secret keyed randomness and a persisted counter make dealing reproducible through retries without exposing future outcomes through public identifiers.

## Lifecycle defects found and fixed

- Withholding a judgment could deny the rival's claim payout. Timeout now defaults to TRUST without doubling plus a −2 inactivity penalty; asymmetric tests cover the exploit.
- Reconnecting could create audible audio elements while UI said muted. New elements inherit current incoming mute; browser regressions cover local and remote reconnect.
- Automatic no-claim cases consumed chips despite paying zero. UI and server now prevent the debit.
- Failed comments erased drafts. Drafts clear after server confirmation.
- Mobile decisions were buried. Rival-first controls, early personal results and longer reveals improve access.
- Room-creation-only quota cleanup lagged during voice use. Each new quota bucket now funds bounded expired-record cleanup.

## Tradeoffs and next steps

Polling avoids a persistent socket service for phase-based play; aggregate writes simplify consistency at the cost of CAS contention. Mesh voice keeps media off the app backend but increases peer upload demand. TURN is verified fallback, not universal network reachability or unlimited quota.

Priorities are device/browser media coverage, scoped credential rotation/usage controls, measured bot comparisons, and sustained multi-room load testing. The statistical bots do not read text or listen to voice; solo teaches mechanics rather than simulating human persuasion.
