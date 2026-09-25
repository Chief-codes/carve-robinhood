# Optional creator-fee buyback — implementation history

Superseded by [AUTO-RELEASE-2026-09-22.md](AUTO-RELEASE-2026-09-22.md). Infrastructure is deployed and verified; website integration and internal checks are complete. Historical pending steps below are retained for continuity, not current instructions.

## Confirmed deployment — supersedes unsigned status below
Transaction `0x58b02a79e39e5453ecc2a26547e5f456ae381f37fecf0c44cc7c177e02cdb1fe` succeeded at block 69716039, using nonce 23 and the exact reviewed plan. Rechecked at block 69720018: runtimes and 33 bindings passed. Execution gas cost: 0.00049665287959 ETH. The receipt does not require another deployment signature.

- Factory: `0xAFbF0a6a548BAD4320FC0fBe777055572B2F340a`
- Engine: `0x832Fb03279d7b10B0f2F711Fc4251eBeC3ce2044`
- Router: `0x097C5497a07fB9D50d818f5356eD847FD5dE23Bf`
- Proof: `../../work/carve-contracts/deployment-plans/mainnet-auto-verified-2026-09-22.json`

Approval console rebuilt after correcting economics verification for nested buyback settings; all 44 tests passed. No new mainnet transaction was sent by the agent. No live buyback-enabled token has been tested yet.

## Confirmed scope
- Applies separately to tokens launched through Carve, not a Carve platform-token buyback.
- Preserve the separate 1% Carve platform fee.
- Preserve the existing optional creator-fee range (0–10%).
- When opted in, split the creator fee into 20% creator revenue and 80% buying the launched token.
- At a 1% creator fee, this means 0.2% revenue and 0.8% buyback, plus Carve's separate 1%.
- No authority to spend a creator's personal wallet balance or divert platform revenue.

## Decision and tested candidate — 2026-09-22
User selected trade-triggered execution explicitly: no schedule, keeper, external model or manual recurring transaction.

Candidate Solidity lives in `work/carve-contracts/src/auto/` (relative to workspace root). Existing deployed source files remain unchanged. New factory version 5 has an immutable per-launch `autoBuyback` choice; the user's creator identity, initial-buy beneficiary and content roots are preserved. There is no separate externally controlled vault: each market/engine accounts for its token's buyback budget separately from withdrawable revenue.

Curve buys and sells split creator fees 20/80. Post-graduation V4 hooks also split creator fees: ETH budgets buy that same token; the 80% share of token-denominated fees goes directly to the dead address. The engine releases residual curve budgets into only the corresponding token budget. Bought tokens go to `0x000000000000000000000000000000000000dEaD`. This permanently removes circulation, not nominal totalSupply. No arbitrary destination/router or withdrawal of buyback balances is exposed.

Candidate limits shown on deployment review: minimum accumulated ETH 0.00001; max purchase 0.002 ETH and 0.1% of virtual native reserves. Buys pay normal fees. Internal self-call rollback boundaries retain budgets on failures. A gas floor on eligible trades prevents eth_estimateGas from choosing an always-skip path; the trader pays this extra transaction gas. No trades means no new automatic execution. V4 spot-price bounds limit execution impact but do not promise elimination of MEV.

## Validation and exact unsigned review
- 21 candidate tests passed, 0 skipped, against real Robinhood mainnet fork block 69686947. Covers all media combinations, curve trades, migration, real V4 exact-in/out, both fee currencies, split, failed attempts, gas floor, creator withdrawals, token isolation, backing of claims and locked LP. Internal tests, not an independent audit.
- Current unsigned plan: `work/carve-contracts/deployment-plans/unsigned-auto-buyback-gas-reviewed-2026-09-22.json`.
- Plan ID: `0x1a1b1272bf6aea5c65d5d4c23200108feb3f64b4c36bb711f1825c7a54ca5c6f`.
- The earlier `unsigned-auto-buyback-2026-09-22.json` is SUPERSEDED. Do not use it.
- One deployment signature, nonce 21 at preparation, registry reused. Simulated 10,134,250 gas; approximate 0.0004992 ETH at quoted gas price (not guaranteed; console refreshes).
- Local review console: `work/carve-auto-deployment-console`, port 5197. New planner/verifier scripts preserve old deployment tooling.

## Nonce refresh
The wallet nonce advanced from 21 to 23. Onchain checks found no contract at either nonce-21 or nonce-22 creation addresses. Current reviewed unsigned plan is `work/carve-contracts/deployment-plans/unsigned-auto-buyback-nonce23-2026-09-22.json`, plan ID `0x44a98c635624abc7b4c29a2f8b56950885fdcce393d77e2081d8a86d7628407d`. Both earlier nonce-21 plans are superseded. Nonce-23 simulation passed (10,134,250 gas, approximately 0.00050351 ETH at quote). Console port 5197 now loads this plan. Still unsigned/unverified onchain.

## Still required
Integrate factory version 5 and the optional launch flag in the website, keep old-token trading supported, show real buyback/burn stats, test the updated launch/trade flow, then publish. Deployment is complete; do not sign it again. No live configuration or public website has been changed for buybacks yet. No retrofit of immutable old tokens.
