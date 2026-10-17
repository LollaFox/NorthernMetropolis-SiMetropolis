# 前端交接 — v0.1.0

以实际 [v3-api.js](../../../frontend/sandbox/web/v3-api.js)、[v3-contract.js](../../../frontend/sandbox/web/v3-contract.js) 和[后端路由](../../server.py)为准，不以原提案为准。本版本没有修改前端代码。[English](FRONTEND_HANDOFF_EN.md)。

## API 对接情况

前端已建立的六个 V3 接口全部实现，协议版本为 `nm-v3-draft-1`。

| 前端已有 API | 请求 → 后端返回 |
| --- | --- |
| `GET /api/v3/config` | `schema`、`backendConfigured`、`transport`、`tileURL`、`synthetic` |
| `POST /api/v3/initializations` | Multipart：`metadata` JSON + `plan` PDF → `initializationId`、`reviewVersion`、`items` |
| `POST /api/v3/initializations/{id}/confirm` | 严格 `{reviewVersion}` → `{confirmed:true,reviewVersion}` |
| `POST /api/v3/simulations` | 严格 `{initializationId,reviewVersion}` → HTTP 202 `{jobId,status}` |
| `GET /api/v3/jobs/{id}` | 持久化任务状态、进度、`providerMetrics`；完成后 `result` 包含模拟及快照 ID |
| `GET /api/v3/simulations/{sid}/snapshots/{frame}` | 原有栅格/矢量快照协议；使用后端返回的 frame ID |

每个 POST 操作须有独立的 `Idempotency-Key`（1–100 个字母、数字、下划线或连字符）。重试同一操作时保持请求和 key 不变；同 key 改请求返回 409。可恢复失败通过原模拟 POST 和原 key 继续；已完成操作重放不会再调用模型。设置沿用现有边界、日期和步长协议，起始日期须早于当天。PDF 验证文件签名，最大 20 MB，只保存摘要，不解读正文；建设计划由已配置的政府 JSON 决定。

**前端需要新增接入：** `GET /api/v3/simulations/{sid}/export`。返回 `schemaVersion, run, setup, review, scale, monthlyStates, monthlyBuildingTotals`。每月统计为 `{date,buildings:[...]}`，每个对象含 `id,type,x,y,housingCapacity,plannedHousingCapacity,actualResidents,offeredJobs,filledJobs,vacancies`。使用 `id` 关联对象；没有独立的逐楼统计接口。完整导出较大，应按已完成模拟缓存，不要反复轮询。

| 旧前端接口 | 后端实际支持 |
| --- | --- |
| `GET /api/state`、`/api/model`、`/api/export`、`/api/health` | 支持；state 是存档城市的示意投影 |
| `POST /api/control`：`playing` / `speed` | 只播放存档；速度 0.5、1、2、4、8，不执行 AI |
| `POST /api/seek`：`{month}` | 使用 `/api/state.timeline[i].month` 的实际值，不是数组下标 |
| `POST /api/switch`：`{id}` | 切换至已有模拟的最新存档月 |
| `POST /api/mode`：`{mode:"rules"}` | 接受，但不改变引擎 |
| `/api/mode` 的 live 模式；POST `/api/branch`、`/api/intervention`、`/api/reset` | **不支持，返回 HTTP 409** |

暂无 HTTP 政府脚本编辑、任务取消/暂停、PDF 政策解读、交通/污染/电力预测，以及 V3 楼宇三维网格数据通道。`backendConfigured` 不代表在线模型可用；即使回放 DeepSeek 存档，`/api/state` 仍显示 rules。模型结果应读取 V3 任务/结果中的 `providerMetrics`；任务完成不等于每次 AI 调用都成功。

未知 V3 路由及未知 GET `/api/*` 路由返回 404；不支持的旧版 POST 操作返回 409。

## 前端需要改什么

1. **明确 Team API 与存档回放入口，禁用不支持的操作。** 涉及 [analysis-compact.js](../../../frontend/sandbox/web/analysis-compact.js)、[app.js](../../../frontend/sandbox/web/app.js)、[index.html](../../../frontend/sandbox/web/index.html)、[port-study.css](../../../frontend/sandbox/web/port-study.css)。现有政策/演示面板容易让用户误以为它们控制当前后端。
2. **保存并恢复任务。** [v3-api.js](../../../frontend/sandbox/web/v3-api.js)：刷新后仍保留设置、操作 key、初始化/审阅/任务/模拟 ID；延长 120 次轮询限制（完整在线基线耗时约 355 秒），显示逐月进度及失败情况。“停止等待”不能写成取消后端任务。
3. **修正单位。** 区域对象是开发组团；住宅容量是可容纳人数，不是住宅套数。区分实际居民、容量、提供岗位、已填岗位、空缺岗位。总览 jobs 表示提供岗位，快照 zone jobs 表示已填岗位；使用该次导出的 `scale`。
4. **接入完整导出及对象详情。** [analysis-compact.js](../../../frontend/sandbox/web/analysis-compact.js) 现在导出的是前端摘要，应改接新 export，显示逐对象统计，并从 `monthlyStates` 读取规划/在建/完工阶段。快照不显示未完工对象；不要从 zone 展示名称解析持久 ID。
5. **未建模指标显示“暂无数据”。** [app.js](../../../frontend/sandbox/web/app.js) 的零值兜底可能把未建模的气候、财务、电力指标显示成真实 0。[v3-map.js](../../../frontend/sandbox/web/v3-map.js) 应保留网格坐标及排除用地语义，并说明位置只是示意。

## 政府建设脚本在哪里

**复制并修改 [backend/examples/northern-metropolis-scenario.json](../../examples/northern-metropolis-scenario.json)。** 新例子放在 `backend/examples/<name>.json`；同目录已有 default、parks-first 示例。单条建设记录：

```json
{"id":"R001","type":"residential","x":1,"y":0,"startMonth":1,"completionMonth":2}
```

类型支持 `residential`、`business`、`park`、`station`；ID 和格子不能重复。第 1 月是请求的起始日期，新例子应明确填写开工月与完工月。可新增“交通先行”“商业先行”“住宅放缓”等对比方案。

```sh
python3 -B -m backend.cli --scenario backend/examples/<name>.json --start 2025-01-01 --end 2026-09-01
python3 -B -m backend.server --port 8878 --scenario backend/examples/<name>.json --data-dir backend/.data/<name>
```

运行前替换 `<name>`。`--scenario` 与 `--preset` 二选一；可选住宅节奏参数会覆盖住宅日期。加载入口：[cli.py](../../cli.py) 的 `configured_scenario`；生成、校验、节奏设置：[scenario.py](../../scenario.py)；实际执行：[engine.py](../../engine.py) 的 `_construct` / `advance_month`。更换脚本后重启并新建初始化，旧模拟保留原脚本。AI 不编写政府建设计划。拆迁、税收、补贴、卖地需要扩展引擎，不能只增加 JSON 字段。

历史数据读取见独立的[城市存档指南](CITY_HISTORY_ZH.md)。密钥放置方法见根目录 [README](../../../README.md)。
