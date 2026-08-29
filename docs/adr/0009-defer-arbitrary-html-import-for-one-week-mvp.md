---
status: accepted
---

# 一周 MVP 暂不导入任意 HTML

为了在一周内交付可展示的 MVP，首个版本只编辑由产品通过五个已验证模板生成的演示文稿，不提供任意本地 HTML 导入。GrapesJS 项目数据是继续编辑和恢复的依据，HTML 是可导出的成果；这个选择牺牲了通用导入能力，以避免 HTML 解析后信息丢失和两套编辑模型兼容工作。

Supersedes ADR-0002, ADR-0003, and ADR-0004.

2026-08-29 更新：其中的导入暂缓已由 [ADR-0013](0013-restricted-html-import-visual-editing.md) 以受限形式解除；「GrapesJS 项目数据是编辑状态载体、HTML 是导出成果」的原则继续有效。
