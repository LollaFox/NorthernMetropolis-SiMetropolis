# Northern Metropolis · 前后端产品整合版

本目录是独立可运行版本：使用 `D:/Metropolis/Front/northern-metropolis-white-model` 的新版前端，合入之前的双情景、财政居民模型及政府大模型能力。源目录保持原样，无需在两个项目间切换。

## 启动

Windows 双击 `start-product.cmd`，或执行：

```powershell
python -B start_product.py
```

打开 http://127.0.0.1:8898/ 。默认离线，不读取密钥、不调用API。关闭终端停止服务；不要同时启动两个使用同一数据目录的进程。

真实政府大模型：

```powershell
python -B start_product.py --live --model deepseek-flash --api-key-file "你的DeepSeek密钥文件完整路径"
```

也可设置 `DEEPSEEK_API_KEY` 环境变量后省略 `--api-key-file`。密钥只在后端使用，不输入网页。既有密钥文件可以直接引用，无需复制到本目录。在线服务启动后，仅在网页选择实时政府、审查确认时发起调用；浏览、历史回放和导出不发起调用。

## 网页操作

1. 点击 Configure（配置），Analysis mode 选择 Team API。
2. 选择功能分区或混合布局；两个情景各有2栋商业、2栋住宅、2个公园。每次运行独立保存。
3. 选择政府方式：Fixed schedule（固定计划）、Government test（明确标记的离线测试）、Government AI（真实API）。未启用实时后端时第三项不可选。
4. 检查日期和财政参数。默认24个月；固定计划17个月完成，AI决定开工时间，不保证在窗口内全部完成。
5. 勾选使用所选情景，点击 Use test PDF（占位附件）或上传PDF。PDF正文不解析。
6. Save settings → Review scenario → 确认假设 → 运行。
7. 底部按月查看人口、岗位和建设进度。点击 Evidence 查看政府当月决定、原因、项目预算、支出、税额和项目状态。右侧2D analysis按精确模型格网显示布局。
8. Analysis history 打开已保存结果；Export study 下载完整历史及决策。刷新后未完成任务可用 Resume analysis 恢复等待；Stop waiting 不会取消后端任务。

政府AI只决定预定项目何时开工，不能改地点、类型、数量、工期、税率或预算。居民、企业、通勤、财政与施工均使用规则。选用原始服务器情景时在本产品中按离线规则运行，不对其他角色调用大模型。

## 保存及异常

- `backend/.data/product/`：本产品的任务、历史和完整月度存档；旧项目数据不修改。
- 每月保存政府输入和输出；回放重用保存的决策，不重问模型。
- API出错、非法项目或超预算时任务失败并保留已完成月份，可按原任务恢复；没有静默规则替代。
- 进程在API已执行但尚未保存该月时被终止，恢复可能重复该次调用。界面显示请求数不等于模拟月份数。
- 成功结束表示所选月份已运行，不保证全部建设目标完成。

## 验证与边界

94项后端测试、513项前端测试通过；真实Chrome浏览器已跑通两个情景的离线政府模式：配置、审查、24个月、切月、财政和决策展示、刷新不重复创建任务。实时provider路径使用模拟HTTP响应验证，尚未执行付费在线模型联调。

原3D总览仍是示意投影，精确布局看2D分析。结果含假设，不是城市预测。没有自动并排对照统计页；通过历史选择两份独立结果并导出比较。继承前端的来源及功能说明保存在 `docs/FRONTEND_SOURCE_README.md`。

验证命令：

```powershell
python -B -m unittest discover -s backend/tests -q
$env:PYTHON="python"
node --test sandbox/tests/test_*.mjs
```

浏览器检查脚本：`tools/check_product.mjs`，依赖已有Playwright及Chrome；通过 `PLAYWRIGHT_PATH`、`PRODUCT_BASE` 和 `PRODUCT_LAYOUT` 指定模块、服务地址及情景。此脚本只做离线测试。
