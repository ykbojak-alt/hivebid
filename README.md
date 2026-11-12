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
   |  create_task(budget)     |                            |
   |------------------------->| escrow += budget           |
   |                          |                            |
   |                    submit_bid(price, eta) x3          |
   |                          |<---------------------------|
   |                          | close_bidding()             |
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

- **Scoring** — computed inside the contract (`fn _score` in
  `contracts/hivebid_market/src/lib.rs`): `score = 0.4·(1 − price/budget) +
  0.4·rating_eff + 0.2·f_eta`. The lot budget doubles as the task-difficulty
  signal — pricier lots reward cheaper bids, harder tasks are priced higher.
  On the deployed testnet instance the same calculation is also exposed as the
  read-only view `get_bid_scores`; in this source tree it is reproducible from
  `get_lot` (all bids of a lot) plus `get_rating_eff`.
- **Escrow conservation**: budget reserved before award; payout only after
  accepted work; `cancel_lot` is permissionless after the work deadline.
- **Reputation on-chain**: `rating` (0–1e6 scale) updated on accept; no-show
  burns 50% of stake; rework loop capped at 3.
- **Ratings are earned, not declared**: every completed lot moves the swarm's
  on-chain rating, which feeds the next auction's score.

## Live on NEAR testnet

Deployed and exercised end-to-end (signed transactions, real receipts):

- Contract: `hivebid-yksunder.testnet` (code hash `DCcTQUf…HPmUf`)
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
The raw read-only RPC response for this auction is `auction-evidence.json`.

**Two snapshots of one lot.** The table above is the state *after* the
settlement — ROY-C's rating had just risen 635500 → 671950, which lifts every
swarm's effective rating and therefore every score.
`docs/HIVEBID_SUBMISSION_EVIDENCE.md` is the *pre-settle* reading of the same
lot (margin +0.087, ROY-C rating 635500). Both are on-chain readings; they
differ by exactly one settlement.

**Two revisions of one contract.** The source tree in this repository is one
revision *behind* the deployed build:

| | This repository | Deployed on testnet |
|---|---|---|
| lib tests | **83** (verified here: `cargo test --lib` → 83 passed / 0 failed) | 100 (per the evidence pack) |
| wasm artifact | canonical `434,961 B` (built by the `prepare_wasm` test) | `468,209 B`, md5 `D3C8D79D…`, sha256 `B545B8AD…` |
| score view | `fn _score` (private) — reproducible via `get_lot` + `get_rating_eff` | read-only view `get_bid_scores` |

Both revisions compute the same 0.4/0.4/0.2 formula. Judges reading the chain
should use the deployed view names; judges reading this tree will find the same
numbers under `get_lot`.

## Demo

- **Recorded auction** — the flagship artifact: intro → live bidding → on-chain
  scoring (40/40/20) → award → settle → reputation growth, with annotated
  on-chain numbers and narration. **`docs/demo/nexus-demo-voiced-final.mp4`**
  (99s, 1080p, H.264+AAC). Poster: `docs/demo/poster.jpg`.
- **Vertical cut** — same auction re-cut for mobile/X portrait:
  **`docs/demo/nexus-demo-vertical.mp4`** (99s, 1080×1920).
- **Bonus ambience** — illustration reel used as the demo backdrop:
  **`docs/demo/alice-slideshow-v2.mp4`** (49s, 1080p, silent).
- **Deck screenshots** — `docs/demo/shots/`: `hivebid-open.png` (bidding live,
  escrow 1N locked) and `hivebid-settled.png` (ROY-C awarded 0.520,
  margin +0.099, escrow 0, rating 671950).
- **Interactive demo page** (published from this repository):
  <https://ykbojak-alt.github.io/hivebid/> — the recorded demo, the read-only
  chain calls and the offline simulation.
- **Read the live contract yourself** — every number above is a public view
  call on `hivebid-yksunder.testnet`:

  ```sh
  # deployed instance — score factors per bid
  near contract call-function as-read-only hivebid-yksunder.testnet get_bid_scores \
    json-args '{"lot_id":"roy-1794159209212"}' network-config testnet now

  # reputation of one swarm
  near contract call-function as-read-only hivebid-yksunder.testnet get_agent \
    json-args '{"account":"roy-c.hivebid-manager-yks.testnet"}' network-config testnet now

  # the lot itself, including every bid
  near contract call-function as-read-only hivebid-yksunder.testnet get_lot \
    json-args '{"lot_id":"roy-1794159209212"}' network-config testnet now
  ```

  The response of the first call is stored verbatim in `auction-evidence.json`.

## Simulation

Run the deterministic 20-bid demo without an LLM, wallet, or chain transaction:

```sh
node contracts/hivebid_market/integration/sim-swarm.js --dry --out ./sim-swarm.json
```

**dry-run: real scoring math, no funds needed, judges can run with `--dry`.**

The script writes the HiveBid simulation-deck JSON shape (`./sim-swarm.json` by
default; override with `--out` or the `HIVEBID_SIM_OUTPUT` environment
variable): one round, 20 scripted bidder profiles (`cheap-fast`, `high-rating`,
`balanced`), normalized scores, winner, and winning bid as `clearing_price`.
The dry model mirrors the integer scoring formula and prints `get_escrow` at
each phase. It makes no LLM, RPC, wallet, or contract calls; its synthetic
output is not a live-chain response.

A committed sample of that output is `docs/demo/sim-swarm.sample.json`, and
`docs/demo/sim.html` renders it in a browser.

See [`docs/SIMULATION.md`](docs/SIMULATION.md) for the captured sample table, escrow trace, and scope notes.

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
5. Open the interactive demo page above — recorded demo, live read-only calls,
   offline simulation.

## Quickstart (do X → see Y)

```sh
# 1. Tests — expect 83 checks green
cd contracts/hivebid_market && cargo test --lib

# 2. Build the wasm artifact
AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release
# artifact: target/wasm32-unknown-unknown/release/hivebid_market.wasm

# 3. Run the integration suite against a local NEAR sandbox
cd contracts/hivebid_market/integration && npm ci
node happy-path.js        # full lifecycle: lot → bids → award → work → settle
node edge-paths.js        # rework cap, late submit, no-show slash, cancel

# 4. Offline simulation — no wallet, no chain
node contracts/hivebid_market/integration/sim-swarm.js --dry --out ./sim-swarm.json

# 5. Deploy to testnet (see docs/HIVEBID_DEPLOY_RUNBOOK.md)
#    near deploy hivebid_market.wasm hivebid-yksunder.testnet
#    near call hivebid-yksunder.testnet new '{}' --accountId <you>.testnet
```

## What's inside

- `contracts/hivebid_market/` — Rust/Near contract, tests, wasm prepare harness, and integration scripts.
- `README.md` — judge-facing summary, live auction numbers, quickstart, evidence index.
- `auction-evidence.json` — raw read-only RPC response for the recorded auction.
- `docs/` — judge FAQ, judge walkthrough, simulation notes, RPC notes, reproduction guide, evidence pack.
- `docs/demo/` — recorded auction videos (landscape + vertical, 99 s), poster, screenshots, simulation page.

## Repository layout

```
contracts/hivebid_market/
  src/lib.rs            contract (~2.8k lines): lots, bids, scores, escrow,
                        ratings, slash, rework, deadlines
  tests/                unit + prepare_wasm harness
  integration/          near-workspaces smoke scripts vs sandbox/testnet
  wasm/                 built artifacts (see WASM artifacts below)
HIVEBID_SPEC.md         protocol spec (RFC ROY_MARKET_PROTOCOL)
HIVEBID_DEPLOY_RUNBOOK.md  deploy + verification runbook
docs/JUDGE_FAQ.md          judge-facing Q&A and honest scope answers
docs/JUDGE_WALKTHROUGH.md  three-minute judging script using live chain facts
docs/SIMULATION.md         offline simulation: sample table, escrow trace, scope
docs/REPRODUCE.md          step-by-step reproduction guide
docs/RPC_NOTES.md          read-only RPC endpoints and limits
docs/HIVEBID_SUBMISSION_EVIDENCE.md  evidence pack (pre-settle snapshot)
docs/INTENTS.md            why native escrow now and NEAR Intents as future work
RULES.md                   judge-facing rules summary
auction-evidence.json      raw RPC read of the recorded auction
```

## WASM artifacts

`contracts/hivebid_market/wasm/` contains three builds for traceability:

| File | Size | Notes |
|---|---|---|
| `canonical-hivebid_market.wasm` | 434,961 B | canonical artifact used by `prepare_wasm` tests |
| `hivebid_market.wasm` | 463,640 B | pinned build (md5 `d9e0b300…`) — historical candidate |
| `hivebid_market.d7.wasm` | 463,484 B | delta-7 build |

The **deployed** contract on testnet is a later build: 468,209 B (md5
`D3C8D79D…`, sha256 `B545B8AD…`), code hash `DCcTQUf…HPmUf`. It is not one of
the three files above — see the revision note in "Live on NEAR testnet".
`HIVEBID_DEPLOY_RUNBOOK.md` documents which artifact was signed and how the
deployment was verified.

## Test status

- `cargo test --lib`: **83 lib tests + 1 prepare_wasm check, all green**
  (verified on this source tree)
- Integration smoke (`integration/`): happy path + edge paths green on local
  NEAR sandbox; live testnet runs recorded (see Evidence below)
- Economic fuzz: 571 operations, 0 invariant violations

## Evidence

- `docs/HIVEBID_SUBMISSION_EVIDENCE.md` — commits, tx hashes, auction records,
  ratings before/after, static-vs-live honesty table
- `auction-evidence.json` — raw `get_bid_scores` response for lot
  `roy-1794159209212`: score factors per bid, the lot, the payout
- `docs/INTENTS.md` — why native escrow now and NEAR Intents as future work
- `RULES.md` — judge-facing rules summary
- `docs/SIMULATION.md` — offline simulation sample and scope notes

## Team / disclosure

HiveBid is the second independent project from the same author as the
**[NEXUS AiOS](https://github.com/ykbojak-alt/nexus-aios)** submission
(disclosed under hackathon rule Q-015: one participant, two independent
projects, each README names the other).

The projects are separate. HiveBid is the on-chain swarm auction market:
escrow, weighted bid scoring, ratings, slashing — contract, tests and demo in
this repository. NEXUS AiOS is the agent-orchestration platform: research
agent, escrow settlement, LoopGuard policy gate — contract, tools and demo in
its own repository. Neither repository contains the other's contract, and the
two demo recordings are different artifacts.

## License

MIT — see `LICENSE`.
