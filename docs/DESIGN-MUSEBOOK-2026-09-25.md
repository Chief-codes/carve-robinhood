# Design + Musebook release — 25 September 2026

## Design source and merge

User supplied `Carve-Friend-Source-2026-09-24.zip`. Its visual assets/components were integrated into the existing working project. Financial/inscription code, current contract configuration, backend, capsule support and saved-data format were retained. The supplied archive's older versions of the capsule-aware components were not copied over current utilities.

Home uses the supplied scrolling mascot, gaze, rigid cutout computer arms, labelled demonstration video and launch invitation. The shared light palette applies to Explore, Musebook, My workspace, How it works and Docs. Create keeps its dark palette. Existing wallet logos, extension selection, account change and disconnect remain.

## Musebook use

1. Open **Musebook**. Recent public posts load once; updates are requested explicitly, not continuously polled.
2. Browse a public channel, search the loaded window, or paste an official profile link.
3. Choose a muse. Review the snapshot, select 1–8 of its available posts, and edit the record's name/description. Source identity, channel, timestamps and exact selected text remain attached.
4. Review the self-contained preview and publication permission. Continue to Create saves a backup and persists the prepared website-slot asset before navigation. Image/GIF and audio remain available.
5. A user-approved launch is still needed to publish bytes. After launch, Explore → Verify inscription reconstructs the actual media and recognises the capsule configuration.

The alternative **Write an agent profile** uses labelled written templates or the user's text. It does not generate AI replies, execute trades, register identities or post to Musebook. Snapshots are attributed archives, not ownership/authorship verification or an official partnership. No AI API or paid model was added. Ordinary hosting resources and chain gas still apply.

## Checks

- `npm run build` and 65 unit tests passed.
- `tests/design-musebook-browser.mjs`: actual source feed/capture, homepage timeline, reduced motion, seven routes at four widths, safe fixture-only staging and reload, real historical token's image/audio/website byte reconstruction.
- `tests/wallet-design-browser.mjs`: isolated fake extension, correct selected provider, account change and disconnect; signing methods are blocked by the fixture.
- Existing `tests/auto-browser.mjs` and `tests/gif-browser.mjs` passed.
- Existing `tests/auto-live-read.mts` and `tests/agent-capsule-live-read.mts` passed using `eth_call`; no signing/broadcast.
- Launch/wallet/trading/GIF/inscription code was compared byte-for-byte to the pre-merge backup (11 critical files unchanged).

## Publication

- Published on 25 September 2026 at https://carve-robinhood.netlify.app.
- Production deployment: `6ab64a853520e62d29311d02` (`ready`). Previous production retained by Netlify: `6ab3b616d529899c6476cae1`.
- Preview deployment `6ab64a399112c924a9ba5557` was ready but anonymous access returned 401 due to existing preview protection. No access protection was changed.
- Public homepage returned HTTP 200; `/assets/index-CTXvj8Qg.js` matched the locally tested bundle byte for byte; the existing Content Security Policy was present.
- Public `/api/musebook?channel=lobby` returned 20 real posts. Browser verification confirmed choose-muse → exact attributed preview, with publication permission still required before staging.
- The public Explore page reconstructed and integrity-checked the existing CVCURVE token's image (7,512 bytes), audio (8,044 bytes), and HTML (728 bytes). No browser error logs were reported during this public check.
- No new mainnet transaction was signed or broadcast. These checks do not replace an independent contract audit or a user-approved end-to-end launch.
