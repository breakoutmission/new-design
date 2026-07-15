# Open Design 学习资料

本页只保留 Open Design 相关资料。每个专业名词后面都附有简单解释。

## 第一遍必读

- [Open Design GitHub 仓库](https://github.com/nexu-io/open-design)  
  Repository（装着项目代码、文档和资源的总文件夹）的官方入口。
- [Open Design README](https://github.com/nexu-io/open-design#readme)  
  README（放在仓库门口、先介绍项目是什么和怎样开始的说明书）。
- [Architecture](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md)  
  Architecture（说明产品各部分怎样分工和连接的结构图）。重点看 Web App（用户看到的网页）、Daemon（藏在电脑后台的调度小助手）和 Agent（真正操作文件的 AI 助手）。
- [Skills Protocol](https://github.com/nexu-io/open-design/blob/main/docs/skills-protocol.md)  
  Protocol（大家共同遵守的格式规则）。重点看一个 Skill（教 AI 完成特定任务的说明书）怎样声明输入、参数、预览和输出。

## 第二遍按需查看

- [`apps/web`](https://github.com/nexu-io/open-design/tree/main/apps/web)  
  前台页面（用户实际看到、点击和输入内容的部分）。
- [`apps/daemon`](https://github.com/nexu-io/open-design/tree/main/apps/daemon)  
  本地后台服务（在用户电脑上负责启动 AI、保存文件和返回进度的小程序）。
- [`skills`](https://github.com/nexu-io/open-design/tree/main/skills)  
  AI 工作说明书目录。
- [`design-systems`](https://github.com/nexu-io/open-design/tree/main/design-systems)  
  Design System（规定颜色、字体、间距和组件样式的品牌装修规则）目录。
- [`design-templates`](https://github.com/nexu-io/open-design/tree/main/design-templates)  
  Template（提前做好基础结构、等待替换内容的半成品）目录。
- [CHANGELOG](https://github.com/nexu-io/open-design/blob/main/CHANGELOG.md)  
  CHANGELOG（按版本记录新增功能和修复内容的更新日记），用于确认当前版本是否已有手动编辑等能力。
- [License](https://github.com/nexu-io/open-design/blob/main/LICENSE)  
  License（别人允许你怎样使用和修改代码的法律说明）。复制代码或模板前必须看。

## 本项目内的入口

- [Open Design 仓库儿童版说明书](./OPENDESIGN-REPOSITORY-GUIDE.md)
- [DeckFlow Lite PRD](./DeckFlow-Lite-PRD.md)
- [项目技术蓝图](./PROJECT-BLUEPRINT.md)
- [从这里开始](./START-HERE.md)

## 暂不做

- 不打开交互式教学页面；
- 不生成课程 HTML（浏览器可以打开的网页文件）；
- 不把 Open Design 整个复制进来；
- 不在 P0（第一版必须完成的最高优先级范围）加入可视化拖拽编辑、多 Agent（多个 AI 助手切换）或 Plugin Marketplace（浏览和安装功能包的商店）。
