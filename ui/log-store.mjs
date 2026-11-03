export const PAGE_SIZE = 300;
export const MAX_VISIBLE_ENTRIES = 1200;
export const SCOPES = Object.freeze(['app', 'plugin', 'browser']);
export const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

const SCOPE_LABELS = Object.freeze({ app: '底座', plugin: '插件', browser: '浏览器' });
const LEVEL_LABELS = Object.freeze({ debug: '调试', info: '信息', warn: '警告', error: '错误' });

export function normalizeSeq(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeLevel(value) {
  if (value === 'warning') return 'warn';
  return LEVELS.includes(value) ? value : 'info';
}

export function normalizeEntry(value) {
  const seq = normalizeSeq(value?.seq);
  if (seq === null || !value || typeof value !== 'object') return null;
  const time = Number(value.time);
  return {
    seq,
    time: Number.isFinite(time) ? time : 0,
    scope: SCOPES.includes(value.scope) ? value.scope : 'app',
    source: String(value.source ?? ''),
    level: normalizeLevel(value.level),
    message: String(value.message ?? ''),
    ...(Number.isSafeInteger(value.line) && value.line > 0 ? { line: value.line } : {}),
    ...(typeof value.url === 'string' && value.url ? { url: value.url } : {}),
  };
}

export function readBatch(value) {
  const source = Array.isArray(value) ? value : value?.entries;
  const entries = mergeEntries([], Array.isArray(source) ? source : []);
  return {
    entries,
    nextCursor: normalizeSeq(value?.nextCursor),
  };
}

export function mergeEntries(current, incoming, { limit = MAX_VISIBLE_ENTRIES } = {}) {
  const bySeq = new Map();
  for (const value of [...current, ...incoming]) {
    const entry = normalizeEntry(value);
    if (entry) bySeq.set(entry.seq, entry);
  }
  return [...bySeq.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-Math.max(1, limit));
}

export function maxSeq(entries) {
  let value = null;
  for (const entry of entries) {
    const seq = normalizeSeq(entry?.seq);
    if (seq !== null && (value === null || seq > value)) value = seq;
  }
  return value;
}

export function advanceCursor(current, provided, entries = []) {
  let value = normalizeSeq(current);
  for (const candidate of [normalizeSeq(provided), maxSeq(entries)]) {
    if (candidate !== null && (value === null || candidate > value)) value = candidate;
  }
  return value;
}

export function filterEntries(entries, { scope = 'all', level = 'all' } = {}) {
  return entries.filter(entry => (scope === 'all' || entry.scope === scope)
    && (level === 'all' || entry.level === level));
}

export function scopeLabel(value) {
  return SCOPE_LABELS[value] ?? value;
}

export function levelLabel(value) {
  return LEVEL_LABELS[value] ?? value;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatLogTime(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '时间未知';
  const pad = (number, length = 2) => String(number).padStart(length, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function entryLocation(entry) {
  if (entry?.url && entry?.line) return `${entry.url}:${entry.line}`;
  if (entry?.url) return entry.url;
  if (entry?.line) return `第 ${entry.line} 行`;
  return '';
}
