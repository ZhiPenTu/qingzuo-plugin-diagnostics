import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { validatePluginManifest } from '../scripts/manifest.mjs';

const run = promisify(execFile);
const platforms = ['darwin-arm64', 'win32-x64'];

test('pack emits identical dual-platform artifacts with only the UI manifest, license and local assets', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-diagnostics-pack-'));
  try {
    await run(process.execPath, ['scripts/pack-plugin.mjs', '--out', temporary], {
      cwd: path.resolve('.'),
    });
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const expectedArtifacts = platforms
      .map(platform => `${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`)
      .sort();
    const actualArtifacts = (await readdir(temporary))
      .filter(name => name.endsWith('.ecplugin'))
      .sort();
    assert.deepEqual(actualArtifacts, expectedArtifacts);

    let previousBytes = null;
    for (const platform of platforms) {
      const artifact = path.join(temporary, `${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`);
      const bytes = await readFile(artifact);
      if (previousBytes) assert.deepEqual(bytes, previousBytes);
      previousBytes = bytes;

      const zip = new AdmZip(bytes);
      const names = zip.getEntries().map(entry => entry.entryName).sort();
      assert.deepEqual(names, [
        'LICENSE',
        'package.json',
        'ui/app.mjs',
        'ui/diagnostics.mjs',
        'ui/index.html',
        'ui/log-store.mjs',
        'ui/state.mjs',
        'ui/style.css',
      ]);
      assert.ok(names.every(name => !/^(?:tests|scripts|node_modules|release)\//.test(name)));
      assert.ok(names.every(name => !name.endsWith('sdk.mjs')));

      const packaged = JSON.parse(zip.readAsText('package.json'));
      const manifest = validatePluginManifest(packaged);
      assert.equal(manifest.id, 'official.diagnostics');
      assert.equal(manifest.api, '^1.10.0');
      assert.deepEqual(manifest.permissions, {});
      assert.equal(manifest.backend, undefined);
      assert.equal(manifest.settings, undefined);
      assert.match(zip.readAsText('ui/diagnostics.mjs'), /firstParty\.diagnostics\.recent/);

      const catalog = JSON.parse(await readFile(path.join(temporary, `catalog-${platform}.json`), 'utf8'));
      assert.deepEqual(Object.keys(catalog.plugins[0]).sort(), [
        'api',
        'artifacts',
        'category',
        'description',
        'icon',
        'id',
        'releaseNotes',
        'title',
        'version',
      ]);
      assert.equal(catalog.plugins[0].icon, manifest.icon);
      const record = catalog.plugins[0].artifacts[platform];
      assert.equal(record.size, bytes.length);
      assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.match(record.url, new RegExp(`${pkg.commerce.id}-${pkg.version}-${platform}\\.ecplugin$`));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
