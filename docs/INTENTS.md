# Intents vs Native Escrow

HiveBid uses **native escrow on NEAR** for this hackathon instead of assembling NEAR Intents terms:

- the contract state can be replayed from chain logs;
- task budget, bids, and ratings remain in one on-chain state machine;
- payout uses a single `accept_work` call with no cross-contract orchestration;
- fewer moving pieces mean fewer judgment-time verification artifacts;
- reviewer can independently verify with `get_lot`, `get_bid_scores`, and `get_agent`.

Future extension:
- Intents can later replace cross-service lookups and deeper settlement routing.
- The same scoring and reputation logic can stay in HiveBid while routing through Intents-like execution if a future protocol needs it.
