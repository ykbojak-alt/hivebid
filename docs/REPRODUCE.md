# Judge Reproduction Guide

1. Clone `github.com/ykbojak-alt/hivebid`.
2. `cd contracts/hivebid_market && cargo test --lib`
   - expected: `100 lib tests + 1 prepare_wasm check, all green`
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
   - the artifact rebuilt in step 3 must hash to
     `b545b8adb25b5b92b2233d32ae5e6c4f026852c8ceae7b5b074331afb8efb284`
     (468,209 B) — the same artifact that is live on testnet
7. Watch `docs/demo/nexus-demo-voiced-final.mp4` (99 s).
8. Read:
   - `docs/JUDGE_FAQ.md`
   - `docs/JUDGE_WALKTHROUGH.md`
   - `README.md`
   - `docs/HIVEBID_SUBMISSION_EVIDENCE.md`

No mainnet funds, no redeploy needed for review.
