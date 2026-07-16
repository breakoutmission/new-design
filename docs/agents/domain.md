# Domain Docs

This repository uses a single-context domain-documentation layout.

## Before exploring

Read these files when they exist:

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If they do not exist, proceed silently. They will be created when real terminology or architectural decisions are resolved.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   ├── agents/
│   └── adr/
└── src/
```

## Vocabulary

Use terminology defined in `CONTEXT.md`. Avoid introducing different names for concepts that already have an agreed meaning.

If an important concept is missing, record it through the domain-modeling workflow.

`CONTEXT.md` contains only concepts specific to AI Presentation Studio. General product, design, Git, AI, web, testing, and development terminology belongs in the beginner-facing `docs/GLOSSARY.md`; maintain it according to `docs/agents/glossary.md` instead of expanding `CONTEXT.md` with general jargon.

## ADR conflicts

If proposed work contradicts an existing ADR, identify the conflict explicitly instead of silently overriding the decision.
