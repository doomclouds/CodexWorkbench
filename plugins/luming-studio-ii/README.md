# 鹿鸣 · Luming Studio II

面向共享白板、架构图解和 Agent 协作的 CodexWorkbench 插件。插件 ID 为 `luming-studio-ii`，起始版本为 `1.0.0`。Web 包提供基础控件和 Canvas 运行时，插件运行入口随第一个业务闭环接入。

## 项目结构

```text
luming-studio-ii/
├── plugin.json
├── package.json
├── assets/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── pages/
│   │   │   ├── surfaces/
│   │   │   ├── ui/
│   │   │   │   ├── base/
│   │   │   │   └── domain/canvas/
│   │   │   │       ├── viewport/
│   │   │   │       ├── gestures/
│   │   │   │       ├── selection/
│   │   │   │       ├── scene/
│   │   │   │       ├── rendering/
│   │   │   │       ├── adapters/
│   │   │   │       └── overlays/
│   │   │   ├── data/
│   │   │   └── platform/
│   │   └── tests/{unit,component,contracts,integration,fixtures,support}/
│   └── server/
│       ├── src/
│       │   ├── entrypoints/{http,mcp}/
│       │   ├── application/workflows/
│       │   ├── modules/whiteboard/{application,domain,ports}/
│       │   ├── infrastructure/{platform,adapters}/
│       │   └── bootstrap/
│       └── tests/{unit,contracts,integration,fixtures,support}/
└── packages/
    └── contracts/proto/luming/studio/v1/
```

## 依赖与状态归属

- Web 采用 React、TypeScript 和 Vite。页面协调跨 Surface 的用户动作，Surface 管理局部流程，数据层持有服务确认的投影。画布运行时处理手势、视口和绘制预览。
- 后端先用 Node.js 和 TypeScript。HTTP 与 MCP 入口调用同一应用用例。领域维护业务规则，消费方定义出站端口，由基础设施实现，启动层负责装配。跨上下文同步协作走公开应用服务，持久化提交后分发集成事件。
- 前后端业务协议采用 Protobuf，模式放在 `packages/contracts/proto/luming/studio/v1/`。协议版本独立于插件版本。后续 Rust 服务端沿用这一协议和同一套行为验收，Codex 宿主接入继续使用 MCP JSON-RPC。

前端的 `ui/base` 提供按钮、菜单等交互原语，组件样式随组件共置。`ui/domain` 提供多个 Surface 共用的画布和内容组件。画布将视口、手势、选区、场景、对象呈现、适配器和覆盖层分开，局部预览留在当前画布会话。`platform` 适配浏览器、Codex 及传输。

后端的 `infrastructure/platform` 提供数据库连接、事务、时钟、文件和消息等通用能力。`infrastructure/adapters` 复用这些能力，落实白板存储、归档、素材和事件发布端口。其他业务上下文随实际用例增加。

前端集成测试使用 AppMock 挂载真实应用并替换宿主和 I/O。后端集成测试使用真实服务和隔离的 SQLite 数据根。夹具存放样本数据，测试支持目录负责环境、时钟和资源清理。

## 基础控件

使用 Web 包的 `@codexworkbench/luming-studio-ii-web/ui/base` 或对应的 `apps/web/src/ui/base/index.ts` 入口。属性和事件描述可观察的状态与操作，句柄只提供声明过的交互方法。控件之间依赖对方的公开组件和类型。网络、持久化和宿主能力通过应用层接入。

每个公开控件在 `apps/web/tests/component/` 提供同名 `.test.tsx` 文件，从公开入口验收属性、事件和句柄。测试使用受同一边界约束的基础控件夹具。Lint 在 `src` 和 `tests` 检查通用规范及导入边界，禁止测试替换被测控件或跳过用例。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-web check
pnpm --filter @codexworkbench/luming-studio-ii-web test
pnpm --filter @codexworkbench/luming-studio-ii-web build
```

构建通过 Lint、类型和测试门禁后生成 ESM 与 CSS。

## Canvas 独立验收

画布从 `@codexworkbench/luming-studio-ii-web/ui/domain/canvas` 使用。调用方通过场景、属性、观察事件、编辑意图和句柄与 Canvas 交互。Canvas 专用 Lint 检查公开入口、内部模块依赖、I/O 及测试边界。

验收页支持单次放置、框选、拖动吸附、多选变形、笔迹、连接点和折点。用「确认当前」或「拒绝当前」观察几何意图与回执。用「定位对象」打开实际的文档、待办、表格、HTML、图解、图表、图片、视频、链接、便签、贴纸和形状。正文编辑走独立的版本化回执。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-web preview:canvas
```

### Canvas 对象扩展

Studio 通过 `objectExtensions` 装配内置定义。扩展按 `kind` 声明放置预设、变形与连线能力、正文交互方式，可选提供边界和命中计算。自定义类型使用 `example:badge` 形式的标识。

Canvas 管理图层、选区、手势、焦点和裁剪。对象的 `View` 接收几何投影和独立的 `payloadById` 载荷，按自身规则管理正文与编辑状态。通过 `request` 提交操作时，Canvas 附上当前对象身份，宿主按预期版本返回确认或拒绝。对象可在草稿和编辑会话期间报告保活，Canvas 在对象有在途请求时也会保留挂载。

对象注册文件只能引用 Canvas 的公开类型。Canvas 通过注册表调用对象能力。源码与组件测试都受依赖门禁约束，测试通过公开入口执行真实模块。

按终端中的本地 Vite 地址打开 `/tests/fixtures/canvas/`。验收页用基础控件提供工具切换和模拟回执，可以检查预览、确认、拒绝、迟到确认及原生输入。

## 首个业务闭环

首批运行代码接入前建立源码和测试的 Lint、类型检查与构建门禁。首个闭环覆盖开板、移动对象与保存回执。前端立即预览手势，服务端校验授权与版本后提交变更，回执更新前端的确认投影。验证覆盖前端组件与 AppMock、协议往返、真实 SQLite 写入和失败恢复。

目录分工依据白板「Luming Studio 架构设计」中的「前端目录与文件归属」「后端目标目录」和 Protobuf 契约图。
