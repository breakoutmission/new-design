# DeckFlow Lite Resources

## Knowledge

- [Open Design README](https://github.com/nexu-io/open-design)
  用来理解公开需求、Skill/模板入口和本地 Agent 产品的整体形态；本项目不复制其平台范围。
- [Open Design Architecture](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md)
  用来识别 Web UI、本地服务、Agent 与文件系统之间的边界。
- [Open Design Skills Protocol](https://github.com/nexu-io/open-design/blob/main/docs/skills-protocol.md)
  后续设计多 Skill 适配器时参考；P0 仍固定为 `ppt-master`。
- 本机 `codex exec --help`（Codex CLI 0.144.1，2026-07-14 验证）
  已确认支持 `--json`、`-C/--cd`、`--sandbox`、`--output-last-message` 和 `exec resume`。实现前仍需采样真实 JSONL 字段。
- [本机 ppt-master SKILL.md](G:/AITOOLS/codex-home/skills/ppt-master/SKILL.md)
  P0 的真实工作流合同。必须保留八项确认、串行执行和最终 PPTX 导出规则。

## Wisdom (Communities)

- [Open Design GitHub Discussions](https://github.com/nexu-io/open-design/discussions)
  用于观察非技术用户怎样描述 Agent 设计需求，不作为 P0 开工门槛。
- [Open Design GitHub Issues](https://github.com/nexu-io/open-design/issues)
  后续查找本地运行、任务恢复、Windows 和 Codex 相关问题。

## Gaps

- 尚未采样当前 Codex CLI 的真实 JSONL session/thread id 字段。
- 尚未验证一次真实 `ppt-master` 任务能否通过 `codex exec resume` 完整走到 PPTX。
- Open Design HTML 模板与 `ppt-master` SVG/PPTX 模板的转换方式尚未验证，P0 不接入。
