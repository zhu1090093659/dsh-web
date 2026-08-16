# @linxin666/dsh-client-ui-shutdown

[English](README.md) | 中文

DSH Web 侧边栏底部、设置按钮旁的一个关机按钮（Windows 关机样式图标）。点击按钮弹出确认框；确认后请求宿主进程优雅退出 DeepSeek Harness。

## 功能

- **只有一个按钮**：侧边栏底部只多一个关机样式入口——图标按钮，宽栏为内联图标、窄栏为 36px 圆形，与设置按钮几何一致。
- **确认弹窗**：点击按钮先弹确认框，因为退出会结束 dsh web 进程，可能中断正在运行的会话与任务；可用 `confirmShutdown` 设置关闭确认。
- **优雅退出**：确认后向仅限 loopback 的 `/api/dsh-shutdown` 路由发请求。宿主先写回确认响应，再请求 `ctx.appExit`（launcher 提供的 bounded exit：先回收插件树再结束进程）；launcher 服务缺失时（手建树/测试）回退 `process.exit(0)`。
- **设置卡**：「设置 > 插件配置」中有本插件卡片，可开关按钮、确认门与智能体播报。

## 安装

推荐安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile web add @linxin666/dsh-client-ui-shutdown

# 或从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-shutdown

```

安装后**重启 `dsh web`**，侧边栏底部设置按钮旁出现关机按钮。

另一种方式：作为普通 overlay 行加入个人 DSH overlay（`~/.dsh/config.yaml`），保存即热加载：

```yaml
- insert:
    - id: shutdown
      name: '@linxin666/dsh-client-ui-shutdown'
```

## 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 插件总开关（按钮 + 宿主面） |
| `confirmShutdown` | `boolean` | `true` | 退出前弹确认框；`false` 点击即退出 |
| `announceToAgent` | `boolean` | `true` | 是否在系统提示词中播报本插件 |

## 安全模型

- `/api/dsh-shutdown` 路由**仅限 loopback**：拒绝局域网与跨源请求，因为它会终止宿主进程；围栏与全家桶 SSH 路由同一套（loopback 地址 + 同源标记）。
- 退出是真实关机：dsh web 进程结束，进程内的一切（智能体会话、定时任务、未保存状态）都会中断；确认框是默认的防护。

## 已知限制

- 退出的优雅程度取决于 launcher 的 `appExit` 控制器回收范围；无 launcher 的回退路径（`process.exit(0)`）不做优雅回收。
- 按钮位于 Web GUI 侧边栏底部，暂无 TUI 等价物。
- 浏览器半区无法自行结束进程——依赖本插件在宿主侧挂载的退出路由。
