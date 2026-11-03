import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePluginManifest } from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/ZhiPenTu/qingzuo-plugin-diagnostics';
const PLATFORMS = Object.freeze(['darwin-arm64', 'win32-x64']);

async function addDirectory(zip, directory, prefix = '') {
  for (const name of await readdir(directory)) {
    if (name === '.DS_Store') continue;
    const filename = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error('插件包不能包含符号链接。');
    if (info.isDirectory()) {
      await addDirectory(zip, filename, relative);
    } else if (info.isFile()) {
      zip.addFile(relative, await readFile(filename), '', info.mode);
    } else {
      throw new Error('插件包包含不支持的文件类型。');
    }
  }
}

export async function buildPlugin({ releaseRoot = path.join(ROOT, 'release') } = {}) {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = validatePluginManifest(pkg);
  const stage = path.join(releaseRoot, 'plugin');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(path.join(ROOT, 'ui'), path.join(stage, 'ui'), { recursive: true });
  await cp(path.join(ROOT, 'LICENSE'), path.join(stage, 'LICENSE'));
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    commerce: manifest,
  }, null, 2));

  const zip = new AdmZip();
  await addDirectory(zip, stage);
  const bytes = zip.toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const artifacts = [];
  for (const platform of PLATFORMS) {
    const artifactName = `${manifest.id}-${pkg.version}-${platform}.ecplugin`;
    const artifact = path.join(releaseRoot, artifactName);
    await writeFile(artifact, bytes);

    const fragment = path.join(releaseRoot, `catalog-${platform}.json`);
    await writeFile(fragment, JSON.stringify({
      schemaVersion: 1,
      plugins: [{
        id: manifest.id,
        version: pkg.version,
        title: manifest.title,
        description: manifest.description,
        ...(manifest.category !== undefined ? { category: manifest.category } : {}),
        api: manifest.api,
        ...(manifest.releaseNotes !== undefined ? { releaseNotes: manifest.releaseNotes } : {}),
        ...(manifest.icon !== undefined ? { icon: manifest.icon } : {}),
        artifacts: {
          [platform]: {
            url: `${REPOSITORY}/releases/download/v${pkg.version}/${artifactName}`,
            size: bytes.length,
            sha256,
          },
        },
      }],
    }, null, 2) + '\n');
    artifacts.push({ artifact, fragment, platform, size: bytes.length, sha256 });
  }

  return { artifacts, size: bytes.length, sha256, manifest };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const releaseRoot = outIndex >= 0
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(ROOT, 'release');
  if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error('--out 需要目录参数。');
  const result = await buildPlugin({ releaseRoot });
  console.log(JSON.stringify({
    id: result.manifest.id,
    version: result.manifest.version,
    size: result.size,
    sha256: result.sha256,
    artifacts: result.artifacts.map(item => path.relative(ROOT, item.artifact)),
    fragments: result.artifacts.map(item => path.relative(ROOT, item.fragment)),
  }, null, 2));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
