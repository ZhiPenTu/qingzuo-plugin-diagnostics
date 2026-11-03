import {
  isAccessDenied,
  readDiagnostics,
  subscribeDebugLog,
  userFacingError,
} from './diagnostics.mjs';
import {
  PAGE_SIZE,
  entryLocation,
  filterEntries,
  formatBytes,
  formatLogTime,
  levelLabel,
  scopeLabel,
} from './log-store.mjs';
import {
  applyLogBatch,
  applyReadFailure,
  applyReadSuccess,
  beginRead,
  createDiagnosticsState,
  setLevel,
  setScope,
} from './state.mjs';

const $ = id => document.getElementById(id);
const bridge = globalThis.commercePlugin;
let state = createDiagnosticsState();
let unsubscribe = null;
let reading = false;

function element(tag, { className, text, attributes } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes ?? {})) node.setAttribute(name, value);
  return node;
}

function setBadge(node, text, tone) {
  node.textContent = text;
  node.dataset.tone = tone;
}

function renderStatus() {
  const status = state.status;
  if (!status) {
    setBadge($('logging-state'), state.loading ? '读取中' : '未知', 'muted');
  } else if (status.enabled === true) {
    setBadge($('logging-state'), '已开启', 'success');
  } else if (status.enabled === false) {
    setBadge($('logging-state'), '已关闭', 'warning');
  } else {
    setBadge($('logging-state'), '未知', 'muted');
  }

  if (state.denied) {
    setBadge($('auth-state'), '未授权', 'danger');
  } else if (state.granted) {
    setBadge($('auth-state'), '已授权', 'success');
  } else if (state.loading) {
    setBadge($('auth-state'), '确认中', 'muted');
  } else {
    setBadge($('auth-state'), '未授权', 'warning');
  }

  $('loaded-count').textContent = status?.count > state.entries.length
    ? `${state.entries.length} / ${status.count} 条`
    : `${state.entries.length} 条`;
  $('storage-usage').textContent = status
    ? `${formatBytes(status.storedBytes)} / ${formatBytes(status.maxBytes)}`
    : '—';
  $('directory').textContent = status?.directory || '—';
  $('current-file').textContent = status?.currentFile || '—';

  const hostError = status?.lastError || '';
  $('host-error').textContent = hostError;
  $('host-error').hidden = !hostError;
  $('status-error').textContent = state.entries.length > 0 ? state.error : '';
  $('status-error').hidden = !state.entries.length || !state.error;

  if (unsubscribe) {
    $('realtime-state').textContent = '实时更新已连接';
    $('realtime-state').dataset.tone = 'success';
  } else if (state.loading) {
    $('realtime-state').textContent = '正在连接';
    $('realtime-state').dataset.tone = 'muted';
  } else if (state.denied) {
    $('realtime-state').textContent = '等待手动授权';
    $('realtime-state').dataset.tone = 'warning';
  } else if (state.granted && typeof bridge?.onDebugLog !== 'function') {
    $('realtime-state').textContent = '仅手动刷新';
    $('realtime-state').dataset.tone = 'warning';
  } else {
    $('realtime-state').textContent = '实时更新未连接';
    $('realtime-state').dataset.tone = 'muted';
  }
}

function logEntry(entry) {
  const article = element('article', {
    className: `log-entry level-${entry.level}`,
    attributes: { 'data-seq': String(entry.seq) },
  });
  const header = element('div', { className: 'log-header' });
  const meta = element('div', { className: 'log-meta' });
  const date = new Date(entry.time);
  const datetimeAttributes = Number.isFinite(date.getTime()) ? { datetime: date.toISOString() } : {};
  meta.append(
    element('time', {
      className: 'log-time',
      text: formatLogTime(entry.time),
      attributes: datetimeAttributes,
    }),
    element('span', { className: `scope scope-${entry.scope}`, text: scopeLabel(entry.scope) }),
    element('span', { className: `level level-${entry.level}`, text: levelLabel(entry.level) }),
    element('span', { className: 'log-source', text: entry.source || '未知来源' }),
  );
  header.append(
    meta,
    element('span', { className: 'log-seq', text: `#${entry.seq}` }),
  );
  const message = element('pre', { className: 'log-message', text: entry.message || '(空消息)' });
  article.append(header, message);

  const location = entryLocation(entry);
  if (location) {
    article.append(element('p', {
      className: 'log-location',
      text: location,
      attributes: { title: location },
    }));
  }
  return article;
}

function renderEntries({ follow = false } = {}) {
  const list = $('log-list');
  const visible = filterEntries(state.entries, state);
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  list.replaceChildren(...visible.map(logEntry));
  if (follow || nearBottom) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
  return visible;
}

function render({ follow = false } = {}) {
  renderStatus();
  const visible = renderEntries({ follow });
  $('scope-filter').value = state.scope;
  $('level-filter').value = state.level;
  $('visible-count').textContent = `${visible.length} 条`;
  $('refresh').disabled = state.loading;

  const initialLoading = state.loading && state.entries.length === 0;
  $('loading').hidden = !initialLoading;
  const blocked = Boolean(state.error) && !state.entries.length;
  $('error-state').hidden = state.loading || !blocked;
  $('error-message').textContent = state.error;

  const empty = !state.loading && !blocked && visible.length === 0;
  $('empty-state').hidden = !empty;
  $('log-list').hidden = state.loading || visible.length === 0;
  if (empty) {
    const recordsOff = state.status?.enabled === false;
    if (recordsOff) {
      $('empty-title').textContent = '日志记录已关闭';
      $('empty-copy').textContent = '请在轻作主壳的日志设置中开启，然后点击刷新。';
    } else if (!state.entries.length) {
      $('empty-title').textContent = '还没有日志';
      $('empty-copy').textContent = '运行轻作、插件或浏览器后，日志会显示在这里。';
    } else {
      $('empty-title').textContent = '当前筛选没有日志';
      $('empty-copy').textContent = '调整范围或级别后再看。';
    }
  }
}

function ensureSubscription() {
  if (unsubscribe || !state.granted) return;
  unsubscribe = subscribeDebugLog(bridge, batch => {
    state = applyLogBatch(state, batch);
    render({ follow: true });
  });
}

async function load() {
  if (reading) return;
  reading = true;
  state = beginRead(state);
  render();
  try {
    if (!bridge || typeof bridge.invoke !== 'function') {
      state = applyReadFailure(state, {
        error: '请在轻作中打开日志调试插件。',
        denied: false,
        status: null,
      });
      return;
    }
    const result = await readDiagnostics(bridge, { cursor: state.cursor, limit: PAGE_SIZE });
    state = result.ok ? applyReadSuccess(state, result) : applyReadFailure(state, result);
    if (result.ok) ensureSubscription();
  } catch (error) {
    state = applyReadFailure(state, {
      error: userFacingError(error),
      denied: isAccessDenied(error),
      status: state.status,
    });
  } finally {
    reading = false;
    render({ follow: true });
  }
}

$('refresh').addEventListener('click', () => void load());
$('retry').addEventListener('click', () => void load());
$('scope-filter').addEventListener('change', event => {
  state = setScope(state, event.target.value);
  render();
});
$('level-filter').addEventListener('change', event => {
  state = setLevel(state, event.target.value);
  render();
});

window.addEventListener('pagehide', () => {
  unsubscribe?.();
  unsubscribe = null;
});

void load();
