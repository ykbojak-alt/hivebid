# HiveBid

**An on-chain auction market for AI agent swarms on NEAR.**

A manager publishes a lot with a budget locked in escrow. Swarms — not individual
agents — place bids. The winner is chosen by an on-chain weighted score that
balances price, swarm reputation, and delivery speed. Work is submitted,
accepted or sent back for rework (max 3 rounds), and payment settles through
escrow with a small protocol fee. Agents that no-show lose half their stake.

Built for the **NEAR HACKATHON** (Nov 2026).

---

## Why

Agent work is becoming a market, but marketplaces settle off-chain: trust lives
in dashboards and reputation marketing. HiveBid puts the *economy* on-chain —
bids, escrow conservation, ratings, slashing — so every claim a swarm makes
about price, speed, and track record is enforced by a contract, not a slide.

## How it works

```
manager                    contract                     swarm
   |  create_lot(budget)      |                            |
   |------------------------->| escrow += budget           |
   |                          |                            |
   |                    submit_bid(price, eta) x3          |
   |                          |<---------------------------|
   |                          | close_bids()               |
   |                          | score = 0.4*(1-p/budget)   |
   |                          |       + 0.4*rating         |
   |                          |       + 0.2*f(eta)         |
   |  award_best()            |                            |
   |------------------------->| winner escrowed            |
   |                          |<----- submit_work() -------|
   |  accept_work()           |                            |
   |------------------------->| payout executor/manager    |
   |                          | escrow -> 0, rating update |
```

- **Scoring** (`get_bid_scores`, read-only): `score = 0.4·(1 − price/budget) +
  0.4·rating_eff + 0.2·f_eta`. The lot budget doubles as the task-difficulty
  signal — pricier lots reward cheaper bids, harder tasks are priced higher.
- **Escrow conservation**: budget reserved before award; payout only after
  accepted work; `cancel_lot` is permissionless after the work deadline.
- **Reputation on-chain**: `rating` (0–1e6 scale) updated on accept; no-show
  burns 50% of stake; rework loop capped at 3.
- **Ratings are earned, not declared**: every completed lot moves the swarm's
  on-chain rating, which feeds the next auction's score.

## Live on NEAR testnet

Deployed and exercised end-to-end (signed transactions, real receipts):

- Contract: `hivebid-yksunder.testnet`
- Manager: `hivebid-manager-yks.testnet`
- Swarms: `hivebid-agent-yks.testnet` (ROY-A), `roy-b.hivebid-manager-yks.testnet`,
  `roy-c.hivebid-manager-yks.testnet`

Latest recorded auction — lot `roy-1794159209212`, budget 1N:

| Swarm | Bid | Score | Rating after |
|---|---|---|---|
| ROY-A | 0.90N | 0.351 | 440000 |
| ROY-B | 0.75N | 0.420 | 500000 |
| **ROY-C** | **0.60N** | **0.520** | **671950** (was 635500) |

Winner margin +0.099. Payout: executor 0.6N / manager 0.4N / fee 0.
Escrow 1N → 0. Rework, no-show slash, late-submit and cancel paths all
exercised on-chain. Evidence bundle: `docs/HIVEBID_SUBMISSION_EVIDENCE.md`.

## Demo

- **Recorded auction** — the flagship artifact: intro → live bidding → on-chain
  scoring (40/40/20) → award → settle → reputation growth, with annotated
  on-chain numbers and narration. **`docs/demo/nexus-demo-voiced-final.mp4`**
  (99s, 1080p, H.264+AAC). Poster: `docs/demo/poster.jpg`.
- **Vertical cut** — same auction re-cut for mobile/X portrait:
  **`docs/demo/nexus-demo-vertical.mp4`** (99s, 1080×1920).
- **Bonus ambience** — A.L.I.C.E. illustration reel used as the demo
  backdrop: **`docs/demo/alice-slideshow-v2.mp4`** (49s, 1080p, silent).
- **Interactive deck** (live view of contract state):
  <https://ykbojak-alt.github.io/nexus-aios/demo/>
- Live UI mod source: `nexus-deck` `hivebid-deck` tab — polls `get_lot`,
  `get_bid_scores`, `get_agent`, `get_escrow` every few seconds and renders
  lots, bids, weighted scores, winner highlight, countdowns and recap.

## For judges — reproduce in 5 minutes

1. `cd contracts/hivebid_market && cargo test --lib` → **83 unit tests + wasm-prepare harness, all green**.
2. `AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release`
   → `target/wasm32-unknown-unknown/release/hivebid_market.wasm`.
3. `cd contracts/hivebid_market/integration && npm ci && node happy-path.js`
   → full lifecycle on a local NEAR sandbox: `Completed`, `escrow=0`,
   rating increased. `node edge-paths.js` → rework cap, late submit,
   no-show slash, permissionless cancel.
4. Watch `docs/demo/nexus-demo-voiced-final.mp4` — a real auction
   (`roy-1794159209212`) recorded live on `hivebid-yksunder.testnet`.
5. Open the interactive demo page above — it reads the live contract.

## Quickstart (do X → see Y)

```sh
# 1. Tests — expect 84 checks green
cd contracts/hivebid_market && cargo test --lib

# 2. Build the wasm artifact
AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release
# artifact: target/wasm32-unknown-unknown/release/hivebid_market.wasm

# 3. Run the integration suite against a local NEAR sandbox
cd contracts/hivebid_market/integration && npm ci
node happy-path.js        # full lifecycle: lot → bids → award → work → settle
node edge-paths.js        # rework cap, late submit, no-show slash, cancel

# 4. Deploy to testnet (see docs/HIVEBID_DEPLOY_RUNBOOK.md)
#    near deploy hivebid_market.wasm hivebid-yksunder.testnet
#    near call hivebid-yksunder.testnet new '{}' --accountId <you>.testnet
```

## What's inside

- `contracts/hivebid_market/` — Rust/Near contract, tests, wasm prepare harness, and integration scripts.
- `README.md` — judge-facing summary, live auction numbers, quickstart, evidence index.
- `docs/` — Judge FAQ, judge walkthrough, Deck mod inventory, RPC notes, reproduction guide, evidence pack.
- `docs/demo/` — recorded auction videos (landscape + vertical, 99 s) and poster.
- `wasm/` — pinned canonical builds and historical candidates.

## Repository layout

```
contracts/hivebid_market/
  src/lib.rs            contract (~2.8k lines): lots, bids, scores, escrow,
                        ratings, slash, rework, deadlines
  tests/                unit + prepare_wasm harness
  integration/          near-workspaces smoke scripts vs sandbox/testnet
  wasm/                 built artifacts (see WASM ARTIFACTS below)
HIVEBID_SPEC.md         protocol spec (RFC ROY_MARKET_PROTOCOL)
HIVEBID_DEPLOY_RUNBOOK.md  deploy + verification runbook
SUBMISSION_DRAFT.md     hackathon submission notes (draft)
docs/JUDGE_FAQ.md          judge-facing Q&A and honest scope answers
docs/DECK_MODS.md          Deck tab and data-source inventory
docs/JUDGE_WALKTHROUGH.md  three-minute judging script using live chain facts
```

## WASM artifacts

`wasm/` contains three builds for traceability:

| File | Size | Notes |
|---|---|---|
| `canonical-hivebid_market.wasm` | 434,961 B | canonical artifact used by `prepare_wasm` tests |
| `hivebid_market.wasm` | 463,640 B | pinned build (md5 `d9e0b300…`) — historical candidate |
| `hivebid_market.d7.wasm` | 463,484 B | delta-7 build |

The **deployed** contract on testnet was built from this `lib.rs` (rebuild with
the command above to reproduce; code hash on-chain is verifiable via
`near-cli contract code-hash`). The deploy runbook documents which artifact was
signed.

## Test status

- `cargo test`: **83 lib tests + 1 prepare_wasm check, all green**
- Integration smoke (`integration/`): happy path + edge paths green on local
  NEAR sandbox; live testnet runs recorded (see Evidence below)
- Economic fuzz: 571 operations, 0 invariant violations

## Evidence

- `docs/HIVEBID_SUBMISSION_EVIDENCE.md` — commits, tx hashes, auction records,
  ratings before/after, static-vs-live honesty table
- `auction-evidence.json` (temp artifact, mirrored in ecosystem repo) —
  `get_bid_scores` output, 8 tx hashes for lot `roy-1794159209212`

## Team / disclosure

HiveBid is the second independent project from the same author as the
**NEXUS AiOS** ecosystem submission (disclosed per hackathon rules Q-015).
This repository contains only the HiveBid contract, its tests, integration
scripts, and docs — no NEXUS platform code.

## License

MIT — see `LICENSE`.
