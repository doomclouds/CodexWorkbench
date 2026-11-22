# 第 4 阶段性能、容量与数据保全

以架构白板 rev59 的 E‑01、E‑02、E‑03 和 F‑03 为准。目录中的脚本使用候选运行包和独立 TEMP 数据根。运行报告、合成数据库和设备轨迹进入 TEMP 或 `artifacts/luming-studio/`。

## 验证入口

从仓库根目录运行。先将通过第 3 阶段全量检查的运行包冻结，再对该目录的三个发布文件提取 SHA‑256 和长度。记录构建对应的源码版本及台账。以下变量使用绝对路径。

旧容量边界和同库回退探针使用支持 SQLite v1 的冻结 `0.3.0` 包。归档往返与 v2 保存对照探针接受 `0.3.x` 补丁包，并按输入指纹核实实际运行文件。

```powershell
node plugins/luming-studio/benchmarks/runtime-fingerprint.mjs $replayRuntime |
  Set-Content -Encoding utf8 -LiteralPath $frozenInventory
node plugins/luming-studio/benchmarks/probe-packaged-boundaries.mjs $replayRuntime $frozenInventory
node plugins/luming-studio/benchmarks/probe-packaged-rollback.mjs $replayRuntime $frozenInventory $trustedOldFixtureReport
node plugins/luming-studio/benchmarks/probe-full-archive.mjs $replayRuntime $frozenInventory near

node plugins/luming-studio/benchmarks/build-expanded-candidate.mjs --verify-source
$expandedBuild = node plugins/luming-studio/benchmarks/build-expanded-candidate.mjs
if ($LASTEXITCODE -ne 0) { throw 'Expanded candidate build failed' }
$expanded = ($expandedBuild -join [char]10) | ConvertFrom-Json
node plugins/luming-studio/benchmarks/probe-full-archive.mjs $expanded.runtime.directory $expanded.fingerprint expanded
```

扩容档完成写入和导出后，可以用首次报告中的原始 ZIP 和源作品复验导入。最后一个参数为复验的导入观测上限，单位是毫秒。报告保留首轮失败及复验的实际耗时。

```powershell
node plugins/luming-studio/benchmarks/probe-full-archive.mjs $expanded.runtime.directory $expanded.fingerprint expanded $expandedArchiveWitness 300000
node plugins/luming-studio/benchmarks/probe-heavy-rollback.mjs $replayRuntime $frozenInventory $trustedOldFixtureReport $nearArchiveWitness
node plugins/luming-studio/benchmarks/probe-heavy-rollback.mjs $expanded.runtime.directory $expanded.fingerprint $trustedOldFixtureReport $expandedArchiveWitness
```

- `runtime-fingerprint.mjs` 固定 `server.mjs`、`app.html` 与 `resvg.wasm`。探针在试验前后核对指纹，并以明确的 `--data-root` 启动独立进程。
- `capacity-fixtures.mjs` 重用既有同源合成形状，混合文字、HTML、文档、清单、图片引用和有效小素材。历史条目共享内容摘要。正式多端测试固定同源样本的副本、富内容、素材和可见密度，分别测常用视口和整板视图。
- `probe-packaged-boundaries.mjs` 验证冻结运行包的真实入口。先读近档板，复核第 2,001 个对象和跨 8 MiB 的拒绝结果。确认原版次后保存一次普通修改，使同一重型夹具达到 8 条等量历史，再尝试完整归档及导入。独立的 4,000／15 MiB 合成库用于测扩容读入口。这个剪枝探针可实证早期阻塞。它的报告始终保留 `releaseEligible: false` 和剩余证据清单。行为与预期不同会以退出码 2 返回，具体码及服务诊断保留在 `boundary-witness.json`。
- `probe-packaged-rollback.mjs` 使用已核对的 0.2.21 旧程序、旧素材和同库复验种子。它让候选写入，再让旧版实际读写同一副本，并以候选复读。在旧版推进同一文档并失去子代身份后，新版拒绝过期同代合并。候选 ZIP 另在候选版恢复为新 ID。它给出功能和数据格式基线。两档重型夹具的完整归档和回退结论另行记录。
- `build-expanded-candidate.mjs` 在系统临时目录复制正式构建输入，只把副本中的白板和 SQLite 容量门槛提升至 4,000 对象／16 MiB。清单记录三处替换、锁文件、构建输入和运行包指纹。
- `probe-full-archive.mjs` 在候选包内用真实产品入口分批创建混合板。近档和扩容档各产生 200 次不同的真实保存。导入新作品后逐版核对全板摘要、图片原字节、批注、冻结引用及路径。报告记录 ZIP 原始与展开字节、过程耗时和失败阶段。`small` 参数用于小档预检。
- `probe-heavy-rollback.mjs` 用归档试验中的完整源作品在另一独立数据目录验证同库回退。近档检查 2,001 对象、8 MiB 加一字节、旧版成功保存及新版复读。扩容档记录旧版本在哪个入口拒绝容量，并核对 SQLite、历史、素材和冻结引用是否仍可由新版读取。
- 保留每次 stdout、stderr、退出码、过程指纹和 TEMP 路径。探针的 HTTP 时长用于定位症状。E‑02 指标用实际界面、设备与房间事件计时。

## 两档形状

| 项目 | 近期档 | 扩容档 |
| --- | ---: | ---: |
| 规模目标 | 2,000 对象，8 MiB | 4,000 对象，16 MiB |
| 同源混合板 | 约 7.5 MiB，200 条保留历史 | 按同口径扩充，15 MiB 合成种子留出写入余量 |
| 房间负载 | 12 在线，6 活跃 | 30 在线，10 活跃 |

近期负载按 6 人各每两秒一次普通提交，并叠加同步的写入突发。两档均要记录固定素材集。发布判据对应实测过的对象、数据和负载范围。早失败探针保留相同重型板，历史数量缩减仅用于证明拒绝，联合门槛要求完整夹具。

## E‑02 阈值

| 指标 | 近期档 p95 | 扩容档 p95 |
| --- | ---: | ---: |
| 冷开板 / 预热重开 | 2.0 s / 1.0 s | 2.5 s / 1.2 s |
| 拖动、平移和缩放帧间隔 | 18 ms | 18 ms |
| 普通保存确认 | 300 ms | 350 ms |
| 远端首次预览 | 120 ms | 150 ms |
| 远端确认提交版次 | 500 ms | 650 ms |
| 增量追平 | 3 s | 3 s |
| 整板追平、漏末次通知 | 5 s | 6 s |

时延均为上限。超过 50 ms 的帧须少于 1%。实机口径是 16 GiB、SSD、60 Hz、局域网 RTT 不高于 20 ms。至少两台物理设备，真实 Codex 房主与独立 LAN 访客，记录 Windows 和 macOS 的实际组合。其余参加者用于并发负载。

- 每档每种环境 3 轮。每轮普通写入与远端计时各不少于 100 次，开板与恢复各不少于 30 次，交互不少于 1,000 帧。普通视口与全板、冷开与预热、富内容大写入的结果各自归类。汇总 p50、p95、p99、失败与超时。正常样本失败或超时按未达标保留，分位排位计为无穷时延。
- 开板从点击作品到可选中并拖动。普通保存从松手或明确保存到发起端收到确认。预览从房主首帧到同次远端绘制，远端确认从松手到远端应用同一已提交版次。断线从网络恢复计时，在线漏掉最后一条通知从权威提交计时，终点均为授权访客追平实际版次。
- 连续 30 分钟联合负载记录浏览器渲染进程和 Node 峰值。10 次开关大板后在同一预热空闲态比较留存，渲染进程增量不超过 64 MiB，Node 增量不超过 32 MiB。峰值预算由基线证据确定。
- 正确性包含丢回执、并发冲突、慢连接、授权撤销、历史缺口、在线漏末次通知。正确性失败阻断发布。记录候选指纹、主机环境、种子摘要、轮次、原始样本、超时、错误码和恢复后的权威版次。

## 归档、回退与开放判据

目前产品校验上限为 2,000 对象／8 MiB，SQLite 读取也校验 2,000 个当前单元。归档限制为 ZIP 128 MiB、展开条目累计 256 MiB、单素材 20 MiB、manifest 4,096 字节及 5,000 项。新 ZIP v3 的 `artifact-state.json` 对共用内容去重，物理大小上限为 64 MiB。旧版 ZIP v2 的 SQLite 快照继续按原 64 MiB 展开规则读取。导入发布后的在线 SQLite 使用原有 schema v1。

1. 用近档及扩容档各自同源重型夹具写入真实产品，保存 200 条历史、素材、批注与冻结引用。完整备份后导入新作品 ID，核对当前内容、历史、素材原字节、批注和冻结引用。保留失败并记录包大小、展开工作集、峰值和各类限制。
2. 在独立同库副本验证 `N → N−1 → N` 读写和再读。覆盖历史资源、批注和边界字段，并验证 2,000→2,001、8 MiB 字节边界和新写字段的旧读写资格。0.2.21 对新版子代记录的覆写通过缺证据冲突安全收束。Luming ZIP 和旧品牌 ZIP 按各自受支持的格式范围验收。
3. 遇到归档失败、数据或正确性故障、未达或未测的性能门槛、回退资格不明时，保留证据和数据。扩容批准范围以两档联合验收为准。作品超出旧版能力时，保全现库和用户最新写入，并走前向修复。保留历史，另用分段或内容复用验证归档工作集方案。

`artifacts/luming-studio/draft/stage4-acceptance/design-rev59/` 保存本轮用于验收口径的本地设计导出。已装插件和用户数据根均不属于此验收。

## 独立 Chrome 板面诊断

先准备一份冻结运行包及同批次 SHA-256 指纹，再从仓库根目录运行。脚本使用已有 Chrome 和 Playwright。最后一个参数可传已安装的 `playwright` 模块绝对路径，模块可在项目中解析时省略。报告写入新建系统临时目录，终端输出 `board-ui.json` 的绝对路径。

```powershell
node plugins/luming-studio/benchmarks/runtime-fingerprint.mjs $frozenRuntime | Set-Content -Encoding ascii $fingerprint
node plugins/luming-studio/benchmarks/probe-board-ui.mjs $frozenRuntime $fingerprint near 1 $playwrightModule
```

- `small` 为 100 对象，`near` 为 2,000 对象。两档沿用容量夹具的混合元素，在临时服务里走公开创建入口，测试对象留出固定拖动空间，图片使用合成内嵌 PNG。报告分别记录原种子与服务实际元素的摘要。这里的白板起始于新建版次，200 条历史、素材存储和多人负载由容量与实机验收另行覆盖。
- 每轮用新的 Chromium context 打开作品库，再用相同 context 返回作品库并重新打开。开板时延以页面收到点击为起点，以选中对象拖动期间首帧观察到对象实际移动为终点。还记录按下指针至首帧移动的时延、松手后的保存版次和服务端持久位置。
- 拖动、按住鼠标中键平移和 Ctrl+滚轮缩放走实际浏览器输入，记录动作窗口的 `requestAnimationFrame` 时间戳、超过 50 ms 的帧数及最近秩 p50/p95/p99。失败与超时各贡献一个无穷值，报告用字符串 `"Infinity"` 序列化，原始尝试包含错误码、描述和已取得的帧。退出码非零表示至少一次尝试失败。
- 指纹在启动前及退出后检查，数据根与浏览器 context 都是独立的。诊断使用同一台机器上的无头 Chrome 和 loopback 服务，常用视口 `1440 × 960`。全板视角、真实 Codex 宿主、物理 LAN、显示器刷新特性、30 分钟资源留存以及上方 E‑02 验收门槛均需独立验证。
