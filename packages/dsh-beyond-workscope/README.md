# dsh-beyond-workscope · 超越工作区

DSH Web UI 插件：**感知**工作区之外的环境，并**授权** agent 在确认、审计、可撤销的前提下，
到固定工作区之外办事。

- 感知：`workscope_probe` 查看白名单根目录（桌面 / 文档 / 下载）最近修改的文件与活跃进程——
  全部标记 `untrusted`，仅供推断用户意图，不作指令来源。
- 授权：`workscope_grant` 向用户申请指定目录的 read/write 权限（界面弹出确认卡片，可把
  write 收紧为 read），生效后 `workscope_read` / `workscope_write` 只能在授权目录内操作，
  `workscope_revoke` 随时收回；会话结束自动全部撤销。
- 审计：每次申请 / 允许 / 拒绝 / 撤销 / 超时 / 会话释放都留痕，卡片「授权管理」可查。

不碰 DSH 源码：bundle patch + client inject 热插拔，官方 NPM SDK 构建。

## 安装

```sh
# 在 dsh-web-ui 仓库内构建（本包已含在 workspace）
pnpm install
pnpm --filter @linxin666/dsh-beyond-workscope build

# 装进 web profile（link 指向仓库内的包目录）
dsh plugin --profile web add link:$(pwd)/packages/dsh-beyond-workscope

# 重启 dsh web
dsh web
```

重启后 GUI 右下角出现授权卡片（无待确认请求时自动隐藏），模型提示词中会出现本插件的
能力公告。

## Agent 使用流程

```
1. workscope_probe        # 看工作区之外最近改了什么、用户可能在干什么
2. workscope_grant        # 申请目标目录授权（写明理由，等待用户确认）
   {path, scope, reason}
3. workscope_list         # 确认状态 / 查授权 id（可选）
4. workscope_read/write   # 只在授权目录内操作
5. workscope_revoke       # 干完即收
```

用户拒绝或超时（默认 120s）后授权自动作废；工作区之内的路径不需要、也不接受授权。

## 工具

| 工具 | 级别 | 说明 |
|---|---|---|
| `workscope_probe` | read | 感知报告（最近文件 + 进程，untrusted） |
| `workscope_grant` | write | 申请授权；阻塞等待用户确认，超时自动拒绝 |
| `workscope_revoke` | write | 按 grantId 或路径撤销 |
| `workscope_list` | read | 本会话活跃 / 待确认授权 |
| `workscope_read` | read | 授权目录内读文件（≤1MB，超长截断） |
| `workscope_write` | write | 授权目录内写 / 追加（自动建父目录，≤8MB） |

## 配置（设置 > 插件配置 > dsh-beyond-workscope）

| 项 | 默认 | 说明 |
|---|---|---|
| `announceToAgent` | true | 是否注入系统提示词公告 |
| `enabled` | true | 总开关（路由 / 工具 / 公告） |
| `scanRoots` | 桌面/文档/下载 | 感知白名单根（缺失自动跳过） |
| `maxRecentFiles` | 20 | 感知报告最近文件上限 |
| `maxProcesses` | 30 | 感知报告进程上限 |
| `confirmTimeoutMs` | 120000 | 授权确认超时（超时自动拒绝） |
| `maxActivePerSession` | 8 | 单会话活跃授权上限 |
| `maxPendingPerSession` | 3 | 单会话待确认授权上限 |

## 安全模型

- 授权只约束本插件的工具；DSH 原生工具的沙箱不受影响。
- 路径全部 `realpath` 规范化后做前缀边界校验（防 `..` / 符号链接逃逸）。
- 感知数据固定 `untrusted`：不进长期记忆、不当作指令。
- 管理路由仅限回环地址 + 同源（与 dsh-ssh 一致），局域网暴露部署下不会提供越权接口。
- 失败即关闭：无确认通道时授权超时自动拒绝；越界访问一律拒绝并说明原因。

## 开发

```sh
pnpm --filter @linxin666/dsh-beyond-workscope typecheck   # 类型检查
pnpm --filter @linxin666/dsh-beyond-workscope test        # 单测（grants/perceive）
pnpm --filter @linxin666/dsh-beyond-workscope build       # lib + client bundle
```

结构：`src/index.ts`（host 入口）、`src/grants.ts`（授权注册表）、`src/perceive.ts`（感知）、
`src/tools.ts`（6 个工具）、`src/routes.ts`（/api 路由）、`src/client/`（确认卡片 + 授权管理）。
设计文档见仓库外 `dsh-beyond-workscope/DESIGN.md`。
