# @linxin666/dsh-skill-manager

[English](README.md) | 中文

dsh Web GUI 的技能管理器：设置页一级分区「技能」，列出当前工作区的技能，随时
启停，并可从本地目录或 Git 仓库 URL 安装、卸载 skill。全部走官方 DSH skill
机制，不修改 DSH 源码。

## 功能

- 设置 → 技能：设置页一级分区（nav id `skills`），排在「Agent 预设」之后。
- 工作区选择器默认选中当前会话所在工作区；目录解析与官方 `skill.list` RPC
  完全一致（会话 header cwd + live agent scope，冷会话回退全局层）。
- 每行技能显示名称、描述、来源/提供方徽标、已安装标记与单个总开关。关闭开关
  会在该技能 SKILL.md frontmatter 写入 `disable-model-invocation: true` 与
  `user-invocable: false`；打开则删除两键。filesystem provider 的 watcher
  使目录失效，下一次 agent 步骤自动重发模型目录——无需重启。
- 安装来源：本地目录（含 SKILL.md 的目录 bundle、平铺 `*.md` 文件、或
  目录集合）或 Git 仓库 URL（浅克隆）。目标可选「当前工作区
  （<projectRoot>/.agents/skills）」或「用户级（<dshHome>/skills，所有工作区
  可见）」。安装会校验 frontmatter、kebab-case 名称、重名与冲突，并记入安装
  账本。
- 卸载只允许删除管理器安装过的技能（账本保护），带内联确认。

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-skill-manager
```

### 从仓库（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skill-manager
```

重启 `dsh web`，打开 设置 → 技能。

## 配置

本插件没有设置命名空间，行为固定：

| 方面 | 行为 |
| --- | --- |
| 启停语义 | 单个总开关：关闭后模型目录与用户斜杠入口均不可见。 |
| 启停范围 | 只有文件型技能（存在可编辑技能文件）可启停；内置与运行时注册技能显示不可编辑状态。 |
| 安装根 | <projectRoot>/.agents/skills（工作区）或 <dshHome>/skills（用户级，默认 ~/.dsh/skills）。 |
| 安装账本 | <dshHome>/skill-manager.json（0600 原子写）；仅账本内路径可卸载。 |
| Git 安装 | `git clone --depth 1`，需要 PATH 中有 git（120 秒超时）。 |
| 查看视角 | 目录按会话解析（header cwd + live agent scope）；无 live agent 的冷会话回退全局层，官方 web 组合下该层没有文件型技能。 |

## 安全模型

- 全部 `/api/dsh-skill-manager/*` 路由仅限 loopback：非本机地址、伪造 Host
  头与跨站来源一律 403（与 dsh-ssh 同款围栏）。
- 插件只写两类位置：技能根下的技能文件（frontmatter 启停、安装拷贝、账本内
  路径的卸载）与 <dshHome> 下的安装账本。
- Git 克隆只针对用户粘贴进安装表单的 URL，克隆发生在临时目录，结束后删除。
- 管理器不添加 agent 工具、不发布系统提示词公告，是纯用户侧管理面。

## 已知限制

- 内置与运行时注册技能不支持启停（无可编辑文件）；管理器重新启用会恢复作者
  原始的 frontmatter 默认值。
- 冷会话（无 live agent）只列出全局层目录；官方 web 组合下该层没有
  filesystem provider，界面会提示先打开会话。
- 安装暂不支持「从零新建」模板与粘贴 Markdown 正文。
- 设置页至少需要一个会话：所有 list/install/toggle/uninstall 都以会话寻址
  （其 cwd 选择项目，与官方 `skill.list` RPC 一致）。

## License

Apache-2.0。
