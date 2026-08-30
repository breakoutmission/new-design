# 导入演示固定样本集（Issue #21）

Spec #13「测试决定」要求的固定样本集：为页面识别与三档判定提供可回放的真实样本材料。
本目录随仓库提交，样本文件不做任何改写；真实样本的判定档位由 `tests/import-checker.mjs`
J 组用例锁定，公开界面全链路（上传 → 报告 → 编辑 → 保存 → 重开 → 导出）由
`tests/browser/issue-21-real-samples.mjs` 回放。

## 样本清单与判定记录（2026-08-30，导入检查器当前版本）

| 文件 | 来源 | 判定档位 | 页数 | 关键报告数据 |
| --- | --- | --- | --- | --- |
| `AI 演示工作流.html` | **本产品导出**（fixture 生成的 Grove 演示项目经编辑器保存后由导出接口导出） | 部分可编辑 | 3 | 锁定：SVG 装饰图形 1 处（Grove 模板装饰）、页眉 Logo 1 处；已移除 1 段脚本（产品自带的演示翻页脚本）；6 处 CSS 动画转静态；可编辑文字 5 处、图片 1 张 |
| `studio.html` | 外部工具（上游模板集合，见下） | 完全可编辑 | 12 | 可编辑文字 36 处；无锁定内容；22 处 CSS 动画转静态；已移除 1 段脚本 |
| `cobalt-grid.html` | 外部工具（上游模板集合） | 部分可编辑 | 8 | 锁定：SVG 装饰图形 5 处、背景渐变 1 处（`.stage::before` 网格）；可编辑文字 18 处 |
| `8-bit-orbit.html` | 外部工具（上游模板集合） | 部分可编辑 | 10 | 锁定：背景渐变 8 处、背景图 1 处、脚本动效 2 处（`requestAnimationFrame`）；可编辑文字 46 处 |
| `retro-windows.html` | 外部工具（上游模板集合） | 暂不支持 | — | 原因：页面包含 Canvas/WebGL 画布内容（3 处 `<canvas>`）；不创建项目记录 |

覆盖情况：三档判定全覆盖；锁定类别覆盖 SVG 装饰、背景渐变、背景图、页眉 Logo、脚本动效全部五类。

> 页数判定记录为 Issue #21 修订后的口径：`slide-content`、`slide-chrome`、`slide-counter`、
> `chart-slide-layout` 这类页内复合类名不再计入页数（studio 初测曾误报 27 页 / 实际 12 页，
> 8-bit-orbit 初测曾误报 23 页 / 实际 10 页；修订用例见 `tests/import-checker.mjs` B7–B9）。

## 出处与许可

- 外部样本来自真实外部 AI 演示模板集合
  [zarazhangrui/beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates)（MIT），
  取自提交 `e5e204fb1f3b06290846e7dcd7aceddabeceec8c` 的
  `templates/<样本名>/template.html`，字节原样拷贝，未做任何修改。
  本产品五个演示模板的 `example.html` 亦来自该集合（见 `templates/*/NOTICE.md`）。
- `AI 演示工作流.html` 由本产品产生：fixture 生成链路产出 Grove 演示
  （内容即 `fixtures/grove-deck.html`，一周 MVP 演示所用真实项目材料），经真实编辑器「保存」
  获得 GrapesJS 项目数据后，调用产品「导出 HTML」接口导出的原样字节。
  该样本再导入判为「部分可编辑」是当前口径下的预期结果：导出文件带有 Grove 模板的 SVG
  装饰与页眉 Logo（锁定显示），并自带演示翻页脚本（导入时移除、翻页由产品页面导航接管）。
- 样本仅用于自动化测试与验收回放，不改变「不承诺兼容所有 AI 工具输出」的范围边界
  （Spec #13）；对外兼容性声明以本样本集通过为准。

## 播放方式

```
node tests/import-checker.mjs                 # J 组：固定样本判定档位与关键报告数据
node tests/browser/issue-21-real-samples.mjs  # 公开界面全链路（含导出 HTML/PDF）
```
