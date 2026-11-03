# AGENTS.md

本文件是 `qingzuo-plugin-diagnostics` 的开发指南。这里只维护 UI-only 的「日志调试」插件，日志采集、落盘、容量与授权都由轻作主壳负责。

## 项目边界

- `ui/` 是插件页面和浏览器端纯函数。
- `scripts/pack-plugin.mjs` 负责校验清单并生成 `.ecplugin` 与平台 catalog 片段。
- `tests/` 使用 Node 内置测试；`test:host` 只在提供真实轻作可执行文件时运行。
- 不包含 backend、安装脚本、网络请求或日志配置能力。

## 硬约束

- 清单固定为 `official.diagnostics`、`manifestVersion: 1`、`api: ^1.10.0`，不得添加 `settings.entry`、`backend` 或网络权限。
- 宿主内部桥只使用 `window.commercePlugin.invoke('firstParty.diagnostics.status' | 'firstParty.diagnostics.recent')` 与 `window.commercePlugin.onDebugLog()`；不要引入公开 `createPluginClient` 包装。
- 首次授权被拒绝后不得自动重试。只允许用户点击「重新读取」再次发起授权。
- 页面不得自行修改日志开关、目录或容量；这些设置仍在主壳中完成。
- 日志条目去重和排序以 `seq` 为准，实时批次可乱序到达。
- 日志属于用户批准的完整脱敏数据，可展示本地路径、URL 与行号；不得把日志写回宿主或上传网络。
- 所有页面资源必须本地存在，不使用 CDN、远程字体、远程样式或外部请求。

## 验证

```sh
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

没有 `QINGZUO_HOST_EXECUTABLE` 时，`test:host` 应明确跳过。
