# Buddy reference restoration — 25 September 2026

## Scope

Restores the original friend-design animation supplied on 24 September and confirmed by the owner's screen recording and pointer-gaze instructions. The seated character uses the original 5×5 eye atlas, registration, clipping, 85 ms pointer easing and independent 230 ms sine blink every 5.4 seconds. Left/right/up/down/neutral map to 10/14/2/22/12. The body, wand, head silhouette and scroll poses are unchanged. The experimental seated texture warping and reconstructed skin eyelids from the earlier same-day release are no longer used.

The original leaning texture motion and blink rendering are restored too. High-resolution lossless art, deferred later scenes, native first-paint fallback, background/offscreen pause, reduced-motion support and single-frame on-demand inspection remain. Original source artwork is preserved, including the eye atlas with SHA-256 `75f10154f0b21d5ccbcc3b5be2c71407c670e8b060b6b634916919f8af9fa1bd`.

The Create preview's abstract ripple is replaced with an actual looping GIF converted from the existing Carve greeting artwork. The 256px, 26-frame GIF is 585,411 bytes, preserving the original wave, blink and pauses at about 10 fps. Reduced-motion visitors receive a still image. It is explicitly labelled a sample and is never inserted into a token's draft or inscription.

## Checks

- All 73 unit tests and the TypeScript/Vite production build passed.
- Local comparison against the original friend's compositor: 125 combinations (25 gaze directions × five blink states); zero differing pixels, zero changes outside the eye regions. This checks the renderer against the supplied code, not a claim that differently sized browser recordings have identical pixels.
- The local-only browser harness passed all pointer directions, leave/blur, touch, reduced motion, reverse scroll and independent blinking checks. It and the frozen reference fixture are excluded from the production bundle.
- Launch contracts, fee settings, trading logic, storage, wallet connections and live Musebook polling are not changed by this restoration.

## Publishing

Production release `6ab663f669daad86fdc8f3b1` is published at https://carve-robinhood.netlify.app. The private team-protected preview was not made public. Public repository synchronization is recorded in STATUS.md. No wallet signature or financial transaction was requested or sent for these visual changes.
