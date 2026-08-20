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
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer@latest
```

### 从仓库（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skill-explorer
```

安装后重启 `dsh web`，侧边栏出现「技能中心」入口。

## 路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-explorer/list` | GET | 分级技能列表 |
| `/api/dsh-skill-explorer/set-enabled` | POST | 启用/禁用（改写 frontmatter） |
| `/api/dsh-skill-explorer/create` | POST | 创建技能（user/project 根） |
| `/api/dsh-skill-explorer/delete` | POST | 删除（移入 .trash） |
| `/api/dsh-skill-explorer/health` | GET | 健康检查 |

## 安全模型

- 全部 `/api/dsh-skill-explorer/*` 路由默认仅限 loopback（插件家族共享围栏：
  loopback 套接字 + Host 头 + 浏览器同源标记）：未配对的局域网客户端在任何
  技能文件访问前即收到 `403 forbidden: loopback-only`。同时装了
  `dsh-remote-web-ui` 时，有效的已配对设备 cookie 是额外放行路径（与
  `api/gate` 检查同一枚 cookie）；未配对与已撤销设备仍 403。技能中心不硬依赖
  远程插件。
- 写路由仅把面板展示的路径作为身份声明；执行修改前，最新文件系统扫描必须解析到
  同名且路径完全一致的技能。任意路径与过期的同名回退都会被拒绝，因此项目技能
  消失后，尚未执行的操作不会改到同名的用户级或自定义技能。
- 技能内容是用户自写的 markdown；创建表单限制内容 64KB。
- 面板用文本节点渲染技能描述（无 HTML 注入）。
- 扫描跟随符号链接：skill 根里的符号链接目录 / `.md` 单文件链接会被当作
  普通技能列出。链接属于用户的挂载意图，因此不校验链接目标是否落在某个
  skill 根内；项目根（可能来自 clone 的仓库）里的符号链接被视为该项目内容，
  其指向目录中的 `SKILL.md` 会被读取并展示——这是预期信任边界。链接技能可
  列表、可启用/禁用（改写目标自身的 frontmatter），但**不可删除**：删除会把
  链接目标的 `SKILL.md` 移出原位、越出当前 skill 根，因此对链接技能隐藏删除
  按钮并在 delete 路由上拒绝（400）。写操作仍受 loopback 围栏与「仅信任最新
  扫描路径」约束。

## 已知限制

- 项目技能跟随面板显示的 workspace：list 路由接受显式 `?cwd=` 覆盖，
  创建表单会发送当前显示的 workspace；项目根为该 workspace 最近的
  `.git` 祖先。
- frontmatter 解析为零依赖轻量实现（块标量、布尔、input 嵌套块）；不支持的
  生僻 YAML 特性以官方 dsh-skill-filesystem 提供方为准。
- 链接技能不可删除（见安全模型）；启用/禁用对链接技能正常（改写目标
  `SKILL.md` frontmatter）。目录型与「单文件」链接都能正常列出；「单文件」
  符号链接（指向单个 `.md`）在原子改写（rename）时会被替换为一个普通文件
  （链接不再保留），目标文件本身不受影响。

## License

BSD-3-Clause。
