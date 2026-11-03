import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceCursor,
  entryLocation,
  filterEntries,
  formatBytes,
  maxSeq,
  mergeEntries,
  readBatch,
} from '../ui/log-store.mjs';

const entry = (seq, overrides = {}) => ({
  seq,
  time: 1_700_000_000_000 + seq,
  scope: 'app',
  source: `source-${seq}`,
  level: 'info',
  message: `message-${seq}`,
  ...overrides,
});

test('log entries are deduplicated by seq and sorted ascending', () => {
  const merged = mergeEntries(
    [entry(8), entry(2), entry(5)],
    [entry(5, { message: 'updated' }), entry(3), entry(2, { level: 'warn' })],
  );
  assert.deepEqual(merged.map(item => item.seq), [2, 3, 5, 8]);
  assert.equal(merged.find(item => item.seq === 5).message, 'updated');
  assert.equal(merged.find(item => item.seq === 2).level, 'warn');
});

test('batch input accepts arrays and cursor envelopes while dropping invalid seq values', () => {
  const array = readBatch([entry(2), { ...entry(3), seq: '3' }, entry(4)]);
  assert.deepEqual(array.entries.map(item => item.seq), [2, 4]);
  assert.equal(array.nextCursor, null);

  const envelope = readBatch({ entries: [entry(9)], nextCursor: 9 });
  assert.deepEqual(envelope.entries.map(item => item.seq), [9]);
  assert.equal(envelope.nextCursor, 9);
});

test('cursors advance monotonically and never move backwards', () => {
  assert.equal(advanceCursor(12, 9, [entry(8)]), 12);
  assert.equal(advanceCursor(12, 14, [entry(13)]), 14);
  assert.equal(advanceCursor(null, null, [entry(3), entry(7)]), 7);
  assert.equal(maxSeq([entry(4), entry(10), entry(6)]), 10);
});

test('scope and level filters combine without mutating entries', () => {
  const entries = [
    entry(1, { scope: 'app', level: 'info' }),
    entry(2, { scope: 'plugin', level: 'error' }),
    entry(3, { scope: 'browser', level: 'debug' }),
  ];
  assert.deepEqual(filterEntries(entries, { scope: 'plugin' }).map(item => item.seq), [2]);
  assert.deepEqual(filterEntries(entries, { level: 'debug' }).map(item => item.seq), [3]);
  assert.deepEqual(filterEntries(entries, { scope: 'plugin', level: 'error' }).map(item => item.seq), [2]);
  assert.equal(entries.length, 3);
});

test('local paths, URLs and line numbers are preserved for display', () => {
  const withPath = entry(1, { url: '/Users/example/Library/Application Support/Qingzuo/logs/app.mjs', line: 42 });
  const withUrl = entry(2, { url: 'https://example.test/page', line: 7 });
  const lineOnly = entry(3, { line: 12 });
  assert.equal(entryLocation(withPath), `${withPath.url}:42`);
  assert.equal(entryLocation(withUrl), 'https://example.test/page:7');
  assert.equal(entryLocation(lineOnly), '第 12 行');
  assert.equal(formatBytes(50 * 1024 ** 2), '50.0 MB');
});
