# 来源与许可

Agentero Studio 是 CodexWorkbench 中面向 Codex 的独立插件实现。本插件的原创代码、中文业务 Skill 和图标按 [MIT 许可](LICENSE) 提供；第三方依赖保留各自的许可。

本项目在功能研究中参考了 [Jim Liu 宝玉的 open-artifacts](https://github.com/JimLiu/open-artifacts) 的作品管理、本地白板和评论协作流程。open-artifacts 自己的 [NOTICE](https://github.com/JimLiu/open-artifacts/blob/main/NOTICE.md) 明确区分其维护者的 MIT 工作、Anthropic 来源材料和第三方依赖。

本插件不分发 open-artifacts 中还原的 Anthropic 编辑器、Anthropicons 字体、原始提示词或图种参考文档。这里的中文 Skill 围绕 Studio 的工具契约重新编写，不是原有 `claude-whiteboard` 指令的逐段翻译。

`src/core/shared/safe-merge.ts` 的行级差异算法改编自 open-artifacts 的 MIT 本地服务器 `skills/claude-whiteboard/scripts/artifact.mjs`（提交 `d9e5123f888228cacdab69a157a4e94d2d1c629c`）。版权归属 Copyright (c) 2026 Jim Liu 宝玉。原 MIT 许可与署名保留在该模块的许可注释中，并随预构建运行资源分发。本插件将其真正冲突策略调整为保留双方并拒绝静默覆盖。

Diagram Design 是用户可另行启用的外部插件／Skill。Studio 仅在其对当前 Agent 可用时组合使用，不将其实现、图种参考或示例打包为本插件的一部分。其名称仅用于标识可选能力，相关权利及许可由各自权利人保留。

本插件不隶属于 Anthropic，也不借助 Claude 登录态、claude.ai 私有接口或 DeepSeek Harness 的宿主扩展运行。

PNG 导出使用 `@resvg/resvg-wasm 2.6.2`，其许可为 MPL-2.0；原始许可与来源保存在 [许可来源](assets/licenses/sources/resvg-wasm/2.6.2/LICENSE)。对应源码见 [resvg-js 固定提交](https://github.com/yisibl/resvg-js/tree/9ca058462ac529120c8cc84ddcd6fef644cc5406)。构建生成的 `assets/licenses/manifest.json` 和 `assets/licenses/packages/` 收录实际运行依赖的许可，第三方运行文件不因打包而改用本插件的 MIT 许可。
