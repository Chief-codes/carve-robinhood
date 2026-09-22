# Trade-triggered buyback release — 22 September 2026

Robinhood Chain, ID 4663. Factory version 5 adds an immutable optional buyback choice to newly launched tokens. Previous releases remain unchanged and supported.

## Deployed addresses
- Factory: 0xAFbF0a6a548BAD4320FC0fBe777055572B2F340a
- Engine: 0x832Fb03279d7b10B0f2F711Fc4251eBeC3ce2044
- Router: 0x097C5497a07fB9D50d818f5356eD847FD5dE23Bf
- Coordinator: 0x96780f7AD70C2C3E7C9DF007F7b63553F5603C9d
- Retained content registry: 0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F
- Deployment: 0x58b02a79e39e5453ecc2a26547e5f456ae381f37fecf0c44cc7c177e02cdb1fe
- Block: 69716039. Nonce: 23. Receipt execution gas cost: 0.00049665287959 ETH.

## Public source verification
The owner explicitly approved public source publication on 22 September.
Sourcify reports exact creation and runtime matches for all four new contracts:
- Router match 51501785
- Factory match 51501789
- Engine match 51501790
- Coordinator match 51501798

Blockscout's automated source-submission endpoint returns HTTP 403 / Cloudflare challenge. No Blockscout verification is claimed. Source and compiler settings are independently public on GitHub and Sourcify.

## Economics
Supply 1 billion; creation fee 0.0005 ETH plus gas; virtual reserve 1.68 ETH; migration cap 4.2 ETH; platform fee 1%; optional creator fee 0–10%; no anti-sniping fee.

Opt-in splits the creator fee 20% revenue / 80% token-specific buyback budget. Platform revenue is not diverted. No authority over personal-wallet balances is granted. Curve trades and migrated pool hooks trigger bounded processing; no trades means no processing. Minimum ETH budget 0.00001; max purchase 0.002 ETH and 0.1% of virtual native reserves. Price bounds and gas floors apply. Internal processing failures retain budgets for later trades. Eligible trades pay extra gas.

Bought tokens, and the burn share of token-denominated pool fees, go to the dead address. Nominal totalSupply remains unchanged. Buyback balances are isolated per token and not withdrawable as creator revenue.

## Checks
- Exact deployed runtimes and 33 parameter/binding checks passed.
- 21 tests against the actual deployed release on a local mainnet fork at block 69729281 passed, none skipped: fee split, withdrawal isolation, buyback gas, failures, all media combinations, migration and real V4 swaps.
- 51 website tests passed.
- Website read-only mainnet deployment check passed. Both opt-in and opt-out launch simulations passed with an explicitly simulated sender balance.
- Isolated-browser switch, GIF preview, launch review, previous-release feed and trading route, and documentation checks passed.
- No live buyback-enabled token was launched by the agent. A user-signed live launch remains distinct from these simulations. This is internal testing, not an independent security audit.

## Website behavior
The optional switch is OFF by default and saved with the draft. Review repeats the permanent fee choice. Receipt checks verify the mined choice. Explore can select current or previous launches; older tokens retain their original market and router. Buyback figures combine curve and pool counters at one block, with unavailable reads reported as unavailable.

GIFs use the image slot and may be combined with sound and HTML. Compression and integrity checks remain local. A labelled animated preview demo is not included in anyone's launch unless they upload their own file.
