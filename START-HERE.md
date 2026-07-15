# 从这里开始：DeckFlow Lite

不再打开之前的 HTML 第一课。当前方向已经改为：**把 `ppt-master` 的复杂命令行工作流，做成一个非技术用户也能操作的本地网页产品。**

## 产品一句话

DeckFlow Lite 让用户上传材料、查看并确认 PPT 设计建议，然后由本机 Codex 自动执行 `ppt-master`，最终集中展示 PPTX 和过程文件。

## 第一版只有一条流程

```text
上传 PDF / DOCX / Markdown
        ↓
填写主题、受众、时长等基本信息
        ↓
启动本机 Codex + ppt-master
        ↓
展示 ppt-master 的八项设计建议
        ↓
用户确认或修改
        ↓
恢复同一个 Codex 任务继续生成
        ↓
展示 PPTX、PDF/预览和产物目录
```

## 暂时不做

- HTML 可视化编辑
- 多 Skill 市场
- 多 Agent 切换
- 登录、云端同步和付费
- 直接兼容所有 Open Design 模板

## 为什么这仍然是一款完整产品

它具备真实用户输入、异步运行、人工确认、任务恢复、失败处理、产物输出和历史记录。面试展示重点不是功能数量，而是你如何把一个复杂 Skill 变成非技术用户可以完成的稳定流程。

## 接下来

产品规格见 [DeckFlow-Lite-PRD.md](./DeckFlow-Lite-PRD.md)。开发时严格按 P0 顺序推进，不同时制作 P1/P2。

