# CodexWorkbench

基于 Codex 桌面端的个人工作台插件集合，面向 Windows 和 macOS。通过可组合的本地工具、界面与工作流，逐步形成自己的工作环境。

首个插件是 [文献库](plugins/agentero-library/README.md)，当前版本为 **0.4.0**：复用 Agentero CLI／MCP，在当前对话旁阅读 PDF、整理关联笔记和修订论文 Markdown。提供多级笔记目录、可拖动阅读分栏、多页批注附加到 Codex 原生输入框，以及明暗主题和回收站入口。

## 安装插件

在 Codex 中添加远程商城 `https://github.com/doomclouds/CodexWorkbench`，然后安装“文献库”。也可以使用：

```sh
codex plugin marketplace add doomclouds/CodexWorkbench --ref main
codex plugin add agentero-library@codex-workbench
```

插件随仓库提供预构建运行文件，无需下载 ZIP、克隆源码或自行构建。运行需要 Node.js 24 与用户安装的 Agentero CLI v0.15.2；后台 PDF 原生处理还需要 PDFium，基础阅读器使用随插件提供的 PDF.js。翻译可选择 Agentero 文本翻译或单独配置兼容模型服务，具体设置见插件说明。

Windows 已完成隔离 CLI／MCP 和模拟宿主浏览器验证；macOS arm64 尚未实测。自动检查与模拟宿主结果不代表所有 Codex 桌面版本的行为已经验证。

## 开发方向

| 部分 | 约定 |
| --- | --- |
| 前端 | TypeScript、React、Vite，统一语义主题与基础组件 |
| 后端 | Node.js、TypeScript，暂不使用 C# |
| 插件界面 | MCP App／Widget，或在 Codex 内置浏览器打开的 Web 页面 |
| 宿主接入 | 按需选择 Global、Thread、File、工具、资源及其他官方扩展点 |
| 跨平台 | Windows、macOS；普通 JS 共用实现，原生能力单独适配 |
| 主题 | 明亮与暗色；宿主内跟随宿主，Web 无宿主信号时跟随系统 |
| 组织方式 | pnpm workspace，每个插件独立交付，按实际需求提取共享代码 |
| 安装与分发 | 远程 Git marketplace，用户添加商城后安装插件，无需下载 ZIP 或自行构建 |

不是每个插件都需要界面或全部入口。业务功能在对应任务中选型，具体 SDK 版本与兼容性通过实际验证确定。

## 从这里开始

- [开发 Agent 执行规则](AGENTS.md)
- [项目开发 Skill](.agents/skills/workbench-plugin-development/SKILL.md)
- [技术栈、模块边界与目录约定](.agents/skills/workbench-plugin-development/references/architecture.md)
- [界面形式与扩展点选型](.agents/skills/workbench-plugin-development/references/extensions.md)
- [Codex 官方界面与 Windows／macOS 可视化参考](docs/references/codex-plugin-ui/README.md)
- [工程、检查与交付约定](.agents/skills/workbench-plugin-development/references/engineering.md)
- [贡献流程](CONTRIBUTING.md)

在 Codex 中可使用 `$workbench-plugin-development` 选择插件形式和实现方案。项目级 Skill 位于 `.agents/skills/`，可随仓库一起维护。

## 本地检查

准备 Node.js 24 和 `package.json` 声明的 pnpm 版本，然后运行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
```

`test` 包括仓库与插件测试，`check` 包括文本检查和 TypeScript 检查，`build` 更新商城所需运行文件。只检查仓库文本时，也可直接执行：

```sh
node --test tooling/check-repository.test.mjs
node tooling/check-repository.mjs
```

文本检查覆盖编码、换行、JSON、Markdown 本地链接与 Skill 基础结构。仅在推送 Git 标签（tag）时，GitHub Actions 才在 Windows 和 macOS 上运行测试、类型检查和运行文件一致性检查；普通分支推送和 Pull Request 不触发。自动检查不替代真实宿主验收。

## 当前目录

```text
.agents/skills/     项目开发 Skill 及其参考
.agents/plugins/    远程商城目录
.github/           Issue／PR 模板与双平台 CI
plugins/           插件源码、Skills 与可直接运行的资源
tooling/           跨平台仓库检查工具
AGENTS.md          开发 Agent 执行规则
CONTRIBUTING.md    开发与提交流程
```

后续按真实复用需求提取 `packages/`，具体结构见项目 Skill。

## License

本项目自有内容采用 [MIT License](LICENSE)。保留的上游参考素材及其来源见 [第三方声明](THIRD_PARTY_NOTICES.md)。
