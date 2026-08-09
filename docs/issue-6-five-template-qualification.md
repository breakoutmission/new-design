# Issue #6：五个首发模板资格验收

更新日期：2026-07-18

固定基线：`359c79b0b6ae0ca53a0b9593801c2aaa0c5c6509`
对应任务：[GitHub Issue #6](https://github.com/breakoutmission/new-design/issues/6)

## 结论

首发模板集固定为以下 5 个，且每个模板都通过固定结果浏览器回归与一次真实 Codex 全链路资格验收：

1. Grove
2. Blue Professional
3. Biennale Yellow
4. Cobalt Grid
5. Studio

“通过资格验收”只表示这些模板在本机 Windows、当前 Codex CLI、当前代码和本次材料下完成了所测链路。它不是长期稳定率、速度承诺、计费估算或外部用户效果。

## 模板包与来源

每个 `templates/<name>/` 包都包含：

- `SKILL.md`：模板提示和构图规则；
- `example.html`：完整 HTML 示例；
- `template.json`：模板元数据；
- `LICENSE`：MIT 许可证；
- `NOTICE.md`：Open Design 与上游来源说明。

四个新增模板从 Open Design 固定提交 `6b90486c97967633bfcfb0cd4d3c9b3314bf0caf` 选择性复制；对应上游均为 `zarazhangrui/beautiful-html-templates`。Grove 保留既有、已验证的 Open Design / Zara Zhang 来源说明与 MIT 许可证。共享输出契约由应用统一执行：完整 HTML、多页 `.slide`、可见页码、至少一个 `img[data-editable-image]`、普通图片使用 data URI、安全预览，以及自包含导出。

候选 Retro Windows 被淘汰，因为示例依赖外部 Chart.js 脚本，不符合首版“不依赖外部脚本、可安全预览和离线导出”的共同契约。没有为保留候选而放宽安全规则。

## 固定结果浏览器矩阵

| 行为 | Grove | Blue Professional | Biennale Yellow | Cobalt Grid | Studio |
| --- | --- | --- | --- | --- | --- |
| 新建页可辨认选择 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 代表视觉与安全预览 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 编辑页跨页导航 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 文字编辑、保存、重开 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 普通图片拖动、保存、重开 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 背景/装饰锁定 | 通过 | 通过 | 通过 | 通过 | 通过 |
| SVG / Logo 代表样本锁定 | 通过 | 不适用 | SVG 不适用 / 装饰通过 | SVG 通过 | 不适用 |
| 离线 HTML 翻页 | 3 页 | 10 页 | 8 页 | 8 页 | 12 页 |
| PDF 逐页与代表背景 | 3 页 | 10 页 | 8 页 | 8 页 | 12 页 |

固定结果入口：

```text
pnpm test:browser:templates
```

## 真实 Codex 资格矩阵

所有模板均使用同一公开产品路径完成：新建 → 选择模板 → 真实 Codex 生成 → 安全预览 → 文字编辑 → 后续页普通图片拖动 → 锁定页码装饰 → 保存 → 完成编辑 → 返回首页 → 重开 → 离线 HTML → PDF。

| 模板 | 页数 | 图片所在编辑页 | 耗时 | Input | Cached input | Output | Reasoning output | HTML / PDF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Blue Professional | 9 | 4 | 369.376 秒 | 255,349 | 204,800 | 18,834 | 5,266 | 通过 / 9 页 |
| Biennale Yellow | 8 | 6 | 495.658 秒 | 2,095,474 | 1,937,920 | 29,768 | 8,813 | 通过 / 8 页 |
| Cobalt Grid | 8 | 6 | 390.716 秒 | 191,915 | 126,464 | 19,539 | 5,513 | 通过 / 8 页 |
| Studio | 12 | 4 | 395.766 秒 | 578,441 | 508,928 | 20,401 | 3,619 | 通过 / 12 页 |
| Grove | 12 | 4 | 364.231 秒 | 262,347 | 198,144 | 18,106 | 3,448 | 通过 / 12 页 |

耗时来自 usage 事件的 `startedAt` / `finishedAt`；Token 字段原样来自当前 Codex CLI 的 `turn.completed.usage`。这些数字只用于记录本次资格运行，不用于推断价格、平均速度或生产容量。

本地诊断证据位于：

```text
output/playwright/issue-6-real/2026-07-18T10-22-27-712Z/
output/real-acceptance/issue-6-2026-07-18T09-41-57-566Z/
```

上述目录按仓库规则忽略，不作为提交内容；可重复的证据是测试脚本、模板包、本文矩阵和 GitHub Issue 验收记录。

## 验收暴露并修复的问题

1. Biennale 的嵌套标题最初只替换内层标签，导致新旧文字拼接；编辑器现会把选择提升到用户实际点击的整段文字组件。
2. Biennale 的标题层曾遮挡归一化普通图片；共享普通图片层级调整到装饰之上、页码之下。
3. Blue、Biennale、Cobalt 使用 `active` 类翻页，Grove、Studio 使用横向轨道；编辑器现同时支持两种布局，且不会破坏 Blue 计数器的内部节点。
4. PDF 打印规则原来只重置 Grove 的 `#deck`，Blue 的 10 页会叠成 1 页；打印契约现统一重置 `#deck`、`.deck`、`.stage` 和绝对定位幻灯片。
5. Studio 的背景层设置了 `pointer-events:none`；真实验收改点所有模板都可见且明确锁定的页码装饰，固定测试继续分别覆盖背景、SVG、Logo 和装饰。

## 未扩大范围

本任务没有加入任意 HTML 导入、模板编辑器、自动配图、外部脚本白名单或新生成格式。普通内容图片只做现有 data URI 占位/兼容归一化和既定拖动缩放；模板视觉资产仍保持锁定。
