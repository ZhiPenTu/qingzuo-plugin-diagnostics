const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[^:]+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

export function validatePluginManifest(pkg) {
  const manifest = pkg?.commerce;
  if (!manifest || manifest.manifestVersion !== 1) throw new Error('插件清单版本无效。');
  if (!ID.test(manifest.id) || manifest.id.startsWith('system.') || manifest.id.length > 96) {
    throw new Error('插件标识无效。');
  }
  if (manifest.id !== 'official.diagnostics') throw new Error('插件标识必须为 official.diagnostics。');
  if (!SEMVER.test(pkg.version)) throw new Error('插件版本无效。');
  if (manifest.api !== '^1.10.0') throw new Error('插件 API 必须为 ^1.10.0。');
  if (typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 80) {
    throw new Error('插件名称无效。');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim() || manifest.description.length > 2000) {
    throw new Error('插件说明无效。');
  }
  if (typeof manifest.ui !== 'string' || !SAFE_PATH.test(manifest.ui)) throw new Error('插件页面路径无效。');
  if (manifest.settings !== undefined) throw new Error('日志调试插件不能提供设置入口。');
  if (manifest.backend !== undefined) throw new Error('日志调试插件不能包含 backend。');
  const permissions = manifest.permissions ?? {};
  if (!permissions || Array.isArray(permissions) || typeof permissions !== 'object') throw new Error('插件权限无效。');
  if (Object.keys(permissions).length) throw new Error('日志调试插件不能申请权限。');
  return Object.freeze({ ...manifest, permissions });
}

export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || !SAFE_PATH.test(value)) throw new Error('插件资源路径无效。');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('插件资源路径无效。');
  return value;
}
