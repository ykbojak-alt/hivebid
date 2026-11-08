# Deck Mods Inventory

Source root: `C:/Users/BoJaK/.config/nx/mods`
Owner: NEXUS core app (runtime tabs)

## 1) `hivebid-deck` — live/testnet auction market viewer
- Primary reads:
  - `get_lot`
  - `get_bid_scores`
  - `get_agent`
  - `get_escrow`
- Typical refresh: 5–10 s poll on live contract calls.
- Data:
  - lot status, bids, score triplets, payout, winner, history, rankings
- Modes:
  - live mode with chain calls
  - mock fallback when RPC calls fail
- Sources:
  - `src/main.js`, `src/act.js`, `src/rating_poll.js` equivalents from W48–W54.

## 2) `aegis-deck` — archive-first audit viewer
- Primary reads:
  - core API export `/api/core/audit*` or cached `aegis-audit.jsonl`
- Typical refresh:
  - per open / slow deterministic refresh; no native runtime writer from app
- Data:
  - hash-chain decision records and replayed seq/hash
- Source:
  - archive path `D:/Temp/nc-state-win5/aegis-audit.jsonl` (rooms of dated rows)

## 3) `ratings-deck` — swarm ratings + ledger
- Primary reads:
  - `get_agent` (RPC)
- Typical refresh:
  - polled every 25 s (`rating_poll.js` / `pollChain`)
- Data:
  - rating deltas, test chip colors, bar normalized to 600k,
  - ledger with icon/state and relative timestamps.
- `this.chainUpdatedMs` used for relative "updated Xs ago".

## 4) `hackwatch-deck`
- Primary reads:
  - local `C:/Users/BoJaK/AppData/Roaming/Hackwatch/hackwatch.json` (300 rows)
- Typical refresh:
  - app-side model snapshot; read-only view with ranking by win probability
- Data:
  - top 6 list + schema `rank/win_prob/variance`

## 5) `farmratings-deck`
- Primary reads:
  - local farm metric snapshot from `farm-score.json`
- Typical refresh:
  - static-to-live bridge, mod watcher
- Data:
  - steward scores, node counts (e.g. seed 0.8 relative), pass/fail snapshot state.

No product docs are packaged here; this inventory keeps implementation honest. EOF marker intentional.
DECK MODS INVENTORY END (read-only).