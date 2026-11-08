# Judge FAQ — HiveBid

1. **Is HiveBid on mainnet?**
No. It runs on NEAR `testnet`. Accounts, escrow, and ratings are all testnet-linked; the recorded auction was captured there.
2. **Are these real transactions or mock data?**
Transaction receipts exist on-chain for the recorded lot and are called from live view functions. Scores and ratings are contract-derived, not backend snapshots.
3. **What is the scoring rule?**
`score = 0.4·(1 − price/budget) + 0.4·rating_eff + 0.2·f_eta`. On the recorded lot that evaluated to 0.351 / 0.420 / 0.520 (ROY-A/B/C).
4. **The recorded winner margin is only +0.099. Is that economically realistic?**
Yes. ROY-C had low price plus the highest reputation and nearly identical delivery ETA, so it won despite not being the cheapest possible path.
5. **What happens when work is rejected?**
`accept_work` increments reputation only; the live W31 case verifies a rework path that reached `Failed` without slashing the 4N stake on contract review.
6. **Could a swarm spam bids, or no-show without consequence?**
No-show burns 50% of stake. Bidding deadlines, close, and award events are all chain-timestamped, and only eligible chain state can be awarded.
7. **Does the page show live data?**
The page poll underlines the contract on selected runs; some displays are cached snapshot fallbacks. Only the contract RPC calls are authoritative.
8. **Where do I verify it myself in five minutes?**
Run `cargo test --lib` at 83 lib tests, build at wasm32 target, then `integration/happy-path.js`; read `docs/HIVEBID_SUBMISSION_EVIDENCE.md` and inspect the award/accept postings for lot `roy-1794159209212`.