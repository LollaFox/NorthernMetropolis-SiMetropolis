# v0.1.0 — First internal backend release / 首个内部后端版本

2026-10-16. Local source release; original frontend unchanged. The ZIP includes source, tests, examples, documentation and existing license notices. Credentials, runtime city saves and `.git` are excluded. The adjacent `RELEASE_MANIFEST.json` records the exact commit and ZIP checksum; `SHA256SUMS.txt` checks the ZIP and manifest.

本次为本地源码交付，前端代码未修改。包含源码、测试、示例、文档及原有许可声明；不包含密钥、运行存档或 `.git`。ZIP 旁的清单记录准确提交及校验值。

## Included / 本次内容

- Monthly engine, staged government construction, resident decisions, firms/jobs and per-object population/employment totals; existing V3 initialization, confirmation, jobs and snapshots, plus canonical export.
- Regional preset: 132 occupied/planned cells, 100 residential clusters with eventual capacity of 2.5 million resident places; five residential starts per month, completed the following month. Capacity is not forced occupancy.
- Lossless gzip/shared-record storage with legacy reading, restart and saved-run replay.
- DeepSeek Flash, optional two-key parallel requests, per-attempt context/answer/token measurements. Only exact duplicate city records are compacted; facts and narratives remain intact.

对应功能：逐月引擎及分期政府建设、居民与企业决策、逐对象人口和岗位统计；V3 接口及完整导出；132 格区域方案及 250 万居民容量；无损压缩存储及重启读取；Flash 双密钥并行与请求/回答统计。只合并完全重复的城市记录，不删减事实或叙述。

## Verification / 验证

| Check / 检查 | Result / 结果 |
| --- | --- |
| Backend + provider regression tests / 回归测试 | 74 + 60 = **134 passed**, no failures/skips |
| Latest compact-context live run / 压缩后实测 | **2 months, 18/18 successful calls**, no retry correction, fallback or rejected decisions; 20.034 s observed |
| Same-input request bytes / 同输入请求字节 | 390,062 → 291,050 B: **25.38% smaller**; 70,077 actual input tokens, 915 output tokens |
| Saved states / 存档 | Both months match HTTP export and computed totals; completed replay makes zero new calls |
| Earlier full live baseline / 较早完整实测 | Before context dedup: 21 months, 232 accepted decisions across 235 attempts; three invalid drafts corrected |
| Full-history compaction / 完整历史压缩验证 | Offline reconstruction of all 235 baseline attempts: HTTP bodies **55.54% smaller**, exact decoding |

The compressed-context live test covers two months, not 21. Byte reduction is not a measured causal token/cost saving. Earlier actual 21-month storage restart preserved states, totals and metrics. Full evidence: [verification](../VERIFICATION.md), [two-month measurements](../evidence/deepseek-record-dedup-two-month-20261016.md), [offline comparison](../evidence/deepseek-record-dedup-offline-20261016.md).

压缩后在线实测是两个月；21 个月压缩比较是离线复算，不能混称。字节缩减不等于已验证的 token 或费用降幅。此前 21 个月存档已通过重启一致性检查。

## Integration / 接入

Read [English handoff](FRONTEND_HANDOFF_EN.md) / [中文交接](FRONTEND_HANDOFF_ZH.md), and [English history guide](CITY_HISTORY_EN.md) / [中文存档指南](CITY_HISTORY_ZH.md). The main [README](../../../README.md) explains startup. Enter the DeepSeek key in Configure.

Remaining limits: schematic geography, synthetic coefficients, PDF digest only, no HTTP government editor or intervention/branch/reset operations. Frontend polling, labels and export integration need the changes listed in the handoff. This is an internal sandbox release, not a validated forecast.

主要限制：地图为示意、参数为假设、PDF 只记录摘要；暂无 HTTP 政府脚本编辑器及干预/分支/重置功能。前端需要调整轮询、单位标签与导出接入，具体见交接文档。
