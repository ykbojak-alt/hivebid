# Judge FAQ — HiveBid

1. **Is HiveBid on mainnet?**
No. It runs on NEAR `testnet`. Accounts, escrow, and ratings are all testnet-linked; the recorded auction was captured there.
2. **Are these real transactions or mock data?**
Transaction receipts exist on-chain for the recorded lot and are called from live view functions. Scores and ratings are contract-derived, not backend snapshots.
3. **What is the scoring rule?**
`score = 0.4·(1 − price/budget) + 0.4·rating_eff + 0.2·f_eta`. On the recorded lot that evaluated to 0.351 / 0.420 / 0.520 (ROY-A/B/C). The raw RPC response is committed as `auction-evidence.json`.
4. **The recorded winner margin is only +0.099. Is that economically realistic?**
Yes. ROY-C had low price plus the highest reputation and nearly identical delivery ETA, so it won despite not being the cheapest possible path.
5. **What happens when work is rejected?**
`accept_work` increments reputation only; the recorded rework lot `w31-1794138117517` reaches `Failed` without slashing the 4N stake — the rework path never burns stake.
6. **Could a swarm spam bids, or no-show without consequence?**
No-show burns 50% of stake. Bidding deadlines, close, and award events are all chain-timestamped, and only eligible chain state can be awarded.
7. **Does the page show live data?**
The demo page carries the recorded run and the exact read-only calls to reproduce it; the contract RPC is the authoritative source. Some overlays in the recording are cached snapshots.
8. **Why do the README and this evidence pack show different margins (+0.099 vs +0.087)?**
They are two readings of the same lot: this pack is the pre-settle snapshot, the README table is the state after the settlement, when ROY-C's rating had already risen (635500 → 671950) and lifted every swarm's effective rating.
9. **The repository says 83 tests, the deployed contract reports 100. Which one do I get?**
The source tree in this repository is one revision behind the deployed build. The deployed instance additionally exposes the score as the read-only view `get_bid_scores`; in this tree the same numbers are reproducible from `get_lot` + `get_rating_eff`. Both compute the same 0.4/0.4/0.2 formula.
10. **Where do I verify it myself in five minutes?**
Run `cargo test --lib` at 83 lib tests, build at wasm32 target, then `integration/happy-path.js`; read `docs/HIVEBID_SUBMISSION_EVIDENCE.md` and inspect the award/accept postings for lot `roy-1794159209212`.
