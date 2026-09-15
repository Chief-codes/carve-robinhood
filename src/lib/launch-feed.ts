type Address = `0x${string}`;

/** Rows supplied by the caller from the Carve factory's registered markets. */
export type LaunchFeedRow = {
  index: bigint;
  market: Address;
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  phase: number;
  reserve: bigint;
  /** Null means unavailable, never an implied zero. ETH amounts use wei. */
  marketCapETH: bigint | null;
  volumeETH: bigint | null;
  curveProgressBps: number | null;
  /** Creator fee in basis points: 100 bps = 1%. */
  creatorFee: number;
  hasImage: boolean;
  hasAudio: boolean;
  hasWebsite: boolean;
};

export type LaunchFeedOptions = {
  search: string;
  phase: 'all' | 'curve' | 'v4' | 'v3-building' | 'v3-milestone';
  media: 'all' | 'image' | 'audio' | 'website' | 'complete';
  creatorFee: 'all' | 'zero' | 'upto1' | 'upto5' | 'above5';
  sort: 'newest' | 'oldest' | 'reserve-desc' | 'reserve-asc' | 'fee-asc' | 'fee-desc' | 'name'
    | 'marketcap-desc' | 'marketcap-asc' | 'volume-desc' | 'volume-asc' | 'progress-desc' | 'progress-asc';
};

export const DEFAULT_LAUNCH_FEED_OPTIONS: Readonly<LaunchFeedOptions> = Object.freeze({
  search: '',
  phase: 'all',
  media: 'all',
  creatorFee: 'all',
  sort: 'newest',
});

function compare<T extends bigint | number | string>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullable<T extends bigint | number>(a: T | null, b: T | null, descending: boolean): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return descending ? compare(b, a) : compare(a, b);
}

/** Pure display filtering; the caller is responsible for loading registered markets. */
export function filterLaunchFeed<T extends LaunchFeedRow>(
  rows: readonly T[],
  options: Partial<LaunchFeedOptions> = {},
): T[] {
  const search = (options.search ?? DEFAULT_LAUNCH_FEED_OPTIONS.search).trim().toLowerCase();
  const phase = options.phase ?? DEFAULT_LAUNCH_FEED_OPTIONS.phase;
  const media = options.media ?? DEFAULT_LAUNCH_FEED_OPTIONS.media;
  const creatorFee = options.creatorFee ?? DEFAULT_LAUNCH_FEED_OPTIONS.creatorFee;
  const sort = options.sort ?? DEFAULT_LAUNCH_FEED_OPTIONS.sort;

  const filtered = rows.filter(row => {
    if (search && ![row.name, row.symbol, row.token, row.creator].some(value => value.toLowerCase().includes(search))) return false;
    if (phase === 'curve' && row.phase !== 0) return false;
    if (phase === 'v4' && row.phase !== 2) return false;
    if (phase === 'v3-building' && row.phase !== 3) return false;
    if (phase === 'v3-milestone' && row.phase !== 4) return false;
    if (media === 'image' && !row.hasImage) return false;
    if (media === 'audio' && !row.hasAudio) return false;
    if (media === 'website' && !row.hasWebsite) return false;
    if (media === 'complete' && !(row.hasImage && row.hasAudio && row.hasWebsite)) return false;
    if (creatorFee === 'zero' && row.creatorFee !== 0) return false;
    if (creatorFee === 'upto1' && row.creatorFee > 100) return false;
    if (creatorFee === 'upto5' && row.creatorFee > 500) return false;
    if (creatorFee === 'above5' && row.creatorFee <= 500) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    let primary: number;
    switch (sort) {
      case 'oldest': primary = compare(a.index, b.index); break;
      case 'reserve-desc': primary = compare(b.reserve, a.reserve); break;
      case 'reserve-asc': primary = compare(a.reserve, b.reserve); break;
      case 'fee-asc': primary = compare(a.creatorFee, b.creatorFee); break;
      case 'fee-desc': primary = compare(b.creatorFee, a.creatorFee); break;
      case 'name': primary = compare(a.name.toLowerCase(), b.name.toLowerCase()); break;
      case 'marketcap-desc': primary = compareNullable(a.marketCapETH, b.marketCapETH, true); break;
      case 'marketcap-asc': primary = compareNullable(a.marketCapETH, b.marketCapETH, false); break;
      case 'volume-desc': primary = compareNullable(a.volumeETH, b.volumeETH, true); break;
      case 'volume-asc': primary = compareNullable(a.volumeETH, b.volumeETH, false); break;
      case 'progress-desc': primary = compareNullable(a.curveProgressBps, b.curveProgressBps, true); break;
      case 'progress-asc': primary = compareNullable(a.curveProgressBps, b.curveProgressBps, false); break;
      default: primary = compare(b.index, a.index);
    }
    // Factory indices are unique. Equal input rows retain their original order.
    return primary || compare(b.index, a.index);
  });
}
