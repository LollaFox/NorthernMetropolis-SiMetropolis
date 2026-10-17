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

This prepares a saved offline demonstration. To create a new run, choose **Configure → Team API**, upload a PDF, select dates, start analysis, review and confirm. PDF text is not interpreted; the configured government JSON determines construction. Use `2025-01-01` through `2026-09-01`, monthly, for the full 21-month regional script.

启动时生成离线示例。新建模拟请选择 **Configure → Team API**，上传 PDF、设置日期、开始分析并确认审阅结果。后端不解读 PDF 正文；政府建设由 JSON 脚本决定。完整区域脚本为 21 个月，可选择上述起止日期及月步长。

## Where to put DeepSeek API keys / DeepSeek API 密钥放在哪里

Create `backend/.data/credentials/`. Save one raw key per UTF-8 text file, without quotes or JSON:

创建该文件夹，每个 UTF-8 文本文件只放一条密钥，不加引号或 JSON 包装：

| File / 文件 | Purpose / 用途 |
| --- | --- |
| `backend/.data/credentials/deepseek-1.key` | First key / 第一条密钥 |
| `backend/.data/credentials/deepseek-2.key` | Optional second key for parallel requests / 可选第二条密钥，用于并行请求 |

```sh
python3 -B -m backend.server --port 8878 --preset northern-metropolis \
  --data-dir backend/.data/live_regional_storage \
  --provider deepseek --model deepseek-flash \
  --api-key-file backend/.data/credentials/deepseek-1.key \
  --api-key-file backend/.data/credentials/deepseek-2.key \
  --timeout 180 --retries 2 --no-demo
```

With only one key, remove the second `--api-key-file` line. Both keys use the same Flash model and simulation; there is no total live-call cap. `--no-demo` skips startup simulation; a new live run starts through the confirmed Team API workflow. Keep one server per data directory. Keys stay in backend files, never frontend JavaScript. `backend/.data/` is ignored by Git, and this release contains no keys or saved runtime data.

只有一条密钥时，删除第二个 `--api-key-file` 参数。两条密钥服务于同一个 Flash 模型和同一次模拟，不设总调用次数上限。`--no-demo` 跳过启动示例，确认 Team API 流程后才发起新模拟。每个数据目录只运行一个服务。密钥只放后端文件，不放前端 JavaScript；`backend/.data/` 不纳入 Git，发布包不包含密钥或实际运行存档。

## Government examples and original handoff / 政府示例及原始交接

Edit a copy of [the regional government script](backend/examples/northern-metropolis-scenario.json); see the frontend handoff for the exact loader and execution files. Historical city data has its own separate guides linked above.

请复制上述区域政府脚本再编辑；加载与执行代码位置见前端交接文档。历史城市数据读取方法见上方独立指南。

The root `00_*`, `01_*`, `02_*`, `发给后端同学.txt` and `MANIFEST.json` belong to the original frontend handoff. They are historical references; use this release's handoff for the implemented backend contract. `RELEASE_MANIFEST.json` beside the release ZIP identifies the new package. Internal collaborator distribution only; existing licensing and Three.js notices are preserved, with no relicensing or public publication.

根目录原有交接说明及 `MANIFEST.json` 是旧前端交接资料；当前后端接口以本版本交接文档为准。ZIP 旁的 `RELEASE_MANIFEST.json` 描述本次发布包。本版本用于内部协作，保留原有许可和 Three.js 声明，不变更许可、不公开发布。
