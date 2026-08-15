# @linxin666/dsh-client-ui-skill-explorer

[English](README.md) | 中文

DSH Web GUI 的**技能中心**：按来源分级浏览已加载的全部 skill，启用/禁用模型
调用，创建新技能，删除技能（移入可恢复的回收站）。

## 功能

- 侧边栏「技能中心」入口，打开面板含两个 tab。
- **技能 tab**：按来源分级展示（系统内置 / 项目 `.dsh/skills` / 项目
  `.agents/skills` / 自定义目录 / 用户 `~/.dsh/skills` / 用户
  `~/.agents/skills` / 运行时注册），每张卡片显示描述、适用场景、可调用标记、
  启用/禁用开关（改写 SKILL.md frontmatter 的 `disable-model-invocation`，
  模型目录热刷新）与删除按钮（文件移入 `.trash`，可恢复）。
- **创建 tab**：表单创建新技能，可写入用户根（`~/.dsh/skills`）或项目根
  （`.dsh/skills`），生成标准 SKILL.md。
- 数据来自按官方 dsh-skill-filesystem 根约定的文件系统扫描，并与
  `ctx.skills` 注册表（bundled / runtime 条目）合并。本插件不改变 skill 的
  加载/注入语义——纯 GUI 管理层。

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer
```

### 从仓库（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/skill-explorer
```

安装后重启 `dsh web`，侧边栏出现「技能中心」入口。

## 路由（全部 loopback 围栏）

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-explorer/list` | GET | 分级技能列表 |
| `/api/dsh-skill-explorer/set-enabled` | POST | 启用/禁用（改写 frontmatter） |
| `/api/dsh-skill-explorer/create` | POST | 创建技能（user/project 根） |
| `/api/dsh-skill-explorer/delete` | POST | 删除（移入 .trash） |
| `/api/dsh-skill-explorer/health` | GET | 健康检查 |

## 安全模型

- 全部 `/api/dsh-skill-explorer/*` 路由仅限 loopback（同源围栏，与 dsh-ssh
  相同）：局域网暴露的 dsh web 部署无法触达写路由。
- 写路由只操作最新文件系统扫描产出的路径——请求无法指定任意路径。
- 技能内容是用户自写的 markdown；创建表单限制内容 64KB。
- 面板用文本节点渲染技能描述（无 HTML 注入）。

## 已知限制

- 项目根取活跃会话 workspace（最近 `.git` 祖先）；list 路由接受显式 `?cwd=`
  覆盖。
- frontmatter 解析为零依赖轻量实现（块标量、布尔、input 嵌套块）；不支持的
  生僻 YAML 特性以官方 dsh-skill-filesystem 提供方为准。

## License

BSD-3-Clause。
