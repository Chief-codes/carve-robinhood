# Custom domain and supplied Buddy animation

## Scope

- Primary public domain: https://carvelaunch.com/.
- www.carvelaunch.com redirects to the primary domain. Existing Netlify site is retained; no replacement project or contract deployment.
- Official X link: https://x.com/CarveOnRh, shown beside the GitHub link in the shared footer, with canonical/social page metadata.
- Public Docs rewritten as ten beginner-friendly expandable guides covering all current tabs and utilities. Explorer instructions, source/build references and buyback limits remain in optional technical sections. Corrected the stale private-source statement in How it works.
- Removed the footer RH / block counter and its otherwise unused minute-by-minute RPC polling. Wallet network checks, launch verification and trading reads remain unchanged.
- Create's example now uses the user-supplied jump/blink GIF. With the user's explicit permission, background cleanup is deterministic and frame-by-frame, not an AI redraw. All 113 frames, the original 3.76-second timing and infinite loop are retained. Ivory boots and enclosed eye highlights are protected. Reduced-motion visitors get a transparent still.
- The sample is not added to draft assets and incurs no inscription costs. The 1 MB *user-upload* preparation limit is unchanged. The website example is a separately optimized display asset, not a prepared launch upload.

## Reproducibility

Original source: `artwork/Carve-Jump-Blink.gif` (not served by the production site).
Run `scripts/prepare-buddy-hello.mjs` with Sharp available, or set `SHARP_MODULE` to an existing Sharp package. This writes the two preview assets under `src/assets/buddy/` and verifies frames, exact delays, looping, transparency and retained foreground in every frame.

## Domain / local data

The existing Netlify-managed zone uses dns1–dns4.p09.nsone.net. Apex and www NETLIFY records point to carve-robinhood.netlify.app. The managed wildcard/apex certificate is issued and HTTPS was validated with hostname checking enabled.

DNS caches can retain the earlier empty answer until their negative TTL expires. Public Google/Cloudflare resolvers already return the new records. Do not weaken TLS or change users' network settings to bypass this.

Browser-local drafts, uploads-in-progress and wallet site permissions are origin-specific. The old Netlify address is deliberately still available: users can export existing drafts there and import them on the new domain. Nothing in local storage or the chain was erased or migrated automatically.

## Preservation

No contract, address, fee, wallet authorization, buyback, inscription, trading, Musebook-feed or saved-data implementation changed. No financial transaction signed or broadcast. This visual/domain update is not a new mainnet end-to-end launch test or security audit.

## Release checks

- Production deployment: `6ab67b909f74e1a1c0f1c49b`.
- Source checkout and publish checkout: 75 tests passed and production build passed.
- GIF: 1,184,795 bytes, 113 frames, exact original 3,760 ms cycle, transparent corners and retained foreground checked in every decoded frame; selected jump/neutral/landing frames visually reviewed. Reduced-motion still: 30,660 bytes.
- Browser: transparent preview with unobscured controls/caption; documentation accordions and readable links; footer X/GitHub links; empty error log. Draft still contains zero prepared bytes when only the sample is shown.
- Live custom-domain HTML, entry bundle, Docs bundle and GIF matched local bytes. HTTPS validated without disabling certificate checks; www returns 301 to the apex. Public live feed returns 20 posts.
- The local resolver retained a negative DNS cache at handoff while Google/Cloudflare resolvers answered correctly. Domain requests verified against the authoritative address with full hostname/TLS checks. No local DNS override, browser warning bypass or global network change was made.
