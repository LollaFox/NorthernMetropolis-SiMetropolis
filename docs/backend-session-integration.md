# 后端 v0.1.0 长任务与会话恢复适配

日期：2026-10-16。适配文件为 `sandbox/web/v3-api.js`。本次读取后端协议和实现，没有调用网络、真实模型或浏览器。

## 控制器接入

```js
const session = new V3Session(new HttpTransport(), {
  storage: localStorage,
  storageKey: 'nm-team-api-session-v1', // 团队后端与 fixture 应使用不同的 key
  onState(snapshot) {
    // snapshot.state / snapshot.busy 用于更新入口、恢复和停止等待按钮。
    // snapshot.lastError / session.storageError 可用于状态说明。
  },
  onProgress(event) {
    // event.status: queued / running / complete / failed
    // event.completedMonths / event.totalMonths
    // event.progress.activeMonth
    // event.providerMetrics: 后端提供的调用统计摘要
  }
});
```

构造时从指定存储恢复元数据，**不自动发请求**。控制器须检查 `session.state` 和 `session.pending`，在用户选择继续后调用 `await session.resume()`。自动恢复数据与自动继续模型任务是两个动作。

`onState` 在构造自动恢复时不触发，在后续状态变化时触发；回调收到独立的可序列化对象。回调自身异常不会使后端任务失败。实际持久化异常保存在 `session.storageError`，不会中断已授权的操作。

### 新增与保留的方法

| 方法 | 行为 |
| --- | --- |
| `initialize(setup, file)` | 校验、上传和初始化；重试同一输入保留操作 key；修改输入或 PDF 字节会生成新初始化 key |
| `confirm(true)` | 确认当前 reviewVersion；未解决条目仍会阻止确认 |
| `simulate()` | 从 confirmed 启动；后端失败后再次显式调用会沿用原 key |
| `snapshot(index, signal?)` | 保留原有快照校验和请求方式 |
| `serialize()` | 导出可持久化的会话元数据对象 |
| `restoreSnapshot(snapshot)` | 校验并恢复元数据；不自动联网；busy 恢复为 false |
| `resume(file?)` | 有 jobId 时先查询原 job；可恢复失败时显式同 key 重试原 POST；无 jobId 时重试原操作 |
| `stopWaiting()` | 中止当前浏览器请求和轮询等待；保留 job、key 和恢复信息 |
| `cancel()` | 兼容原调用的 `stopWaiting()` 别名；不代表取消后端任务 |
| `reset()` | 开始新的本地会话，清除本地恢复元数据和导出缓存；原后端任务可能继续运行 |
| `exportRun({refresh=false, signal}={})` | GET 完整 canonical export；实例内存缓存；同一导出的并发请求合并；refresh 强制重新获取 |

## 状态与恢复

状态为 `draft → initializing → review → confirming → confirmed → running → ready`。

```js
if (session.pending) {
  try {
    await session.resume();
  } catch (error) {
    // 初始化提交结果未知且没有 jobId 时，提示重新选择原 PDF。
    // 接到该文件后调用 await session.resume(file)。
  }
} else if (session.state === 'ready') {
  // 直接使用 session.run 和 session.snapshot(index)，无需重新生成模拟。
}
```

`serialize()` 的 schema 为 `nm-v3-session-v1`，包含：

```text
state, busy, setup, review, run, keys, lastFingerprint,
pending, job, progress, providerMetrics, lastError, needsFile
```

`pending` 包含 `name`（initialize / confirm / simulate）、`phase`（posting / polling / failed）、`jobId` 和 `recoverable`。`job` 保留后端返回的任务信息；模拟完成后 `run` 保留 simulationId、快照目录和后端指标。

PDF 字节、FormData、AbortController、栅格快照以及完整世界导出不写入会话存储。初始化请求发出后若尚无 jobId，刷新后无法仅凭元数据重传 PDF，因此必须重新选择原文件。已获得初始化 jobId 时，可查询该 job，无须重新上传文件。异步初始化失败后重试会核对原 PDF 字节。

损坏的已有存储会被保留，系统转为内存会话；不会自动覆盖损坏数据。显式 reset 表示开始新会话，之后才恢复写入。

## 长任务、进度和失败

默认每 1 秒查询一次，最多 1,200 次（约 20 分钟，不含每次请求耗时）。可以通过 `pollLimit` 和 `pollInterval` 调整。原来每次 HTTP 请求的超时仍为 30 秒；355 秒的模拟通过快速入队和多次短轮询完成，不依赖单个连接保持 355 秒。

后端 `progress`、`completedMonths`、`totalMonths` 和 `providerMetrics` 原样保留含义。初始化的 queued 回执可能尚无总月份或指标，此时不编造零进度。最终 `run.providerMetrics` 保留完整结构；`session.providerMetrics` 和进度事件使用后端摘要供界面展示。

后端重启可能返回 `status: failed, recoverable: true`。调用 `resume()` 后先查询原 job，确认可恢复后才用原 Idempotency-Key 再次 POST `/simulations`，由后端继续原 simulation 的已保存月份。不会仅因刷新就主动继续，也不会生成新 key 来重做相同模拟。

轮询达到上限、浏览器停止等待或连接中断时，状态说明均保留“后端可能仍在运行”的含义；没有调用后端 cancel 接口。

## 完整导出

```js
const canonical = await session.exportRun();
// 包含 run / setup / review / scale / monthlyStates / monthlyBuildingTotals。
// canonical 为实例内存缓存对象，调用方应按只读数据处理。
```

结果校验 simulationId、schemaVersion、快照目录和完整状态数组。错误响应不会缓存；新会话或 reset 后清除缓存。完整导出可能很大，故不放入 localStorage，刷新后按需重新请求。

## 验证

新增 `sandbox/tests/test_backend_session.mjs`：25 项通过。包括 355 秒虚拟长任务、进度指标、review/confirmed/running/ready 刷新恢复、同 key 故障续跑、未知 POST 结果、PDF 重选、停止等待、导出缓存和并发、损坏持久化、状态校验及回调异常隔离。

原 `sandbox/tests/test_v3.mjs`：20 项通过。累计 45 项。本记录验证客户端协议与恢复逻辑，不等同于真实后端运行、真实模型生成或浏览器视觉验收。

```sh
/Users/ww/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test sandbox/tests/test_v3.mjs sandbox/tests/test_backend_session.mjs
```
