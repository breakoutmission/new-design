# 导入检查规则表

导入检查器（`src/import-checker.mjs`）把上传的自包含 HTML 评估为「完全可编辑 / 部分可编辑 / 暂不支持」三档，并产出逐条规则的导入检查报告。本文件是规则表的成文位置；每条规则的行为由 `tests/import-checker.mjs` 的固定 HTML 样本锁定（模块缝），公开浏览器行为由 `tests/browser/import.mjs` 抽样验证。

本文档与实现由 Issue #15 建立；Issue #14 冻结的报告契约（字段名与类型）保持不变，扩展内容见文末「契约扩展记录」。

## 规则评估顺序（短路）

```
file-type → file-size → file-integrity
  → framework-detection、dynamic-content、restricted-embeds（硬性不支持组，整组并列评估）
  → page-structure
  → locked-content（仅有锁定内容时出现，status=warn）
  → animation-static → content-inventory → script-removal
```

- 任一 `fail` 即判「暂不支持」，报告只包含已评估的规则（#14 冻结语义）。
- 硬性不支持组整组评估、并列展示全部命中原因（对齐原型屏幕 9 的多原因报告）。
- 通过全部规则后：存在锁定内容（`lockedElements` 非空）判「部分可编辑」，否则「完全可编辑」。

## 页面识别规则表（优先级从高到低，先命中先用）

识别在移除全部脚本之后的 HTML 上执行；命中任一规则后不再叠加低优先级规则，同一元素只计一次。全部规则未命中则 `page-structure` 判 fail（「无法识别演示页面」）。

| 优先级 | 规则 id | 启发式 | 正例固定样本 | 反例固定样本 |
| --- | --- | --- | --- | --- |
| 1 | `slide-class-token` | class 含独立词元 `slide`（以空格 / 连字符 / 下划线为边界）的容器各为一页 | B1 正例：`<section class="slide">` ×3 → 3 页 | B1 反例：`class="slideshow"`（无词元边界）不识别 |
| 2 | `page-class-token` | class 含独立词元 `page` 的容器各为一页，并补 `slide` 语义类 | B2 正例：`<section class="page">` ×2 → 2 页 | B2 反例：`class="homepage-link"` 不识别 |
| 3 | `page-data-attribute` | 带 `data-slide` / `data-page` 属性的容器各为一页，并补 `slide` 语义类 | B3 正例：`<section data-slide="1">` ×2 → 2 页 | B3 反例：`data-slider-id` 不识别 |
| 4 | `sibling-sections` | 两个以上并列 `<section>` 区块各为一页，并补 `slide` 语义类 | B4 正例：3 个裸 `<section>` → 3 页 | B4 反例：并列 `<article>` 不识别 |
| 5 | `single-fullscreen-section` | 全文唯一 `<section>` 且样式声明全屏尺寸（`height/min-height: 100vh|100%`）时回退为单页 | B5 正例：唯一 `<section style="min-height:100vh">` → 1 页 | B5 反例：单个普通 `<article>`（无全屏尺寸）不识别 |

优先级组合样本见 B6：`page` 类名优先于 `data-slide` 属性；`slide` 类名优先于 `page` 类名且同一元素不重复计数。

## 三档判定映射

| 判定 | 条件 |
| --- | --- |
| 完全可编辑 | 识别出页面，且无锁定内容 |
| 部分可编辑 | 识别出页面，且 `lockedElements` 非空（仍创建演示项目） |
| 暂不支持 | 任一规则 `fail`（不创建演示项目，不返回处理后 HTML） |

同一样本重复检查除 `checkedAt` 时间戳外结果完全一致（D1 用例）。

## 硬性不支持原因

| 规则 id | 触发条件（启发式） | 报告文案 |
| --- | --- | --- |
| `framework-detection` | 脚本 API 特征只在脚本标签文本里匹配（如 `react-dom` 脚本、`ReactDOM`、`createApp`），框架专属属性 / 全局标记在全文匹配（如 `data-reactroot`、`data-v-app`、`ng-version`）；正文提及框架名称不触发 | 标题「检测到 React 框架」；详情「页面结构由框架接管，无法安全转为可编辑内容」 |
| `dynamic-content` | 存在脚本，且（空的应用根容器 `id` 为 root/app/__next/q-app）或（无任何 `<img>`/`<svg>` 视觉元素且全文静态文字不足 20 字符）；图片和 SVG 也算内容，纯图片翻页演示不误判 | 标题「页面内容由脚本动态生成」；详情「检查时得不到稳定页面，无法识别文字与图片」 |
| `restricted-embeds` | `<canvas>` / WebGL 上下文（脚本内 `getContext('webgl…')`）/ `<iframe>` | 「页面包含 Canvas/WebGL 画布内容」「页面包含 iframe 嵌入」等 |

文件级原因（沿用 #14 并按 #15 要求细化）：

| 规则 id | 触发条件 | 报告文案 |
| --- | --- | --- |
| `file-type` | 文件名非 `.html`/`.htm` | 「仅支持 .html 演示文稿文件」 |
| `file-size` | 超过 10 MB 上限 | 「文件超过 10 MB 大小上限」 |
| `file-integrity` | 缺 doctype / `<html>` / `</html>` | 「不是完整的 HTML 文件」 |
| `file-integrity` | `<script>` 标签未闭合 | 「存在未闭合的脚本标签，无法安全解析」 |
| `file-integrity` | `<!--` 与 `-->` 数量不配对（HTML5 空注释写法 `<!-->`/`<!--->` 先剔除再计数，不误报） | 「存在未闭合的注释，部分内容无法正常显示」 |
| `page-structure` | 页面识别规则表全部未命中 | 「无法识别演示页面」 |

## 锁定元素清单（部分可编辑档）

锁定元素保持原样显示、不可编辑（沿用现有「不可编辑提示」交互），报告在 `lockedElements` 数组中列明类别、数量、原因；`locked-content` 规则（`status: "warn"`）的详情逐类别列出数量，如「SVG 装饰图形 1 处、背景渐变 1 处、页眉 Logo 1 处保持原样显示，不可编辑」。

| 类别 | 启发式 | 原因文案 |
| --- | --- | --- |
| SVG 装饰图形 | `<svg>` 元素计数 | 第一版不编辑矢量图形，保持原样显示 |
| 背景渐变 | 样式中 `background(-image): … gradient(…)` 声明 | 背景渐变不提供编辑，保持原样显示 |
| 背景图 | 样式中 `background(-image): … url(…)` 声明 | 背景图不提供选择与修改，保持原样显示 |
| 页眉 Logo | `<header>` 内 `<img>`，或标签属性含 logo 字样的 `<img>` | 品牌标识不提供替换，保持原样显示 |
| 脚本动效 | 原文件脚本中的 `requestAnimationFrame` / `.animate(` 调用（`setInterval` 翻页计时不算——翻页由产品页面导航接管，Spec #13） | 依赖原文件脚本的动效随脚本移除冻结为静止画面 |

可编辑内容盘点（`editableContent`，全档位提供）：页眉/导航/页脚之外的 `h1–h6`、`p`、`li`、`blockquote` 计「可编辑文字」；其中不含 logo 字样的 `<img>` 计「可编辑图片」。

## 脚本移除与动效转静态

- 移除全部内联与外部 `<script>` 及内联 `on*` 事件属性，`scriptCount` 计入报告（`script-removal` 规则标题动态含数量）。
- CSS 动画与过渡转静态只作用于样式上下文（`<style>` 块与 `style` 属性）：删除其中 `@keyframes` 定义；`animation*` / `transition*` 声明的值置为 `none`（已是静态值的声明不变）。正文文本中出现的 `animation:` 字样不受影响（C9 用例）。转换处数 = 实际置 none 的声明数 + 移除的 keyframes 定义数，计入 `animationCount` 与 `animation-static` 规则标题。
- 脚本驱动的动效不转换：相关脚本随脚本移除消失，动效冻结为静止画面，按锁定类别「脚本动效」计（判部分可编辑）。

## 已知边界

- 页面识别与锁定 / 盘点为正则级启发式（非 DOM 解析）：同名标签嵌套（如 `<li>` 套 `<li>`）按最近闭合近似计数，可能低估；判断以固定样本集通过为准。
- 畸形检测覆盖未闭合脚本标签、未闭合注释与缺必要骨架；不做完整标签配对校验。
- 兼容性声明不承诺覆盖所有 AI 工具输出；真实外部样本验收属 #21。

## 契约扩展记录（Issue #15，向后兼容）

在 #14 冻结契约（https://github.com/breakoutmission/new-design/issues/14#issuecomment-5461715355）基础上只做增量，不改动既有字段名与类型：

1. `rules[].status` 新增枚举值 `warn`（现用于 `locked-content`）；`pass` / `fail` 语义不变。
2. 新增规则 id：`framework-detection`、`dynamic-content`、`restricted-embeds`、`locked-content`、`animation-static`、`content-inventory`。
3. `verdict` 从「完全可编辑 | 暂不支持」扩展为可产出全部三档（新增「部分可编辑」，`passed` 仍等价于 `verdict !== "暂不支持"`）。
4. 报告新增可选展示字段：`animationCount`（number）、`lockedElements`（`{category, count, reason}[]`）、`editableContent`（`{category, count, note}[]`）。
5. 评估顺序在冻结五条的相对顺序之间插入新规则（`script-removal` 仍最后）；硬性不支持组整组评估后并列展示。
6. `page-structure` 的 `detail` 现注明命中的页面识别规则（如「通过「slide 类名规则」识别出 3 页幻灯片」）。
