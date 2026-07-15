# DeckFlow Lite 与 OpenCode Resources

## Knowledge

- [OpenCode GitHub 仓库](https://github.com/anomalyco/opencode)
  OpenCode 源码、MIT 许可证、monorepo 目录和发布版本的权威入口。
- [OpenCode 官方文档](https://opencode.ai/docs/)
  安装、Plan/Build Agent、项目初始化、撤销、分享和配置的总入口。
- [OpenCode Server](https://opencode.ai/docs/server/)
  最值得产品经理理解的页面：解释 TUI 与 Server 的分离，以及 Session、Message、File、Permission、Event 等 HTTP API。
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
  用于在自己的产品中启动或连接 OpenCode，并通过类型安全客户端控制 Session 和获取事件。
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
  说明 OpenCode 如何发现和按需加载 `SKILL.md`；用于判断 `ppt-master` 迁移方式。
- [OpenCode Agents 与权限](https://opencode.ai/docs/agents/)
  说明 Build、Plan、自定义 Agent 以及 read/edit/bash/skill 等权限如何变成产品交互。
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
  说明插件如何监听 Session、Message、Permission 和 Tool 事件；暂不属于 DeckFlow P0。
- [Open Design README](https://github.com/nexu-io/open-design)
  用来理解 Open Design 如何把 Coding Agent 包装成面向设计任务的垂直产品。
- [Open Design Architecture](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md)
  用来对照 OpenCode 的 Agent 引擎和 Open Design 的设计产品层。
- 本机 `codex exec --help`（Codex CLI 0.144.1，2026-07-14 验证）
  DeckFlow P0 当前最快的执行引擎；已确认支持 JSONL、指定工作目录和 resume。
- [本机 ppt-master SKILL.md](G:/AITOOLS/codex-home/skills/ppt-master/SKILL.md)
  DeckFlow 的真实业务工作流合同，必须保留八项确认和串行生成。

## Wisdom (Communities)

- [OpenCode GitHub Issues](https://github.com/anomalyco/opencode/issues)
  查询 Windows、Session、Provider、Permission 和 SDK 的真实问题。
- [OpenCode Discord](https://opencode.ai/discord)
  适合在决定将 OpenCode 作为产品运行引擎前，确认 SDK 和 Windows 部署实践。
- [Open Design GitHub Discussions](https://github.com/nexu-io/open-design/discussions)
  观察垂直设计产品如何收集非技术用户需求。

## Gaps

- 尚未在本机安装并运行 OpenCode，因此没有验证 Windows 环境下的 Server/SDK 行为。
- 尚未验证当前 `ppt-master` 能否不修改地被 OpenCode 的 skill 工具发现和完整执行。
- DeckFlow P0 继续使用 Codex CLI，是否在 P1 增加 OpenCode Adapter 需等主流程稳定后决定。

