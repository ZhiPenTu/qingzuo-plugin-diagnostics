import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.QINGZUO_HOST_EXECUTABLE;
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const platform = `${process.platform}-${process.arch}`;

function commerceResources(executablePath) {
  const directory = path.dirname(path.resolve(executablePath));
  if (process.platform === 'darwin') return path.resolve(directory, '..', 'Resources', 'commerce');
  return path.resolve(directory, 'resources', 'commerce');
}

test('the packaged diagnostics plugin installs and opens in a real Qingzuo host', {
  skip: executable ? false : 'QINGZUO_HOST_EXECUTABLE 未设置，跳过真实宿主测试。',
  timeout: 180_000,
}, async () => {
  const { _electron: electron, expect } = await import('@playwright/test');
  const artifact = path.resolve(`release/${pkg.commerce.id}-${pkg.version}-${platform}.ecplugin`);
  const bytes = await readFile(artifact);
  const resources = commerceResources(executable);
  const configFile = path.join(resources, 'market.json');
  let previous = null;
  try {
    previous = await readFile(configFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-diagnostics-host-'));
  const profile = path.join(temporary, 'profile');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  let application;
  try {
    const artifactUrl = `https://market.example/${pkg.commerce.id}.ecplugin`;
    const catalog = {
      schemaVersion: 1,
      plugins: [{
        ...pkg.commerce,
        version: pkg.version,
        artifacts: {
          [platform]: {
            url: artifactUrl,
            size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            signature: sign(null, bytes, privateKey).toString('base64'),
          },
        },
      }],
    };
    const existing = previous ? JSON.parse(previous.toString('utf8')) : {};
    await writeFile(configFile, JSON.stringify({
      ...existing,
      url: 'https://market.example/catalog.json',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    }));

    application = await electron.launch({
      executablePath: path.resolve(executable),
      cwd: temporary,
      args: [`--user-data-dir=${profile}`],
      timeout: 60_000,
    });
    const page = await application.firstWindow();
    await expect.poll(
      async () => (await page.evaluate(() => window.commerceDesktop.invoke('status'))).kernel.ready,
      { timeout: 60_000 },
    ).toBe(true);
    await application.evaluate((_, value) => {
      globalThis.fetch = async address => String(address).endsWith('/catalog.json')
        ? new Response(JSON.stringify(value.catalog))
        : new Response(Buffer.from(value.bytes, 'base64'));
    }, { catalog, bytes: bytes.toString('base64') });

    await page.getByRole('button', { name: '工具中心', exact: true }).click();
    await page.getByRole('tab', { name: '全部', exact: true }).click();
    const card = page.locator('[data-slot="card"]').filter({ hasText: '日志调试' });
    await expect(card.getByRole('heading', { name: '日志调试', exact: true })).toBeVisible();
    await card.getByRole('button', { name: '安装插件', exact: true }).click();
    await expect(card.getByRole('button', { name: '已安装', exact: true })).toBeVisible({ timeout: 60_000 });

    await page.getByRole('tab', { name: '已安装', exact: true }).click();
    const installedCard = page.locator('[data-slot="card"]').filter({ hasText: '日志调试' });
    await installedCard.getByRole('button', { name: /^打开(?:工具)?$/ }).click();
    await expect.poll(
      () => application.context().pages().some(candidate => candidate.url().startsWith(`commerce-plugin://${pkg.commerce.id}/`)),
      { timeout: 60_000 },
    ).toBe(true);
    const plugin = application.context().pages().find(candidate => candidate.url().startsWith(`commerce-plugin://${pkg.commerce.id}/`));
    await expect(plugin.getByRole('heading', { name: '日志调试', exact: true })).toBeVisible();
    await expect(plugin.locator('#logging-state')).toBeVisible();
    await expect(plugin.locator('#scope-filter')).toBeVisible();
    const bridge = await plugin.evaluate(() => ({
      invoke: typeof window.commercePlugin?.invoke,
      onDebugLog: typeof window.commercePlugin?.onDebugLog,
    }));
    assert.equal(bridge.invoke, 'function');
    assert.equal(bridge.onDebugLog, 'function');
    console.log('日志调试插件以市场来源安装并打开，内部桥可用。');
  } finally {
    await application?.close().catch(() => {});
    if (previous) await writeFile(configFile, previous).catch(() => {});
    else await rm(configFile, { force: true }).catch(() => {});
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
