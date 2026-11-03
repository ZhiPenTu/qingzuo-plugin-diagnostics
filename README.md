# 日志调试（轻作插件）

独立 UI-only 插件，用于查看轻作、插件与浏览器产生的调试日志。日志采集、保存目录、容量上限和访问授权全部由轻作主壳管理。

## 功能

- 显示日志记录开关、访问授权、已载入数量与占用空间。
- 按范围（底座、插件、浏览器）和级别（调试、信息、警告、错误）筛选。
- 按 `seq` 去重排序查看最近日志，授权后实时追加宿主推送的新日志。
- 保留完整消息、本地路径、URL 与行号。
- 首次授权被拒绝时显示可操作提示，不会自动重复弹窗。

## 开发

```sh
npm install --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

`npm run pack` 在 `release/` 生成内容一致的 macOS arm64 与 Windows x64 `.ecplugin`，以及对应的 `catalog-<platform>.json`。本仓库不会自动发布 Release，也不会修改市场目录。

## 宿主契约

插件目标 API 为 `^1.10.0`，直接使用宿主内部桥：

```text
firstParty.diagnostics.status -> status
firstParty.diagnostics.recent({ cursor?, limit? }) -> { entries, snapshot }
window.commercePlugin.onDebugLog(batch) -> { entries, nextCursor }
```

日志条目沿用 `time / scope / source / level / message` 字段，可选 `line / url`，并带有单调递增的 `seq`。

## 许可

MIT
