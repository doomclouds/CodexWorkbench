# CodexWorkbench

基于 Codex 桌面端的个人工作台插件集合，面向 Windows 和 macOS。通过可组合的本地工具、界面与工作流，逐步形成自己的工作环境。

当前处于开发规范与仓库基础设施阶段，尚未提供可安装的业务插件。

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
```

目前检查工具没有第三方运行依赖，也可以直接执行：

```sh
node --test tooling/check-repository.test.mjs
node tooling/check-repository.mjs
```

检查覆盖仓库文本编码、换行、JSON、Markdown 本地链接与 Skill 基础结构。仅在向 GitHub 推送 Git 标签（tag）时，GitHub Actions 才在 Windows 和 macOS 上运行这些检查；普通分支推送和 Pull Request 不触发。仓库检查不代表尚未实现的业务插件已通过宿主验收。

## 当前目录

```text
.agents/skills/     项目开发 Skill 及其参考
.github/           Issue／PR 模板与双平台 CI
tooling/           跨平台仓库检查工具
AGENTS.md          开发 Agent 执行规则
CONTRIBUTING.md    开发与提交流程
```

后续按需求引入 `plugins/`、`packages/` 等目录，具体结构见项目 Skill。

## License

本项目自有内容采用 [MIT License](LICENSE)。保留的上游参考素材及其来源见 [第三方声明](THIRD_PARTY_NOTICES.md)。
