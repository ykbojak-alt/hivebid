# Owner Handoff — HiveBid Submission

Date: 2026-11-08 (paused; no POST sent)

## Public project
- Repo: `https://github.com/ykbojak-alt/hivebid` (latest pushed ` 58d1a94 ` per W86; local docs still uncommitted)
- Formula/calculation live auction: lot `roy-1794159209212`, scores `0.351 / 0.420 / 0.520`, winner ROY-C +0.099, payout `0.6 / 0.4`, fee 0, escrow `1N → 0`, rating `635500 → 671950`
- Code hash (RPC): `DCcTQUfWB7jW7N1DCfZpYjDp4K73NJ215vu1QcQHPmUf`
- Tracks: `[swarms, agents, defi]`
- Idea field: `D:/Temp/idea-hivebid.txt` (1301 chars)

## Artifact inventory (do not commit personal payloads)
- Wallet payload: `D:/Temp/submission-payload.json` (now populated except `demoUrl=<WAIT-X-POST>`)
- Docs in repo: README, `HIVEBID_SUBMISSION_EVIDENCE.md`, `JUDGE_FAQ.md`, `JUDGE_WALKTHROUGH.md`, `DECK_MODS.md`, `READINESS.md`, `REPRODUCE.md`, `RPC_NOTES.md`, `HIVEBID_SUBMISSION_STATUS.md`
- Video poster: 99s (20.7MB), `docs/demo/nexus-demo-voiced-final.mp4`
- Submission status: paused until owner explicit go.

## Before POST checklist
1. Finish & publish X-post with attached video
2. Replace `<WAIT-X-POST>` in payload
3. Confirm `leadName`, `email`, `nearAddress`, `size` are still correct
4. Do final diff and run `node --check` + README review
5. Generate final requestId if retry/new from A.L.I.C.E.; otherwise keep old
6. After owner `go`: send exact body from approved JSON only; inspect API response and avoid retries
7. Archive exact response (`201` expected) and payload used

## Explicit do-nots
- No mainnet claim
- No unverified tx count or duration
- No services restart
- No commits until owner.
EOF