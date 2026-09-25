# Agent capsules — 23 September 2026

## Product scope

An optional Carve feature at `#/agents`, separate from the research bot and all other projects. It shows live public Musebook posts/replies and allows attributed snapshots or a creator-written public blueprint. It does not create a running AI, generate chat, post on Musebook, register identities, initiate autonomous transactions, or claim agent ownership. As of 25 September the preset template buttons were removed; saved user drafts remain intact.

Musebook connection is independent, not a partnership. Public documentation: https://musebook.me/about and https://musebook.me/muse.txt. Public profiles/posts are source claims, not verified identities or proof of author endorsement. The feed does not supply original post signatures for independent verification.

## Storage and launch compatibility

The capsule is self-contained `text/html` with a versioned `carve.agent-capsule/1` JSON block. It occupies the existing **website slot / websiteRoot**, not a fourth root or a new contract. Existing image/GIF and audio slots remain usable. Existing supply, fees, buyback selection, trading and wallet approval behavior are unchanged.

If a draft has an ordinary HTML website, explicit consent is required to retain that website's original bytes as a base64 attachment inside the capsule. The capsule becomes the primary website preview; the old website can be downloaded, not run, from the capsule inspector after inscription verification. Re-editing a capsule retains the original attachment without nesting old capsules. Full pre-change drafts are saved under `agent-capsule-backup:<timestamp>` and `agent-capsule-last-backup`; the latest is downloadable from the capsule page and importable through My workspace.

Prepared HTML must fit the existing 1 MB per-file limit. Added attachment/escaping overhead counts toward that limit. The existing combined 24 KiB inline limit still determines single-approval versus chunked uploads. Preparing, downloading and staging are local only; a confirmed user-approved launch is required to inscribe bytes. No secret or private data belongs in an inscription.

## Read-only source adapter

`GET /api/musebook` supports only six explicitly allowed public channels and an optional bounded muse ID. Fixed HTTPS host, GET only, redirects rejected, 8-second per-fetch deadline, 512 KiB response limit. No arbitrary URLs, private rooms, credentials, avatar downloads or writes. Up to 50 source-window posts returned; up to eight by one muse/channel in a capsule. Text beyond 2,000 characters is explicitly an excerpt. An unavailable feed returns an error, never sample activity.

Successful responses revalidate in the browser and share a 10-second Netlify durable cache, varied by channel and muse ID. The visible feed refreshes every 15 seconds after completion; no overlapping requests, background-tab/offline work, paid AI calls or preset conversations. Failure retries back off to 120 seconds and retain the last good posts with a visible warning. Channel switching, review, capture and unmount cancel obsolete feed requests. The live feed and frozen inscription snapshot have separate state. Public read-only access still consumes ordinary hosting resources; source/network delay can exceed the polling interval.

## Verification and security

The existing onchain verifier reconstructs and checks website bytes before recognising capsule JSON and offering configuration/attachment downloads. This proves byte integrity only, not runtime capability, truth, copyright permission, source signatures or ownership. Text is rendered as text; generated HTML escapes injection sequences and embeds JSON safely. The existing opaque iframe and restrictive CSP remain unchanged. Original attachments are not executed by the capsule preview.

## Validation so far

- Production frontend build passed.
- 63 unit tests passed, including 12 capsule/adapter tests: deterministic bytes, hostile text, exact original-site retention, draft export/import integrity, preservation of other assets/settings, malformed/oversized source rejection, bounded same-muse snapshots, URL allowlisting and unavailable-source behavior.
- Actual public Musebook read through the new handler returned HTTP 200 and 20 posts on 23 September.
- Chrome local test: live feed displayed; written template prepared; explicit consent enabled staging; capsule appeared in the existing Create website preview without opening a wallet or signing.
- `tests/agent-capsule-live-read.mts`: read-only `eth_call` of actual deployed v5 `launchInline` accepted a 1,596-byte capsule. Sender balance was simulated. Nothing was signed, broadcast, mined or funded. This is compatibility evidence, not a live inscription proof or security audit.
- Netlify preview deployment: `6ab3b4803c9a7f9b6426485c`; the existing team protection remains enabled. Authenticated Chrome can view it; anonymous preview requests returned 401.
- Hosted Chrome preview: real feed loaded; “Archive this muse” captured two actual recent posts with source attribution and timestamp into a 3.7 KB prepared capsule. No launch or consent to republish those posts was submitted.
- Published production deployment: `6ab3b616d529899c6476cae1`, https://carve-robinhood.netlify.app/#/agents. Existing hosting access controls were not changed.
- Anonymous production checks returned HTTP 200 for the homepage, current capsule bundle and `/api/musebook?channel=lobby` (20 real posts). Entry bundle matched the checked build. Chrome confirmed the published Agent capsules page and navigation.

No public capsule token has been launched by the agent. A user-signed live capsule launch is still needed before claiming end-to-end mainnet inscription verification for this new content format.
