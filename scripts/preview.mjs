import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../ui', import.meta.url));
const server = http.createServer(async (request, response) => {
  const name = request.url === '/' ? 'index.html' : request.url.split('?')[0].slice(1);
  try {
    const body = await readFile(path.join(root, name));
    const type = ({
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
    })[path.extname(name)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const entries = [
  { seq: 1024, time: now - 3800, scope: 'app', source: 'desktop/main', level: 'info', message: '轻作已就绪，内核版本 0.2.1-alpha.1' },
  { seq: 1025, time: now - 2200, scope: 'plugin', source: 'official.shein-full', level: 'warn', message: '商品图片读取较慢，已切换到备用队列。', url: '/Users/tuzhipeng/Documents/qingzuo-plugin-shein-full/ui/app.mjs', line: 428 },
  { seq: 1026, time: now - 900, scope: 'browser', source: 'browser/session', level: 'debug', message: '页面来源校验通过。', url: 'https://detail.1688.com/offer/123456789.html', line: 1 },
  { seq: 1027, time: now - 120, scope: 'app', source: 'debug-logging', level: 'error', message: '日志写入受限：请检查当前保存目录的写入权限。' },
];
const snapshot = {
  enabled: true,
  granted: true,
  count: entries.length,
  maxBytes: 50 * 1024 ** 2,
  directory: '/Users/tuzhipeng/Library/Application Support/Qingzuo/logs',
  currentFile: 'qingzuo-debug-20261103-142015-120-4812-1.jsonl',
  storedBytes: Math.round(2.4 * 1024 ** 2),
  lastError: null,
  lastSeq: 1027,
};
const init = `(() => {
  const snapshot = ${JSON.stringify(snapshot)};
  const entries = ${JSON.stringify(entries)};
  window.commercePlugin = {
    async invoke(method, args = {}) {
      if (method === 'firstParty.diagnostics.status') return { ...snapshot };
      if (method === 'firstParty.diagnostics.recent') return { entries, snapshot };
      throw new Error('未知方法');
    },
    onDebugLog() {
      return () => {};
    },
  };
})();`;

const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, name] of [[1280, 820, 'qingzuo-diagnostics-1280.png'], [760, 900, 'qingzuo-diagnostics-760.png']]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript({ content: init });
    await page.goto(origin);
    await page.locator('.log-entry').first().waitFor();
    await page.screenshot({ path: '/tmp/' + name, fullPage: true });
    console.log('Saved /tmp/' + name);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
