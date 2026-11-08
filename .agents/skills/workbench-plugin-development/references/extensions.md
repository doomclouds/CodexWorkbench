# 界面形式与扩展点选型

本表用于选择方案和限定范围，不是要求所有插件接入全部能力。官方文档支持与当前桌面版本实测通过分别记录。

## 两种界面形式

| 形式 | 推荐用途 | 接入边界 |
| --- | --- | --- |
| MCP App／Widget | 宿主中的工具界面、结果卡片和对话协作 | 通过 MCP Apps 与 OpenAI Extensions 使用宿主能力 |
| 内置浏览器 Web | 完整 Web 应用、复杂编辑器、已有网页功能 | 通过普通 Web 接口及可用的 WebMCP／Annotation 能力协作 |

纯工具、资源或 Skills-only 插件可以没有界面。多个界面入口共享业务逻辑，宿主接入与页面启动可以分别实现。系统浏览器独立使用不是当前必需验收项；不要为了支持它提前扩展任务范围。

分清三个维度：

- **入口**：Global、Thread、File。
- **显示方式**：inline、fullscreen；按当前宿主公布的能力选择。
- **MCP 传输**：stdio、Streamable HTTP。

普通 Web 页面的 HTTP 服务不等于 Streamable HTTP MCP 服务。MCP App 也不因为使用 stdio 就必须另开 HTTP 页面服务；按资源交付需要决定。

## MCP 与 OpenAI 扩展目录

| 能力 | 何时推荐 | 边界与实现提示 |
| --- | --- | --- |
| MCP Tools／Resources | Agent 读取或修改业务数据 | 核心操作可脱离页面使用；参数和结果具有明确契约 |
| Global／Sidebar Apps | 完整工具、资源管理和长期工作区 | 入口位于全局导航；不能据此假定它是跨所有对话的单一实例 |
| Thread／Conversation Panels | 配合当前对话的阅读、编辑、分析 | 每个对话有自己的界面实例，明确选择内容与上下文的归属 |
| File Viewers & Editors | 打开指定类型文件时提供专用体验 | 明确扩展名、读取／编辑／保存能力；使用宿主资源访问机制 |
| MCP Apps／Display Modes | 交互结果、卡片、图表、完整应用 | 短交互可 inline；持续操作按入口与可用空间选择 fullscreen |
| Composer Mentions | 搜索并引用插件中的文件或对象 | 使用稳定资源标识和摘要，引用后仍检查访问范围 |
| Plugin Settings | 偏好、连接和功能配置 | 按官方支持的结构化设置实现，复杂业务操作留在应用中 |
| Extended Forms | 在工具工作流中收集参数或选项 | 适合短步骤；字段类型与连接协议要求按实际 SDK 核实 |
| Extended Model Context | 给模型提供用户选择或当前视图信息 | 区分显式选择与背景状态；控制大小和敏感内容范围 |
| Extended Message Sending | 将应用内容填入草稿或发送到对话 | 明确目标与发送行为；不能把填入草稿误写成立即发送 |
| Deep Links | 打开插件内页面或业务对象 | 用于定位与导航；修改仍经对应业务操作执行 |
| Plugin Onboarding | 首次设置和使用引导 | 与安装、升级、后台初始化及数据迁移分别设计 |
| Lifecycle Hooks | 确实需要宿主生命周期事件的集成 | 按手动桌面安装、信任与分发限制单独评估，不作为普通插件的默认依赖 |

官方入口文档中的 Global、Thread 是推荐的主要入口。File 是按需提供的文件处理扩展；不要仅为了统一模板注册文件处理器。

MCP App 中按宿主能力通过资源接口或后端工具读取文件，不假定 iframe 可直接访问本机任意路径。复杂或大型文件处理放在后端；字节传输方式、体积和性能在真实宿主中验证。

## 内置浏览器扩展

### WebMCP／Site Tools

当用户与 Agent 要共同操作当前实时页面时使用，例如筛选表格、编辑画布、操作页面中的对象。

- 页面主动注册工具，复用应用现有业务逻辑和访问控制。
- 工具属于提供它的页面和来源；关闭或导航离开页面后可能不可用。
- 需要离开页面后仍可调用的能力放在 MCP Server 或后台服务。
- 不把浏览器中的 WebMCP 工具视为已注册的常驻 MCP Server。
- 检查浏览器、模型、页面安全上下文和策略是否支持；不支持时保留正常人工操作。

### Browser Annotation API

当用户需要选择文字、卡片或画布对象，并把评论、对象信息或控件选择带进对话时使用。

- 根据产品对象定义选择目标，提供足够定位的稳定标识与少量元数据。
- Annotation 用于用户选择和反馈；实际修改由相应业务接口完成。
- 官方 API 针对安全的顶层页面，例如 HTTPS 或 localhost；不要假定任意 iframe 都有相同能力。
- 检查方法是否存在，再增强交互。没有 API 时，阅读、编辑等普通页面操作仍可使用。

WebMCP、Annotation 与 MCP App API 分别适配。网页在 Codex 内置浏览器打开，并不自动得到 MCP App 的消息发送或上下文 API。

## 选型顺序

| 当前需要 | 首选候选 |
| --- | --- |
| 无界面读取数据、执行操作 | MCP 工具／资源 |
| 一次性结果、短暂交互 | inline MCP App |
| 围绕当前对话持续操作 | Thread 面板 |
| 完整、长期使用的工作区 | Global 入口 |
| 复杂网页功能或现有 Web 应用 | 内置浏览器 Web |
| Agent 操作当前页面状态 | WebMCP |
| 人选择页面局部对象并附带反馈 | Annotation |
| 搜索并引用已有对象 | Composer Mentions |
| 自定义指定文件类型的打开体验 | File 入口 |

根据工作流组合，避免同一用途重复设置多个入口。不要默认使用生命周期 Hooks、浏览器扩展或私有接口来解决公开扩展已经覆盖的问题。

## 状态与生命周期

分别说明：

- 用户／工作区／资源的数据范围。
- 每个对话的视图、选中内容、草稿和待发送上下文。
- 临时界面状态与需要恢复的持久状态。
- 后端进程、Web 服务和耗时任务由谁启动、何时结束。

切换对话不能把上一对话的上下文写进新对话。界面关闭不自动等于取消后台任务；需要明确用户可理解的行为。不要使用“当前活动对话”作为所有实例共享的隐含全局变量。

按官方语义更新模型上下文。例如 `ui/update-model-context` 会替换同一 App 实例先前提供的上下文，不能默认每次调用都会累加。多对象选择应由应用管理完整选择集合。

## 明暗模式

- MCP App：使用宿主提供的主题／样式变量，响应宿主上下文变化，不仅在首次加载时读取。
- Web：有正式可用的宿主主题信号时经适配层接入；否则默认跟随系统，允许明亮／暗色／跟随系统，不虚构宿主注入 API。
- 共享组件使用背景、表面、文字、边框、强调、选中和错误等语义变量。图表、编辑器、弹窗、空状态也覆盖两套主题。
- 主题偏好不修改用户业务内容；不同入口在同一主题下保持视觉一致。

## 兼容性证据

为实际使用的能力记录：官方资料、SDK 版本、宿主版本、Windows／macOS 验证结果、缺失时的可用操作。账户或管理策略造成的不可用单独说明。

“官方有文档”“当前宿主实测通过”“实验待验证”是不同状态。不要把本目录表格解释为所有账号和桌面版本均可使用全部能力。

## 原始资料

- [官方扩展目录与入口](https://developers.openai.com/plugins/build/extensions#extension-reference)
- [OpenAI Extensions 完整协议与平台支持](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
- [OpenAI Extensions 接入模式](https://github.com/openai/mcp-extensions/blob/main/docs/patterns.md)
- [OpenAI Extensions TypeScript SDK](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md)
- [内置浏览器与 WebMCP](https://learn.chatgpt.com/docs/webmcp)
- [Browser Annotation API](https://learn.chatgpt.com/docs/annotations-extensibility)
- [主题变量更新说明](https://developers.openai.com/plugins/changelog#mcp-apps-host-style-variables)
- [本地插件与 Hooks 分发限制](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

此目录依据 2026-11-08 的讨论和已查阅资料整理；实施前核实所用能力及版本，不冻结官方未来的接口或平台支持范围。
