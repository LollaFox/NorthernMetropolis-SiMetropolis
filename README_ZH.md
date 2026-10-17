# Northern Metropolis · 前后端产品整合版

本目录是独立可运行版本：使用 `D:/Metropolis/Front/northern-metropolis-white-model` 的新版前端，合入之前的双情景、财政居民模型及政府大模型能力。源目录保持原样，无需在两个项目间切换。

## 启动

Windows 双击 `start-product.cmd`。该启动器会查找 Python 3.9 或更新版本，无需加入 PATH。如果没有安装，第一次启动会把一份专用 Python 下载到 `runtime/`，不修改系统设置。

macOS 不支持双击启动。在终端中进入本目录后执行：

```sh
python3 -B start_product.py
```

服务器就绪后会自动打开 http://127.0.0.1:8898/ ，页面打开时会直接弹出 Configure。每次重新启动服务器，当前城市都是空的，需要先完成 Configure 再运行。已保存的城市仍可在 Analysis history 中打开。关闭终端停止服务；不要同时启动两个使用同一数据目录的进程。

本沙盒不能离线运行。在 Configure 中选择政府脚本并填写 DeepSeek API key。密钥只发给本机服务器，用于建筑叙事，不保存在浏览器。政府决策 AI 和 PDF 上传已停用。

## 网页操作

1. 点击 Configure，或在第一次运行前点击 Configure analysis。两者打开同一设置。
2. 选择政府脚本：Default City、Function Zones，或 Mixed Zones。
3. 选择模拟年数，1 至 5 年。五年脚本中未选中的后续年份不会运行。
4. 在页面中填写 DeepSeek API key。没有密钥不能开始运行。启动器不读取密钥文件。
5. 保存设置，然后 Start analysis。查看假设并确认运行。
6. 底部按月查看人口、岗位和建设进度。每个脚本都会为每栋已完成建筑向 DeepSeek 请求一段叙事。政府开工时间仍按固定计划。
7. Analysis history 打开已保存结果。刷新后如需继续未完成任务，要重新填写密钥。Stop waiting 不会取消后端任务。

DeepSeek 密钥用于逐栋建筑叙事，不用于决定政府何时开工。政府决策模式已停用。

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
