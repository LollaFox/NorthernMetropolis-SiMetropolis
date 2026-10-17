# 读取与备份已保存的城市历史

请在项目根目录运行命令和 Python 示例。城市历史属于运行数据，与源码发布包及 Git 提交分开保存。

## 找到数据目录

服务器通过 `--data-dir` 指定历史目录，默认值是后端源码旁的 `backend/.data`。现有本地在线运行使用 **`backend/.data/live_regional_storage`**；该目录及其中的在线运行历史**不包含在发布包中**。

```text
DATA_DIR/
  catalog.json
  simulations/
    sim_<id>/
      2025-01-01.json.gz
      2025-02-01.json.gz
      ...
      shared-objects.json.gz
```

`catalog.json` 的 `simulations` 按运行 ID 记录已保存的 `months`、输出 `snapshots`、初始化 ID 和提供商调用指标。`jobs` 记录执行状态与进度；`initializations` 保存设置、确认审阅内容及选定的场景。每个月的逻辑状态包含建筑、居民群体、企业、指标、历史记录，以及该月完整的审计记录。

## 正确读取一个月

新月度文件使用 gzip 压缩与共享引用。单独解压一个文件得到的是存储封装，并非完整世界状态。请保留同目录中的 `shared-objects.json.gz`，并使用项目提供的读取函数；它同时兼容旧版普通 `.json` 和完整 gzip JSON 文件。

```python
from pathlib import Path
from backend.storage import monthly_state_path, read_json

data_dir = Path("backend/.data/live_regional_storage")  # 或实际的 --data-dir。
catalog = read_json(data_dir / "catalog.json")
for simulation_id, run in catalog["simulations"].items():
    print(simulation_id, run["months"])

simulation_id = "sim_REPLACE_WITH_AN_ID_PRINTED_ABOVE"
day = catalog["simulations"][simulation_id]["months"][0]
folder = data_dir / "simulations" / simulation_id
world = read_json(monthly_state_path(folder, day))
print(world["month"], world["metrics"])
```

将占位 ID 替换为上面输出的实际 ID，并选择至少保存了一个月的运行。读取函数会还原共享引用并校验哈希；文件缺失或损坏时抛出 `StorageError`，不会修改原文件。不要手动编辑存储封装或共享池。

## 通过正在运行的服务器读取

请使用服务器的实际端口；默认端口为 `8877`，现有本地在线服务器使用 `8878`。

| GET 路由 | 返回内容 |
| --- | --- |
| `/api/v3/simulations/{simulationId}/export` | 普通 JSON，包含 `setup`、`review`、`run`、`scale`、完整的 `monthlyStates` 和派生的 `monthlyBuildingTotals`。 |
| `/api/v3/simulations/{simulationId}/snapshots/{frameId}` | 一个展示快照：平坦示意地形、已竣工对象区域和指标，并非完整的原始世界状态。 |
| `/api/v3/jobs/{jobId}` | 已保存的任务状态、进度和提供商调用指标。 |
| `/api/export` | 总览当前选中运行的完整导出；查找指定运行时，优先使用带 simulation ID 的路由。 |

从 `export.run.snapshots` 取得 `frameId`，不要假设每个已保存的内部月份都有输出帧。即使选择季度或年度输出，系统内部仍逐月结算并保存。逐对象汇总会区分规划与已竣工的居民容量、实际居民数、岗位供给、已填补岗位和空缺岗位。

读取文件或上述 GET 路由**不会**触发 AI 调用，也不会推进模拟。新建模拟或明确重试可恢复的模拟 POST 可能调用 AI，因此不能将该 POST 当作历史查询。

## CLI 历史与备份

CLI 默认写入 `backend/.data/cli/<new-id>/`，也可通过 `--output` 指定一个新目录。月度文件和共享池位于 `states/`。运行根目录还包含 `scenario.json`、`initial.json`、`calls.json`、`metrics.json`、`status.json`、`summary.json`、`building-totals.json.gz` 及普通 `audit.jsonl`。JSONL 是兼容用的额外审计副本，同样的信息已包含在月度状态中。

为取得一致的备份，请先停止服务器及所有正在写入的 CLI。复制**整个选定的数据目录**，包括 `catalog.json`、全部模拟目录及每个共享池；CLI 则复制整个运行目录。月度文件与共享池不可分离，只复制月份 `.json.gz` 文件会丢失引用的数据。备份应与发布包分开保存。Git 源码检查点不包含运行历史备份。

恢复时放回完整副本，并让对应版本的后端通过 `--data-dir` 指向该目录。打开已有历史且不希望新增启动离线演示时，使用 `--no-demo`。格式详情见 [STORAGE.md](../STORAGE.md)。
