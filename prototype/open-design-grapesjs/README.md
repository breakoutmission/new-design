# Open Design + GrapesJS technical prototype

> THROWAWAY PROTOTYPE — this branch answers one integration question. It is not the production MVP.

## Question

Can an Open Design zhangzara HTML deck pass through the real local Codex CLI, load into GrapesJS, edit text and one ordinary content image, persist as GrapesJS project data, reopen without losing the edit, and export usable HTML and PDF?

The browser page surfaces the full relevant prototype state after each action. The prototype intentionally skips the project list, five-template selector, production error handling, authentication, and visual polish.

## Important fixture assumption

The upstream zhangzara examples use image placeholders rather than real content images. At load time this prototype replaces Grove's single image placeholder with a self-contained ordinary image element so that the agreed image editing boundary can be tested. Backgrounds, SVG decorations, logos, and template ornaments remain non-editable.

## Run

    pnpm prototype

The server listens only on 127.0.0.1:4317 and opens the prototype in the default browser. Set PROTOTYPE_NO_OPEN=1 to suppress auto-open.

## Direct reuse and attribution

- The vendored Grove template, template instructions, metadata, and MIT license come from Open Design's design-templates/html-ppt-zhangzara-grove.
- The Codex invocation follows Open Design's daemon adapter: JSON event stream, prompt through stdin, and --skip-git-repo-check. This prototype deliberately uses Codex's read-only sandbox and returns the generated artifact through stdout instead of granting the Windows child process broad write access.
- GrapesJS project data, not exported HTML, is the saved editor state.

Runtime save data is written to .prototype-data/project.json and is intentionally ignored by Git.
