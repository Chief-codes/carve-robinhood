# Carve — current status, 25 September 2026

## Original Buddy reference restored — published

- Restored the friend's actual 25-pose seated gaze renderer and original sine-blink timing, replacing the experimental native-eye/skin renderer described below. Existing original poses and lossless quality remain.
- Browser comparison: 125 gaze/blink combinations exactly match the original compositor and leave all non-eye pixels unchanged. 73 tests and production build passed.
- Create preview now uses the original Buddy greeting as a 585 KB looping GIF, with reduced-motion still and no effect on uploaded/draft media.
- Live renderer checks passed: left/right/up/down, neutral on leave/blur/touch, reduced-motion stillness, reverse-scroll gaze shutoff and independent idle blink. Create GIF, caption and controls do not overlap; home-page greeting is hidden while seated and there is no horizontal overflow.
- Production deployment `6ab663f669daad86fdc8f3b1`: https://carve-robinhood.netlify.app. Preview `6ab6633f1acf1e770c71d5a5` remains behind the existing Netlify team protection; that protection was not weakened.
- Utilities, contract addresses, fees, wallet behavior, saved data and live Musebook feed unchanged. See `BUDDY-REFERENCE-RESTORE-2026-09-25.md`. Public repository is being synchronized from this tested source, retaining existing contracts and using GitHub's no-reply author email.

## Buddy face/quality fixes and live Musebook feed

- Replaced mismatched eye-atlas overlays with subtle native-eye texture motion. Blink contours follow the actual eyes (including iris interruptions) and sample original skin instead of filling oversized flat-colour ellipses. Neutral frames restore the exact base pixels. Native reduced-motion, offscreen/background sleep and progressive loading remain.
- Character derivatives are now lossless WebP. All seven assets' visible pixels and native dimensions were compared with their original PNGs and matched. First buddy is 214 KB; later 1254px scenes stay deferred. The leaning renderer draws from its high-resolution original rather than a 314px intermediate, and the computer canvas uses 1254px. Fixed full-bleed scrollbar overflow.
- Musebook opens on actual public messages/replies; polls every 15 seconds while visible, deduplicates IDs, links original conversations, and switches channels automatically. A 10-second shared cache limits upstream traffic. No preset conversations, key, paid AI, or posted messages. The separate write-your-own profile option and saved drafts remain; template buttons were removed.
- Polling stops for hidden/offline tabs, capture/review and unmount; failures retain the last good feed with a warning and bounded retry backoff. The live feed never rewrites a captured inscription snapshot. Public docs updated.
- Build and all 73 tests passed. Open/half/closed/gaze sheets checked for standing, seated and leaning art; actual home-page native gaze and zero horizontal overflow checked. Live lobby/townsquare feeds and changing retrieval timestamps checked. No financial transactions, contract changes or external Musebook writes.
- Published and checked in production `6ab65d063ec90b6d57350ebf`: https://carve-robinhood.netlify.app. Details: `BUDDY-LIVE-MUSEBOOK-2026-09-25.md`.

## First-visit speed and unified Create theme

- Public release `6ab651236cce80403d5744c3`: https://carve-robinhood.netlify.app. This supersedes the dark Create theme described in the previous release below.
- Buddy renders immediately from a 53 KB derivative; later pose sheets/eye atlas load progressively and tutorial video is deferred. Native visual fallback survives failed animation downloads. Frame inspection is on-demand, not all 48 frames before first paint. Offscreen/background animation work sleeps.
- All pages now share mint/cream styling, including uploads, preview, fees, buyback, storage plan and dialogs. Fixed nested sticky-stage scrolling and short-screen tutorial fit. Create/My workspace are lazy-loaded; hashed assets have long-lived immutable caching, but HTML and financial reads do not.
- Build + 68 tests passed. Cold local first-view transfer about 420 KB; actual pose/computer scenes, blocked-animation fallback, desktop/390px Create and wallet dialog checked. Public buddy, theme, bundle identity, cache/CSP and live Musebook endpoint verified. No signed/broadcast transactions.
- 13 critical utility files matched the pre-change backup. Saved drafts, fees, contract addresses and byte-verification behavior preserved. Details: `PERFORMANCE-2026-09-25.md`.

## Design merge and simplified Musebook flow

- Integrated the supplied 24 September friend-design archive: mint/cream theme, scroll-driven mascot, rigid computer-arm animation, launch tutorial and final launch invitation. Create remains dark emerald. All seven routes include the existing Musebook tab.
- Preserved the current v5 addresses and launch, fee, buyback, migration, wallet, GIF, trading and inscription-verification implementations; older token support remains intact. The archive was not allowed to replace the newer capsule inspector, backend or local-storage features.
- Musebook is now choose source → review exact posts → continue to Create. Live public browsing, local search, profile links on both official hosts, 1–8 selected posts, a visible exact preview, permission checkbox and safe draft backup. Advanced profile fields/downloads are collapsible.
- The staged draft is saved before navigating to Create, so an immediate reload does not discard the capsule. Animation rendering skips unchanged eye frames; theme selection happens before route paint.
- Validation: 65 unit tests; desktop/mobile layout across 390/675/1024/1440px; reduced-motion navigation; live public feed and capture; written-profile staging/reload; original-token three-file onchain reconstruction; simulated wallet connection/account change/disconnection; buyback switch and GIF browser checks. GIF test retained 10 frames while reducing 1,481,371 to 785,854 bytes.
- Read-only mainnet simulations passed for the capsule and both buyback settings, plus a nonzero quote for the older token. No new wallet transaction was signed, sent or funded. This is not a new end-to-end mainnet launch or an independent security audit.
- Published and checked at https://carve-robinhood.netlify.app in production deployment `6ab64a853520e62d29311d02` (`ready`). Public bundle matched the tested build; live Musebook feed/capture and all three original-token inscription proofs passed on the public site. Details: `DESIGN-MUSEBOOK-2026-09-25.md`.

## Agent Capsules — public website update

- Published at https://carve-robinhood.netlify.app/#/agents in production deployment `6ab3b616d529899c6476cae1`.
- Creator-written public blueprints and read-only, attributed Musebook post snapshots become self-contained HTML in the existing website inscription slot. Image/GIF and audio remain usable; no new contracts, fee changes, AI subscriptions or autonomous actions.
- Full draft backup before staging; original HTML can be explicitly preserved as a downloadable attachment. Verified onchain HTML capsules expose a configuration download. No running AI, authorship, ownership or endorsement is implied.
- Build and all 63 frontend tests passed. Hosted preview feed and snapshot capture worked in Chrome. Read-only simulation against deployed v5 accepted a capsule launch; no transaction was signed or broadcast, and a live capsule token has not yet been launched.
- Details, limits, source attribution and test evidence: [AGENT-CAPSULES.md](AGENT-CAPSULES.md).

> Current website release is factory version 5 with optional trade-triggered buyback & burn. See [AUTO-RELEASE-2026-09-22.md](AUTO-RELEASE-2026-09-22.md) for the current addresses, source verification, exact fee split and test evidence. The user-approved deployment is complete. Sourcify reports exact matches for all four contracts; Blockscout submissions remain blocked by its security challenge. No live buyback-enabled test token has been launched by the agent.

## Previous version-4 release — retained for older tokens
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
# 2026-09-22 — GIF preparation published; buyback remains pending

- Replaced the earlier trailer-trimming GIF helper with a pinned, lazy-loaded Gifsicle WASM encoder in a bounded worker.
- Local animation test: 1,481,371 bytes → 785,854 bytes, 10 frames and 100 centiseconds retained.
- Structural validation, 12 MB upload limit, frame/pixel work bounds, 30-second per-attempt timeout, three bounded compression attempts and 1 MB prepared-output limit.
- GIF uses the existing image slot; audio and HTML remain combinable. No new contract or mainnet transaction was needed for this frontend update. This turn did not perform a new onchain GIF launch.
- Build + 47 frontend tests passed. Public upload/preview and CSP smoke test passed. Production dependency audit reported zero known vulnerabilities.
- Production deploy: https://6ab277670ff503c18b59fdfc--carve-robinhood.netlify.app (https://carve-robinhood.netlify.app).
- Creator-fee buyback is NOT deployed/enabled. Split-policy unit/fuzz tests (3 tests, 256 fuzz cases) passed; see BUYBACK-PENDING.md for architecture constraints and the outstanding execution-trigger decision. No current contracts/settings were changed.
