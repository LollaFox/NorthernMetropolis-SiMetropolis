# Northern Metropolis backend / 北部都会区后端

**v0.1.0 · First internal release / 首个内部版本 · 2026-10-16**

Working simulation backend with the original frontend bundled unchanged. Python 3.9+; standard library only, no dependency installation required. Regional objects are synthetic development clusters, not individual physical towers or a validated forecast.

可运行的模拟后端，附带未修改的原前端。使用 Python 3.9 及以上版本，无需安装第三方依赖。区域对象代表示意性开发组团，并非真实单栋楼宇；结果用于沙盒演示。

- [Release notes / 版本说明](backend/docs/releases/RELEASE_NOTES.md)
- Frontend handoff / 前端交接：[English](backend/docs/releases/FRONTEND_HANDOFF_EN.md) · [中文](backend/docs/releases/FRONTEND_HANDOFF_ZH.md)
- Historical city data / 历史城市数据：[English](backend/docs/releases/CITY_HISTORY_EN.md) · [中文](backend/docs/releases/CITY_HISTORY_ZH.md)
- [Detailed backend guide / 后端详细说明](backend/README.md)

## Offline quick start / 离线启动

Run from this extracted folder; open <http://127.0.0.1:8878/>. Stop an existing server before reusing its port.

在解压后的项目根目录执行，浏览器打开上述地址。如端口已被占用，请先停止原服务。

```sh
python3 -B -m backend.server --port 8878 --preset northern-metropolis
```

This prepares a saved offline demonstration. For a new product run, open Configure, choose Default City, Function Zones, or Mixed Zones, choose 1 to 5 years, enter a DeepSeek API key, then review and confirm. PDF upload is disabled.

启动时生成离线示例。新建产品运行时，打开 Configure，选择 Default City、Function Zones 或 Mixed Zones，选择 1 至 5 年，填写 DeepSeek API key，然后审阅并确认。PDF 上传已停用。

## DeepSeek API key / DeepSeek API 密钥

The current product does not read `api_key` or `backend/.data/credentials`. Enter the key in Configure. It stays in memory for that run and is not saved in the browser.

当前产品不读取 `api_key` 或 `backend/.data/credentials`。在 Configure 中填写密钥。密钥只留在该次运行的内存中，不保存在浏览器。

## Government examples and original handoff / 政府示例及原始交接

Edit a copy of [the regional government script](backend/examples/northern-metropolis-scenario.json); see the frontend handoff for the exact loader and execution files. Historical city data has its own separate guides linked above.

请复制上述区域政府脚本再编辑；加载与执行代码位置见前端交接文档。历史城市数据读取方法见上方独立指南。

The root `00_*`, `01_*`, `02_*`, `发给后端同学.txt` and `MANIFEST.json` belong to the original frontend handoff. They are historical references; use this release's handoff for the implemented backend contract. `RELEASE_MANIFEST.json` beside the release ZIP identifies the new package. Internal collaborator distribution only; existing licensing and Three.js notices are preserved, with no relicensing or public publication.

根目录原有交接说明及 `MANIFEST.json` 是旧前端交接资料；当前后端接口以本版本交接文档为准。ZIP 旁的 `RELEASE_MANIFEST.json` 描述本次发布包。本版本用于内部协作，保留原有许可和 Three.js 声明，不变更许可、不公开发布。
