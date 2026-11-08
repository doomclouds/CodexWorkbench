# CodexWorkbench 开发约定

## 项目 Skill

规划、开发或评审工作台插件前，使用 [workbench-plugin-development](.agents/skills/workbench-plugin-development/SKILL.md)，按任务读取其参考。技术栈、扩展点与工程约定由该 Skill 维护；本文件只保留仓库执行规则。

用户当前指令优先。尚未确定的业务细节在对应任务中讨论，不把建议或参考项目的做法直接升级为全仓库要求。

## 项目边界

- 以现有 Codex 桌面端为宿主，开发可组合的本地插件。
- Windows、macOS 都是目标平台；普通 JavaScript／TypeScript 共用跨平台实现，涉及原生能力时再隔离适配。
- 前端 TypeScript、React、Vite；后端 Node.js、TypeScript；pnpm workspace。暂不使用 C#。
- 界面按需选择 MCP App 或内置浏览器 Web，支持明暗主题。Global／Thread／File 入口、显示方式与 MCP 传输方式分别设计。
- 按实际需要建立插件和共享包，不生成没有用途的空框架。
- 用户内容、凭据与运行数据放在源码和安装目录之外，不提交到 Git。

## 资料与代码查询

- OpenAI／Codex 接口优先使用官方文档工具搜索并读取原始页面。
- 第三方技术文档优先使用 Context7：先解析 Library ID，再查询匹配版本；缺少覆盖时补充官方资料并说明。
- 如确需查询 .NET 官方资料，优先使用 Microsoft Docs 工具；这不改变当前不使用 C# 的技术基线。
- 代码查询可使用已有 CodeGraph 索引；文档、配置和索引未覆盖的内容直接读取。索引缺失不阻塞开发，也不自动安装工具。
- 区分文档支持与实际验证，不把 Windows 检查通过表述为 macOS 或宿主功能已验证。

## 修改与检查

- 先查看 Git 状态，保留用户已有修改，控制本次变更范围。
- 共享业务逻辑和公开契约；不直接修改其他插件拥有的数据库。
- 新增、升级依赖时维护锁文件，记录实际运行要求，避免依赖开发机绝对路径或全局安装。
- 当前检查命令为 `pnpm test`、`pnpm check`。按变更内容增加真实需要的检查，不报告尚不存在的构建或测试命令。
- 修改 Skill 时检查 frontmatter、引用文件和 UI 元数据的一致性。
- 重要沟通与压缩前的续接状态按项目 Skill 及时落盘；设计文档放在 `artifacts/<plugin-id>/<version>/`，可选且不提交。
- 当前仓库尚无业务插件；基础仓库检查不能代替后续插件的打包和宿主验收。

## Git 与发布

- 新建工作分支默认使用 `codex/` 前缀，主分支为 `main`。
- 提交采用 Conventional Commits；scope 可使用插件 ID，保持提交内容相关。
- 提交前检查暂存内容和差异；不提交缓存、生成产物、用户数据或密钥。
- 提交、推送、安装和发布按当前任务授权执行，不从参考仓库继承自动提交指令。
- 交付时说明实际改动、检查结果和未验证范围。
