# Evidence and architecture

> Historical foundation notes below. For the deployed September 16 curve-to-V4 release, actual token proof and current publication status, read STATUS.md first. Statements below about an undeployed preview/prototype are superseded; retain them only as historical context. The user declined public contract-source submission.

Network: Robinhood Chain, chain ID 4663, public RPC https://rpc.mainnet.chain.robinhood.com and explorer https://robinhoodchain.blockscout.com.

Primary references:

- https://docs.robinhood.com/chain/connecting/
- https://github.com/Uniswap/contracts/blob/main/deployments/4663.md
- https://www.scribe.ong/

Detailed research is maintained outside this Site checkout in `../../work/carve-research/`. Prototype sources and 32-test results are in `../../work/carve-contracts/`.

The prototype stores actual bytes in STOP-prefixed immutable bytecode chunks of at most 20 KiB. A content manifest binds MIME type, encoding, byte length, ordered pointer addresses and chunk hashes. A token binds content roots. Files are not onchain merely because they have a hash or URL.

Robinhood read-only gas configuration returned a 32,000,000 per-transaction gas limit during research. Limits can change; estimate against the current chain for each operation. Do not confuse this with a verified serialized transaction byte limit. File uploads are multiple transactions; the later token creation and initial buy can be atomic.

The existence of Uniswap v4 deployments does not make graduation implemented. Native ETH settlement, approved pools, launch-specific price continuity, liquidity locking, fee accounting and adverse-case tests remain mandatory.

The preview itself has no deployed Carve addresses and performs no chain writes.
