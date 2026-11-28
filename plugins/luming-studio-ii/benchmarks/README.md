# 白板性能基准

2,000 对象整板概览的三版对照复用首轮 V2 原始数据。先在同一台机器上复跑初代和当前版本，再生成 HTML。报告逐项比较 p95，显示相对当次 V1 的 30% 耗时下降目标、20 Hz 帧预算和两版原始结果。

```powershell
pnpm --filter @codexworkbench/luming-studio-ii benchmark --profile near --view overview --initial-root ../luming-studio
node plugins/luming-studio-ii/benchmarks/comparison-report.mjs $baselineResults $currentResults $reportDirectory
```

从仓库根目录运行。前提是已有插件运行包和 Chrome。默认测 Studio II，提供初代包目录即同时测两版。初代包也可以在插件目录之外。

```powershell
pnpm --filter @codexworkbench/luming-studio-ii check:benchmarks
pnpm --filter @codexworkbench/luming-studio-ii benchmark --smoke --initial-root ../luming-studio
pnpm --filter @codexworkbench/luming-studio-ii benchmark --initial-root ../luming-studio
```

`--initial-root` 的相对路径以 Studio II 插件目录为基准。正式运行默认每组 2 次预热和 30 次计时。可用 `--rounds` 和 `--warmups` 修改轮数，用 `--profile small` 或 `--profile near` 限定对象规模，用 `--view normal`、`--view overview` 或 `--view retained` 限定场景。功能 E2E 和性能基准各有独立入口，日常 `pnpm check` 只执行基准的 Lint、格式和自测。

## 负载与口径

- 100 和 2,000 对象混合板复用同一份合成 ZIP。每版导入后对账对象位置、种类、各类代表正文和图片原字节。运行包指纹在开始与结束时核对，业务服务和数据目录每组隔离。
- 开板以工作台的真实点击为起点，记录首个进入可见区域的对象和指定目标可命中的帧。冷开在新浏览器上下文，热开在同一上下文返回工作台后重开。两者共用已启动的服务。
- 拖动、中键平移和 Ctrl 滚轮在两组真实视角采样。普通组使用 100% 缩放并居中。概览组通过「适应白板」进入。每组记录实际缩放、输入到可见变化和 `requestAnimationFrame` 帧间隔。按 20 Hz 的 50 ms 帧预算查看慢帧占比。
- 浏览器保存从松手开始，分别记录网络响应结束和界面「已保存」。各轮从同一目标坐标启动，坐标复位、持久化回读和截图在计时外执行。
- 200 版历史组导入同一块 100 对象白板，通过真实保存补足历史，然后按顺序测移动对象、改字和新增形状，分别计时到公开 HTTP 响应完整解码。提交版次、内容和历史连续性通过公开接口回读。

结果写入 `artifacts/luming-studio-ii/<版本>/benchmarks/<运行目录>/`。`report.html` 可离线打开，`results.json` 保存每轮测量、失败和环境信息。时延分位采用最近秩，失败和超时按无穷值排列。帧分位使用有效帧，动作失败数单独记录。比较性能时使用同一设备、运行包和参数，保留首次失败及复测记录。
