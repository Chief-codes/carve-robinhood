# Buddy quality / face fix + live Musebook — 25 September 2026

## Changes

The seated face previously pasted an unrelated 5×5 eye atlas into white-eye ellipses. It could show white patches and double/misaligned edges. The previous blink used solid green rectangles inside those ellipses. Both techniques were replaced: pointer tracking gently deforms the native eye texture; eyelids use a cached convex contour of the actual eye and the original surrounding skin colours. At blink completion the original base pixels are restored. A local-only test sheet covers open, half-closed, closed and gaze states for all three idle poses. It is not part of the production build.

Original PNG files remain untouched. Lossless derivatives: buddy 214,090 bytes, jump 1,356,602, walk 1,249,962, sit 1,270,190, leaning 964,544, computer 935,144, computer plate 911,120. Visible RGBA pixels and dimensions were independently compared with originals; all match. Later scenes stay lazy-loaded; the obsolete gaze atlas is no longer requested. This intentionally prioritises normal image fidelity over the earlier lossy sizes while retaining the loading architecture. Network speed can still affect later scene loading.

The Musebook tab now displays actual public messages and replies from musebook.me automatically. Visible-tab polling checks every 15 seconds after completion. Successes use a 10-second shared CDN cache and browser revalidation. No authentication, private channels or paid AI is used. No outgoing messages, identity registrations or agent actions are enabled. Public source and hosting availability still apply; this is polling, not a zero-latency websocket.

Only one feed request runs at a time. Hidden/offline/unmounted views cancel requests; failures keep the last good messages and back off from 30 to 120 seconds. Channel changes cancel old responses. IDs are deduplicated; replies link to their original conversation. Capture/review uses separate state, so a live refresh cannot alter the bytes a user selected to inscribe. Preset buttons removed without deleting existing saved forms or drafts.

## Validation

- TypeScript + Vite production build.
- 73 tests, including native blink restoration, iris-gap coverage, lossless asset safeguards, poll cancellation/dedup/backoff and the existing launch/inscription/GIF/capsule tests.
- Local visual sheets: standing, seated and leaning, neutral/half/closed/gaze. Actual seated home-page eyes checked with `data-gaze=native`; fixed horizontal scrollbar overflow (0px).
- Actual public source returned messages/replies; local Carve lobby and townsquare each loaded 20 real posts and updated read timestamps without manual reload.
- No wallet approvals, transaction broadcasts, launch parameter or contract changes.

## Publication

Published production deployment `6ab65d063ec90b6d57350ebf` to https://carve-robinhood.netlify.app. The public Musebook tab loaded 20 real posts with reply links, an automatic-update timestamp and no preset buttons; browser error log was empty. Anonymous HTTP checks verified the homepage, entry bundle and lossless buddy asset against the local tested build, and the feed returned the expected source and browser-revalidation cache policy.
