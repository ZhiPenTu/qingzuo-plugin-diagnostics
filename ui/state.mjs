import { MAX_VISIBLE_ENTRIES, advanceCursor, mergeEntries } from './log-store.mjs';

export function createDiagnosticsState() {
  return {
    entries: [],
    status: null,
    cursor: null,
    granted: false,
    loading: true,
    error: '',
    denied: false,
    scope: 'all',
    level: 'all',
  };
}

export function beginRead(state) {
  return { ...state, loading: true, error: '' };
}

export function applyReadSuccess(state, result) {
  return {
    ...state,
    entries: mergeEntries(state.entries, result.entries, { limit: MAX_VISIBLE_ENTRIES }),
    status: result.status,
    cursor: result.cursor ?? state.cursor,
    granted: true,
    loading: false,
    error: '',
    denied: false,
  };
}

export function applyReadFailure(state, result) {
  const status = result.status ?? state.status;
  return {
    ...state,
    status,
    granted: result.denied ? false : (typeof status?.granted === 'boolean' ? status.granted : state.granted),
    loading: false,
    error: result.error,
    denied: result.denied,
  };
}

export function applyLogBatch(state, batch) {
  return {
    ...state,
    entries: mergeEntries(state.entries, batch.entries, { limit: MAX_VISIBLE_ENTRIES }),
    cursor: advanceCursor(state.cursor, batch.nextCursor, batch.entries),
    granted: true,
    loading: false,
    error: '',
    denied: false,
  };
}

export function setScope(state, scope) {
  return { ...state, scope };
}

export function setLevel(state, level) {
  return { ...state, level };
}
