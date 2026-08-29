---
status: accepted
---

# 解除 HTML 导入暂缓，以受限形式支持导入编辑

一周 MVP 交付后，导入 AI 生成的简单 HTML 演示文稿成为下一个用户价值点。决定解除 ADR-0009 对导入的暂缓，但以受限形式进行：仅接受单个自包含 HTML 文件；导入检查按逐条规则判定「完全可编辑 / 部分可编辑 / 暂不支持」三档并出具报告，仅前两档创建演示项目；编辑沿用既有 GrapesJS 引擎（ADR-0010），GrapesJS 项目数据仍是唯一编辑状态载体（延续 ADR-0009 的原则），不为导入另建自定义幻灯片数据模型；导入副本移除全部脚本并由产品页面导航接管翻页，CSS 动效转为静态，脚本驱动的动效按不支持处理；导入项目的 HTML 导出放宽为允许保留 https 图片链接（仍禁止本地 file:// 与脚本）。

Supersedes the import deferral in ADR-0009（其「项目数据是编辑状态载体」原则继续有效）; revives the capability-check direction of ADR-0002 and the single-file, copy-into-project boundaries of ADR-0003/0004 with the modifications above.

Considered options: 自研类 PPT 编辑器（否决——与 ADR-0010 单一编辑引擎冲突且为重复建设）；为导入设计独立的幻灯片 JSON 模型（否决——会形成两套编辑数据模型，正是 ADR-0009 曾要避免的局面）；继续暂缓（否决——主链路已验证，受限导入的价值大于剩余风险）。
