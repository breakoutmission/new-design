---
status: accepted
---

# 选择性复用 Open Design，并由 GrapesJS 统一负责编辑

一周 MVP 建成小型独立应用，不 fork 或改造完整的 Open Design 单体仓库；只选择性复用其五个模板、Codex 调用与事件解析思路，以及安全预览和导出相关实现。GrapesJS 是唯一的编辑引擎，GrapesJS 项目数据是项目编辑状态的技术载体；这避免同时维护 Open Design 源码补丁编辑与 GrapesJS 两套编辑模型，也缩短首个可展示版本的集成路径。