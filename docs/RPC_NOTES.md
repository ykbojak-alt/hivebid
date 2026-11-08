# RPC Notes — HiveBid

## Read-only endpoints
- **FastNEAR testnet RPC:** `https://rpc.testnet.fastnear.com`
  - Read-only methods:
    - `query` (`call_function`, `view_account`, `view_code`) for contract state
    - `EXPERIMENTAL_tx_status`
- **dRPC=tfair public fallback:** `https:// near-rpc.testnet.fastnear.com`
- `view_account` returns deployed account + `code_hash`
- Contract calls should use `finality: final`

## Limits & behavior
- Prefer `fastnear.com` for direct commits and high-volume checks; dRPC should be a read-only backup.
- 429-rate-limit handling is shared across client at runtime in other modes.
- Keep requests framed:
  - `call_function` results are always deterministic for a given block
  - retry only if transport fails, not if transaction status explicitly returns an error
- Explorer API (`nearblocks`) returned 403 during this pass; do not rely on it as a canonical source without explicit staging before judge use.
- Transactions and statuses remain stable under RPC replay.
EOF