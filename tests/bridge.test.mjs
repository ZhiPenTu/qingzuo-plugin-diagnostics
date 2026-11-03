import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METHODS,
  isAccessDenied,
  readDiagnostics,
  subscribeDebugLog,
  userFacingError,
} from '../ui/diagnostics.mjs';
import {
  applyLogBatch,
  applyReadFailure,
  applyReadSuccess,
  createDiagnosticsState,
} from '../ui/state.mjs';

const snapshot = (overrides = {}) => ({
  enabled: true,
  granted: true,
  count: 2,
  maxBytes: 50 * 1024 ** 2,
  directory: '/tmp/qingzuo-logs',
  currentFile: 'qingzuo-debug.jsonl',
  storedBytes: 1024,
  lastError: null,
  lastSeq: 2,
  ...overrides,
});

const log = (seq, overrides = {}) => ({
  seq,
  time: 1_700_000_000_000 + seq,
  scope: 'app',
  source: 'desktop/main',
  level: 'info',
  message: `entry ${seq}`,
  ...overrides,
});

test('reads status and recent logs through the exact internal bridge methods', async () => {
  const calls = [];
  const bridge = {
    async invoke(method, args) {
      calls.push([method, args]);
      if (method === METHODS.status) return snapshot();
      if (method === METHODS.recent) return { entries: [log(2), log(1)], snapshot: snapshot() };
      throw new Error('unexpected');
    },
  };
  const result = await readDiagnostics(bridge);
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map(item => item.seq), [1, 2]);
  assert.equal(result.cursor, 2);
  assert.deepEqual(calls, [
    [METHODS.status, undefined],
    [METHODS.recent, { limit: 300 }],
  ]);
});

test('subsequent reads pass the cursor and keep only new unique sequence numbers', async () => {
  const calls = [];
  const bridge = {
    async invoke(method, args) {
      calls.push([method, args]);
      if (method === METHODS.status) return snapshot();
      return { entries: [log(2), log(3)], snapshot: snapshot({ lastSeq: 3 }) };
    },
  };
  const result = await readDiagnostics(bridge, { cursor: 2, limit: 50 });
  assert.equal(result.cursor, 3);
  assert.deepEqual(calls[1], [METHODS.recent, { cursor: 2, limit: 50 }]);

  let state = applyReadSuccess(createDiagnosticsState(), {
    entries: [log(1), log(2)],
    status: snapshot(),
    cursor: 2,
  });
  state = applyLogBatch(state, {
    entries: [log(2, { message: 'duplicate' }), log(3), log(4)],
    nextCursor: 4,
  });
  assert.deepEqual(state.entries.map(item => item.seq), [1, 2, 3, 4]);
  assert.equal(state.entries.find(item => item.seq === 2).message, 'duplicate');
  assert.equal(state.cursor, 4);
});

test('authorization refusal becomes an actionable state and does not retry', async () => {
  let recentCalls = 0;
  const bridge = {
    async invoke(method) {
      if (method === METHODS.status) return snapshot({ granted: false, count: 0, lastSeq: 0 });
      recentCalls += 1;
      throw new Error('用户拒绝授权。');
    },
  };
  const result = await readDiagnostics(bridge);
  assert.equal(result.ok, false);
  assert.equal(result.denied, true);
  assert.match(result.error, /允许访问后点击“重新读取”/);
  assert.equal(recentCalls, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recentCalls, 1);

  const state = applyReadFailure(createDiagnosticsState(), result);
  assert.equal(state.denied, true);
  assert.equal(state.granted, false);
  assert.equal(state.loading, false);
  assert.match(state.error, /未获得日志访问授权/);
});

test('debug-log subscription is separate from the initial read and normalizes batches', async () => {
  let callbacks = 0;
  let listener;
  const bridge = {
    onDebugLog(callback) {
      callbacks += 1;
      listener = callback;
      return () => { listener = null; };
    },
  };
  assert.equal(callbacks, 0);
  const received = [];
  const unsubscribe = subscribeDebugLog(bridge, batch => received.push(batch));
  assert.equal(callbacks, 1);
  listener({ entries: [log(8), log(7)], nextCursor: 8 });
  assert.deepEqual(received[0].entries.map(item => item.seq), [7, 8]);
  assert.equal(received[0].nextCursor, 8);
  unsubscribe();
  assert.equal(listener, null);
});

test('authorization and unsupported-version errors stay concise', () => {
  assert.equal(isAccessDenied(new Error('用户取消了授权')), true);
  assert.equal(isAccessDenied(new Error('unknown method')), false);
  assert.equal(userFacingError(new Error('用户拒绝授权。')), '未获得日志访问授权。允许访问后点击“重新读取”。');
  assert.equal(userFacingError(new Error('unknown method: firstParty.diagnostics.recent')), '当前轻作版本不支持日志调试，请更新后重试。');
  assert.equal(userFacingError(new Error('ENOENT: /private/log.jsonl')), '日志文件不存在，请开启日志记录后重新读取。');
  assert.equal(userFacingError(new Error('unexpected host failure at /private/path')), '暂时无法读取日志，请稍后重试。');
});
