# AI Presentation Studio handoff

更新时间：2026-08-30（#21 合并后）

## 当前阶段：HTML 导入可视化编辑已全部收尾（#14–#21 全部完成并合入基线，Spec #13 无剩余票）

- **远端基线** `codex/ui-open-design-reference` 当前提交：`2fefa27`（#21 合并提交；含 #14 导入最小链路、#15 三档判定流水线、#17 元素复制与删除、#16 排版扩展与图片替换、#20 报告页完整三态、#19 导出放宽与离线静态翻页、#18 文本框拖拽与原位留白、#21 真实样本端到端收尾）
- **已完成票**：#14（导入演示最小链路，冻结三契约）、#15（导入检查规则与三档判定，契约扩展评论成文）、#17（可编辑元素复制与删除）、#16（编辑面板排版扩展与图片替换，[验收评论](https://github.com/breakoutmission/new-design/issues/16#issuecomment-5463493514)）、#20（报告页完整三态，[验收评论](https://github.com/breakoutmission/new-design/issues/20#issuecomment-5463562261)）、#19（导出放宽与离线静态翻页，[验收评论](https://github.com/breakoutmission/new-design/issues/19#issuecomment-5464124400)）、#18（文本框拖拽与原位留白，[验收评论](https://github.com/breakoutmission/new-design/issues/18#issuecomment-5467026124)）、#21（真实样本端到端验收与收尾，验收评论见 Issue #21）
- **待做票**：无。Spec #13 拆票全部关闭；下一步方向见 #21 验收评论的「后续建议」

### #21 能力落点（真实样本端到端验收与收尾）

- **固定样本集**：`fixtures/import-samples/`（5 份真实样本 + README 判定记录）——1 份本产品导出（fixture Grove 演示经真实编辑器保存后导出）、4 份外部真实 AI 生成样本（取自 zarazhangrui/beautiful-html-templates 固定 commit `e5e204f`，MIT）；覆盖三档判定与全部五类锁定类别
- **真实样本驱动的规则修订（TDD）**：页面识别词元收紧为「完整词 slide/page 或 词元+纯数字编号」，页内复合类名（slide-content/slide-chrome/slide-counter/chart-slide-layout）不再误判为页（studio 误报 27 页→实际 12，8-bit-orbit 误报 23 页→实际 10）；共享谓词 `isSlideTokenClass` 同步对齐导出 `countSlides` 与静态翻页徽章注入，报告页数=导出徽章=PDF 分页三方一致（3/12/8/10 全部验证）；契约字段零改动，修订用例 B7–B9 + J 组真实样本回放（模块缝共 51 条）
- **全链路 E2E**：`tests/browser/issue-21-real-samples.mjs`（已入 `test:browser` 链与独立 `test:browser:issue-21-real-samples`）——四份通过档样本各走完 上传→报告→编辑（排版三项/图片替换/复制/删除/拖拽留白）→保存→重开→导出 HTML+PDF，复制与删除的跨保存重开保持直接断言；暂不支持样本（retro-windows，Canvas×3）验证正确档位、可读原因与不创建项目；项目记录契约字段与原始文件字节一致性逐项断言
- **边界如实记录**：样本集仅 5 份，「5/5 判定正确」不外推为工具兼容率；非定位 .slide 的拖拽落点参照未覆盖（样本页面容器均有定位）；图片替换在样本集内仅产品导出样本含可编辑图片；证据库 #21 条目已按 VERIFIED（带边界）成文
- **测试**：合并结果上全套 `pnpm run test:browser` PASS、退出码 0（模块缝 51 条 + 全部浏览器链）

### #18 能力落点（文本框整框拖拽与原位留白）

- **编辑器逻辑**：`public/textbox-drag.js`（幻灯片参照坐标 + 夹紧；流式转自由定位时在同父原索引插入空占位组件 `data-aps-placeholder`，经 `addStyle` 保留原尺寸与原 margin；提交在同一同步调用栈内完成 → backbone-undo 按调用栈合并为一步撤销；流式提交同时 `transform:none` 中和样式表 transform 防落点偏移）
- **编辑器接入**：`public/editor.js` 文本交互三函数（begin/move/finish + pointercancel 只恢复不提交兜底 + 多指保护）；`beginTextInteraction` 校验事件来源属画布 frame 文档（防宿主按钮坐标巧合重叠的幻影拖拽）；编辑期注入 CSS：选中元素 `cursor:move`、占位虚线 + 「原位置留白」`::after` 标注（不入项目数据，预览/导出不可见）；面板零改动（点击占位盒走既有「不可编辑提示」）
- **测试**：`tests/browser/issue-18-textbox-drag.mjs`（生成 Grove + 导入样本双路径：落点、占位几何、相邻不回填、一次撤销/重做、编辑期虚线标注、预览留白不塌陷无虚线、跨会话保持、历史清空、绝对定位二次拖拽、锁定元素拖拽无效、原地点击不进栈、宿主侧栏点击不改写文档、带 transform 落点、复制/删除与占位组合；已入 `test:browser` 链与独立 `test:browser:issue-18-textbox-drag`）；合并结果上全套 63 条 PASS
- **边界与已知 workaround（后续票必读）**：
  - **avoidInline 序列化**：组件样式必须走 `addStyle` 进样式模型（序列化为 `#id` 规则进 `data-editor-styles`）；直接写 `attributes.style` 会在 `getHtml()` 被丢弃且不生成规则（#18 踩过：占位盒预览塌陷为 0 高）
  - **撤销分组**：backbone-undo 以同步调用栈为合并窗口，多次模型改动放在同一同步函数里即一步撤销
  - **画布事件路由**：iframe 画布 pointer 事件经宿主监听器接收；做画布交互必须校验 `event.target` 属画布 frame 文档
  - 拖拽把流式文字冻结为固定 px 盒（PPT 式固定框）；删除已拖拽文本框留白保留、复制不复制占位；画布内 pointercancel（触摸中断）引擎不转发（与图片拖拽同构）；保存链路不剥离占位盒、PDF 留白保留

### #19 能力落点（导出放宽与离线静态翻页）

- **实现**：`src/server.mjs` 导出端点按 `sourceType` 分流——imported 走 `prepareImportedExportHtml`（完整性与禁令断言 + `prepareImportedHtml` 二次安全化 + 外部样式表 link 剥离 + 非 https 图片资源拒绝 + 注入静态翻页片段），generated 保持 `prepareSelfContainedHtml` 一行未改；PDF 路径零改动。
- **资源口径**：保留 `<img>` src/srcset 与 CSS `url()` 的 https 图片/字体引用（与导出文件自带导入 CSP `img-src/font-src https:` 一致）；`@import`、`http://` 图片、媒体/嵌入元素 https 引用、`javascript:` 一律拒绝；`file://` 由 FORBIDDEN_HTML_PATTERNS 全局禁止；重复导出幂等（先剥离旧翻页片段）。
- **静态翻页**：导出注入 `<style data-product-static-paging>`（纵向排列 + scroll-snap 逐页吸附）+ 每页 `<span data-product-page-badge>N / 总页数</span>`（写死 DOM 文本，总数与 PDF 分页同源 `countSlides`）；产品词已入 `CONTEXT.md`（静态翻页/导出成果修订）与 `docs/GLOSSARY.md`。
- **测试**：`tests/browser/imported-export.mjs`（四段：https 图片导出与离线翻页、在线图片加载、导入 PDF 页数尺寸、生成项目拒绝回归），已入 `test:browser` 链与独立脚本 `test:browser:imported-export`；合并结果上全套 62 条 PASS。
- **测试环境注意**：查看导出文件必须用**独立浏览器实例**——共享浏览器里后台页的合成器帧会被挂起、吸附动画不推进，且页面内 `waitForFunction` 轮询被节流（rAF/定时器）；断言请用 Node 侧 evaluate 轮询（见 `waitFor` 助手）。导出流程的中间状态文案瞬时即逝，测接口响应与终态提示。

### #16 能力落点（排版扩展与图片替换）

- **编辑器逻辑**：`public/editor-controls.js`（字体/粗细选项与 computed 匹配、字间距 px 换算、本地图片读 data URL、`syncImportedImageMarks` 导入项目图片编辑标记——与 #15 报告「可编辑图片」口径一致、`repairImageSrcProps` 撤销/重做后修复 GrapesJS 图片 `src` 序列化脱节）
- **编辑器接入**：`public/editor.js` 的 `clearTextStyle`/`replaceSelectedImage`（挂载返回 API）、`selectedTextState` 新增 fontFamily/fontWeight/letterSpacing、undo/redo 内调用 `repairImageSrcProps`；`public/app.js` 面板接线与图片文件读入
- **面板 UI**：`public/index.html` 面板顺序为 `#text-controls`（文字内容/字体/字号+粗细/颜色+字间距/行距/对齐）→ `#element-actions`（#17）→ `#image-controls`（图片描述+替换图片）→ `#locked-hint`（锁定提示框）；文字控件与图片控件按选中类型互斥显示（对齐原型屏幕 10/11）
- **测试**：`tests/browser/issue-16-editor-controls.mjs`（生成+导入双路径，已入 `npm run test:browser` 链）；模块缝新增 I1 用例（共 43 条）；全套 61 条 PASS
- **边界与已知 workaround**：GrapesJS 0.23 图片组件撤销快照丢弃 `src` 模型属性（引擎缺陷，#18 若新增撤销路径必须保留 undo/redo 内的 `repairImageSrcProps` 调用）；锁定状态断言统一用 `page.locator("#selection-status", { hasText: "已锁定：…", })` 模式，勿用全文 `getByText` 精确匹配（提示框会严格模式冲突）；单图无大小上限（沿用导入 10 MB 文件级上限）

### #17 能力落点（复制/删除）

- **编辑器逻辑**：`public/element-operations.js`（副本生成与落点：绝对定位按幻灯片参照偏移 24px 夹紧、流式相邻插入；共享 `clamp`）
- **编辑器接入**：`public/editor.js` 的 `copySelection`/`deleteSelection`（挂载返回 API）+ 选中状态清理（`clearSelectionState`/`selectionIsLive`，撤销/重做后悬空引用防护）
- **面板 UI**：`public/index.html` 的 `#element-actions`（复制/删除药丸按钮，锁定时隐藏）；`public/app.js` 只改了元素选择面板接线；`public/style.css` 只改了面板按钮样式（红色用 `--danger` token）
- **测试**：`tests/browser/element-copy-delete.mjs`（生成+导入两条路径，已入 `npm run test:browser` 链与独立脚本 `test:browser:element-copy-delete`）；全套 59 条 PASS
- **边界**：导入项目可编辑图片当前=自带 `data-editable-image` 的图片（#16 合入后普通图片接入走同一 `handleSelected` 路径）；全出血元素副本会夹紧回原位（自动选中可拖出）；偏移与既有图片拖拽共享「幻灯片参照」坐标约定

### #20 能力落点（报告页完整三态）

- **界面结构**：`public/index.html` 的 `#import-report-view`（`#import-verdict` 徽标胶囊带图标 + `#import-report-note` 检查备注 + 文件摘要卡含 `#import-view-original` 查看原文件 + `#import-rules` 规则清单 / `#import-content-groups` 分组卡 + 页脚三按钮 `#import-home-action`/`#import-reupload`/`#import-open-project`）
- **渲染逻辑**：`public/app.js` 的 `showImportReport` 按三档分流——完全可编辑=全部规则+「已创建演示项目」+返回首页/进入编辑；部分可编辑=`renderImportContentGroups` 分「可编辑内容 N 类 / 将被锁定的内容 N 类」两组卡（类别+数量+原因/说明）+重新上传/仍要进入编辑；暂不支持=仅 `status:"fail"` 原因行（「原因」徽章）+未创建项目说明+返回首页/重新上传（深色）；辅助函数 `importRuleRow`（规则行与分组行共用）、`importFileMetaText`（大小·页数·图片数·相对检查时间）、`setImportOpenProject`
- **查看原文件**：blob 只读新标签打开**当前报告对应**的上传文件（`state.reportedImportFile`，在 `showImportReport` 时绑定；勿改回 `state.pendingImportFile`——重新上传选新文件又取消时会指向错误文件）
- **测试**：`tests/browser/import.mjs` 三档完整路径（含「仍要进入编辑」走完编辑保存重开、暂不支持「重新上传」完整重传回路、弹窗内容=原始上传字节）；截图 `output/playwright/import-report-green/partial/unsupported.png` 对照原型屏幕 7/8/9；全套 61 条 PASS（合并结果）
- **边界与注意**：报告页能力说明文案来自检查器 `editableContent[].note`（#16 同步编辑面板能力），测试按「UI 文本 === 报告数据」绑定断言，**不要钉死文案**；0 计数类别不渲染、不占「N 类」；徽章计数断言要收敛到 `#import-report-view` 内（隐藏首页的项目状态徽章会干扰全文匹配）；部分可编辑档报告无规则清单（分组卡替代），#16/#17 旧断言已在基线 `043055d` 同步修正


- **执行方式**：每张票开**全新会话**执行，票与票之间清空上下文；票内 TDD（先失败测试后实现），收尾跑双路代码审查再提交。
- **并行说明**：#14–#20 已全部合入，暂无并行票。合回基线流程（#16/#17/#20/#18 已示范）：先把远端最新基线并进本票分支、手工解决冲突（`package.json` 测试链与 `docs/PM-CAREER-EVIDENCE.md` 末尾条目是惯常冲突点，两边都保留）、在合并结果上跑全套测试再推送；基线分支被 `NEW-DESIGN-UI` worktree 检出且本地指针常落后，在本票 worktree 用 `git checkout --detach origin/codex/ui-open-design-reference` + `git merge --no-ff <本票分支>` + `git push origin HEAD:codex/ui-open-design-reference`（#18 用的此方式），或建临时分支 `tmp/<票>-merge` 后 `git push origin tmp/<票>-merge:codex/ui-open-design-reference`（#20 用的此方式）。注意本机 git 配置的代理（127.0.0.1:7897）可能未运行，推送连接失败时用 `git -c http.proxy= -c https.proxy= push ...` 直连。
- **测试缝**：只用两条——公开浏览器行为（现有浏览器测试体系）+ 导入检查器模块缝（HTML 字符串进、报告与处理后 HTML 出，用固定样本）。不再新增其他缝。

## 接手约束

1. 先完整阅读 `AGENTS.md`、`CONTEXT.md`、accepted ADR（尤其 0009/0010/0013）、Spec #13、本文件和所接票的全部 Blocked by。
2. 不重新进行产品访谈，不重开已确认的访谈结论、Spec 与 ADR；实现中发现成本失控或架构缺口，带证据回对应 Issue 请用户重新权衡，不默默降级。
3. **当前工作区存在大量未提交内容**：本次规划产物（`CONTEXT.md`、`docs/adr/0013`、ADR-0009 注记、`docs/PM-CAREER-EVIDENCE.md`、`prototype/import-demo-ui/`、`.scratch/`、本文件）以及此前遗留改动。未经用户明确要求，不得提交、清理、reset、stash、checkout 或 pull。
4. 原型目录 `prototype/import-demo-ui/` 是 throwaway 原型（非生产代码），其视觉与文案是 #16–#20 的验收依据；实现不得整体照搬原型代码。

## 历史里程碑

- 一周 MVP 与五模板资格验收已完成（Issue #1–#7 关闭）；回归 Bug #8/#9 已修复关闭。
- Issue #11 的界面重构已于 2026-08-10 完成实现并通过全套回归（GitHub 状态以 Issue 列表为准）。
- Spec #13（HTML 导入可视化编辑）的全部拆票 #14–#21 已于 2026-08-30 完成验收并关闭；真实样本判定记录见 `fixtures/import-samples/README.md`。
- 历史 Issue #6 真实验收矩阵等数据见 `docs/PM-CAREER-EVIDENCE.md` 与 `docs/issue-6-five-template-qualification.md`。

## 工作区说明

- 主工作区：`G:\AITOOLS\NEW-DESIGN`（当前分支 detached HEAD，压有未提交内容，是保险副本）
- 票工作区：`G:\AITOOLS\NEW-DESIGN-21`（#21，已收尾可删）、`G:\AITOOLS\NEW-DESIGN-14`（#14/#15/#20，可复用）、`G:\AITOOLS\NEW-DESIGN-16`（#16，已收尾可删）、`G:\AITOOLS\NEW-DESIGN-17`（#17）、`G:\AITOOLS\NEW-DESIGN-18`（#18，已收尾可删）、`G:\AITOOLS\NEW-DESIGN-19`（#19，已收尾可复用，本地分支已合入基线）、`G:\AITOOLS\NEW-DESIGN-UI`（挂着基线分支的 worktree，本地指针可能落后，以远端为准，勿动）
- 本文件只用于交接，不属于任何提交，不得提交。
