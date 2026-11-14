# Agentero Studio · Agentero 创作

Agentero Studio 是 CodexWorkbench 的本地设计创作插件。通过 Codex 对话旁的 MCP App 进入作品中心，创建白板、组织原生对象和 HTML Region，并围绕具体内容留下备注、附加到对话，让 Codex 修改原始内容。

版本：`0.1.2`。运行要求：Node.js 24 或更高版本。

## 使用流程

1. 从 Codex 当前对话的 Studio 入口打开作品中心，创建白板或打开已有作品。
2. 在白板上组织文字、便签、图形和 HTML 图解。HTML Region 内部通过标注与 Codex 协作修改，区域整体仍能在白板上移动和调整尺寸。
3. 点击顶部备注图标后选择原生对象或 HTML 内部内容，在目标旁填写备注；也能从元素浮动条直接备注。HTML 支持点击节点、拖选文字和 Shift 框选。“附加到对话”默认不勾选；勾选后先保存冻结来源，再将引用放入输入框草稿，由用户发送。
4. Codex 读取相关原始 HTML 和当前版本，用带版本检查的操作写回同一区域，避免把渲染后的 DOM 当作保存源。
5. 在白板中查看历史、预览差异或恢复版本。恢复会生成新版本，不抹掉后续记录。

作品中心提供作品查找、固定、改名、复制、回收与恢复。数据默认保存在用户主目录下的 `.codexworkbench/agentero-studio/`，可通过 `AGENTERO_STUDIO_DATA_ROOT` 指定数据根目录，不写入源码或插件安装目录。关闭页面不会删除作品。

回收站支持单项永久删除、勾选后批量删除和清空；执行前确认范围。永久删除同时清理该作品的历史、反馈、资源及服务端导出副本，不能恢复；用户自行下载的文件和原始导入文件保持完整。列表和 Grid 共用回收操作与选择状态。

顶部保留版本历史、分享、备注模式与备注列表。分享浮层含分享/导出页签；完整作品备份使用导出页签的 ZIP 项，包含内容、资源、历史、批注与冻结来源；分享凭据和运行状态不打包。在作品中心选择“导入作品”恢复为新的作品 ID，不覆盖原作品。ZIP 备份及导入只对房主开放。

底部固定选择、平移、文字、分区、便签、画笔、形状和贴纸八个工具。画笔子菜单包含箭头，形状内提供表格/链接/HTML 等低频插入，贴纸内上传图片或视频。创建文字类对象后直接输入，完成回到选择；按空格临时平移。锁定只固定几何位置，保留文字、样式、HTML 源编辑和备注。

建议方案通过房主备注列表提供私人预览、应用和安全撤回；访客只能看到正式应用后的内容。不相交的选项可并用，相交选项切换时先安全撤回旧项；后来被修改的内容不会被旧快照覆盖。

选中 HTML Region 后可在新标签打开同源独立阅读页，支持缩放、源码更新提示、刷新及返回原白板备注。阅读权限仅限该区域且 15 分钟过期，不包含房主访问凭据，也不自动开启 LAN。实际打开位置由宿主公开链接 API 决定；被拦截时提供显式打开链接。

## 可选 Diagram Design

Diagram Design 是可选的外部 Skill，不随 Studio 复制或安装。当前 Codex 可使用它时，同一个 Codex 可以按其图种和样式规范生成 HTML，再写入 Studio 的 HTML Region。

没有 Diagram Design 时，基础白板、已有 HTML 内容与手动导入仍可使用。Studio 不把本地某个技能目录的存在当成可调用证明，也不在缺失时声称已使用它生成图解。

Studio 内只有一个中文版业务 Skill：[agentero-studio](skills/agentero-studio/SKILL.md)。它负责作品、反馈、版本和工具的工作流，不复刻 Diagram Design 的图种库。

该 Skill 按任务读取七份中文参考：

- [白板表达与布局](skills/agentero-studio/references/whiteboard-craft.md)：内容形式、标题、文字、关系、分区、间距、局部清理和人工布局的保留。
- [图片与素描](skills/agentero-studio/references/pictures.md)：实物构图、干净绘图、马克笔表达、剖面、分镜、部件标注和 SVG 资源。
- [建议方案与预览](skills/agentero-studio/references/ideas.md)：私人建议、预览、应用、互斥、安全撤回与生命周期。
- [对象与协作操作](skills/agentero-studio/references/operations.md)：元素、媒体、连线、嵌入状态、视图上下文和共享恢复。
- [白板对象格式](skills/agentero-studio/references/whiteboard-format.md)：当前白板字段、操作、媒体资源与可恢复备份。
- [HTML 区域与反馈](skills/agentero-studio/references/html-feedback.md)：原始内容定位、冻结来源、版本与标注。
- [配色与可读性](skills/agentero-studio/references/appearance.md)：界面与内容主题、对比度及中文可读性。

## 标注、共享和权限

标注记录作品和区域引用、源码版本、目标标识、文字或 DOM 摘录以及备注。摘录和截图用于定位；可修改的原始内容由 Studio 工具按引用读取。

MCP App 内的标注通过插件自己的选择层和宿主消息扩展实现，不假定 iframe 具有内置浏览器的顶层 Annotation API。附加草稿与发送消息是两步；局域网访客提交给 Codex 的请求需由本机接收流程处理，不能继承房主的 Codex 登录态。

局域网共享按编辑、评论和查看角色授权，支持成员光标、光标聊天和视角跟随。链接是访问凭据，请只交给预期参与者。关闭分享或重置链接会撤销相应旧凭据并断开已有事件流；本机作品仍保留。网络或服务中断时，以页面的保存和同步状态为准。

## 明暗主题

界面与内容分别处理主题。Studio 首次响应宿主主题，之后可用单个日／月图标切换明暗；HTML Region 保留自己的内容配色，不做整图强制反色。默认参考 Diagram Design 的背景、正文、次要文字、强调和连接等语义色，尤其检查暗色下节点填充与文字、连线及标签的对比。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `studio_open` | 打开作品中心或指定作品 |
| `artifact_list` | 查找、筛选并分页列出作品 |
| `artifact_manage` | 创建、命名、固定、复制、回收、恢复、导入备份及导入／移除未引用资源 |
| `artifact_read` | 读取概要、对象、原始源码、冻结反馈、视图上下文、资源元数据、历史与差异 |
| `artifact_apply` | 带版本检查和幂等标识的批量修改、历史恢复与安全撤回 |
| `artifact_feedback` | 处理批注、显式 Agent 请求及私人建议的预览／选择／撤回 |
| `artifact_share` | 管理局域网分享 |
| `artifact_export` | 导出 JSON、HTML、SVG、PNG，或房主的完整作品 ZIP 备份 |

工具 schema 和返回值是接口依据。MCP 默认读取有界概要，完整对象和源码按需分段读取。模型可通过 `artifact_manage action:"asset-import"` 导入用户指定或本次生成的本机媒体绝对路径，使用返回的稳定资源引用；`asset-delete` 会检查当前内容、保留历史、来源和提案，并保留内部回收副本。实时光标、拖动预览和选区由协作服务同步，不为每次界面操作增加模型工具调用。

## 开发与交付

### 产品与公共层

`runtime/server.mjs` 是 [tooling/build-agentero-studio.mjs](../../tooling/build-agentero-studio.mjs) 从 `src/server/index.ts` 自动生成的 esbuild 分发文件，包含后端运行依赖；其长度包含打包代码，不能视为业务单体。前端由同一脚本经 Vite 生成 `runtime/app.html`，PNG 渲染另随附 `runtime/resvg.wasm`。业务修改维护下列源码，再统一构建运行资源，不手工修改生成文件。

`src/server/` 负责 stdio MCP 协议、HTTP／SSE 传输、连接鉴权、本机权威服务发现与进程租约。嵌入的 MCP App 通过仅界面可用的 `studio_app_request` 与宿主通信，不直接请求 loopback；该内部传输不增加模型可见的八个业务工具。完整文档、媒体和备份按有界分块传输，写入保留人类作者。局域网 Web 页面继续使用 HTTP／SSE，MCP App 使用可见时的版本检查与在线状态轮询。它把请求交给 `src/core/service.ts`，不另建一套业务存储。

`src/core/shared/` 统一作品身份、持久化、历史、CAS／幂等、批注／提案、分享权限、在线状态、资源与 ZIP 归档。产品内容存入泛型 `content`，这些公共模块不读取白板元素或 HTML。

`src/core/products/` 负责产品注册与白板内容适配，包括内容校验、编辑操作、读取投影、差异、反馈源码快照及导出；白板几何供画布与导出共用。新增产品时，实现并注册后端 `ProductDefinition`（`src/core/products/index.ts`）与前端 `ProductDescriptor`（`src/app/products.tsx`），公共层继续处理版本、权限和协作。当前只注册真实实现的白板，不展示空产品入口。

`src/app/shared/html-region/` 是可复用的 HTML 渲染、元素／文字／区域标注和有限状态桥。宿主消息与背景上下文集中在 `src/app/bridge.ts`、`host-context.ts`，产品不直接访问 Codex 全局对象。

HTML Region 默认禁止外部网络资源并保留自身配色。图片、字体等需内联为当前沙箱允许的数据资源，字体提供明确回退；不要直接引用本机路径或依赖 Google Fonts。`window.studioEmbed.load/save/onLoad` 提供至多 64 KB 的 JSON 对象状态桥，保存经过区域版本检查；改 HTML 不附带覆盖旧 state。完整备份不包含安装目录或访问凭据。

区域使用 `sandbox="allow-scripts"` 的 `iframe srcDoc` 渲染副本，保持独立样式与不透明来源；UTF-8 声明位于注入脚本之前。原始源码单独保存，标注、状态和滚动消息校验来源窗口、通道、区域及源码版本。

MCP App 文件导出通过公开 `app.downloadFile` 交给宿主保存，保留中文文件名和原始字节；宿主未声明该能力、拒绝或取消时明确报错。Web 使用浏览器下载设置。服务端副本位于数据根目录的 `exports/`，以导出 ID 存储，下载文件名保存在对应元数据中；单次文件沿用 128 MiB 作品传输预算。

在仓库根目录安装开发依赖后，运行 `pnpm --filter @codexworkbench/agentero-studio typecheck`、`pnpm --filter @codexworkbench/agentero-studio test` 和 `pnpm --filter @codexworkbench/agentero-studio build` 检查与构建；仓库级检查入口仍为 `pnpm test`、`pnpm check`、`pnpm build`。商城运行资源由开发者预构建，终端用户不需要先构建源码。分发使用 Git marketplace，作品 ZIP 是用户数据备份，不是插件安装包。

不要直接修改已安装插件的缓存副本。插件源码、预构建运行资源与用户数据分别维护；安装后需要在目标 Codex 宿主验证入口、消息附件和页面生命周期。

验证结果应区分工具自动测试、界面检查、实际 Codex 宿主、真实双机局域网和 macOS。当前仍未完成真实 Codex MCP App、两台物理设备的 LAN 和 macOS 实测；这些范围不能通过“跨平台 JavaScript”、模拟宿主或单机多页面测试推断为通过。

## 来源

作品中心和白板协作流程参考 [open-artifacts](https://github.com/JimLiu/open-artifacts)，Studio 使用面向 Codex 的独立实现与中文工作流。原创代码与中文 Skill 按 [MIT](LICENSE) 提供；不分发原专有编辑器、字体和提示词。第三方运行依赖保留各自许可，包括 PNG 渲染使用的 resvg Wasm 的 MPL-2.0；实际依赖许可清单由构建脚本生成在 `assets/licenses/`。完整来源与许可边界见 [NOTICE](NOTICE.md)。
