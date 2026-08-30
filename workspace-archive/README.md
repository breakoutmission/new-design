# workspace-archive：主工作区本地文件备份归档

> **这个文件夹是什么**：2026-08-30 应仓库所有者要求，把当时只存在于本机主工作区
> （`G:\AITOOLS\NEW-DESIGN`）、**没有任何提交、没有任何远端备份**的本地文件，
> 原样收进仓库保存。这样即使主工作区被误清理或磁盘出问题，这些材料也不会丢。
>
> **重要**：这些是**历史规划与学习材料**，不是产品文档——它们记录的是当时的想法、
> 原型和过程，不代表当前代码的行为。主工作区里的原件全部保留未动（未删除、未移动），
> 本文件夹只是副本。

## 文件清单与出处映射（防止忘记每个东西是什么）

| 归档位置 | 原路径（主工作区） | 它是什么 |
| --- | --- | --- |
| `handoff.snapshot-2026-08-30.md` | `handoff.md` | 交接文档快照（2026-08-30，#21 收尾时点）。**实时版仍在主工作区根目录、按约定不提交**；要找最新状态看主工作区原件，不要看这里 |
| `docs/portfolio/ai-presentation-studio-8-slide-source.md` | `docs/portfolio/` 同名 | PM 求职作品集的 8 页项目介绍源稿（AI Presentation Studio 项目叙事） |
| `lessons/0001-merge-vs-pr-and-branch-roles.md` | `lessons/` 同名 | 学习笔记第 1 课：什么时候合并、什么时候开 PR、每条分支的角色（以本仓库真实合并为教材） |
| `reference/0001-git-merge-pr-branches.md` | `reference/` 同名 | 上述课程配套的速查卡（开票前扫一眼的分支操作参考） |
| `issue UI/UI参考.png` | `issue UI/UI参考.png` | Issue #11（UI 重构）用的 Open Design 界面参考图（用户提供） |
| `prototype/open-design-grapesjs/` | `prototype/open-design-grapesjs/` | 技术验证原型：GrapesJS 能否承载编辑的早期试验（含 `.prototype-data/project.json` 存档），结论已沉淀进 ADR-0010 |
| `scratch/import-editor/` | `.scratch/import-editor/` | Spec #13 规划期的草稿：spec issue 正文草稿与 8 张拆票草稿（t1–t8），成品即 Issue #13–#21 |

## 为什么不直接提交在原路径

- 原路径有的与仓库现行约定冲突：`handoff.md` 按约定不属于任何提交；`.scratch/`、
  `archive/` 等在 `.gitignore` 里被视为本地产物。
- 集中放在一个带说明的文件夹下，将来一眼能看出"这是一次性备份归档"，不会误当成
  活跃文档来维护。

## 后续维护约定

- 本文件夹**只增不改**：归档后如需更新这些材料，在主工作区原路径修改，再整批复制
  进来追加新的快照（文件名带日期），不覆盖旧快照。
- 新增归档时在本 README 的清单表里加一行，写清出处与用途。
