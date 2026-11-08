# 运行文件中的第三方许可

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) 汇总预构建服务与应用所涉及包的许可原文；[manifest.json](manifest.json) 记录包名、版本、运行范围与许可来源。`packages/` 保留各份原文。

清单依据服务的 esbuild 输入与应用的 Vite 模块输入整理，不包含整棵开发依赖，也不复制 `node_modules`。PDF.js 的可选 CMap、ICC、字体和 WASM 资源许可一并保留；保留许可不表示当前运行文件附带或使用每一种可选资源。

更新运行依赖或改变 bundle 输入后，应重新核对并生成此清单。用户自行安装的 Node.js、Agentero CLI 和原生 PDFium 不在插件内分发。
