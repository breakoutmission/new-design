# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues. Use the `gh` CLI for operations.

Repository: `breakoutmission/new-design`

## Conventions

- Create: `gh issue create`
- Read: `gh issue view <number> --comments`
- List: `gh issue list`
- Comment: `gh issue comment <number>`
- Apply or remove labels: `gh issue edit <number>`
- Close: `gh issue close <number>`

Infer the repository from `git remote -v`.

For multiline issue bodies, write the content to a temporary Markdown file and pass it with `--body-file`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Pull requests do not enter the issue-triage queue unless this setting is changed to `yes`.

## Skill terminology

When a skill says “publish to the issue tracker,” create a GitHub Issue.

When a skill says “fetch the relevant ticket,” read the corresponding GitHub Issue and its comments.

## Wayfinding operations

A wayfinding map is represented by one GitHub Issue with linked child Issues.

- Map label: `wayfinder:map`
- Child labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`
- Use GitHub sub-issues and native issue dependencies when available.
- Otherwise, record relationships with `Part of #<number>` and `Blocked by: #<number>`.
- A ticket is ready only when all blockers are closed.
