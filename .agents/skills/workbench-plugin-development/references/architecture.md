# 技术栈与仓库结构

## 技术基线

| 层面 | 默认选择 | 选型边界 |
| --- | --- | --- |
| 目标平台 | Windows、macOS | 两端都应能运行；普通 JS 功能共用实现 |
| 前端语言 | TypeScript，严格类型检查 | 公共边界校验运行时输入，不能只依赖类型声明 |
| 前端框架 | React | MCP 与 Web 复用适合共享的功能组件 |
| 前端构建 | Vite | MCP HTML、Web 页面分别按交付需要构建 |
| 样式 | 语义 CSS 变量、Tailwind CSS | 共享主题与基础组件；具体组件库按需求选择 |
| 后端 | Node.js、TypeScript、ESM | 暂不使用 C#；不默认引入第二套后端语言 |
| 插件接入 | 官方 MCP SDK、MCP Apps、OpenAI Extensions | 按兼容性选择相互匹配的 SDK 版本 |
| Web 协作 | WebMCP、Browser Annotation API | 按实际需要接入，检查能力是否存在 |
| 包管理 | pnpm workspace | 根目录维护统一锁文件，内部依赖显式声明 |
| 静态检查 | TypeScript、ESLint、Prettier | 区分构建、类型检查与格式检查 |
| 测试 | Vitest；界面流程按需用 Playwright | 围绕关键行为和真实风险选择测试 |

采用仍受支持的 Node.js LTS。初始化实际运行代码时，选择与依赖兼容的具体版本，记录 Node 与 pnpm 版本并锁定依赖；本 Skill 不预设尚未验证的补丁版本组合。Vite 构建不替代完整 TypeScript 类型检查。

业务专用库，例如 PDF、编辑器、OCR、图表和 SQLite 驱动，在对应功能立项时选择。考虑许可证、包体、Worker／WASM、原生模块和 Windows／macOS 分发方式，不为尚未出现的需求预装整套依赖。

## 模块边界

建议把可复用业务操作与接入方式分开：

```text
MCP 工具／Web API／页面工具
            ↓
      业务操作与规则
            ↓
   文件、存储、外部服务适配

共享功能界面 → MCP 接入或 Web 接入
```

- `server` 负责 MCP 注册、资源及协议错误映射；不把所有业务堆进入口文件。
- `core` 放业务规则和可复用操作。复杂到需要单独用例层时，再细分，简单功能不强制增加层级。
- `infrastructure` 封装文件、数据库、下载或其他外部依赖。
- `contracts` 定义接入层与业务层使用的稳定输入输出，不依赖 React 或宿主全局对象。
- `app` 放界面、功能组件与状态；宿主能力经适配层访问。

同一操作由界面和 Agent 使用时，共用业务实现。纯界面动作可以只存在于页面；需要页面关闭后仍可用的操作应放在后端工具或服务中。

默认每个插件独立运行和交付。需要多个插件共享常驻服务时，再说明资源归属、版本关系和进程生命周期。

## 仓库结构

按实际需要创建以下目录，不一次生成空框架：

```text
CodexWorkbench/
├─ .agents/
│  ├─ skills/                 # 项目级开发技能
│  └─ plugins/                # 插件目录清单，实际提供插件时建立
├─ plugins/
│  └─ <plugin-id>/            # 独立插件
├─ packages/                 # 已有真实复用需求的共享包
├─ tooling/                  # 跨平台构建、校验、打包工具
├─ templates/                # 有实际复用价值的开发模板
├─ docs/
│  ├─ standards/             # 独立规范文档，按维护需要建立
│  └─ decisions/             # 重要决策的原因与取舍
└─ artifacts/                # 生成产物，不提交
```

共享包的推荐职责是 `contracts`、`ui`、`host-bridge`。首次出现的业务代码留在插件内；不要为了凑齐目录创建共享框架。项目 Skill 的约定与独立规范保持单一维护来源，通过链接引用，避免两份全文逐渐分歧。

单插件的推荐结构：

```text
plugins/<plugin-id>/
├─ plugin.json
├─ mcp.json                   # 有 MCP Server 时提供
├─ package.json
├─ README.md
├─ src/
│  ├─ app/
│  │  ├─ entrypoints/         # 按需提供 MCP、Web 入口
│  │  ├─ features/
│  │  └─ components/
│  ├─ server/
│  ├─ core/
│  ├─ infrastructure/
│  └─ contracts/
├─ skills/                    # 插件交付给用户的业务技能，按需提供
├─ assets/
└─ tests/
```

这不是每个插件必须完整复制的模板。纯工具或 Skills-only 插件只保留需要的部分。根目录的开发 Skill 与插件内交付的业务 Skills 用途不同。

## 身份、契约和交付

- 插件 ID 与目录使用稳定的 kebab-case；展示名可用中文，不随展示文案调整 ID。
- 新插件优先使用根目录 `plugin.json`、`mcp.json` 的可移植格式；OpenAI 专属配置使用官方扩展位置。需要兼容旧宿主时再提供兼容清单，避免多份身份配置手工漂移。
- 自定义项目元数据单独定义，不把自己的字段当成宿主能识别的能力或权限。
- 插件、公共契约、持久数据格式各有自己的版本概念；数据迁移不依赖猜测插件版本。
- 用稳定资源引用传递跨插件对象，例如所属插件、资源 ID、必要的版本或定位信息。模型可见结果通常不需要本机绝对路径。
- 共享包是开发依赖关系，不代表最终安装环境也有 workspace。构建时打包或携带实际运行依赖，验证解包后可启动。

## 数据归属

插件默认数据根目录为 `~/.codexworkbench/<plugin-id>/`，其中 `~` 表示当前用户主目录。使用稳定插件 ID，不随展示名称或界面语言变化。Windows 与 macOS 都通过系统提供的用户主目录和路径 API 定位，不硬编码用户名。

文献插件的建议布局如下，目录按实际需要创建：

```text
~/.codexworkbench/agentero-library/
├─ config.json               # 插件配置、CLI 路径、当前 Vault 等
├─ state/                    # 按可用对话／实例标识隔离的视图与草稿状态
├─ cache/                    # 可重建的缩略图等
├─ logs/                     # 运行诊断
└─ vault/                    # 默认 Agentero Vault
   ├─ papers/
   ├─ notes/
   ├─ data/
   └─ .agentero/             # 上游管理的目录、catalog.sqlite 等
```

Vault 的完整结构由 Agentero CLI 创建和维护，以上只列主要目录。用户可以配置已有的外部 Vault；插件保存引用并显式传递路径，不静默迁移或复制现有内容。用户自行安装的 CLI 保持原安装位置，插件配置保存可执行文件路径。

每个插件定义用户内容、配置、运行状态与缓存的归属和存储方式。普通文件、JSON、SQLite 按业务选择，不要求所有插件使用同一种存储。

必须区分可重建索引与需要保留的原始数据；不能笼统把 SQLite 文件都当缓存删除。描述备份、导出、格式升级与失败恢复方式。

数据范围可以是用户全局、工作区或资源。对话视图状态与这些范围分别定义，不因 Global 入口就把所有数据设为全局，也不因 Thread 入口就把所有数据绑定到对话。

跨插件操作经拥有者的公开接口完成，不直接修改其他插件的数据库。不要把第三方参考仓库作为隐含构建依赖，也不提交开发机的绝对路径。

## 原始资料

- [官方插件包结构与路径规则](https://developers.openai.com/plugins/build/plugins)
- [官方 MCP Apps 扩展](https://developers.openai.com/plugins/build/extensions)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [Vite 的 TypeScript 类型检查说明](https://vite.dev/guide/features.html#typescript)

选择实现版本时重新核对相关文档，资料链接不是已验证的项目依赖锁定清单。
