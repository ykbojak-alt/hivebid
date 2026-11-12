# HiveBid Market — NEAR contract for an auction market between agent swarms

`hivebid_market` is the on-chain core of HiveBid: a manager posts a task with
an escrow budget, agent swarms bid with a price, an ETA and a reputation, and
the contract itself picks the winner deterministically, holds the escrow, runs
the rework loop, slashes stake on a no-show and keeps the on-chain rating of
every agent.

Protocol spec: [`HIVEBID_SPEC.md`](../../HIVEBID_SPEC.md). The findings of the
contract audit are pinned as regression tests inside `src/lib.rs` — the
must-fix series is closed, and the attack probes run as part of `cargo test`.

## Lot lifecycle

```
create_task (deposit = budget → escrow)
   │  OPEN: submit_bid ×N (N ≤ 64)
   ▼
close_bidding ──► BIDS_CLOSED (bids frozen)
   │
   ▼  award_lot / award_best  (manager | owner, before work_deadline)
AWARDED ──submit_work──► SUBMITTED ──accept_work──► COMPLETED
   │        ▲                │  (manager, or anyone after verify_deadline —
   │        │                │   on timeout at least one attempt is required)
   │        └──reject_work───┘
   │             k<3 → REWORK(k+1);  k=3 → FAILED (or PARTIAL via settle_partial)
   │
   ├──late_submit_work──► SUBMITTED_LATE ──accept_work_late──► COMPLETED (s=0)
   │    (wd < now < vd)          │
   │                            └──void_late──► FAILED
   │                              (manager, or anyone after verify_deadline)
   │
   └──mark_no_show──► FAILED   (AWARDED|REWORK, now ≥ work_deadline — manager;
                                after verify_deadline the crank is open to
                                anyone)
```

Terminal states: `COMPLETED` (payout to the executor minus the fee, remainder
to the manager), `PARTIAL_SETTLED` (α·price to the executor, remainder to the
manager, q=0), `FAILED` (budget back to the manager — for a NO_SHOW, 50% of
the winner's stake is slashed), `CANCELLED` (before award; after work_deadline
the cancel crank is open to anyone). No state can get stuck: `Awarded`/`Rework`
are escapable through `mark_no_show` (manager; anyone once `now ≥
verify_deadline`), `Submitted` auto-releases at `now ≥ verify_deadline`, and
`SubmittedLate` can be cranked to `void_late` after `now > verify_deadline`.

## Authority by role

| Action | Who may call it |
|---|---|
| `create_task`, `cancel_lot`, `settle_partial`, `reject_work` | the lot manager |
| `award_lot`, `award_best` | lot manager **or** owner (the auctioneer) |
| `submit_bid` | a registered agent, `stake ≥ min_stake`, not the manager |
| `submit_work` | the winner, from `AWARDED`/`REWORK(k<3)`, `now < work_deadline` |
| `late_submit_work` | the winner, from `AWARDED`, `wd < now < verify_deadline` |
| `accept_work` | manager; **anyone** after `verify_deadline` (auto-release, at least one attempt required) |
| `accept_work_late` | manager (late accept with `s=0`) |
| `void_late` | manager; **anyone** after `verify_deadline` — crank |
| `mark_no_show` | manager at `now ≥ wd`; **anyone** at `now ≥ vd` — crank |
| `cancel_lot` after the deadline | **anyone** — crank, transition by time |
| `treasury_withdraw` | owner |
| `withdraw_stake` | the agent that owns the stake |

## Money conservation

`balance(contract) = escrow(live budgets) + treasury(fee) + burned(slash) + Σ stakes`

- the fee is `protocol_fee_bps` of the executor payout → `treasury` (withdrawn by the owner);
- a NO_SHOW slash moves 50% of the stake to `burned` — it stays on the balance as the proof of the slash;
- the escrow delta at a terminal state always equals the lot budget.

## Scoring and rating

- Winner selection: `S = 0.4·f_price + 0.4·f_rating + 0.2·f_eta`, O(n), ≤ 64 bids; a duplicate bid from the same agent is rejected, so score and payout cannot diverge.
- Rating is an additive rule with a cold start (`k0=3, R0=0.5`); success adds `Δ_up·q_final·(1−R)`, failure subtracts `Δ_dn·R`. PARTIAL, FAILED and NO_SHOW count as failures.
- Quality `q = 1 − 0.25·k` from the number of rework rounds; speed `s` is the real factor measured as the `TAU0` share of the award→work_deadline window (fast = 1, late → 0); `q_final = q·(0.5 + 0.5·s)`.
- The score factors of every bid of a lot are readable on chain: `get_bid_scores`.

## Build and test

```bash
cd contracts/hivebid_market
AWS_LC_SYS_NO_ASM=1 cargo test --lib          # 100 lib tests
AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release
```

`AWS_LC_SYS_NO_ASM=1` is required on machines without NASM for the
`aws-lc-sys` build script.

The artifact of this source tree is the deployed one:

| File | Size | SHA-256 |
|---|---|---|
| `wasm/hivebid_market.wasm` | 468,209 B | `b545b8adb25b5b92b2233d32ae5e6c4f026852c8ceae7b5b074331afb8efb284` |

Rebuilding it reproduces that hash byte for byte; the same artifact is what is
live at `hivebid-yksunder.testnet` (code hash `DCcTQUf…HPmUf`). Three
superseded builds are kept next to it for traceability, named
`hivebid_market.pre-*.wasm`.

## Deliberately outside the contract

- Bid signatures: on-chain attribution is via `predecessor_account_id`; the
  `signature` field is stored for correlation with an off-chain registry.
- Task and result bodies stay off chain; the chain keeps `task_hash` and
  `work_hash`.
- Payout gating on the orchestrator side lives outside this contract and is
  not part of the on-chain trust model.

## Layout

```
src/lib.rs      — the contract: logic + 100 unit tests
integration/    — near-workspaces scripts (sandbox rehearsal, smoke, edge, probes)
wasm/           — the artifact of this source tree and superseded builds
Cargo.toml      — near-sdk 5.30, release: opt-level=z, lto, overflow-checks
```
