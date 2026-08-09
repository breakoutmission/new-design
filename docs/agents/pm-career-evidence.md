# Product Manager Career Evidence Maintenance

`docs/PM-CAREER-EVIDENCE.md` is the long-lived evidence bank for turning work on AI Presentation Studio into honest, defensible product-manager internship resume material and interview stories.

## Why this file exists

This repository is both a product and a product-management practice project. Code completion alone is not enough. Future Agents must preserve the reasoning that demonstrates product-manager value:

- how the user identified and framed a real problem;
- how uncertainty became explicit hypotheses;
- how scope was narrowed and why work was cut or deferred;
- how alternatives and tradeoffs were evaluated;
- how prototypes, tests, feedback, and metrics reduced risk;
- how decisions became durable product documents and executable work;
- what the user decided versus what an Agent or tool executed.

## When to update

Update `docs/PM-CAREER-EVIDENCE.md` after any material product event, including:

- a target user, problem, scenario, goal, or success measure is added or changed;
- a hypothesis is proposed, tested, supported, rejected, or remains unresolved;
- scope is added, narrowed, cut, or deferred;
- an important tradeoff or ADR is accepted or replaced;
- a prototype, usability check, technical test, or real-user test produces evidence;
- a Spec, Issue, milestone, or end-to-end product slice is accepted;
- user feedback, usage data, timing, quality data, or failure data becomes available;
- a setback, pivot, or newly discovered risk changes the plan;
- a new resume bullet or interview story becomes supportable by evidence.

Routine refactors, formatting changes, dependency bumps, and low-level implementation details do not need an entry unless they materially change product risk, scope, delivery, or user value.

## Claim statuses

Every important claim must use one of these statuses:

- `VERIFIED`：已经有文件、Issue、Commit、测试、原型结果、用户反馈或数据支持。
- `DECIDED`：已经作出并记录决定，但决定带来的用户结果还没有发生或验证。
- `HYPOTHESIS`：等待验证的判断，不能写成事实或成果。
- `PLANNED`：未来准备执行的工作，不能使用“完成”“实现”等过去式。
- `DEFERRED`：主动暂缓或砍掉，保留原因和重新考虑的条件。
- `REJECTED`：证据已经否定，或明确决定不采用。

Never silently promote `DECIDED`, `HYPOTHESIS`, or `PLANNED` to `VERIFIED`.

## Evidence rules

1. Inspect the actual artifact before writing a claim. Prefer `CONTEXT.md`, ADRs, GitHub Issues, commits, tests, prototype verdicts, screenshots, exported files, and dated measurements.
2. Link each important `VERIFIED` claim to its evidence. If the evidence is on another branch, name the branch and commit.
3. Never invent percentages, time saved, users, conversion, satisfaction, revenue, or quality improvements.
4. A designed flow is not a shipped flow. A prototype result is not a production result. One successful run is not proof of repeatable reliability.
5. Keep diagnostic measurements in the evidence bank, but do not automatically place internal IDs, local paths, raw Token counts, or low-level logs in resume bullets.
6. Record negative evidence and remaining uncertainty. A defensible limitation is more valuable than an inflated claim.
7. When AI Agents perform implementation, record the division of work:
   - **用户贡献**：问题定义、目标、约束、选择、验收、优先级和最终判断；
   - **Agent / 工具贡献**：资料整理、文档草拟、代码实现、测试执行、Git 或 Issue 操作；
   - **共同完成**：由用户判断方向、Agent 执行并根据证据共同迭代的工作。
8. Resume claims must remain truthful when an interviewer asks “你具体做了什么、为什么这样做、证据在哪里”。

## Maintenance workflow

For each material event:

1. Read the current evidence bank and relevant source artifacts.
2. Add or update the hypothesis, scope decision, risk, measurement, timeline, or story that changed.
3. State what was uncertain before the work and what is less uncertain afterward.
4. Record alternatives considered, the chosen tradeoff, and what was cut or postponed.
5. Separate user judgment from Agent/tool execution.
6. Add a dated evidence link and preserve remaining limitations.
7. Revise the current resume bullets only when the new evidence makes them stronger or more precise; avoid accumulating duplicates.
8. If a new professional term is likely unfamiliar to the user, explain it inline and maintain `docs/GLOSSARY.md` according to `docs/agents/glossary.md`.

## Entry template

Use this template for substantial future entries. Remove fields that truly do not apply, but do not omit limitations or ownership.

```markdown
### YYYY-MM-DD — 事件或决定名称

- **阶段**：发现问题 / 定义 / 原型 / 开发 / 验证 / 交付 / 复盘
- **状态**：VERIFIED / DECIDED / HYPOTHESIS / PLANNED / DEFERRED / REJECTED
- **当时的不确定性**：
- **假设或目标**：
- **采取的行动**：
- **考虑过的替代方案**：
- **决定与取舍**：
- **砍掉或暂缓**：
- **风险怎样降低**：
- **可验证结果**：
- **仍未验证**：
- **用户贡献**：
- **Agent / 工具贡献**：
- **证据**：Issue、ADR、Commit、测试、文件、截图或数据链接
- **体现的产品经理能力**：
- **可用的简历表达**：
- **可用的面试故事**：
- **下一次验证**：
```

## Resume-writing standard

Prefer one concise line in this order:

`背景或问题 + 用户采取的产品动作与方法 + 已验证结果`

Use numbers only when their meaning and source are clear. Keep detailed evidence here; keep the resume focused on product judgment, action, and outcome.
