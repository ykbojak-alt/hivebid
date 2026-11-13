# Scripted HiveBid simulation

## Run without funds

```sh
node contracts/hivebid_market/integration/sim-swarm.js --dry --out ./sim-swarm.json
```

**dry-run: real scoring math, no funds needed, judges can run with `--dry`.** The simulator uses fixed scripted data for 20 bidder profiles; it makes no LLM, RPC, wallet, sandbox, or transaction calls. The default output path is `sim-swarm.json` in the current directory (`HIVEBID_SIM_OUTPUT` overrides it); `--out` sets the destination explicitly.

The dry flow is `create_task` → 20 unique `submit_bid` calls → `close_bidding` → `get_bid_scores` → `award_best`. `close_bidding` is required by the contract before `award_best`. Prices, rating samples, and ETAs are synthetic fixtures, while the score uses integer arithmetic and the contract weights (0.4 price, 0.4 rating, 0.2 ETA; SCALE 1,000,000). The dry result is not a live-chain response.

## Escrow trace

| Step | `get_escrow` | Why |
|---|---:|---|
| Before `create_task` | 0.00N | No lot budget is locked. |
| After `create_task` | 3.00N | The full task budget is in escrow. |
| After 20 bids | 3.00N | Bids do not move funds. |
| After `close_bidding` / `get_bid_scores` | 3.00N | Closing and reading scores are non-monetary. |
| After `award_best` | 3.00N | Award records the payout; funds remain escrowed until work settlement. |

The `clearing_price` in this simulation is the selected winner's bid price, not a second-price auction price.

## Sample output

Captured from the local `--dry` run (`generated_at=2026-11-08T21:45:34.438Z`):

| Bidder | Scripted strategy | Bid | `score_norm` |
|---|---|---:|---:|
| ROY-01 | cheap-fast | 1.45N | 0.590888 |
| ROY-02 | cheap-fast | 1.50N | 0.582577 |
| ROY-03 | cheap-fast | 1.55N | 0.574666 |
| ROY-04 | cheap-fast | 1.60N | 0.560554 |
| ROY-05 | cheap-fast | 1.65N | 0.554044 |
| ROY-06 | cheap-fast | 1.70N | 0.547333 |
| ROY-07 | cheap-fast | 1.75N | 0.530221 |
| **ROY-08** | **high-rating** | **2.00N** | **0.611069** |
| ROY-09 | high-rating | 2.04N | 0.596690 |
| ROY-10 | high-rating | 2.08N | 0.582310 |
| ROY-11 | high-rating | 2.12N | 0.567929 |
| ROY-12 | high-rating | 2.16N | 0.553551 |
| ROY-13 | high-rating | 2.20N | 0.539170 |
| ROY-14 | balanced | 1.75N | 0.583332 |
| ROY-15 | balanced | 1.81N | 0.572777 |
| ROY-16 | balanced | 1.87N | 0.562221 |
| ROY-17 | balanced | 1.93N | 0.551666 |
| ROY-18 | balanced | 1.99N | 0.541110 |
| ROY-19 | balanced | 2.05N | 0.530554 |
| ROY-20 | balanced | 2.11N | 0.519999 |

**Winner:** ROY-08, clearing price 2.00N. The JSON file is for the HiveBid simulation deck and has top-level `ok`, `generated_at`, and `rounds`; each round includes `round`, `lot`, 20 `bids` (`agent`, `amount`, `score_norm`), `winner`, and `clearing_price`.

## Scope note

This command is a no-funds scripted dry-run. It does not call the deployed contract. In the checked HiveBid repository source at the time of this run, the `get_bid_scores` view is absent even though the README describes it; therefore this sample must not be presented as an on-chain score response. The dry simulator reproduces the current scoring formula from the NEXUS contract source for judge-friendly local demonstration.