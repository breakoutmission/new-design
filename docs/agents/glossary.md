# Beginner Glossary Maintenance

The repository includes a beginner-facing technical dictionary at `docs/GLOSSARY.md`. The user is building a software product for the first time, so agents must manage this dictionary as a living project artifact.

## Source boundaries

- `CONTEXT.md` is the canonical glossary for concepts specific to AI Presentation Studio. Keep those definitions short and implementation-free.
- `docs/GLOSSARY.md` explains general product, design, Git, AI, web, testing, and development terms in beginner-friendly language.
- Accepted ADRs explain durable architectural trade-offs. The beginner glossary may explain what “ADR” means, but must link to the ADRs rather than restating their decisions.
- GitHub Issues and the formal Spec define work and acceptance. The glossary explains their vocabulary, not their full requirements.

## When agents must update the glossary

Before completing a repository-changing task, review the professional terms introduced in the task, code, Issue, ADR, test output, and user-facing explanation.

Add or improve a glossary entry when at least one is true:

- the term is likely unfamiliar to someone building software for the first time;
- the term is necessary to understand the current project stage or a decision the user must make;
- the user asks what the term means or confuses it with another term;
- an acronym is used in a durable repository artifact;
- an error or tool introduces a reusable concept that is likely to recur.

Do not add:

- ordinary words that do not carry a special project or technical meaning;
- one-off command output, temporary IDs, hashes, or exact error messages;
- speculative technologies that the project has not selected;
- secrets, tokens, account details, personal information, or machine-specific credentials;
- a second definition of a product term already defined in `CONTEXT.md`.

## Entry format

Search the glossary before adding a term. Prefer one canonical entry with Chinese and English aliases in the heading.

Use this shape:

```md
### 中文名（English name / acronym）

- **一句话**：不用其他生词解释它。
- **在本项目中**：说明用户会在哪里遇到它。
- **例子**：只在概念复杂或容易混淆时加入具体场景。
- **别混淆**：指出最常见的相邻概念，可选。
```

## Writing rules

- Write in Chinese and expand an English acronym on first use.
- Assume no programming background. Do not define one unknown term using three other unknown terms.
- Lead with the practical meaning, then explain mechanics only if they help a decision.
- Prefer an AI Presentation Studio example over a generic textbook example.
- For risky Git terms, state whether the action changes files, history, or only the current view.
- For AI usage terms, distinguish reported usage, cached usage, and billing; never invent a price.
- For complex comparisons, add a small table or scenario rather than a longer abstract paragraph.
- Keep each entry independently understandable when reached through search.
- If a product-specific definition changes, update `CONTEXT.md` first, then align the beginner explanation without copying the full definition.

## Conversation behavior

The file does not replace clear conversation. On first use of a likely unfamiliar term, define it inline in plain Chinese. The user should not be forced to leave the conversation and search the dictionary just to understand the current answer.

For chat-only questions that do not authorize repository changes, explain the term inline and note it for the next in-scope glossary review. Do not turn every casual question into an unrelated Git change.
