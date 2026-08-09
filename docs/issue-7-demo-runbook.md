# Issue #7：演示当天操作清单与备用方案

更新日期：2026-08-09

本清单只覆盖一周 MVP 最终演示。不新增模板编辑器、任意 HTML 导入、自动配图或 PPTX。

## 演示前 10 分钟检查

1. 确认当前机器已安装并登录 Codex CLI（`codex --version` 可运行）。
2. 打开独立 worktree：`G:\AITOOLS\NEW-DESIGN-ISSUE-7`。
3. 确认依赖已安装：`pnpm install`。
4. 确认备用成果仍在：
   - `output/issue-7-evidence/backup/issue-7-real-demo.html`
   - `output/issue-7-evidence/backup/issue-7-real-demo.pdf`
   - `output/issue-7-evidence/backup-data/projects/*.json`（可直接启动的已保存项目状态）
5. 可选：先跑固定回归 `pnpm test:browser`（不消耗真实 Codex）。

## 正式路径（真实材料 + 真实 Codex）

1. 双击 `start-ai-presentation-studio.cmd`。
2. 等待浏览器自动打开首页；后端终端窗口应最小化运行。
3. 点击 **新建项目**。
4. 粘贴用户确认的作品集正式材料全文（来源：`docs/portfolio/ai-presentation-studio-8-slide-source.md` 的副本，或用户当场提供的同一份材料）。
5. 选择 **Grove** 模板。
6. 点击 **发送**。
7. 观察生成阶段：正在准备材料 → 正在生成演示文稿 → 正在检查 HTML → 生成完成。
8. 在安全预览中用 **下一页** 或键盘左右方向键翻页。
9. 点击 **编辑**，修改一处可见文字，拖动一张普通内容图片。
10. 点击 **保存**，确认出现“保存成功”。
11. 点击 **完成编辑**，确认预览中仍能看到修改。
12. 点击 **返回首页**，再重新打开该项目，确认修改仍在。
13. 导出 **HTML**，离线打开并翻页。
14. 导出 **PDF**，确认页数与幻灯片一致。
15. 如需记录诊断数据，查看项目 generation 事件中的 input / cached input / output / reasoning output；**不要**把它们说成账单或长期性能。

## 现场话术边界

- 可以说：在本机 Windows、当前代码和这份真实材料下，完整链路可用。
- 不可以说：长期稳定、任意材料都成功、固定几分钟完成、已省下多少时间、已有外部用户验证。

## 备用路径 A：打开预先保存的项目状态

当现场真实生成失败、超时或材料临时不可用时：

1. 使用独立数据目录（data directory，即应用保存项目状态的专用文件夹）启动，避免覆盖用户原始数据：

```bat
start-ai-presentation-studio.cmd --acceptance --no-open --port 4318 --data-dir output/issue-7-evidence/backup-data
```

2. 验收脚本已经把有效项目写入该 data directory 的 `projects/` 下，不需要现场复制。
3. 打开浏览器 `http://127.0.0.1:4318`。
4. 从首页打开已保存项目，继续预览、简单编辑、保存、导出演示。

> 说明：备用项目已经是真实 Codex 生成并编辑过的状态。它证明交付物可恢复，不替代“现场生成成功”的理想路径，但足以完成一周展示。

## 备用路径 B：直接打开导出成果

1. 双击打开 `output/issue-7-evidence/backup/issue-7-real-demo.html`。
2. 使用页面翻页或键盘方向键浏览。
3. 如需交付文件，展示同目录 PDF。

此路径不经过编辑器，只证明导出成果可独立使用。

## 演示中发现问题时的处理

| 类型 | 处理 |
| --- | --- |
| 阻塞完整演示（无法生成、无法预览、无法保存/重开、无法导出） | 切备用路径；演示后在 #7 范围内按 TDD 修复并补公开回归 |
| 视觉偏好、完整 UI 重设计、范围外功能 | 记录但不在演示中扩展范围 |
| 生成过慢 | 说明这是本机一次性生成的诊断耗时，切备用项目继续编辑/导出演示 |

## 演示后

1. 保留截图、HTML、PDF、usage 与运行记录在 `output/` 忽略目录。
2. 不要把用户真实材料或敏感数据提交到 Git。
3. 若本次又发现新的演示阻断，先写失败浏览器回归再修。
