# 鹿鸣 · Luming Studio II

面向共享白板、架构图解和 Agent 协作的 CodexWorkbench 插件。插件 ID 为 `luming-studio-ii`，起始版本为 `1.0.0`。Web 包提供基础控件，插件运行入口随第一个业务闭环接入。

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

使用 `apps/web/src/ui/base/index.ts` 公开的组件、Props 和句柄。属性和事件描述可观察的状态与操作，句柄只提供声明过的交互方法。控件之间依赖对方的公开组件和类型。网络、持久化和宿主能力通过应用层接入。

每个公开控件在 `apps/web/tests/component/` 提供同名 `.test.tsx` 文件，从公开入口验收属性、事件和句柄。Lint 在 `src` 和 `tests` 检查通用规范及导入边界，禁止测试替换被测控件或跳过用例。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-web check
pnpm --filter @codexworkbench/luming-studio-ii-web test
pnpm --filter @codexworkbench/luming-studio-ii-web build
```

构建通过 Lint、类型和测试门禁后生成 ESM 与 CSS。

## 首个业务闭环

首批运行代码接入前建立源码和测试的 Lint、类型检查与构建门禁。首个闭环覆盖开板、移动对象与保存回执。前端立即预览手势，服务端校验授权与版本后提交变更，回执更新前端的确认投影。验证覆盖前端组件与 AppMock、协议往返、真实 SQLite 写入和失败恢复。

目录分工依据白板「Luming Studio 架构设计」中的「前端目录与文件归属」「后端目标目录」和 Protobuf 契约图。
