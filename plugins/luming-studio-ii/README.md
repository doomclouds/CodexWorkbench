# 鹿鸣 · Luming Studio II

面向共享白板、架构图解和 Agent 协作的 CodexWorkbench 插件。插件 ID 为 `luming-studio-ii`，起始版本为 `1.0.0`。Web 包提供基础控件、Canvas 运行时和一期白板编辑入口。

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

### 一期白板协议

`luming.studio.v1.WhiteboardService` 定义「实施计划设计」第一阶段的四个操作。消息按场景、对象正文和服务入口拆分，HTTP 路由和身份解析由接入适配器实现。

| 操作 | 数据与结果 |
| --- | --- |
| `GetBoardScene` | 返回按图层排序的对象元数据及白板访问权限。连接线的端点和折点随几何返回。 |
| `GetObjectPayloads` | 按对象 ID 批量请求。每项返回带正文版本的类型化载荷或不可用原因，其他对象的结果可独立使用。 |
| `MoveObjects` | 一条命令携带白板 ID、命令 ID、画布坐标位移和全部目标对象的预期几何版本。回执区分成功、冲突和拒绝。 |
| `GetCommandReceipt` | 按白板和命令 ID 查询当前操作者有权读取的留存回执。暂无记录时，前端继续保留结果未知状态。 |

- `board_revision` 表示白板提交进度。移动校验每个受影响对象的 `geometry_version`，正文读取和合并使用独立的 `payload_version`。版本采用带存在性的 `uint64`，映射到 Canvas 的 `number` 前要校验整数精度。
- 墨迹元数据带边界和笔宽，采样点按需读取。前端适配时以边界占位，加载采样点后将其补入 Canvas 的墨迹几何，供绘制和精确命中。自定义对象使用开放的 `kind`，扩展正文带 `schema_id` 并由注册的解析器读取。
- 服务端先校验白板访问权限，再依据操作者、白板和命令 ID 查询留存回执。相同规范化命令可复用留存回执。沿用同一 ID 的不同内容会被拒绝。
- 新移动命令校验写入权限、目标集合、锁定与版本。每个目标 ID 只出现一次。分组或父子关系改变移动范围时，推进受影响对象的几何版本。成功时在同一次事务推进几何与白板版本并写入回执。
- 移动回执只返回受影响对象的确认投影。前端按对象 ID 和几何版本合并，并保留既有图层顺序和较新的正文投影。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-contracts build
```

该命令运行 Buf 格式、Lint、编译与二进制契约测试。仓库检查和构建入口也执行协议门禁。

### 一期后端

服务端使用 Node.js、TypeScript 和 `node:sqlite`。协议包生成的 JavaScript 和声明由 HTTP 入口使用。白板应用服务通过仓储端口读取和提交，SQLite 适配器持有表结构和 SQL。

`POST /luming.studio.v1.WhiteboardService/{Method}` 接收和返回 `application/protobuf`。业务拒绝与冲突通过 `CommandReceipt` 表达。读取权限和操作者身份由服务端的接入上下文与白板成员记录确定。

SQLite 将白板、成员、场景元数据、对象正文和成功回执分别保存。几何与正文版本独立推进。正文在自己的记录中保存结构化数据。服务端按白板和对象 ID 读取，移动只更新目标几何及版次并留存成功回执。

服务端构建先运行通用代码规则、分层依赖检查、类型检查和 Lint 契约测试，再执行领域与真实 SQLite 的集成测试。源码、测试和规则文件沿用 Studio 的格式、复杂度、无注释与异步约束。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-server build
```

本机运行使用 `pnpm --filter @codexworkbench/luming-studio-ii-server start`。启动前为服务进程设置 `LUMING_STUDIO_II_DB`、`LUMING_STUDIO_II_ACTOR` 和 `LUMING_STUDIO_II_TOKEN`。请求携带 `Authorization: Bearer <token>`。可选的 `LUMING_STUDIO_II_PORT` 指定端口，缺省时选择可用端口。服务绑定 `127.0.0.1` 并在启动后输出地址。集成测试使用自己创建的临时库和种子白板。

### 一期前端

白板编辑 Surface 使用真实 Canvas、对象扩展和基础控件。开板先读场景，正文按可见对象和正文版本分批请求。拖动在 Canvas 中立即预览，松手后提交一条移动命令。成功回执更新已确认位置。出现冲突时重新读取场景。结果未知时可以查询回执或用原命令重试。对象正文在这一阶段用于查看。

Web 子项目的架构 Lint 约束层间依赖和公开入口。Protobuf 编解码由数据层负责，浏览器网络和命令 ID 由平台层提供。集成测试通过 AppMock 挂载真实应用，在传输边界注入二进制请求和响应。

本机预览时，将 `LUMING_STUDIO_II_WEB_API` 设为后端输出的环回地址，并使用与后端一致的 `LUMING_STUDIO_II_TOKEN`。运行下列命令，然后在终端显示的 URL 后加上 `?board=<白板 ID>`。Vite 在同源代理中附加认证头。

```sh
pnpm --filter @codexworkbench/luming-studio-ii-web preview:whiteboard
```

Web 构建在原有控件库输出之外提供 `apps/web/dist/app/`。部署该页面时，宿主需要在同源地址提供白板服务路由和认证。

### 工作台目录

Web 根路径进入工作台。搜索、排序和分页从 `BoardCatalogService` 读取目录摘要。新建白板通过命令 ID 获取回执，目录、空白场景、创建者权限和成功回执一起提交。打开白板后使用既有的 `WhiteboardService`，`?board=<白板 ID>` 可直接定位白板。

工作台、画布和对象的界面沿用原版 Studio 0.3.2。源码使用 Studio II 的公开能力契约，视觉验收使用同一场景、主题和视口做实屏对照。

工作台和白板通过 `apps/web/src/app/routes.ts` 登记。架构 Lint 校验页面目录和装配入口。跨页的操作通知由 `apps/web/src/app/shell/operation-notice/` 呈现。

### 导入作品

工作台的「＋」菜单接收初代 Luming Studio 当前导出的 `.studio.zip`，归档清单版本为 `4`。服务端在暂存区验证清单、白板内容和素材，随后在同一个 SQLite 事务中发布到工作台并保存导入回执。归档原件分块保留，导入后打开白板的最新内容。

`POST /luming.studio.v1.BoardArchiveService/ImportBoardArchive` 接收 `application/zip` 和 `X-Studio-Command-Id`，返回 Protobuf 回执。`GetArchiveImportReceipt` 查询当前操作者的回执。导入素材通过受白板成员权限保护的 `/studio-archive-assets/` 路径读取。本机预览的同源代理配置已包含这些路径。
