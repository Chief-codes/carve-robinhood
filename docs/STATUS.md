# Carve — current status, 16 September 2026

## Active release
The new curve-to-Uniswap-V4 release is deployed on Robinhood Chain (4663).
- Deployment transaction: 0x8c6a5d317d3426ea17d70a7c2bb3001f3d08e87e94be765b4c1d55b7d73baa03, block 63884617.
- Factory: 0xf843A997447E3eF9cf44a9078BBe870E7ef3F67c
- Engine / permanent LP custodian: 0x91A6877c72B82e0E7AE0F0488EbD8356Ff5EE044
- Router: 0x9D854151c1db6218B7C9e1f48E9E553cdCDd2D53
- Reused media registry: 0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F
- Deployer and platform recipient: 0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048

Receipt, complete runtime templates/hashes and 30 immutable/parameter bindings were independently checked locally. Evidence: ../../work/carve-contracts/deployment-plans/mainnet-curve-verified-2026-09-16.json.
The user approved public Solidity source verification on 16 September. Sourcify accepted exact-match submissions for the coordinator, factory, router and engine. Robinhood Blockscout currently blocks automated source-submission requests behind a Cloudflare challenge; do not treat that explorer as source-verified unless it subsequently confirms verification. Public bytecode already exists onchain.

## Approved behavior
1 billion supply; 0.0005 ETH creation fee plus gas; 1% Carve fee plus creator-selected 0–10%; no anti-sniping tax.
Virtual reserve 1.68 ETH; real-reserve cap 4.2 ETH. Each creator chooses the initial buy, including zero. Virtual liquidity is not real ETH.
Threshold transactions attempt a canonical Uniswap V4 NFPM migration. Approximately 204.081632M tokens seed the pool and 81.632653M surplus tokens remain locked. Failed migration is atomic and leaves a retryable funded curve; both curve directions pause at the cap. A permissionless retry is exposed on the token page. UI cap-crossing requests add bounded migration gas headroom.
This is an independent implementation with corresponding curve economics, NOT a byte-for-byte Pons clone. It does not include Pons anti-sniping, admin/buyback policies or every paired stock.
Native ETH sales/refunds pay directly with recoverable credit if the recipient rejects ETH.
Any nonempty image/audio/HTML combination is allowed. Total media <=24 KiB uses one launch approval; larger files use resumable uploads. The token's imageRoot refers to the exact prepared uploaded image, used automatically by Carve's cards and detail page. No tokenURI getter exists. External apps use their own logo/listing/indexing rules and cannot be promised automatic support.

## Validation completed
- Existing candidate suite: 12 mainnet-fork tests passed.
- Additional suite using ACTUAL deployed contracts at fork block 63888092: 4 passed, 0 skipped. Tests cover exact token image/audio/HTML bytes, all seven combinations/zero buy, 0.01 buy ratio, creator fees/native curve sell, migration/NFPM ownership and post-migration buy/sell.
- Frontend: 45 tests passed; TypeScript/Vite build checked.
- The website's actual verifyDeployment routine passed against mainnet.
- Read-only simulation of CVCURVE with all 3 files, 0% creator fee and 0.01 ETH buy passed; estimated gas 7,108,787 (~0.00049 ETH at observed gas price). No mainnet test token was submitted by the agent.
- This is internal testing, NOT an independent professional security audit.

## Live test and publication confirmed
- CVCURVE launched in one user-approved transaction: 0x6ffc865b6b1e13eebd0d3f296ca8c0d6c5ede685e994685807bd50be60884a02, block 63893034.
- Token: 0x2c06a3e230FD4ba9D61Ee247C57879F7f1ae9841
- Market: 0x43fD2825EBc1d108e59e7cC802c77008c790023a
- 0.01 ETH initial buy; 0.0099 ETH real reserve; 5,858,334.812710811290608911 tokens received at launch. Creation fee 0.0005 ETH. Receipt execution gas cost 0.000477611661792 ETH.
- All 3 files independently reconstructed and exactly matched the prepared CVCURVE draft: 7,512-byte WebP, 8,044-byte WAV, 728-byte HTML.
- Proof: ../../work/carve-live-test/CVCURVE-mainnet-proof-2026-09-16.json; verifier: verify-curve-live.mts alongside it.
- Both live buy and sell quotes returned nonzero amounts. No separate mainnet buy/sell transaction was sent by the agent. A live post-launch sell still needs the user's approval before claiming it tested.
- Netlify production deployment 6aa9990ff17676760851af63 is ready. https://carve-robinhood.netlify.app returned HTTP 200; chain-BZ6psv_8.js exactly matched the tested local build and new factory. Published 2026-09-15 19:14:46 UTC (16 September locally).
- Public test page: https://carve-robinhood.netlify.app/#/explore?token=0x2c06a3e230FD4ba9D61Ee247C57879F7f1ae9841
- Chrome local preview remains available for the user's continued testing at http://127.0.0.1:5188. Do not interrupt an active wallet request.
- Old V3 tests/positions and older curve contracts remain onchain. V3 token trading route remains supported. Do not delete or deprecate them without a separate request.
- The reference banner and Deployment panel in How it works were removed. Brand, explicit wallet selection, local drafts, HTML isolation and transaction recovery safeguards remain.

## Continuity
Only modify Carve. No unrelated bots, accounts or old project files. Never request/store private keys. Never sign mainnet financial actions for the user. Preserve prior drafts, receipts and resumption journals.
