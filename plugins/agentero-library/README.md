# 文献库

在 Codex 对话旁管理本地论文、阅读 PDF，并将讨论整理为研究笔记。文献与笔记能力调用用户安装的 Agentero CLI／MCP，数据保留在 Agentero Vault 中。

## 安装

先准备以下本机环境：

- Node.js 24。
- Agentero CLI v0.15.2，首版支持的版本。安装方式见 [Agentero 官方说明](https://github.com/poco-ai/Agentero#命令行工具-cli)，对应平台文件见 [v0.15.2 官方发布页](https://github.com/poco-ai/Agentero/releases/tag/v0.15.2)。
- 后台 PDF 解析与文字提取需要 CLI 能加载对应平台的原生 PDFium。仅安装 CLI 可执行文件不代表这项能力已经就绪。

在 Codex 的插件目录添加远程商城来源：

```text
https://github.com/doomclouds/CodexWorkbench
```

从 `CodexWorkbench` 商城安装“文献库”。仓库包含插件所需的预构建运行文件，无需下载 ZIP、克隆源码或运行 pnpm 构建。

已安装可用的 Codex CLI 时，也可以使用：

```sh
codex plugin marketplace add doomclouds/CodexWorkbench --ref main
codex plugin add agentero-library@codex-workbench
```

目标平台为 Windows x64 与 macOS arm64。普通界面与业务使用同一套实现；具体桌面版本及平台能力以安装后的诊断和实际运行结果为准。

## 首次配置

1. 在插件详情的设置中打开“配置与诊断”，填写 Agentero CLI 路径并检测连接。
2. 选择已有 Vault，或明确创建默认知识库。默认路径为 `~/.codexworkbench/agentero-library/vault`。
3. 查看分项能力。缺少原生 PDFium 时，可以继续使用可用的文献／笔记和浏览器阅读功能；后台解析与文字提取需先补齐依赖。
4. 在当前对话的内容标签页打开“文献库”，开始检索、阅读或编辑笔记。

CLI 由用户安装和升级。插件只保存可执行文件路径，不修改全局 PATH，不复制或迁移已有 Vault，也不自动安装原生 PDFium。

## 使用

- 在文献页筛选已有论文、查看详情，或按需要导入标识符与本地 PDF。在线发现提供候选列表，导入会单独报告任务结果。
- 在阅读页打开 PDF、查看相关内容，带来源与页码提出选区问题。没有可靠页级证据时使用文档路径与行号，不补造定位。
- 在笔记页维护独立笔记或论文笔记；请明确说“保存到笔记”或“更新这篇笔记”来让 Agent 写入。普通问答不会自动写笔记或标为已读。
- 切换 Vault 后，旧对话的资源引用会失效，需重新选择；正在编辑的草稿与运行任务仍属于原来的库。

插件附带四个工作流：

| 工作流 | 示例请求 |
| --- | --- |
| [连接与设置](skills/library-setup/SKILL.md) | 检查我的文献库连接，说明还缺什么依赖。 |
| [文献检索](skills/literature-search/SKILL.md) | 在已有文献中找与这个问题相关的论文。 |
| [论文阅读](skills/paper-reading/SKILL.md) | 解释这段方法，并给出原文定位。 |
| [研究笔记](skills/research-notes/SKILL.md) | 把本轮讨论整理到阅读笔记，保留引用。 |

## 数据与正文访问

插件配置和运行状态默认保存在 `~/.codexworkbench/agentero-library/`；默认 Vault 位于其中的 `vault/`。使用外部 Vault 时，文献与笔记继续保存在用户选择的位置。Vault 的 `.agentero/catalog.sqlite` 是上游业务数据，不是可以随意清理的插件缓存。

后台正文访问默认关闭。启用后，Agent 才能按工具范围读取提取正文与正文搜索结果。用户主动发送的选区只用于该次请求，不因此开放其他页或全文。PDF 显示、正文提取与已有 layout 读取是不同能力。

在线发现和导入会连接对应来源；交给 Codex 的选区、正文或笔记会进入当前对话的模型上下文。本地存储不等于所有处理都离线完成。

## 限制与故障处理

- “CLI 已连接”只说明基本连接成功，按诊断页分别确认文献、正文和 PDF 原生能力。
- 普通本地 PDF 解析不保证生成 `page_read` 所需的版面数据。缺少 layout 时不会编造章节或页码锚点。
- 阅读器当前会将 PDF 分块读入内存，单文件上限为 256 MiB；特殊字体／CMap 和图片编码仍需更多样本验证。
- 遇到笔记版本冲突时保留草稿并重新读取，避免盲目覆盖。插件内的队列和乐观检查不能保证与外部 Agentero／编辑器之间的跨进程原子 CAS。
- 关闭面板不等于取消已提交任务；退出服务后的任务不保证自动续跑。取消不会自动回滚已经写入的文献。
- 整篇排版翻译、复杂 OCR、云同步及科研表格不属于当前功能范围。

## 许可

本插件自有代码采用 [MIT License](LICENSE)。运行文件中保留的第三方组件许可见 [第三方许可证](assets/licenses/THIRD_PARTY_LICENSES.txt)。
