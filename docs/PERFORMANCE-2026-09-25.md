# First-visit performance and unified Create theme

The user confirmed the missing buddy eventually appeared after downloading. This release removes the all-at-once animation download/processing gate without changing financial functionality.

## Changes

- Native high-priority buddy image plus preloading; the small image remains usable if later animation sheets fail. Compressed WebP derivatives retain the supplied artwork and transparency; original PNGs remain untouched.
- First buddy: 334,411 → 52,942 bytes. Three pose sheets: 5,085,012 → 1,127,998 bytes. Computer image and plate: 2,708,321 → 215,192 bytes. Invitation: 1,394,685 → 64,322 bytes.
- Load pose sheets progressively on scrolling. Inspect only the displayed pose instead of all 48 frames before first paint. Defer eye atlas until the seated scene.
- No tutorial video request before approaching its scene. Load later character scenes only as needed. Animation clocks sleep offscreen/in background tabs and between blinks; gaze remains smoothed.
- Prevent an overflow-hidden stage from independently scrolling when a button receives focus. The stage clips without becoming a nested scrolling container.
- Create and My workspace code are route-split. All routes, including Create, use mint/cream surfaces, the same typography, and accessible contrasting controls. Corrected preview caption and storage-plan text contrast.
- Hashed `/assets/*` files use immutable browser caching. HTML still revalidates; no financial/API data was given long-lived caching. Original website CSP retained.
- A failed route download gets a recoverable error screen instead of a blank app. Reload is user-initiated, never automatic during a wallet approval.

## Validation

- Build and 68 unit tests pass, including asset budgets and animation idle/visibility/cleanup checks.
- Cold local browser fixture requested about 420 KB compressed for the first view (including deliberately uncached duplicate small image requests). No large pose atlas or tutorial video was requested initially. This is a transferred-byte measurement, not a universal loading-time promise.
- With animation downloads deliberately blocked, the initial buddy remained rendered after scrolling; ordinary home navigation remained available.
- Actual optimized pose and computer scenes rendered; tutorial was deferred until reached. Fixed nested stage scroll measured zero after the scroll buttons.
- Desktop and 390px Create inspections, buyback switch, wallet selection dialog, common theme and readable surfaces checked without wallet signing.
- Thirteen critical wallet/launch/trading/inscription/GIF/storage/Musebook implementation files match the pre-change backup byte for byte. No deployed contracts, fees, saved-data formats or chain actions changed.
- Artwork preparation script: `scripts/prepare-buddy-assets.mjs` (Sharp is an optional build-time tool only; generated assets are stored with the project source).

## Publication

- Published: https://carve-robinhood.netlify.app, production deployment `6ab651236cce80403d5744c3`.
- Homepage HTTP 200; `/assets/index-DlXluXrq.js` matched the tested bundle byte for byte. The 52,942-byte buddy file returned HTTP 200 with `public,max-age=31536000,immutable`.
- Public browser confirmed buddy ready on the initial view, tutorial video still deferred, and Create using the light theme. Public Musebook endpoint returned 20 real posts. Existing CSP remained present.
- Previous production available for rollback: `6ab64a853520e62d29311d02`. No mainnet transaction or wallet signature was made.
