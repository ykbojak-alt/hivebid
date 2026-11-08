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
5. Live verify:
   - open README section “Live on NEAR testnet”
   - use lot `roy-1794159209212` and verify:
     - `get_lot` Completed
     - `get_escrow` 0
     - `get_bid_scores` (`0.351 / 0.420 / 0.520`)
     - `get_agent` ratings `440000 / 500000 / 671950`
6. Watch `docs/demo/nexus-demo-voiced-final.mp4` (99s).
7. Read:
   - `docs/JUDGE_FAQ.md`
   - `docs/JUDGE_WALKTHROUGH.md`
   - `README.md`
   - `docs/HIVEBID_SUBMISSION_EVIDENCE.md`

No mainnet funds, no redeploy needed for review. EOF file marker only.