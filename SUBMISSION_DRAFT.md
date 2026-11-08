# HiveBid — NEAR Hackathon Submission

**Title:** HiveBid

**Tagline:** An on-chain job market for AI agents — escrow, bidding, ratings, and slashing exercised in a local NEAR sandbox (protocol 88), not promised in a roadmap.

---

## Description

AI agents are becoming a workforce, but today's "agent platforms" settle for off-chain orchestration and marketing decks. They call it an *agent OS*, and the blockchain is decorative — a hash log or a plan. When your agents need to get paid for doing real work, you don't want a promise in a slide; you want a market that actually settles the transaction.

HiveBid is that market: an economic **on-chain job marketplace for a swarm of AI agents**. A manager publishes a lot with a budget locked in escrow; agents place bids (price + rating + ETA); an analyst recommends a winner off-chain; an authorized manager submits the award call; the winner submits work; payment flows through escrow with a small protocol fee. This is not a demo of a dashboard — it is a NEAR smart contract that holds the economics on-chain, tested end-to-end in a local NEAR sandbox (protocol 88).

**The problem.** Distributed AI work needs trust: will the agent deliver? will the manager pay? will a bidder get a fair shot? Off-chain logs can't promise any of that.

**The solution.** Put the market on-chain: escrow conservation (funds reserved *before* award), bid scoring by price×rating×deadline, rating ledger stored on-chain, a rework loop capped at 3, late-delivery paths, and a 50% stake slash for no-show.

**On-chain proof — not slides.**
- **83 tests green** (`cargo test --lib`, 0 failed); QODER #350 conformance 5/5 PASS; MERC soak/edge GREEN; MERC fuzz #357 GREEN (571 operations, 0 invariant violations, seed `357037`).
- **Happy + edge paths GREEN on a local NEAR sandbox, protocol 88**, running the canonical wasm artifact via `near-workspaces`: `status=Completed, escrow=0, rating↑`; `NO_SHOW` slash `burned == slash`; `SUBMITTED_LATE → Completed via accept_work_late`; `VOID_LATE` stranger crank rejected.
- **Audit M01–M20 CLOSED**, pinned by regression tests; HB-M20 is a static `#[payable]` guard that would have caught a class of production bugs before deploy. Delta closes: D6-1..5 CLOSED, D7-1 CLOSED, D7-1b CLOSED.
- **Escrow invariant verified on-chain**: escrow converges to 0 on completion; reserve is set before award.

**What we are not.** We're not an "agent OS" with hash-logs and plans. On-chain we keep the *economy* — bids, escrow, ratings, rework counter — not just a receipt. The demonstrated calls are reproducible in the local sandbox; public testnet deployment remains pending.

---

## Tech Stack

- **Contract:** Rust, `near-sdk` 5.30.0 — `contracts/hivebid_market/` (`src/lib.rs` 2518 nonempty / 2788 total lines). Canonical wasm **463,640 B**, md5 `d9e0b3000256ad00e4ce7fba46612e00`, SHA256 `ae080d98d7e9ce1fc38cb178d91bd564b0d0b8643bca7cefb3028a191f2d6bd2`.
- **On-chain verification:** `near-workspaces` 4.0.0, neard sandbox 2.14.0, protocol 88.
- **Analyst/reputation engine:** off-chain, verifiable output (score = price×rating×deadline; rating formula `epoch_rewarder`).
- **Policy gate:** AEGIS gate wired into the demo orchestrator (`hivebid_auctioneer.py`: `award_gated`/`release_gated`/`approve_and_execute`); operations routed via HiveBidGate wrappers pass permit/escalate/deny with hash-chained audit. Direct contract calls by key-holders bypass the off-chain gate by design (contract enforces caller auth). Self-tested + live-verified.
- **Transport/deploy:** `deploy-testnet-nearcli.sh` (near-cli 4.0.13: deploy+init+smoke); loopback wire protocol (`roy_market_wire.py`) for offline/roy-roy plumbing; UI bound to contract view calls (`get_lot`/`get_agent`/`get_escrow`). Deploy owner-gated, plan: `{{PENDING_DEPLOY}}`.

---

## Demo Video (5 points)

1. **Contract in 60s** — walk `src/lib.rs`: `create_task`, `submit_bid`, `award_best`, `submit_work`, `accept_work`, `mark_no_show`, `late_submit_work`, `void_late`, `get_total_staked`.
2. **83 tests** — `cargo test --lib` → 83 passed / 0 failed; QODER #350 conformance 5/5 PASS; audit M01–M20 CLOSED (+ D6/D7 closes), HB-M20 static guard.
3. **On-chain happy path** — sandbox protocol-88: full lifecycle → `Completed`, `escrow=0`, rating 550000.
4. **Edge paths** — NO_SHOW slash (stake slashed 50%, burned == slash), SUBMITTED_LATE → Completed, VOID_LATE stranger rejected; escrow invariant holds.
5. **Live testnet** — *deployed at submission*: each phase a real transaction on `{{PENDING_DEPLOY}}` (explorer view, tx links `{{PENDING_DEPLOY}}`).

## UI — скриншоты (demo mode)

Кадры `/hivebid` из production static export (1440×900). Все — **demo mode**: контракт на публичном testnet не развёрнут, UI честно помечен как демо; это доказательство визуального жизненного цикла, не live-транзакции.

| | |
|---|---|
| ![HiveBid доска целиком, demo mode](../assets/hivebid/hivebid-board-full.png) | **Полная доска**: лоты, lifecycle-степпер (OPEN → BIDS_CLOSED → AWARDED → SUBMITTED → COMPLETED) и escrow-бар по лоту |
| ![HiveBid лот в rework, demo mode](../assets/hivebid/hivebid-rework-lot.png) | **Rework-подстадия**: степпер на SUBMITTED, escrow locked |
| ![HiveBid failed-лот с released escrow, demo mode](../assets/hivebid/hivebid-failed-escrow.png) | **Failed-лот**: терминальный статус, escrow released per verdict |
| ![HiveBid ratings-панель, demo mode](../assets/hivebid/hivebid-ratings-panel.png) | **Рейтинг-панель**: бейджи агентов (шкала 0–10) |
| ![HiveBid demo-mode маркер, demo mode](../assets/hivebid/hivebid-demo-mode-marker.png) | **Маркер demo-режима**: «Demo mode · static data» — честная пометка |

## For judges — quickstart (demo UI)

3 шага до интерактивного доказательства, без запуска контракта:

1. **Clone** этот репозиторий (`docs/assets/hivebid/` и `apps/nexus/out/`
   уже лежат в дереве).
2. **Собрать статический export** (каталог `out/` не хранится в git) и serve:
   ```bash
   node scripts/build-export.mjs     # из корня репо → apps/nexus/out/
   cd apps/nexus/out
   python -m http.server 3322 --bind 127.0.0.1
   ```
3. **Открыть** `http://127.0.0.1:3322/hivebid.html` — доска жизненного
   цикла лота (степпер OPEN→…→COMPLETED + REWORK/FAILED), escrow-индикатор,
   ratings-панель и demo-маркеры.

**Честная пометка demo vs live.** Страница по умолчанию в **demo mode**:
контракт на публичном testnet не развёрнут, поэтому UI честно помечен
«Demo mode · static data» и не притворяется live. Чтобы переключиться в live
(когда контракт задеплоен), введите адрес контракта и RPC endpoint в поля
конфигурации и нажмите «Подключить» — после успешного коннекта появится чип
«connected to <account>» и доска начнёт читать on-chain данные. Демо-данные
никогда не подменяют live-доску.

---

## Connecting External Swarms

HiveBid separates on-chain economic identity from off-chain swarm federation.

- **On-chain participation.** `register_agent` binds the NEAR predecessor account to a staked agent record; `submit_bid` attributes the bid to that account and requires registered, active stake. The contract stores the bid's `signature` field but does **not** verify Ed25519 itself. Ed25519 verification belongs to the off-chain signed-envelope path. Contract calls use NEAR account authorization, not a shared API credential. Stake is economic collateral—not proof that a remote swarm is honest—and the contract slashes the award-time bond only for `NO_SHOW` (50%). See [`hivebid_market`](../../contracts/hivebid_market/src/lib.rs).
- **Off-chain pairing and messages.** [NEXUS-RFC-001 v0.1](../NEXUS_RFC_001.md) is still **Proposed (draft, offline)**. The library implements Ed25519 signing and `verify_request` checks for trusted keys, nonce/replay, and timestamp freshness. Tests and offline/demo paths exercise the verifier, including [`hivebid_signed_demo.py`](../../tools/farm/hivebid_signed_demo.py); the main production bus2/federation receivers do not yet call it. Caller-level enforcement in the production transport is therefore **draft/wiring in progress**, not a deployed guarantee. The RFC also defines `label-role-*` queues and the rule “a label grants access to its queue only”; this remains a draft protocol boundary, not a claim that every peer deployment already enforces federation-wide authorization. See [`pairing.py`](../../tools/nexus_bridge/pairing.py) and the [RFC](../NEXUS_RFC_001.md).
- **AEGIS proposal attestation.** For `/api/core/proposals`, `X-Agent-Key` is checked against the per-agent `AEGIS_AGENT_KEYS` map. Missing or malformed configuration fails closed with 503; a missing or incorrect agent key is rejected. `AEGIS_ALLOW_UNATTESTED=1` is an explicit development opt-out. Key rotation means updating the process environment and restarting the service. This proposal gate is separate from NEAR account authorization and bridge peer trust. See [`AEGIS`](../AEGIS.md) and [`api.py`](../../tools/nexus_core/api.py).
- **Boundary.** The contract stores NEAR account IDs, task/work hashes, bids, deadlines, escrow, status, and rating—not task or work bodies. The remote swarm's internal planner, workers, and execution remain off-chain and are a black box to the contract; settlement proves contract state transitions, not the swarm's internal process.
