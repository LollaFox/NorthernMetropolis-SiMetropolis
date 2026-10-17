# v0.1.0 canonical export：结果接入说明

日期：2026-10-16。实现位于 `sandbox/web/backend-results.js`，只读后端导出的保存状态，不修改模型、服务或历史数据。

## 输入来自实际后端

后端 `NarrativeService.export(simulation_id)` 返回：

```text
schemaVersion: 1
run: { simulationId, snapshots, provenance, limitations, providerMetrics }
setup, review, scale
monthlyStates: [ { month, config, buildings, groups, firms, metrics, ... } ]
monthlyBuildingTotals: [ { date, buildings: [
  { id, type, x, y, housingCapacity, plannedHousingCapacity,
    actualResidents, offeredJobs, filledJobs, vacancies }
] } ]
```

快照输出可以按季度或年度稀疏采样，`monthlyStates` 仍包含内部逐月结算。界面的精确时间序列应使用保存状态的 ISO 日期，不能用快照序号替代月份。

## 模块 API

四个方法均接受原始导出。后三个方法也接受 `normalizeBackendExport` 返回的对象，避免重复校验、聚合和建索引。

```javascript
const normalized = normalizeBackendExport(exported);
normalized.dates; // 递增 ISO 日期数组
normalized.byDate.get('2026-08-01');
// { sourceDate, date, state, metrics, totals, stages, objectsById }
normalized.objectsByDate.get('2026-08-01').get('R1');
// 保留 canonical object id/type/x/y/status，合并该日同 id 的六项 totals

const charts = buildBackendCharts(normalized, '2026-08-01');
const interpretation = buildBackendInterpretation(normalized, '2026-08-01');

renderBackendResults(container, normalized, '2026-08-01', {
  selectedObjectId: 'R1',
  onDate(date) { /* ISO 日期；外部控制器负责同步地图 */ },
  onObject(id, object, date) { /* persistent id，不解析 display zone name */ }
});
```

`renderBackendResults` 返回根节点。它包含当前月总量、全期共轴趋势、当前月建设阶段分布、按持久 id 的对象选择与详情，以及统一六段解读。图表复用现有 `policy-charts.js`，说明复用 `policy-readout.js`，主题图标复用 `policy-visuals.js`。

内部日期和对象选择框分别使用 `data-backend-date`、`data-backend-object`，不生成全局 id。未传 `onDate` 时，模块自行重新渲染选定月份。传入不存在的 `selectedObjectId` 会显示“该日期没有此对象”，不会静默切换到另一个对象。

## 必须保留的单位和边界

| 字段 | 展示含义 | 不应被解释为 |
| --- | --- | --- |
| `scale.unit = development_cluster` | 一个模型对象是开发组团 | 一栋真实楼宇 |
| `housingCapacity` | 已完成对象提供的 resident places | 住房套数、实际入住人数 |
| `plannedHousingCapacity` | 完整计划居民容量，包括未完成对象 | 当前可入住容量、已落实人口 |
| `actualResidents` | 当前保存状态中的模型居民人数 | 官方人口实测或单独迁入人数 |
| `offeredJobs` | 已有模型企业提供的岗位容量 | 实际就业人数、政策新增就业 |
| `filledJobs` | 数值分配后已填补岗位 | 所有岗位容量 |
| `vacancies` | 尚未填补的岗位 | 官方区域失业人数 |
| `meanSatisfaction` | 合成模型的 0–100 指数 | 实测满意率或调查结果 |

建设阶段直接读取当月 `buildings.status`：`planned`、`construction`、`complete`；显示为 Planned、Under construction、Complete。未来月份的完成状态不能进入旧月对象详情。

`scale.referenceHousingCapacity` 和 `scale.referenceJobs` 仅作为参考目标说明，不写入当前总量。缺失字段保留为 null 和 Not provided；气候、电力、学校、医疗和实际交通结果不补零。图表中人数和 resident places 共享容量对比轴时，明确说明一处 resident place 表示一人的容量，不能解释成家庭或住宅单位。

确认任务完成不代表所有模型调用成功。界面单独展示 `providerMetrics.summary` 的调用、尝试、成功次数和状态计数，并提示检查重试、回退和中断记录。`usageAvailable: false` 时不把 usage 中的零占位解释为实测零 token。OfflineProvider 的 `deterministic_fixture_not_ai` 来源保持可见。

选中的政策和 PDF 目前是请求上下文；实际建设脚本由服务配置控制。单次运行没有匹配的无政策对照，因此只展示场景演变，不声明所选政策造成了真实效果。

## 校验与索引

- 要求 schemaVersion 1 和 1–240 个保存月，校验合法日期并按日期排序。
- `monthlyStates.month` 与 `monthlyBuildingTotals.date` 一一对应；允许导出数组顺序不同。
- 当月按对象 id 连接；拒绝重复 id、缺少对应 totals、type 或 x/y 冲突，以及跨月持久 id 的类型或坐标变化。
- 验证数量非负、整数且安全；住宅当前容量不能大于完整计划容量，居民不能多于当前容量；三个岗位数均提供时要求 offered = filled + vacancies。
- 缺失数值保持 null。若某个对象的某项值缺失，该项全区聚合也保留 null。
- 输入和原始状态不被修改。`raw` 仍保留完整原导出供控制器保存和进一步检查。

## 测试结果

`sandbox/tests/test_backend_results.mjs` 包含 16 项测试，全部通过。测试通过真实后端 `NarrativeService` 使用 `OfflineProvider` 和临时存储生成短场景，不调用 HTTP 或任何在线模型：

1. 三个月结算、季度仅一个快照的 canonical 导出。
2. 开发组团尺度、resident places 与实际居民、参考目标分离。
3. offered / filled / vacancies 岗位三分。
4. 日期和对象记录乱序及显示名称变化不影响 id 匹配。
5. 重复、缺失或冲突身份被拒绝。
6. 持久 id 跨月不能偷换类型或位置。
7. 缺失字段保留 null。
8. 非法数值及矛盾岗位、居住数被拒绝。
9. 建设阶段使用当前状态。
10. 满意度 null、真实零和未建模指标的区分。
11. 旧月说明不引用未来完工状态，不声明因果效果。
12. provider 成功、任务完成和 token 可用性分别说明。
13. 对象选择回调传递正确 id、对象和真实日期。
14. 未知对象 id 不回退为别的对象。
15. normalized 输入、日期重绘和共同轴保持一致。
16. 对象叙述作为安全纯文本，缺失字段可见。

本项没有浏览器或 GPU 视觉验收，没有进行 live provider 验证。界面样式与地图和对象选择的双向联动由主控制器接入后验证。
