# 运行文件中的第三方许可

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) 汇总许可与声明原文；[manifest.json](manifest.json) 记录实际构建输入涉及的包、版本、来源、SHA-256 和源码许可。`packages/` 与 `sources/` 保存原文。

由 `node tooling/collect-agentero-licenses.mjs` 在插件构建之后生成，不复制 node_modules，也不把整棵开发依赖列入运行清单。包内字体、CMap、ICC、WASM 等附属许可一并归档；保留许可不代表分发了每一种可选资源。源代码目录中的 motif MIT 许可从本仓库归档，来源固定到记录的上游提交。

用户自行安装的 Node.js、Agentero CLI 和原生 PDFium 不随插件分发。
