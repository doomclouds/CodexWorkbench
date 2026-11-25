# Luming Skills

将问题澄清、任务提示词改写、工程设计与实施、并行派工、编程和中文写作的八项 Luming 技能一起安装到 Codex。

## 安装

在 Codex 中从 CodexWorkbench 商城安装「Luming Skills」。也可以使用 Codex CLI。

```sh
codex plugin marketplace add doomclouds/CodexWorkbench --ref main
codex plugin add luming-skills@codex-workbench
```

已添加商城时，可以运行 `codex plugin marketplace upgrade codex-workbench` 刷新目录。技能随包提供，无需构建。

## 技能与来源

在 Codex 输入框输入 `$` 可以选取技能。「把问题说准」「把任务做深」「用自己的话复述」「工程设计」「并行派工」单独使用时需要显式调用。「工程流程」可在跨工程、公开接口或并行派工等开发任务中自动选中，并按需读取「工程设计」和「并行派工」。下表列出译作和改编所依据的上游提交，方便对照原文。

| 技能 | 来源与调整 |
| --- | --- |
| [把问题说准](skills/luming-reframe/SKILL.md) | 译自 pstack 的 [reframe](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/reframe/SKILL.md)。 |
| [把任务做深](skills/luming-sharpen/SKILL.md) | 译自 pstack 的 [sharpen](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/sharpen/SKILL.md)。 |
| [用自己的话复述](skills/luming-in-your-own-words/SKILL.md) | 译自 pstack 的 [in-your-own-words](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/in-your-own-words/SKILL.md)。多轮委托的示例和复述后的交付边界来自 Luming 的本地实践。 |
| [工程设计](skills/luming-architect/SKILL.md) | 改编自 pstack 的 [architect](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/architect/SKILL.md)。结合 Luming 协作约定明确实施范围、授权边界和验收依据。 |
| [并行派工](skills/luming-swarm/SKILL.md) | 改编自 pstack 的 [swarm](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/swarm/SKILL.md)。按 Luming 协作约定调整任务分派、写入范围和结果验收。 |
| [工程流程](skills/luming-mode/SKILL.md) | 改编自 pstack 的 [poteto-mode](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/skills/poteto-mode/SKILL.md)。按本轮交付和已确认的范围选择工程设计、实施或并行派工。 |
| [卡帕西编程准则](skills/luming-karpathy-guidelines/SKILL.md) | 译自 multica-ai 的 [karpathy-guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md)。上游根据 [Andrej Karpathy 的观察](https://x.com/karpathy/status/2015883857489522876)整理成四条编程准则。 |
| [Luming · 回复与写作](skills/luming-writing-style/SKILL.md) | 本地编写，综合多种写作方法。具体借鉴的作品和用法见[作者与作品来源](skills/luming-writing-style/references/author-sources.md)。 |

## 上游许可

插件自有内容采用 [MIT 许可](LICENSE)。

**pstack** 的六项译作和改编沿用上游 [MIT 许可](https://github.com/backnotprop/pstack/blob/2a5621683e2bbb274efea8b52dd69f5beef6c25f/LICENSE)。原版权声明和许可全文收录如下。

<details>
<summary>pstack 版权声明与 MIT 许可原文</summary>

```text
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

**andrej-karpathy-skills** 在上述提交的 [README 许可章节](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/README.md#license)和[原技能文件头](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md#L4)中标注 MIT。许可标准文本见 [Open Source Initiative 的 MIT License](https://opensource.org/license/mit)。
