# Prototype verdict

## Answer

Yes. A selectively reused Open Design zhangzara template can pass through the local Codex CLI, load into GrapesJS, support the agreed text and ordinary-image edits, persist as GrapesJS project data, reopen, and export working HTML and a multi-page PDF.

## Evidence captured on 2026-07-15

- Open Design Grove loaded as 12 slides with exactly one compatible ordinary content image.
- The image moved and resized from about 356×225 to 449×284 while preserving its approximately 1.58 aspect ratio; only the four corner resize handles were present.
- The edited image coordinates and dimensions survived a reset and reopen from GrapesJS project data.
- Undo/redo was exercised through the visible controls: a drag changed the image position from (515, 130) to (55, 21), undo restored (515, 130), and redo restored (55, 21).
- A heading was changed to “AI 演示工作流已经跑通” and its computed font size changed to 36px.
- Exported HTML opened independently and ArrowRight changed the deck transform from 0vw to -100vw and the active navigation dot from 0 to 1.
- Backend PDF export produced 12 pages at 960×540 points with backgrounds and Chinese text rendered.
- A real local Codex run generated 12 Chinese slides about AI Presentation Studio, loaded them into GrapesJS with one editable image, saved the project, and exported HTML and a 12-page PDF.

## Important findings

1. The zhangzara examples ship image placeholders, not real content images. The product must deliberately provide or generate an ordinary img element; decorative CSS and SVG should remain non-editable.
2. Returning the entire template through the model works, but this run took about 3 minutes 45 seconds and reported 186,633 cumulative input tokens, 141,056 cached input tokens, and 10,873 output tokens. This is viable for a demo but too expensive and slow to accept as the final generation contract without another design decision.
3. On Windows, Node must invoke the npm Codex shim through cmd.exe; spawning the extensionless codex command returns EPERM.
4. PDF export works through installed Chrome, but the backend process must be allowed to launch Chrome.
5. Image overlap behaves literally: an image placed over text intercepts clicks until it is moved or undone.

## Still unproven

- The other four templates.
- Compatibility across arbitrary source materials.
- Production sandboxing and failure recovery.
- Whether the final MVP should have Codex re-emit full HTML or return smaller structured content that the app applies to the copied template.
