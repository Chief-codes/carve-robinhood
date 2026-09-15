// Independent arbitrary-precision migration oracle. Prints a digest used by
// CarveMigrationMath.t.sol; never writes files or accesses a network or wallet.
// Run: node scripts/migration-math-reference.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { keccak256 } = require('js-sha3');
const S = 10n ** 27n, V = 168n * 10n ** 16n, R = 42n * 10n ** 17n;
const D = V + R, Q = 1n << 96n, MIN = (S * V + D - 1n) / D;
const ceil = (a, b) => (a + b - 1n) / b;

// Restoring binary square root, independent of Solidity's Newton iteration.
function root(n) {
  let remainder = n, result = 0n, bit = 1n << 254n;
  while (bit > remainder) bit >>= 2n;
  while (bit !== 0n) {
    if (remainder >= result + bit) {
      remainder -= result + bit;
      result = (result >> 1n) + bit;
    } else result >>= 1n;
    bit >>= 2n;
  }
  return result;
}

// Pinned v4 TickMath's integer tick convention, not floating-point 1.0001**tick.
// All factors are verbatim from core commit 46c6834698c48bc4a463a86d8420f4eb1d7f3b75.
const factors = [
  'fffcb933bd6fad37aa2d162d1a594001', 'fff97272373d413259a46990580e213a',
  'fff2e50f5f656932ef12357cf3c7fdcc', 'ffe5caca7e10e4e61c3624eaa0941cd0',
  'ffcb9843d60f6159c9db58835c926644', 'ff973b41fa98c081472e6896dfb254c0',
  'ff2ea16466c96a3843ec78b326b52861', 'fe5dee046a99a2a811c461f1969c3053',
  'fcbe86c7900a88aedcffc83b479aa3a4', 'f987a7253ac413176f2b074cf7815e54',
  'f3392b0822b70005940c7a398e4b70f3', 'e7159475a2c29b7443b29c7fa6e889d9',
  'd097f3bdfd2022b8845ad8f792aa5825', 'a9f746462d870fdf8a65dc1f90e061e5',
  '70d869a156d2a1b890bb3df62baf32f7', '31be135f97d08fd981231505542fcfa6',
  '9aa508b5b7a84e1c677de54f3e99bc9', '5d6af8dedb81196699c329225ee604',
  '2216e584f5fa1ea926041bedfe98', '48a170391f7dc42444e8fa2'
].map(x => BigInt(`0x${x}`));
function tickRatio(tick) {
  let p = 1n << 128n, bits = tick < 0n ? -tick : tick;
  for (let i = 0; i < factors.length; i++) if ((bits & (1n << BigInt(i))) !== 0n) p = (p * factors[i]) >> 128n;
  if (tick > 0n) p = ((1n << 256n) - 1n) / p;
  return ceil(p, 1n << 32n);
}
const lower = tickRatio(-887200n), upper = tickRatio(887200n);
function plan(inventory) {
  const sqrt = root((inventory << 192n) / D);
  const tokenMax = R * inventory / D;
  // Solve the exact rational mint-cost inequalities directly. No emulation
  // of Solidity FullMath or the periphery's two-stage division is used here.
  const L0 = R * sqrt * upper / (Q * (upper - sqrt));
  const L1 = tokenMax * Q / (sqrt - lower);
  const L = L0 < L1 ? L0 : L1;
  const eth = ceil(L * Q * (upper - sqrt), upper * sqrt);
  const token = ceil(L * (sqrt - lower), Q);
  return [sqrt, -887200n, 887200n, L, R, tokenMax, eth, token, R - eth, inventory - token];
}
const word = x => BigInt.asUintN(256, x).toString(16).padStart(64, '0');
let digest = '0'.repeat(64);
for (let i = 0n; i < 256n; i++) {
  const inventory = MIN + (S - MIN) * i / 255n;
  const bytes = digest + [inventory, ...plan(inventory)].map(word).join('');
  digest = keccak256(Buffer.from(bytes, 'hex'));
}
console.log(JSON.stringify({digest: `0x${digest}`, lower, upper, minimumInventory: MIN,
  minimumPlan: plan(MIN), maximumPlan: plan(S)}, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
