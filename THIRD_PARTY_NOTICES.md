# 第三方素材声明

## OpenAI MCP Extensions

- 来源：[openai/mcp-extensions](https://github.com/openai/mcp-extensions)，参考提交 `39f91ad0bdf1435aadb879172ab2467d0e97cead`。
- 许可：Apache License 2.0，原文保留在 [UPSTREAM-LICENSE.txt](docs/references/codex-plugin-ui/UPSTREAM-LICENSE.txt)。
- 原样保留的文件：
  - `docs/references/codex-plugin-ui/official-thread-panel.png`，来自上游 `docs/resources/02-thread-tray.png`。
  - `docs/references/codex-plugin-ui/official-plugin-settings.png`，来自上游 `docs/resources/07-settings-entrypoint.png`。

图片用于识别 Codex 官方扩展容器与配置入口，未作图像修改。项目 MIT 许可证不替代上述上游许可。用户提供的平台对照图与生成的原型不列为该上游仓库的原始文件。

## 文献插件运行依赖

`agentero-library` 的预构建运行文件包含 MCP SDK、React、PDF.js 等第三方组件。对应版本、来源及许可原文保存在插件的 [第三方许可证](plugins/agentero-library/assets/licenses/THIRD_PARTY_LICENSES.txt) 与 [索引](plugins/agentero-library/assets/licenses/manifest.json) 中；插件缓存可独立取得这些许可。Agentero CLI 由用户自行安装，不随本仓库分发其可执行文件或原生 PDFium。

## 文献插件翻译排版核心

`plugins/agentero-library/src/app/pdf/translation/` 中注明来源的类型、阅读顺序、覆盖检查与排版代码，移植或适配自 poco-ai 的 motif MIT 核心，经由 [agentero-dsh-plugin 固定提交](https://github.com/poco-ai/agentero-dsh-plugin/tree/2c0a7f85e0e3a1b78673f95abc187e04852a7f4f/packages/pdf/src/client/translation) 获取。版权为 `Copyright (c) 2026 poco-ai`，许可原文保留于源码的 `MOTIF-LICENSE.txt`，并随运行包归档到 [sources/motif-translation/MOTIF-LICENSE.txt](plugins/agentero-library/assets/licenses/sources/motif-translation/MOTIF-LICENSE.txt)。这份许可仅适用于有明确声明的翻译核心，不扩展到未确认许可的 DSH 宿主集成或界面代码。
