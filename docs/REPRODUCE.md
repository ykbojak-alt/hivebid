# Judge Reproduction Guide

1. Clone `github.com/ykbojak-alt/hivebid`.
2. `cd contracts/hivebid_market && cargo test --lib`
   - expected: `83 lib tests + 1 prepare_wasm check, all green`
3. Build:
   - `AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release`
4. Run integration:
   - `cd contracts/hivebid_market/integration && npm ci`
   - `node happy-path.js`
   - `node edge-paths.js`
5. Offline simulation (no wallet, no chain):
   - `node contracts/hivebid_market/integration/sim-swarm.js --dry --out ./sim-swarm.json`
6. Live verify:
   - open the README section "Live on NEAR testnet"
   - use lot `roy-1794159209212` and verify on the deployed instance
     (`hivebid-yksunder.testnet`):
     - `get_bid_scores` → `0.351 / 0.420 / 0.520`
     - `get_agent` → ratings `440000 / 500000 / 671950`
     - `get_lot` → status `Completed`, escrow 0
   - the raw response of the first call is committed as `auction-evidence.json`
   - in this source tree (one revision behind the deployment) the same numbers
     are reproducible from `get_lot` + `get_rating_eff`
7. Watch `docs/demo/nexus-demo-voiced-final.mp4` (99 s).
8. Read:
   - `docs/JUDGE_FAQ.md`
   - `docs/JUDGE_WALKTHROUGH.md`
   - `README.md`
   - `docs/HIVEBID_SUBMISSION_EVIDENCE.md`

No mainnet funds, no redeploy needed for review.
