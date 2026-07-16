# AI Presentation Studio 工作流与 Matt Pocock Skills 审计

日期：2026-07-15

## 结论

当前最需要优化的不是继续增加技能，而是先把并行开发隔离开。审计期间，同一个工作目录里的 Issue #4 文件仍在变化，同时治理文档尚未形成独立提交。只要多个线程共用一个工作目录，测试、审查和精确提交都可能混入别人的改动。

Matt Pocock 的 skills 是小型、可组合的工作方法，不适合被当成一条包办所有环节的重流程。当前仓库已具备 issue tracker、triage、domain docs、glossary 等 setup 产物，无需重跑 setup 或批量重装技能。官方入口与当前清单见 [mattpocock/skills](https://github.com/mattpocock/skills)。

## 优先优化项

1. **一个 Issue 一个 branch + worktree**：worktree 是 Git 为同一个仓库分出的另一套独立工作目录。正式集成分支只接收完成并验收的 Issue，禁止两个写入线程共用 `G:\AITOOLS\NEW-DESIGN`。
2. **治理文档单独提交**：`AGENTS.md`、domain、glossary、career evidence 和 handoff 的规则变化应形成 docs-only commit，不与功能代码混交。
3. **建立固定开发门禁**：每个已确认 Issue 使用 `implement -> tdd -> code-review -> check -> 精确暂存 -> push/close -> handoff`。
4. **统一验证入口**：增加一个跨平台 `pnpm check`，先承载快速静态检查和相关浏览器测试；完整浏览器回归以后放到 pre-push 或 CI，不必在每次小提交前运行。
5. **缩短 handoff**：只保留基线提交、当前 Issue、脏文件、验证命令、已知风险和推荐技能；验收标准、ADR 和 diff 用链接引用，不重复抄写。工作区与临时目录保存同一份内容并校验一致性。
6. **按 Issue 拆浏览器测试**：共享 server/browser harness，但不要把后续所有行为继续堆进一个超长测试文件。等 MVP 主链稳定后再评估迁移到 Playwright Test runner。

## Matt skills：现在纳入

### `implement`

把它作为“执行一个已经确认的 Issue”的入口。官方实现流程会在约定的接口处调用 TDD，并在完成前调用 code review；这正好适合当前按 GitHub Issue 交付的节奏。前提是任务位于干净、隔离的 worktree 中。来源：[implement](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md)。

### `tdd`

继续使用，但改成“一条可见行为 -> 红灯 -> 最小实现 -> 绿灯”的纵向切片，避免一次先写一整批测试、再一次实现全部功能。测试应经过公开接口验证行为，不直接依赖内部实现。来源：[tdd](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md)。

### `code-review`

设为提交前必经门禁。它分两条轴检查：是否符合仓库规范，以及是否满足 Issue/Spec；这比只看测试是否通过更完整。每次明确指定固定基线提交，避免把并行改动混入审查范围。来源：[code-review](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md)。

### `diagnosing-bugs`

Issue #4 涉及子进程、取消、并发与时序，出现偶发失败时应立即切换到该技能：先稳定复现和缩小问题，再列假设、增加观测、写回归测试，最后清理诊断代码。来源：[diagnosing-bugs](https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md)。

### `handoff`

继续使用，但按本仓库“双份同步”的规则做一层适配。官方原则是不要在交接里复制 PRD、Issue、ADR、commit 或 diff，而应引用它们；当前长交接应压缩成可快速恢复上下文的索引。来源：[handoff](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md)。

## 条件使用

- **`codebase-design`**：当生成任务生命周期、子进程注册表或取消状态让 `server.mjs` 继续膨胀时，用它划出小接口、深模块和可测试边界；不要借机重做整个架构。来源：[codebase-design](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md)。
- **`domain-modeling`**：只在 `生成中 / 已取消 / 失败 / 可编辑` 等状态发生歧义时使用；不重新访谈已确认的产品决定。来源：[domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md)。
- **`research`**：只用于会变化或不确定的外部事实，如 Playwright、GrapesJS、Node 子进程行为。本次审计即使用了它。
- **`prototype`**：只回答新的高风险设计未知，不用于已经由 Spec 确认的功能。
- **`improve-codebase-architecture`**：等 MVP 主链完成，或至少完成 Issue #5 后再做；当前阶段先保持纵向交付。来源：[improve-codebase-architecture](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md)。
- **`setup-pre-commit`**：先让 `pnpm check` 稳定，再接快速 pre-commit；完整浏览器测试放 pre-push/CI，避免提交钩子过慢或不稳定。

## 当前不纳入

- `grill-with-docs`、`to-spec`、`to-tickets`：当前 MVP 的 Spec 和 Issue 已确认，再使用会重新打开已经关闭的产品问题；只在下一个模糊 epic 开始时使用。
- `wayfinder`：当前路线已经拆成少量明确 Issue，不需要再建立长期任务地图。
- `git-guardrails-claude-code`：面向 Claude Code；当前主工作流是 Codex。
- `resolving-merge-conflicts`：只在真实出现 merge/rebase 冲突时触发。
- 本机仍可见的 `qa`、`request-refactor-plan`、`design-an-interface` 不应作为新版核心流程；它们不在当前官方主清单中，其中多方案接口设计方法已并入新版 `codebase-design`。

## 建议的最小流程

```text
模糊的新 epic：grill-with-docs -> to-spec -> to-tickets

已确认的 Issue：
隔离 worktree -> implement -> tdd
  -> diagnosing-bugs（仅在难复现问题出现时）
  -> code-review -> pnpm check
  -> 精确暂存 / commit / push / close
  -> 精简 handoff -> 求职证据审计

MVP 里程碑：headed browser QA -> triage -> improve-codebase-architecture
```

“headed browser QA”指打开有界面的真实浏览器，让人能看见并操作整条流程。这里应作为里程碑验收，而不是每个微小代码切片都重复执行。
