# OpenCode 仓库入门：给零代码产品经理的解释

> 对应仓库：[anomalyco/opencode](https://github.com/anomalyco/opencode)。你最开始发的 [nexu-io/open-design](https://github.com/nexu-io/open-design) 是另一个项目。

## 1. 先用一句话理解 OpenCode

**OpenCode 是一个开源 AI 编程 Agent 平台：它把模型、项目文件、命令行工具、权限、会话和多个操作界面连接起来。**

它不是一个大模型，也不是一个网页生成器。它更像“Agent 操作系统”：

- 上面可以接不同界面：终端、网页、桌面端、IDE 插件；
- 下面可以接不同模型：OpenAI、Anthropic、Google、本地模型等；
- 中间负责会话、上下文、工具调用、权限、文件修改和任务状态。

## 2. OpenCode、Open Design、Skill 和你的产品是什么关系？

| 名称 | 类比 | 主要职责 |
|---|---|---|
| 大模型 | 大脑 | 理解需求、推理、决定下一步 |
| OpenCode | 操作系统和执行引擎 | 管理模型、会话、工具、文件和权限 |
| Skill | 标准作业手册 | 告诉 Agent 遇到某类任务要按什么流程做 |
| Open Design | 设计工作室产品 | 用设计界面、模板和预览包装多个 Agent |
| DeckFlow Lite | PPT 专用工作台 | 把一个 `ppt-master` Skill 做成固定流程产品 |

因此：**Open Design 可以调用 OpenCode，但 OpenCode 本身并不负责“设计产品体验”。**

## 3. 一条用户消息是怎样运行的？

```text
用户输入：“把这份 PDF 做成 8 页汇报 PPT”
                    |
                    v
界面层：TUI / Web / Desktop / 你自己的产品
                    |
                    v
OpenCode Server：创建 Session，保存 Message，发送 Event
                    |
                    v
Agent：选择 Plan / Build / 自定义 Agent，读取规则和 Skill
                    |
                    v
Provider：把统一请求转换成目标模型 API
                    |
                    v
模型决定调用工具：read / edit / bash / skill / MCP
                    |
                    v
权限系统：allow / ask / deny
                    |
                    v
文件和命令执行，结果重新进入 Session
                    |
                    v
界面持续接收 SSE Event，展示消息、工具状态和最终产物
```

这条链就是 OpenCode 仓库最重要的主线。第一次学习时，不需要理解所有包。

## 4. 八个必须理解的概念

### 4.1 Provider：模型供应商适配层

用户可能选择 OpenAI、Anthropic、Google、OpenRouter 或本地 Ollama。Provider 层把它们的鉴权、模型名和请求差异统一起来。官方文档说明 OpenCode使用 AI SDK 和 Models.dev 支持大量 Provider。

产品含义：用户看到的是“选择模型”，系统内部处理的是不同 API 的兼容和失败。

### 4.2 Session：一次持续任务

Session 不是单条聊天消息，而是一次可以持续、暂停、分叉、恢复和撤销的工作任务。Server API 支持创建 Session、查看状态、fork、abort、share、diff、revert 和 respond to permission。

产品含义：DeckFlow 的“一次 PPT 任务”应该对应一个 Session，而不是每次点击都创建新对话。

### 4.3 Message 与 Part：消息和消息里的组成部分

一条 Message 可以包含多个 Part，例如文字、工具调用、文件、结构化输出或错误。界面需要把这些不同内容渲染成用户能理解的状态。

产品含义：不能假设 Agent 输出永远是一段纯文字。

### 4.4 Agent：角色与权限组合

OpenCode 默认提供 Build 和 Plan。Plan 主要用于分析，默认不修改文件；Build 用于真正实现。自定义 Agent 可以指定模型、提示词、工具和权限。

产品含义：Agent 不只是“人设”，而是任务能力和风险边界。

### 4.5 Tool：真正执行动作的手

模型本身不能直接改文件。它通过 read、edit、bash、grep、skill、web、MCP 等 Tool 完成动作。

产品含义：AI 说“我完成了”不算完成，必须检查 Tool 结果和真实文件。

### 4.6 Permission：产品中的安全确认

OpenCode 的权限可以设为：

- `allow`：自动允许；
- `ask`：执行前询问用户；
- `deny`：不允许使用。

还可以按 Agent、工具和命令模式细分。

产品含义：权限弹窗不是技术噪音，而是用户信任设计的一部分。

### 4.7 Skill：按需加载的任务说明书

Skill 是带 YAML 头信息的 `SKILL.md`。OpenCode会从 `.opencode/skills/`、`.claude/skills/`、`.agents/skills/` 以及对应的全局目录发现 Skill。Agent 先看到名称和描述，需要时再通过 `skill` 工具加载全文。

产品含义：Skill 决定“怎样完成一类任务”，但不会自动给你生成表单、进度页和产物中心；这些是 DeckFlow 要补的产品层。

### 4.8 Plugin 与 MCP：两种不同扩展

- Plugin 在 OpenCode 内部监听事件、改写行为或增加工具；
- MCP 把外部服务的工具和数据连接给 Agent。

产品含义：第一版不要同时做 Skill、Plugin 和 MCP。只用 Skill 就够了。

## 5. 为什么 OpenCode 要分成 Client 和 Server？

官方架构中，运行 `opencode` 时会同时启动 TUI 和 Server；TUI 只是连接 Server 的客户端。也可以单独运行 `opencode serve`，通过 HTTP、OpenAPI 和 SSE 控制它。

```text
          +-- Terminal UI
          +-- Web UI
用户 ---> +-- Desktop App  ---> OpenCode Server ---> Agent / Model / Tools
          +-- IDE Plugin
          +-- DeckFlow
```

这样做的价值是：同一个执行引擎可以有多个产品界面。你的产品不必 fork OpenCode，只需调用 Server 或 SDK。

## 6. 仓库目录怎样看？

OpenCode 是一个使用 Bun workspaces 管理的 TypeScript monorepo，默认开发分支是 `dev`。下面只列与你相关的目录。

```text
opencode/
+-- packages/
|   +-- opencode/     核心 CLI 与主要 Agent 运行逻辑
|   +-- server/       Server 协议与服务端边界
|   +-- app/          Web 应用界面
|   +-- desktop/      Electron 桌面外壳
|   +-- tui/          终端界面
|   +-- sdk/          SDK 相关代码；JS SDK 位于其子目录
|   +-- plugin/       插件类型与扩展接口
|   +-- protocol/     跨层通信协议
|   +-- schema/       公共数据结构和校验
|   +-- core/         多包共享的核心能力
|   +-- ui/           可复用 UI 组件
|   +-- session-ui/   多界面共享的会话展示能力
|   +-- llm/          模型调用相关抽象
|   +-- client/       客户端与生成代码相关能力
|   +-- docs/         文档站内容
+-- .opencode/        仓库自己使用的 OpenCode 配置、Agent 或工具
+-- AGENTS.md         给 Agent 的仓库开发规则
+-- package.json      workspace、版本目录和开发命令
+-- bun.lock          依赖锁定
+-- infra/            官方服务的基础设施代码
+-- specs/            设计规格和跨模块方案
```

### 第一次只看这五处

1. `README.md`：产品定位和安装方式。
2. `AGENTS.md`：仓库规则、默认分支和代码约束。
3. `packages/opencode/`：核心运行时。
4. `packages/server/`：哪些能力通过 API 对外开放。
5. `packages/app/`：这些能力怎样变成用户界面。

不要从 `packages/opencode/src` 第一行开始顺序阅读，那会很快迷失。

## 7. Server 和 SDK 能为自己的产品提供什么？

OpenCode Server 已经提供：

- 健康检查和版本；
- Project、Path 和 Git 状态；
- Provider 和模型；
- Session 创建、状态、分叉、终止、恢复/撤销；
- Message 和异步 Prompt；
- 文件查询与读取；
- Permission 回答；
- MCP、Agent、LSP 和 Formatter 状态；
- SSE 事件流；
- OpenAPI 3.1 文档。

官方 JS/TS SDK 可以：

- 自动启动 Server 并创建 Client；
- 连接已经运行的 Server；
- 以类型安全方式操作 Session、Message 和 Event；
- 请求 JSON Schema 约束的结构化输出。

这意味着：如果使用 OpenCode 作为 DeckFlow 后端，我们不需要自己解析进程日志，可以直接使用 Session API 和 Event 流。

## 8. 为什么仍不建议你直接 fork OpenCode？

因为 fork 后你会同时承担：

- 多模型 Provider；
- TUI、Web、Desktop 三套界面；
- Session 和消息协议；
- 文件、Git、LSP、Formatter；
- 权限和安全；
- Plugin、MCP、Skill；
- Windows、macOS、Linux；
- 大量兼容性和升级工作。

这不是“一个轻量产品”，而是在维护开发者平台。

更合理的方式是：

```text
不要：复制 OpenCode → 删除大量功能 → 修改核心

应该：你的界面 → OpenCode SDK/Server → 只开放一个垂直工作流
```

## 9. OpenCode 对 DeckFlow 有三种使用方式

### 方案 A：只学习架构，不接入

DeckFlow P0 继续调用已经可用的 `codex exec`。

- 优点：最快，当前本机已验证。
- 缺点：需要自己解析 JSONL 和处理 resume。

### 方案 B：把 OpenCode 当作后台引擎

DeckFlow 调用 `@opencode-ai/sdk` 或 `opencode serve`。

- 优点：现成 Session、Message、Event、Permission 和多模型接口。
- 缺点：要安装新运行时；官方文档对 Windows CLI 推荐 WSL；`ppt-master` 兼容性尚未验证。

### 方案 C：fork OpenCode

- 优点：可以深度改变核心。
- 缺点：范围最大、学习成本最高、升级困难。

**当前建议：P0 用方案 A，产品稳定后再做方案 B 的技术探针。不要用方案 C。**

## 10. Open Design 与 OpenCode 到底怎样配合？

Open Design 的产品层负责：

- 选择 Skill、Design System 和模板；
- 输入设计需求；
- 展示 HTML、PPT、图片、视频等产物；
- 评论、预览和导出。

OpenCode 这样的 Agent 层负责：

- 连接模型；
- 读取 Skill；
- 调用文件和命令工具；
- 维护任务上下文；
- 真正生成和修改项目文件。

可以简单理解为：**Open Design 是店面和服务流程，OpenCode 是后厨和生产系统。**

## 11. 你现在不需要学习什么？

- 不需要学习 Bun、SolidJS、Effect 或 Drizzle 的语法。
- 不需要本地编译整个 OpenCode 仓库。
- 不需要理解每一个 Provider。
- 不需要制作 Plugin 或 MCP。
- 不需要修改 OpenCode 核心代码。

作为产品经理，你现在应该能回答：

1. OpenCode 的用户是谁？
2. Client 与 Server 为什么分离？
3. Session 与普通聊天消息有什么不同？
4. Agent、Tool、Permission、Skill 分别负责什么？
5. 为什么自己的产品应该调用 SDK，而不是 fork 仓库？
6. DeckFlow 当前为什么仍优先使用 Codex CLI？

如果这六个问题中有任何一个说不清，下一步就只讲那个问题，不继续深入代码。
