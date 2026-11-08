# 贡献与开发流程

开始前阅读 [AGENTS.md](AGENTS.md) 和 [项目开发 Skill](.agents/skills/workbench-plugin-development/SKILL.md)。详细选型由 Skill 的参考文档维护。

## 开发环境

- Git。
- Node.js 24，版本线记录在 `.node-version`。
- pnpm 11.28.5，精确版本记录在 `package.json` 的 `packageManager`。

```sh
git clone https://github.com/doomclouds/CodexWorkbench.git
cd CodexWorkbench
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
```

日常测试使用隔离数据，不需要 API Key 或模型配置。真实文献工作流还需用户安装 Agentero CLI，原生 PDF 能力单独诊断。

## 修改流程

1. 从最新 `main` 建立 `codex/` 前缀的工作分支。
2. 根据实际任务确定功能、入口和扩展点，修改相关内容。
3. 运行 `pnpm test`、`pnpm check`，以及本次变更需要的其他检查。
4. 查看 `git diff`、暂存内容和生成产物，确认不包含本机配置、凭据或用户内容。
5. 创建内容相关的提交，通过 Pull Request 说明行为变化和验证结果。

新插件按实际需要建立，依赖、资源和公开契约在插件目录中声明。默认经远程 Git marketplace 安装，开发者构建并提交必要运行资源，安装者无需构建源码。不默认增加 ZIP 安装包。

## 自动工作流

GitHub Actions 仅在推送 Git 标签（tag）时触发；普通分支推送、Pull Request 和手动启动不触发。日常修改在本地运行检查。后续新增的自动构建和发布流程同样使用 tag 触发。

## 提交说明

使用 Conventional Commits，例如：

```text
feat(plugin-id): add resource search
fix(plugin-id): preserve the active selection
docs: clarify extension selection
chore: update repository checks
```

一次提交围绕相关改动组织，不混入无关清理。未验证的平台或宿主能力应明确说明。

## 本地文件

`.codegraph/`、依赖、构建产物和本地配置由 `.gitignore` 排除。CodeGraph 是可选的代码查询工具；已有索引时可更新和使用，无需为普通修改强制安装。

示例配置使用无密钥的 `.env.example`；真实环境变量文件不提交。需要共享的测试资料应使用可公开分发的专门 fixture，不使用个人数据。

## 规范变更

区分已确定的基线与新的建议。修改约定时更新对应的 Skill 参考，并检查 README 与执行规则是否仍一致，避免重复维护整份规范。
