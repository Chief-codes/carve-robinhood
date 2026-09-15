# Canonical PoolManager runtime fixture

This is a **local runtime integration fixture**, not a stateful mainnet fork. Tests place the verified runtime at its actual address with `vm.etch`; storage starts empty and test funds are synthetic. The embedded `NoDelegateCall.original` therefore remains valid. Mainnet owner/controller/storage/pools are not imported.

- Chain: Robinhood 4663.
- Address: `0x8366a39cc670b4001a1121b8f6a443a643e40951`.
- Independently verified block: 63,723,836 / `0x3cc593c`.
- Block hash: `0x34c708bfdc9998068120201f3df007996775cc75072bdcd8acad66b9aa9813ef`.
- Runtime bytes: 24,009.
- Keccak-256 of decoded bytes: `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626`.
- SHA-256 of decoded bytes: `6eb21c69298b064e37fcf8089a941ae096fe08c0f179b2d399567aef1b10585b`.
- Source: Uniswap/v4-core commit `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`, `src/PoolManager.sol`, all 45 transitive imports.
- External dependency: transmissions11/solmate commit `4b47a19038b798b4a33d9749d25e570443520647`, `src/auth/Owned.sol`.
- Compiler: `0.8.26+commit.8a97fa7a.Emscripten.clang`.
- Settings: optimizer enabled, 44,444,444 runs, `viaIR=true`, EVM `cancun`, `metadata.bytecodeHash=none`.
- Only immutable: `NoDelegateCall.original`, runtime offset 13,606, length 32, left-padded canonical PoolManager address. Replacing the compiler placeholder with this known value produced an exact byte-for-byte match to fixed-block `eth_getCode`.

During fixture persistence, the public RPC stopped serving the old block's state metadata. Bytes were fetched again with `latest`, then accepted only after enforcing the already verified fixed-block Keccak-256 above. No state or mainnet transaction was changed.

The `.hex` file contains `0x` followed by runtime hex and a trailing newline. Hashes above cover decoded EVM bytecode, not the text file.

Full dependency verification, optional PositionManager/Permit2 reproductions, source links, and hook accounting: [V4-LIVE-VERIFICATION.md](../../../carve-research/V4-LIVE-VERIFICATION.md).
