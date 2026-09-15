import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LAUNCH_FEED_OPTIONS, filterLaunchFeed, type LaunchFeedOptions, type LaunchFeedRow } from '../src/lib/launch-feed';

const address = (suffix: string): `0x${string}` => `0x${suffix.padStart(40, '0')}`;
const row = (index: bigint, overrides: Partial<LaunchFeedRow> = {}): LaunchFeedRow => ({
  index,
  market: address(`1${index.toString(16)}`),
  token: address(`2${index.toString(16)}`),
  creator: address('caFe'),
  name: `Launch ${index}`,
  symbol: `L${index}`,
  phase: 0,
  reserve: index,
  marketCapETH: null,
  volumeETH: null,
  curveProgressBps: null,
  creatorFee: 0,
  hasImage: false,
  hasAudio: false,
  hasWebsite: false,
  ...overrides,
});
const indices = (rows: readonly LaunchFeedRow[]) => rows.map(value => value.index);

test('defaults return all launches ordered newest first in a new array', () => {
  const rows = [row(1n), row(3n), row(2n)];
  const result = filterLaunchFeed(rows);
  assert.deepEqual(indices(result), [3n, 2n, 1n]);
  assert.notEqual(result, rows);
  assert.deepEqual(DEFAULT_LAUNCH_FEED_OPTIONS, { search: '', phase: 'all', media: 'all', creatorFee: 'all', sort: 'newest' });
  assert(Object.isFrozen(DEFAULT_LAUNCH_FEED_OPTIONS));
});

test('search matches name and symbol without case sensitivity and trims surrounding spaces', () => {
  const rows = [row(1n, { name: 'Blue Moon', symbol: 'BLU' }), row(2n, { name: 'Sunset', symbol: 'MOON' }), row(3n)];
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: '  mOoN  ' })), [2n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: 'bLu' })), [1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: '   ' })), [3n, 2n, 1n]);
});

test('search matches mixed-case token and creator addresses, including substrings', () => {
  const rows = [row(1n, { token: address('aBcDef'), creator: address('777') }), row(2n, { creator: address('aBcDef') }), row(3n)];
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: address('ABCDEF') })), [2n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: 'aBcDeF' })), [2n, 1n]);
});

test('phase filters select curve 0 and v4 2 without misclassifying intermediate phases', () => {
  const rows = [row(1n, { phase: 0 }), row(2n, { phase: 1 }), row(3n, { phase: 2 }), row(4n, { phase: 99 })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { phase: 'curve' })), [1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { phase: 'v4' })), [3n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { phase: 'all' })), [4n, 3n, 2n, 1n]);
});

test('each media filter requires its requested media, and complete requires all three', () => {
  const rows = [row(1n, { hasImage: true }), row(2n, { hasAudio: true }), row(3n, { hasWebsite: true }), row(4n, { hasImage: true, hasAudio: true, hasWebsite: true }), row(5n)];
  assert.deepEqual(indices(filterLaunchFeed(rows, { media: 'image' })), [4n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { media: 'audio' })), [4n, 2n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { media: 'website' })), [4n, 3n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { media: 'complete' })), [4n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { media: 'all' })), [5n, 4n, 3n, 2n, 1n]);
});

test('creator fees use inclusive 100 and 500 bps thresholds, with above5 strictly greater than 500', () => {
  const rows = [row(1n, { creatorFee: 0 }), row(2n, { creatorFee: 1 }), row(3n, { creatorFee: 100 }), row(4n, { creatorFee: 101 }), row(5n, { creatorFee: 500 }), row(6n, { creatorFee: 501 })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { creatorFee: 'zero' })), [1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { creatorFee: 'upto1' })), [3n, 2n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { creatorFee: 'upto5' })), [5n, 4n, 3n, 2n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { creatorFee: 'above5' })), [6n]);
  assert.equal(filterLaunchFeed(rows, { creatorFee: 'all' }).length, rows.length);
});

test('combined search, phase, media, and fee filters intersect before sorting', () => {
  const match = { name: 'Moon', phase: 2, hasWebsite: true, creatorFee: 100 };
  const rows = [row(1n, { ...match, reserve: 20n }), row(2n, { ...match, phase: 0 }), row(3n, { ...match, hasWebsite: false }), row(4n, { ...match, creatorFee: 101 }), row(5n, { ...match, name: 'Sun' }), row(6n, { ...match, reserve: 10n })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { search: 'moon', phase: 'v4', media: 'website', creatorFee: 'upto1', sort: 'reserve-asc' })), [6n, 1n]);
});

test('newest and oldest preserve bigint index precision far beyond Number.MAX_SAFE_INTEGER', () => {
  const base = 1n << 200n;
  const rows = [row(base + 2n), row(base), row(base + 1n)];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'newest' })), [base + 2n, base + 1n, base]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'oldest' })), [base, base + 1n, base + 2n]);
});

test('reserve sorts preserve adjacent bigint values beyond Number.MAX_SAFE_INTEGER', () => {
  const reserve = 1n << 200n;
  const rows = [row(1n, { reserve: reserve + 2n }), row(2n, { reserve }), row(3n, { reserve: reserve + 1n })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'reserve-asc' })), [2n, 3n, 1n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'reserve-desc' })), [1n, 3n, 2n]);
});

test('fee sorts order by basis points, then descending index for equal fees', () => {
  const rows = [row(1n, { creatorFee: 100 }), row(4n, { creatorFee: 100 }), row(2n, { creatorFee: 0 }), row(3n, { creatorFee: 500 })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'fee-asc' })), [2n, 4n, 1n, 3n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'fee-desc' })), [3n, 4n, 1n, 2n]);
});

test('name sort is case-insensitive with descending index for equal names', () => {
  const rows = [row(1n, { name: 'alpha' }), row(2n, { name: 'Bravo' }), row(3n, { name: 'ALPHA' }), row(4n, { name: 'charlie' })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'name' })), [3n, 1n, 2n, 4n]);
});

test('all non-index sort ties resolve by exact descending bigint index independently of input order', () => {
  const base = 1n << 200n;
  const rows = [row(base, { name: 'same', reserve: 5n }), row(base + 2n, { name: 'same', reserve: 5n }), row(base + 1n, { name: 'same', reserve: 5n })];
  const sorts: LaunchFeedOptions['sort'][] = ['reserve-desc', 'reserve-asc', 'fee-asc', 'fee-desc', 'name', 'marketcap-desc', 'marketcap-asc', 'volume-desc', 'volume-asc', 'progress-desc', 'progress-asc'];
  for (const sort of sorts) {
    const expected = [base + 2n, base + 1n, base];
    assert.deepEqual(indices(filterLaunchFeed(rows, { sort })), expected, sort);
    assert.deepEqual(indices(filterLaunchFeed([...rows].reverse(), { sort })), expected, sort);
  }
});

test('filtering and sorting do not mutate the source array, row objects, or options', () => {
  const rows = Object.freeze([Object.freeze(row(1n, { name: 'B', hasImage: true })), Object.freeze(row(2n, { name: 'A', hasImage: true }))]);
  const options = Object.freeze({ media: 'image', sort: 'name' } as const);
  const before = structuredClone(rows);
  const result = filterLaunchFeed(rows, options);
  assert.deepEqual(rows, before);
  assert.deepEqual(options, { media: 'image', sort: 'name' });
  assert.deepEqual(indices(result), [2n, 1n]);
  assert.equal(result[0], rows[1]);
  result.pop();
  assert.equal(rows.length, 2);
});

test('a full tie remains stable and generic row metadata is retained', () => {
  const first = { ...row(1n), marker: 'first' };
  const second = { ...row(1n), marker: 'second' };
  const result = filterLaunchFeed([first, second], { sort: 'reserve-asc' });
  assert.deepEqual(result.map(value => value.marker), ['first', 'second']);
});

test('empty inputs, no matches, and explicit undefined options retain defaults', () => {
  assert.deepEqual(filterLaunchFeed([]), []);
  assert.deepEqual(filterLaunchFeed([row(1n)], { search: 'absent' }), []);
  assert.deepEqual(indices(filterLaunchFeed([row(1n), row(2n)], { search: undefined, phase: undefined, media: undefined, creatorFee: undefined, sort: undefined })), [2n, 1n]);
});

test('market cap sorts preserve bigint precision and place nulls after actual zero values', () => {
  const base = 1n << 200n;
  const rows = [row(1n, { marketCapETH: base + 1n }), row(2n, { marketCapETH: base }), row(3n), row(4n, { marketCapETH: 0n }), row(5n)];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'marketcap-desc' })), [1n, 2n, 4n, 5n, 3n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'marketcap-asc' })), [4n, 2n, 1n, 5n, 3n]);
});

test('volume sorts preserve bigint precision and place nulls last in both directions', () => {
  const base = 1n << 200n;
  const rows = [row(1n, { volumeETH: base }), row(2n), row(3n, { volumeETH: base + 1n }), row(4n, { volumeETH: 0n })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'volume-desc' })), [3n, 1n, 4n, 2n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'volume-asc' })), [4n, 1n, 3n, 2n]);
});

test('curve progress sorts respect zero, graduation, and unavailable progress', () => {
  const rows = [row(1n, { curveProgressBps: 0 }), row(2n), row(3n, { curveProgressBps: 5000 }), row(4n, { curveProgressBps: 10000 }), row(5n, { curveProgressBps: 5000 })];
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'progress-desc' })), [4n, 5n, 3n, 1n, 2n]);
  assert.deepEqual(indices(filterLaunchFeed(rows, { sort: 'progress-asc' })), [1n, 5n, 3n, 4n, 2n]);
});

test('metric sorts combine with every filter without dropping or inventing unavailable values', () => {
  const match = { name: 'Moon', phase: 0, hasImage: true, hasAudio: true, hasWebsite: true, creatorFee: 500 };
  const rows = [row(1n, { ...match, volumeETH: 0n }), row(2n, match), row(3n, { ...match, volumeETH: 20n }), row(4n, { ...match, volumeETH: 100n, creatorFee: 501 })];
  const result = filterLaunchFeed(rows, { search: 'MOON', phase: 'curve', media: 'complete', creatorFee: 'upto5', sort: 'volume-desc' });
  assert.deepEqual(indices(result), [3n, 1n, 2n]);
  assert.deepEqual(result.map(value => value.volumeETH), [20n, 0n, null]);
});
