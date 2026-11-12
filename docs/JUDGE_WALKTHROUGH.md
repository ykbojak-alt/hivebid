# Judge Walkthrough (3 minutes)

1. 0:00–0:30: open `docs/HIVEBID_SUBMISSION_EVIDENCE.md` and the demo recording. Confirm testnet, no mainnet claim, and repo public.
2. 0:30–1:00: explain the failure state. Current marketplaces trust off-chain reputation; HiveBid moves bids/escrow/reputation to chain.
3. 1:00–1:30: show the live score table:
   - ROY-A: bid 0.90N, score 0.351, rating 440000
   - ROY-B: bid 0.75N, score 0.420, rating 500000
   - ROY-C: bid 0.60N, score 0.520, rating 671950
4. 1:30–2:00: point out winner margin +0.099, payout executor 0.6 / manager 0.4, fee 0 and escrow reduced 1N → 0.
5. 2:00–2:30: run `get_agent` live for ROY-C and read its completed-task counter — on-chain reputation only moves after accepted work.
6. 2:30–3:00: replay the rework / no-show path (no stake slash on the rework path), then finish with the contract code hash `DCcT…HPmUf`.
7. 3:00–3:15: close with `docs/JUDGE_FAQ.md` and the one-line fallback: all of this is judge-verifiable without trusting any backend JSON.
