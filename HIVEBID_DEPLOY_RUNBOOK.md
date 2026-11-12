# HiveBid — build, deploy and verify (NEAR testnet)

Everything a reviewer needs to rebuild the contract, run it locally, and read
its state from a public testnet. Scope: **testnet only** — no mainnet path is
documented here, and the repository contains no keys.

The contract deployed for this submission lives at `hivebid-yksunder.testnet`
(code hash `DCcTQUf…HPmUf`); the accounts used in the recorded auction are
listed in `docs/HIVEBID_SUBMISSION_EVIDENCE.md`.

---

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Rust | 1.99+ | `cargo test --lib` must be green before anything else |
| near-cli | 4.0.13 | 4.x syntax (`near deploy <account> <wasm>`) |
| Node.js | 18+ | integration scripts (`npm ci` in `integration/`) |
| Optional | `near-sandbox` 2.14.0 (protocol 88) | for the local sandbox rehearsal |

`AWS_LC_SYS_NO_ASM=1` is required for the wasm build on machines without the
assembly-optimised crypto backend.

## 2. Build and pin the artifact

```bash
cd contracts/hivebid_market
cargo test --lib                     # expect: 100 passed / 0 failed
AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release
AWS_LC_SYS_NO_ASM=1 cargo test --test prepare_wasm -- --nocapture
sha256sum src/lib.rs target/wasm32-unknown-unknown/release/hivebid_market.wasm
```

`prepare_wasm` validates the artifact against the local protocol-88
configuration; it does not touch the network. Record the SHA-256 of the source
and of the artifact together — they are one reviewable pair. Never treat the
size or md5 of an older pinned build as proof of provenance.

## 3. Local sandbox rehearsal (no keys, no public transactions)

```bash
cd contracts/hivebid_market/integration
npm ci
HIVEBID_WASM=../target/wasm32-unknown-unknown/release/hivebid_market.wasm \
NEAR_SANDBOX_BIN_PATH=/path/to/sandbox-dir \
node demo-rehearsal-403.js
```

Both `NEAR_SANDBOX_BIN_PATH` and `NEAR_SANDBOX_BINARY_PATH` must point at the
**directory** that contains `near-sandbox`, not at the binary itself. A wrong
or missing directory silently falls back to the npm default sandbox
(neard 2.6.2 / protocol 77), where an artifact using bulk-memory fails the
prepare step. On a CPU without AVX2 the sandbox may exit with SIGILL — that is
a CPU limitation of the sandbox build, not a contract defect.

## 4. Testnet preflight — read only

```bash
export MKT='<existing-contract-account.testnet>'
export MGR='<owner-manager-account.testnet>'
export AGT='<agent-account.testnet>'
near --version                       # expect 4.0.13
near state "$MKT" --networkId testnet
near state "$MGR" --networkId testnet
near state "$AGT" --networkId testnet
near view "$MKT" get_escrow --args '{}' --networkId testnet
```

A freshly created contract account has an empty `code_hash` (`111…111`). If
`get_escrow` answers, the account already holds a contract — that is a
different situation, and it must be handled deliberately, not assumed.

The read-only smoke script prints a schedule and can run a read-only pass
against the chain (no signing, no transactions):

```bash
cd contracts/hivebid_market/integration
MKT="$MKT" MGR="$MGR" AGT="$AGT" LOT="$LOT" node testnet-smoke.js --plan
MKT="$MKT" MGR="$MGR" AGT="$AGT" LOT="$LOT" EXPECT_LOT=1 node testnet-smoke.js --run
```

## 5. Deploy, smoke, edge (owner-gated write steps)

```bash
cd contracts/hivebid_market
export HIVEBID_WASM="$(pwd)/target/wasm32-unknown-unknown/release/hivebid_market.wasm"
./deploy-testnet-nearcli.sh deploy    # deploy + init
./deploy-testnet-nearcli.sh smoke      # lot → bid → award → work → settle
./deploy-testnet-nearcli.sh edge       # no-show / cancel path
```

`deploy` on a clean account runs `near deploy "$MKT" "$WASM" --networkId
testnet --force` and then `near call "$MKT" new "{\"owner_id\":\"$MGR\"}"`.
The wasm path is a **positional** argument of `near deploy` in 4.0.13. On an
account that already holds an initialised contract the script asks for
`CONFIRM_UPGRADE=1`; that flag only skips the repeated `new` call — it is not
a migration, and the contract has no migration hook, so an upgrade of a live
instance needs its own plan.

Run `edge` at most once per contract instance: it uses a fixed lot id
(`edge-1`) and a second run collides with `lot_id already exists`.

`wait_ms <target_ms>` takes an absolute epoch timestamp in milliseconds, not a
duration; it waits in 2-second steps. `eta_ms` must be strictly smaller than
`work_deadline` — equality is rejected.

## 6. Post-deploy verification — read only

```bash
near view "$MKT" get_lot --args "{\"lot_id\":\"$LOT\"}" --networkId testnet
near view "$MKT" get_escrow --args '{}' --networkId testnet
near view "$MKT" get_agent --args "{\"account\":\"$AGT\"}" --networkId testnet
```

The deployed instance additionally exposes the score of every bid of a lot as
the read-only view `get_bid_scores`:

```bash
near view "$MKT" get_bid_scores --args "{\"lot_id\":\"$LOT\"}" --networkId testnet
```

A raw RPC response of that call for the recorded auction is committed as
`auction-evidence.json`.

## 7. Stop conditions

| Condition | Action |
|---|---|
| Source and wasm do not come from one reviewed state, or the hash does not match | **STOP before any transaction.** Rebuild and review source + artifact together. |
| Unclear whether the contract account is fresh; `get_escrow` fails because of RPC/network; account state and chain status disagree | **STOP.** Re-run read-only diagnostics only. A failed view does not prove an empty account. |
| The contract is already initialised, or the storage layout would change | **STOP — no upgrade.** There is no migration hook. |
| The account lacks funds, keys, storage or gas | **STOP before writing.** Never print keys. |
| Ambiguous receipt, transport error, phantom transfer, balances that do not add up | **STOP all further write steps.** Read state and receipts first; repeat nothing until the outcome is established. |
| Gas error, unexpected revert/trap, bid serialisation error, expired deadline, unexpected lot status | **STOP this run.** Compare chain state and receipt; do not re-issue `create_task`, `new` or `award_best` hoping to force it through. |

## Sources in this repository

- `contracts/hivebid_market/src/lib.rs` — the contract.
- `contracts/hivebid_market/tests/prepare_wasm.rs` — artifact prepare gate.
- `contracts/hivebid_market/integration/demo-rehearsal-403.js` — local near-workspaces rehearsal.
- `contracts/hivebid_market/integration/testnet-smoke.js` — `--plan` and read-only `--run`.
- `contracts/hivebid_market/integration/happy-path.js`, `edge-paths.js` — lifecycle scripts.
- `contracts/hivebid_market/deploy-testnet-nearcli.sh` — near-cli 4.0.13 deploy/smoke/edge.
- `docs/HIVEBID_SUBMISSION_EVIDENCE.md` — artifact, code hash and on-chain snapshots.
