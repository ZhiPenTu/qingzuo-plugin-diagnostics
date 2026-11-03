import {
  MAX_VISIBLE_ENTRIES,
  PAGE_SIZE,
  advanceCursor,
  maxSeq,
  readBatch,
} from './log-store.mjs';

export const METHODS = Object.freeze({
  status: 'firstParty.diagnostics.status',
  recent: 'firstParty.diagnostics.recent',
});

const REMOTE_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;
const DENIED = /(?:拒绝|取消|未授权|无权限|无权访问|denied|permission|not authorized|cancel)/i;
const UNSUPPORTED = /(?:不支持|未知方法|unknown method|not supported|unsupported|版本过低)/i;

export function cleanHostError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.replace(REMOTE_PREFIX, '').trim();
}

export function isAccessDenied(error) {
  return DENIED.test(cleanHostError(error));
}

export function userFacingError(error) {
  const message = cleanHostError(error);
  if (DENIED.test(message)) return '未获得日志访问授权。允许访问后点击“重新读取”。';
  if (UNSUPPORTED.test(message)) return '当前轻作版本不支持日志调试，请更新后重试。';
  if (/(?:ENOENT|不存在|not found)/i.test(message)) return '日志文件不存在，请开启日志记录后重新读取。';
  if (/(?:EACCES|EROFS|权限|access denied)/i.test(message)) return '没有读取日志的权限，请检查授权后重新读取。';
  if (/日志.*(?:未开启|关闭)/.test(message)) return '日志记录未开启，请在轻作主壳中开启后重新读取。';
  return '暂时无法读取日志，请稍后重试。';
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function optionalBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function optionalText(value, fallback = null) {
  return typeof value === 'string' ? value : fallback;
}

export function normalizeStatus(value, fallback = {}) {
  return {
    enabled: optionalBoolean(value?.enabled, fallback.enabled ?? null),
    granted: optionalBoolean(value?.granted, fallback.granted ?? null),
    count: nonNegativeInteger(value?.count, fallback.count ?? 0),
    maxBytes: nonNegativeInteger(value?.maxBytes, fallback.maxBytes ?? 0),
    directory: optionalText(value?.directory, fallback.directory ?? ''),
    currentFile: optionalText(value?.currentFile, fallback.currentFile ?? null),
    storedBytes: nonNegativeInteger(value?.storedBytes, fallback.storedBytes ?? 0),
    lastError: optionalText(value?.lastError, fallback.lastError ?? null),
    lastSeq: value?.lastSeq === undefined ? fallback.lastSeq ?? null : Number.isSafeInteger(value.lastSeq) ? value.lastSeq : null,
  };
}

export function normalizeRecent(value, previousStatus = {}) {
  const batch = readBatch(value);
  return {
    entries: batch.entries,
    snapshot: normalizeStatus(value?.snapshot, previousStatus),
    nextCursor: batch.nextCursor,
  };
}

function failure(error, status = null) {
  return {
    ok: false,
    status,
    denied: isAccessDenied(error),
    error: userFacingError(error),
  };
}

export async function readDiagnostics(bridge, { cursor = null, limit = PAGE_SIZE } = {}) {
  if (!bridge || typeof bridge.invoke !== 'function') throw new Error('请在轻作中打开日志调试插件。');
  const safeLimit = Math.min(MAX_VISIBLE_ENTRIES, Math.max(1, nonNegativeInteger(limit, PAGE_SIZE) || PAGE_SIZE));
  let status;
  try {
    status = normalizeStatus(await bridge.invoke(METHODS.status));
  } catch (error) {
    return failure(error);
  }

  const args = { limit: safeLimit };
  if (Number.isSafeInteger(cursor) && cursor >= 0) args.cursor = cursor;
  let value;
  try {
    value = await bridge.invoke(METHODS.recent, args);
  } catch (error) {
    return failure(error, status);
  }

  const recent = normalizeRecent(value, status);
  const nextStatus = {
    ...normalizeStatus(recent.snapshot, status),
    granted: true,
  };
  return {
    ok: true,
    status: nextStatus,
    entries: recent.entries,
    cursor: advanceCursor(cursor, recent.nextCursor ?? recent.snapshot.lastSeq, recent.entries),
    granted: true,
  };
}

export function subscribeDebugLog(bridge, callback) {
  if (!bridge || typeof bridge.onDebugLog !== 'function') return null;
  const unsubscribe = bridge.onDebugLog(value => callback(readBatch(value)));
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

export function latestBatchSeq(batch) {
  return maxSeq(batch?.entries ?? []);
}
