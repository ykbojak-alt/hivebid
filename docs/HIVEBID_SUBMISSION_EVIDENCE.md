# HIVEBID SUBMISSION EVIDENCE

Snapshot date: 2026-11-08. Scope: read-only on-chain readings and documentation.

**Which moment is captured here.** These are the readings taken *before* the
settlement of lot `roy-1794159209212`. The post-settlement numbers for the
same auction (ROY-C rating 635500 → 671950, winner margin +0.099, scores
0.351 / 0.420 / 0.520) are in the repository `README.md`; the raw RPC response
is in `auction-evidence.json`.

**Source revision.** The source tree published in this repository is one
revision behind the deployed build: 83 lib tests here, 100 in the deployed
build, which additionally exposes the score as the read-only view
`get_bid_scores`. Both revisions compute the same 0.4/0.4/0.2 formula. See
the revision note in the `README.md`.

## 1. Commit-backed provenance

The public repository history starts from the initial contract import and
carries the documentation, media and evidence updates on top of it:

- `5ff83f1` — HiveBid: on-chain auction market for agent swarms (NEAR testnet, live demo)
- `1f3a081` — code + docs
- `f4c3aca` — final demo video
- `58d1a94` — judge FAQ, walkthrough, deck-mods reference
- `06b6da9`, `36794e0`, `686d965`, `bc5e7b6` — media: corrected demo cut, vertical cut, media index, screenshots
- `0817792` — demo rebuild, score table patched to the on-chain 0.520 / 0.420 / 0.351
- `5e2a2c2` — quickstart test count corrected 84 → 83 (fresh-clone verified)
- `d358a17`, `b6788aa`, `05aa49c` — rules/links, simulation + evidence docs, standalone simulation page

## 2. Contract (on-chain)

- Contract account: `hivebid-yksunder.testnet`
- Manager / agent accounts: `hivebid-manager-yks.testnet`, `hivebid-agent-yks.testnet`
- Sub-swarms: `roy-b.hivebid-manager-yks.testnet`, `roy-c.hivebid-manager-yks.testnet`
- Deployed code hash (RPC `view_account`): `DCcTQUfWB7jW7N1DCfZpYjDp4K73NJ215vu1QcQHPmUf`
- Artifact: `hivebid_market.wasm`, 468,209 B, md5 `D3C8D79D`, sha256 `B545B8ADB25B5B92B2233D32AE5E6C4F026852C8CEAE7B5B074331AFB8EFB284`
- Tests/build evidence: 99/99 baseline documents; the deployed build reports 100/100.
- View entrypoints verified on the deployed instance: `get_agent`, `get_lot`, `get_bid_scores`, `get_escrow`.
- Live states used in evidence:
  - agent ROY-A: 4N stake, rating 440000, 1 completed, 1 failed.
  - agent ROY-B: 1N stake, rating 500000, no tasks.
  - agent ROY-C: 1N stake, rating 635500, 3 completed, 0 failed; winner margin +0.087 over ROY-B; escrow 0 after settle.
  - score factors: ROY-A 0.346, ROY-B 0.416, ROY-C 0.503; 40/40/20.
  - burned: 0 — the rework path keeps burned at zero even on a no-show.

## 3. Completed auction lots (live chain evidence)

- At least three `Completed` lots independently verify the flow (`roy-1794152630606`, `roy-1794153275795`, `roy-1794153995214`), all winner ROY-C with 0.60N/0.40N payout and escrow 0.
- `smk-5-1794136566619`: also completed; `w31-1794138117517`: anti-slash regression, status Failed, rework 1, burned 0.
- Six-transaction success-tx set retained in the recorded run logs (all FINAL).
- Lot tx IDs are not repeated here; the explorer links for the recorded lot are in `auction-evidence.json` and the demo recording.

## 4. Video / submission package

- `docs/demo/nexus-demo-voiced-final.mp4` (99 s recorded testnet auction), poster and screenshots in `docs/demo/`.
- The interactive demo page is published from this repository.
- External claims remain bounded to local/testnet scope; no mainnet claim anywhere in this packet.

## 5. Honest static-vs-live split

- **Live-chain facts**: deployed contract, view-account code hash, `get_agent` × 3, `get_escrow` = 0, `get_bid_scores` winner margin +0.087, cancellation refunds, six-tx demo set, on-chain no-slash on the rework path.
- **Static/doc facts**: build/test counts, source majors, judged docs, smoke scripts, reproduction guide, publication page.
- **Not claimed here**: any mainnet deployment, any mainnet funds, any private-repo component.

## Scope notes

No secrets are contained in this repository: account IDs are public on-chain
identifiers, no key material or seed phrase appears in any file.
