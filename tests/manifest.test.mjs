import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { validatePluginManifest } from '../scripts/manifest.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const [markup, app, diagnostics, store, state, style] = await Promise.all([
  readFile('ui/index.html', 'utf8'),
  readFile('ui/app.mjs', 'utf8'),
  readFile('ui/diagnostics.mjs', 'utf8'),
  readFile('ui/log-store.mjs', 'utf8'),
  readFile('ui/state.mjs', 'utf8'),
  readFile('ui/style.css', 'utf8'),
]);

test('the diagnostics manifest targets API 1.10 with no backend, settings or permissions', () => {
  const manifest = validatePluginManifest(pkg);
  assert.equal(manifest.id, 'official.diagnostics');
  assert.equal(manifest.title, '日志调试');
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.api, '^1.10.0');
  assert.deepEqual(manifest.permissions, {});
  assert.equal(manifest.backend, undefined);
  assert.equal(manifest.settings, undefined);
});

test('all UI and packaging inputs are present', async () => {
  for (const file of [
    'ui/index.html',
    'ui/app.mjs',
    'ui/diagnostics.mjs',
    'ui/log-store.mjs',
    'ui/state.mjs',
    'ui/style.css',
    'scripts/pack-plugin.mjs',
    'LICENSE',
  ]) {
    await access(file);
  }
});

test('the page uses the internal diagnostics bridge directly', () => {
  assert.match(diagnostics, /firstParty\.diagnostics\.status/);
  assert.match(diagnostics, /firstParty\.diagnostics\.recent/);
  assert.match(diagnostics, /bridge\.onDebugLog/);
  assert.match(app, /globalThis\.commercePlugin/);
  assert.doesNotMatch(`${app}\n${diagnostics}`, /createPluginClient|sdk\.mjs/);
});

test('every element referenced by the controller exists in the markup', () => {
  const ids = new Set([...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  assert.deepEqual([...used].filter(id => !ids.has(id)), []);
});

test('all UI resources are local and the page cannot make network requests', () => {
  const all = [markup, app, diagnostics, store, state, style].join('\n');
  assert.doesNotMatch(all, /https?:\/\//i);
  assert.doesNotMatch(all, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.doesNotMatch(all, /<script[^>]+src=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(all, /<link[^>]+href=["'](?:https?:)?\/\//i);
  assert.match(markup, /connect-src 'none'/);
  assert.match(markup, /<script type="module" src="\.\/app\.mjs"><\/script>/);
  assert.match(markup, /<link rel="stylesheet" href="style\.css">/);
});

test('the page exposes log status, authorization, filters and realtime state', () => {
  assert.match(markup, /id="logging-state"/);
  assert.match(markup, /id="auth-state"/);
  assert.match(markup, /id="scope-filter"/);
  assert.match(markup, /id="level-filter"/);
  assert.match(markup, /id="realtime-state"/);
  assert.match(markup, /id="log-list"/);
  assert.match(app, /applyLogBatch/);
  assert.match(app, /entryLocation/);
});
