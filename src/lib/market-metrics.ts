import { parseAbi, encodeAbiParameters, keccak256, toHex, getAddress, zeroAddress, type Address, type Hex } from 'viem';

export const CHAIN_ID = 4663;
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as Address;
export const POOL_MANAGER_CODE_HASH = '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626' as Hex;
export const SUPPLY = 10n ** 27n;
export const VIRTUAL_ETH = 1680000000000000000n;
export const CAP_ETH = 4200000000000000000n;
export const Q192 = 1n << 192n;
const UINT160 = (1n << 160n) - 1n;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const reason = (error: unknown) => String((error as {shortMessage?: string;message?:string})?.shortMessage
  || (error as Error)?.message || error).split('\n')[0].replace(/https?:\/\/\S+/g, '[RPC URL]');

export type Available<T> = { status: 'available'; value: T } | { status: 'unavailable'; reason: string };
export type Valuation = { basis: 'curve-marginal' | 'v4-slot0'; fdvWei: bigint; spotWeiPerToken: bigint;
  fdvNumerator: bigint; fdvDenominator: bigint; label: 'Market cap / FDV (ETH)' };
export type VerifiedDeployment = { status: 'verified'; chainId: 4663; factory: Address; engine: Address;
  registry: Address; deployedBlock: bigint };
// Structural read-only adapter; a viem PublicClient supplies these methods. No wallet method is accepted.
export type ReadClient = {
  getChainId(): Promise<number>;
  getBlock(args: {blockNumber: bigint;blockTag?: never} | {blockTag:'latest';blockNumber?: never}): Promise<{number: bigint | null;hash: Hex | null}>;
  getCode(args: {address: Address;blockNumber: bigint}): Promise<Hex | undefined>;
  readContract(args: any): Promise<any>;
  getLogs(args: any): Promise<any[]>;
};
export type MetricsContext = { read: ReadClient; deployment: VerifiedDeployment; blockNumber: bigint; blockHash: Hex };
export type MarketSnapshot = { market: Address; token: Address; phase: number; blockNumber: bigint; blockHash: Hex;
  reserveETH: bigint; capETH: bigint; fdv: Available<Valuation>; progressBps: Available<bigint>; poolId?: Hex };

const READ_ABI = parseAbi([
  'function factory() view returns (address)', 'function poolManager() view returns (address)',
  'function registry() view returns (address)', 'function migrationAdapter() view returns (address)',
  'function isMarket(address) view returns (bool)', 'function marketForToken(address) view returns (address)',
  'function token() view returns (address)', 'function contentRegistry() view returns (address)',
  'function totalSupply() view returns (uint256)', 'function phase() view returns (uint8)',
  'function reserveETH() view returns (uint256)', 'function inventory() view returns (uint256)',
  'function curveVolumeETH() view returns (uint256)', 'function poolVolumeETH(address token) view returns (uint256)',
  'function virtualETH() view returns (uint256)', 'function capETH() view returns (uint256)',
  'function keyForToken(address) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))',
  'function getReceipt(address) view returns ((bytes32 poolId,uint128 liquidity,uint256 ethSpent,uint256 tokensSpent,uint256 lockedETH,uint256 lockedTokens))',
  'function marketForPool(bytes32) view returns (address)', 'function verifyPosition(address) view returns (bool)',
  'function extsload(bytes32) view returns (bytes32)',
]);
export const CURVE_EVENTS = parseAbi([
  'event Bought(address indexed buyer,uint256 acceptedGross,uint256 tokensOut,uint256 platformFee,uint256 creatorFee,uint256 refund)',
  'event Sold(address indexed seller,uint256 tokensIn,uint256 ethOut,uint256 platformFee,uint256 creatorFee)',
]);
export const SWAP_EVENT = parseAbi([
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
])[0];

function valuation(numerator: bigint, denominator: bigint, supply: bigint, basis: Valuation['basis']): Valuation {
  assert(numerator > 0n && denominator > 0n && supply > 0n, 'Price/supply must be positive');
  return { basis, fdvWei: numerator * supply / denominator, spotWeiPerToken: numerator * 10n ** 18n / denominator,
    fdvNumerator: numerator * supply, fdvDenominator: denominator, label: 'Market cap / FDV (ETH)' };
}

/** Exact marginal pre-fee price; not the average execution price or circulating market cap. */
export function curveValuation(virtualETH: bigint, reserveETH: bigint, inventory: bigint, supply = SUPPLY) {
  assert(virtualETH > 0n && reserveETH >= 0n && inventory > 0n && inventory <= supply, 'Invalid curve reserves/inventory');
  return valuation(virtualETH + reserveETH, inventory, supply, 'curve-marginal');
}

/** sqrtPriceX96² / 2^192 is raw currency1/currency0. Native currency0 requires inversion. */
export function v4Valuation(sqrtPriceX96: bigint, nativeIsCurrency0: boolean, supply = SUPPLY) {
  assert(sqrtPriceX96 > 0n && sqrtPriceX96 <= UINT160, 'Uninitialized/invalid v4 sqrt price');
  const square = sqrtPriceX96 * sqrtPriceX96;
  return valuation(nativeIsCurrency0 ? Q192 : square, nativeIsCurrency0 ? square : Q192, supply, 'v4-slot0');
}

export function curveProgressBps(phase: number, reserveETH: bigint, capETH: bigint) {
  assert(capETH > 0n && reserveETH >= 0n && reserveETH <= capETH, 'Invalid curve progress inputs');
  if (phase === 2) return 10000n; // Graduation clears curve reserves; it does not reset completion.
  assert(phase === 0, 'Market is transitioning; progress unavailable');
  return reserveETH * 10000n / capETH;
}
/** Integer-only display, rounded DOWN. Useful for tiny nonzero progress below one basis point. */
export function formatFraction(numerator: bigint, denominator: bigint, decimals = 6): string {
  assert(numerator >= 0n && denominator > 0n && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'Invalid fraction display');
  const scale = 10n ** BigInt(decimals), value = numerator * scale / denominator;
  if (!decimals) return value.toString();
  return `${value / scale}.${(value % scale).toString().padStart(decimals,'0')}`;
}
export function formatProgressPercent(snapshot: MarketSnapshot, decimals = 6): string | null {
  if (snapshot.progressBps.status !== 'available') return null;
  return formatFraction(snapshot.phase === 2 ? snapshot.capETH * 100n : snapshot.reserveETH * 100n,snapshot.capETH,decimals);
}

export function poolIdForKey(key: {currency0: Address;currency1: Address;fee: number;tickSpacing: number;hooks: Address}): Hex {
  return keccak256(encodeAbiParameters(
    [{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],
    [key.currency0,key.currency1,key.fee,key.tickSpacing,key.hooks]));
}

/** Pinned Uniswap StateLibrary: _pools mapping slot 6, hash(poolId || bytes32(6)). */
export function poolStateSlot(poolId: Hex): Hex {
  assert(/^0x[0-9a-fA-F]{64}$/.test(poolId), 'Pool ID must be bytes32');
  return keccak256(`${poolId}${toHex(6n,{size:32}).slice(2)}` as Hex);
}
export function decodeSlot0(word: Hex) {
  assert(/^0x[0-9a-fA-F]{64}$/.test(word), 'Slot0 must be bytes32');
  const data = BigInt(word), tickBits = Number((data >> 160n) & 0xffffffn);
  return { sqrtPriceX96: data & UINT160, tick: tickBits >= 0x800000 ? tickBits - 0x1000000 : tickBits,
    protocolFee: Number((data >> 184n) & 0xffffffn), lpFee: Number((data >> 208n) & 0xffffffn) };
}

const contract = (ctx: MetricsContext, address: Address, functionName: string, args?: readonly unknown[]) =>
  ctx.read.readContract({ address, abi: READ_ABI, functionName, args, blockNumber: ctx.blockNumber });

/** Prepare once per refresh and reuse for all cards. The deployment config must come from verified receipts. */
export async function prepareMetricsContext(read: ReadClient, deployment: VerifiedDeployment): Promise<MetricsContext> {
  assert(deployment.status === 'verified' && deployment.chainId === CHAIN_ID && deployment.deployedBlock >= 0n,
    'A verified Carve deployment and its real deployment block are required');
  assert(await read.getChainId() === CHAIN_ID, 'RPC chain mismatch');
  const block = await read.getBlock({blockTag:'latest'});
  assert(typeof block.number === 'bigint' && block.hash && block.number >= deployment.deployedBlock, 'Invalid snapshot/deployment block');
  const ctx = { read, deployment, blockNumber: block.number, blockHash: block.hash };
  const [poolManager, factory, registry, engine, code] = await Promise.all([
    contract(ctx,deployment.engine,'poolManager'), contract(ctx,deployment.engine,'factory'),
    contract(ctx,deployment.factory,'registry'), contract(ctx,deployment.factory,'migrationAdapter'),
    read.getCode({address:POOL_MANAGER,blockNumber:block.number}),
  ]);
  assert(same(poolManager,POOL_MANAGER) && same(factory,deployment.factory) && same(registry,deployment.registry)
    && same(engine,deployment.engine), 'Deployment bindings mismatch');
  assert(code && keccak256(code) === POOL_MANAGER_CODE_HASH, 'Canonical PoolManager code hash mismatch');
  return ctx;
}
export async function assertSnapshotCanonical(ctx: MetricsContext) {
  assert((await ctx.read.getBlock({blockNumber:ctx.blockNumber})).hash === ctx.blockHash,
    'Snapshot changed/reorged; discard these metrics and refresh');
}

export async function readMarketSnapshot(ctx: MetricsContext, market: Address): Promise<MarketSnapshot> {
  const d = ctx.deployment;
  const [token,phase,reserve,inventory,virtual,cap,registered,marketFactory] = await Promise.all([
    contract(ctx,market,'token'),contract(ctx,market,'phase'),contract(ctx,market,'reserveETH'),
    contract(ctx,market,'inventory'),contract(ctx,market,'virtualETH'),contract(ctx,market,'capETH'),
    contract(ctx,d.factory,'isMarket',[market]),contract(ctx,market,'factory'),
  ]);
  const [mapped,supply,registry] = await Promise.all([
    contract(ctx,d.factory,'marketForToken',[token]),contract(ctx,token,'totalSupply'),contract(ctx,token,'contentRegistry'),
  ]);
  assert(registered === true && same(mapped,market) && same(marketFactory,d.factory) && same(registry,d.registry), 'Unauthenticated Carve market/token');
  assert(supply === SUPPLY && virtual === VIRTUAL_ETH && cap === CAP_ETH, 'Unexpected token supply/curve economics');
  const snapshot: MarketSnapshot = { market,token,phase:Number(phase),reserveETH:reserve,capETH:cap,blockNumber:ctx.blockNumber,blockHash:ctx.blockHash,
    fdv:{status:'unavailable',reason:'Market is transitioning'},progressBps:{status:'unavailable',reason:'Market is transitioning'} };
  try { snapshot.progressBps = {status:'available',value:curveProgressBps(Number(phase),reserve,cap)}; }
  catch (error) { snapshot.progressBps = {status:'unavailable',reason:reason(error)}; }
  try {
    if (Number(phase) === 0) snapshot.fdv = {status:'available',value:curveValuation(virtual,reserve,inventory,supply)};
    else if (Number(phase) === 2) {
      const [key,receipt] = await Promise.all([contract(ctx,d.engine,'keyForToken',[token]),contract(ctx,d.engine,'getReceipt',[market])]);
      assert(same(key.currency0,zeroAddress) && same(key.currency1,token) && key.fee === 0
        && key.tickSpacing === 200 && same(key.hooks,d.engine), 'Unexpected Carve pool currency ordering/key');
      const poolId = poolIdForKey(key);
      const [poolMarket,positionValid] = await Promise.all([
        contract(ctx,d.engine,'marketForPool',[poolId]),contract(ctx,d.engine,'verifyPosition',[market]),
      ]);
      assert(receipt.poolId === poolId && receipt.liquidity > 0n && same(poolMarket,market) && positionValid === true,
        'Graduated pool/position authentication failed');
      snapshot.poolId = poolId;
      const slot0 = decodeSlot0(await contract(ctx,POOL_MANAGER,'extsload',[poolStateSlot(poolId)]));
      snapshot.fdv = {status:'available',value:v4Valuation(slot0.sqrtPriceX96,true,supply)};
    }
  } catch (error) { snapshot.fdv = {status:'unavailable',reason:reason(error)}; }
  await assertSnapshotCanonical(ctx);
  return snapshot;
}

const uint = (value: unknown) => { assert(typeof value === 'bigint' && value >= 0n, 'Malformed unsigned trade amount'); return value; };
/** Consistent AMM native leg: net ETH entering the curve, gross ETH leaving it; no creation fees/refunds. */
export function curveTradeVolume(eventName: string, args: Record<string,unknown>): bigint {
  const platformFee = uint(args.platformFee), creatorFee = uint(args.creatorFee);
  if (eventName === 'Bought') {
    const gross = uint(args.acceptedGross); assert(gross >= platformFee + creatorFee, 'Trade fees exceed accepted gross');
    return gross - platformFee - creatorFee;
  }
  assert(eventName === 'Sold', 'Unexpected curve event');
  return uint(args.ethOut) + platformFee + creatorFee;
}
export function v4TradeVolume(args: Record<string,unknown>, nativeIsCurrency0 = true): bigint {
  const amount = args[nativeIsCurrency0 ? 'amount0' : 'amount1'];
  assert(typeof amount === 'bigint' && amount >= -(1n << 127n) && amount < (1n << 127n), 'Malformed signed swap amount');
  return amount < 0n ? -amount : amount;
}

export type VolumeOptions = { maxBlockSpan: bigint; maxLogRequests: number; maxLogsPerResponse?: number; signal?: AbortSignal };
export type LifetimeVolume = { status: 'complete'|'partial'|'unavailable'; label: 'Lifetime pool volume (ETH)';
  wei: bigint | null; partialWei: bigint | null; trades: number; fromBlock: bigint; toBlock: bigint;
  scannedFromBlock: bigint | null; logRequests: number; reason?: string };

export type CounterVolume = { status: 'complete'|'unavailable'; label: 'Lifetime pool volume (ETH)';
  source: 'contract-counters'; wei: bigint | null; curveWei: bigint | null; poolWei: bigint | null;
  blockNumber: bigint; blockHash: Hex; reason?: string };

/** Preferred for the counter-enabled release: O(1) lifetime reads, with no history-window guess. */
export async function readLifetimeCounterVolume(ctx: MetricsContext, snapshot: MarketSnapshot): Promise<CounterVolume> {
  const base = {label:'Lifetime pool volume (ETH)' as const,source:'contract-counters' as const,
    blockNumber:ctx.blockNumber,blockHash:ctx.blockHash};
  try {
    assert(snapshot.blockNumber === ctx.blockNumber && snapshot.blockHash === ctx.blockHash, 'Snapshot mismatch');
    assert(snapshot.phase === 0 || snapshot.phase === 2, 'Market is transitioning');
    assert(snapshot.phase !== 2 || snapshot.poolId, 'Graduated pool has not been authenticated');
    const values = await Promise.all([
      contract(ctx,snapshot.market,'curveVolumeETH'),
      // Engine counters are keyed by currency1 (the token), never the market.
      contract(ctx,ctx.deployment.engine,'poolVolumeETH',[snapshot.token]),
    ]);
    const curveWei = uint(values[0]), poolWei = uint(values[1]);
    assert(snapshot.phase !== 0 || poolWei === 0n, 'Curve-phase market has unexpected v4 volume');
    await assertSnapshotCanonical(ctx);
    return {...base,status:'complete',wei:curveWei+poolWei,curveWei,poolWei};
  } catch (error) {
    // No fallback to zero or a short historical scan when either getter is absent/unavailable.
    return {...base,status:'unavailable',wei:null,curveWei:null,poolWei:null,reason:reason(error)};
  }
}

/** Bounded, filtered eth_getLogs scans. Partial ranges have no full-lifetime numeric value. No background polling. */
export async function readLifetimeVolume(ctx: MetricsContext, snapshot: MarketSnapshot, options: VolumeOptions): Promise<LifetimeVolume> {
  assert(options.maxBlockSpan > 0n && Number.isSafeInteger(options.maxLogRequests) && options.maxLogRequests > 0, 'Explicit positive scan bounds required');
  const resultLimit = options.maxLogsPerResponse ?? 1000;
  assert(Number.isSafeInteger(resultLimit) && resultLimit > 0, 'Invalid log response safety bound');
  const from = ctx.deployment.deployedBlock, to = ctx.blockNumber;
  const base = {label:'Lifetime pool volume (ETH)' as const,fromBlock:from,toBlock:to};
  let sum = 0n, trades = 0, requests = 0, cursor = to, scannedFrom: bigint | null = null, span = options.maxBlockSpan;
  const seen = new Map<string,string>();
  let failure: string | undefined;
  if (snapshot.blockHash !== ctx.blockHash || snapshot.blockNumber !== ctx.blockNumber)
    failure = 'Snapshot mismatch';
  else if (![0,2].includes(snapshot.phase)) failure = 'Market is transitioning';
  else if (snapshot.phase === 2 && !snapshot.poolId) failure = 'Cannot verify v4 pool; curve-only history is not full lifetime volume';
  const validateLogs = (logs: any[], address: Address, start: bigint, end: bigint, isV4: boolean) => {
    let delta = 0n, count = 0; const additions = new Map<string,string>();
    for (const log of logs) {
      assert(same(log.address,address) && typeof log.blockNumber === 'bigint' && log.blockNumber >= start && log.blockNumber <= end
        && /^0x[0-9a-fA-F]{64}$/.test(log.blockHash) && /^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)
        && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0 && log.removed !== true, 'Malformed/out-of-range/removed trade log');
      assert(log.args && (isV4 ? log.eventName === 'Swap' && log.args.id === snapshot.poolId
        : ['Bought','Sold'].includes(log.eventName)), 'Unexpected or undecodable trade event');
      const key = `${log.blockHash}:${log.logIndex}`;
      const fingerprint = JSON.stringify([log.address.toLowerCase(),log.transactionHash,log.eventName,log.args],(_,v)=>typeof v==='bigint'?v.toString():v);
      const existing = seen.get(key) ?? additions.get(key);
      if (existing) { assert(existing === fingerprint, 'Conflicting duplicate trade log'); continue; }
      additions.set(key,fingerprint);
      delta += isV4 ? v4TradeVolume(log.args,true) : curveTradeVolume(log.eventName,log.args); count++;
    }
    return {delta,count,additions};
  };
  while (!failure && cursor >= from) {
    if (options.signal?.aborted) { failure = 'Scan cancelled'; break; }
    const needed = snapshot.phase === 2 ? 2 : 1;
    if (requests + needed > options.maxLogRequests) { failure = 'Bounded log-request budget reached'; break; }
    const start = cursor - from + 1n > span ? cursor - span + 1n : from;
    try {
      requests++;
      const curve = await ctx.read.getLogs({address:snapshot.market,events:CURVE_EVENTS,fromBlock:start,toBlock:cursor,strict:false});
      assert(curve.length < resultLimit, 'Log response safety limit reached; narrow block range');
      let swaps: any[] = [];
      if (snapshot.phase === 2) {
        requests++;
        swaps = await ctx.read.getLogs({address:POOL_MANAGER,event:SWAP_EVENT,args:{id:snapshot.poolId},fromBlock:start,toBlock:cursor,strict:false});
        assert(swaps.length < resultLimit, 'Log response safety limit reached; narrow block range');
      }
      const curveDelta = validateLogs(curve,snapshot.market,start,cursor,false);
      const swapDelta = validateLogs(swaps,POOL_MANAGER,start,cursor,true);
      // Commit a range only after BOTH event sources succeeded and validated.
      for (const [key,value] of [...curveDelta.additions,...swapDelta.additions]) {
        assert(!seen.has(key) || seen.get(key) === value, 'Conflicting log identity'); seen.set(key,value);
      }
      sum += curveDelta.delta + swapDelta.delta; trades += curveDelta.count + swapDelta.count;
      scannedFrom = start; cursor = start - 1n;
    } catch (error) {
      const message = reason(error);
      if (span > 1n && /range|too many|limit|response size|exceed/i.test(message)) { span = (span + 1n) / 2n; continue; }
      failure = message;
    }
  }
  try { await assertSnapshotCanonical(ctx); }
  catch (error) { return {...base,status:'unavailable',wei:null,partialWei:null,trades:0,scannedFromBlock:null,logRequests:requests,reason:reason(error)}; }
  const complete = !failure && cursor < from;
  return {...base,status:complete?'complete':scannedFrom===null?'unavailable':'partial',wei:complete?sum:null,
    partialWei:!complete&&scannedFrom!==null?sum:null,trades,scannedFromBlock:scannedFrom,logRequests:requests,...(failure?{reason:failure}:{})};
}

export type SortableMetrics = { launchIndex: bigint; token: Address; metrics?: MarketSnapshot; volume?: LifetimeVolume | CounterVolume };
export function sortMarketMetrics<T extends SortableMetrics>(rows: readonly T[], mode: 'recent'|'fdv'|'volume'|'progress'): T[] {
  const cmp = (a: bigint,b: bigint) => a===b?0:a>b?-1:1;
  const field = (row:T): [bigint,bigint] | null => {
    if (mode==='recent') return [row.launchIndex,1n];
    if (mode==='fdv' && row.metrics?.fdv.status==='available') return [row.metrics.fdv.value.fdvNumerator,row.metrics.fdv.value.fdvDenominator];
    if (mode==='progress' && row.metrics?.progressBps.status==='available') return [row.metrics.phase===2?row.metrics.capETH:row.metrics.reserveETH,row.metrics.capETH];
    if (mode==='volume' && row.volume?.status==='complete' && row.volume.wei!==null) return [row.volume.wei,1n];
    return null;
  };
  return [...rows].sort((a,b)=>{
    const x=field(a),y=field(b);
    if(x&&!y)return -1;if(!x&&y)return 1;
    const order=x&&y?cmp(x[0]*y[1],y[0]*x[1]):0;
    return order||cmp(a.launchIndex,b.launchIndex)||a.token.toLowerCase().localeCompare(b.token.toLowerCase());
  });
}
