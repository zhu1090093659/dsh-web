# @linxin666/dsh-round-jump

[English](README.md) | 中文

右侧悬停弹窗:列出当前会话所有"我发送的消息"轮次,点击跳转到对应位置——
长会话的导航地图。翻回"第 17 轮那个提问"不再需要大海捞针。

鼠标移到视口最右缘(最右 16px 竖条)停留约 180ms,弹窗滑入:你的每条消息
变成一条记录(序号 + 文本预览),按从旧到新排列。点击任一条,会话滚动到
那一轮。底部「加载全部历史」按钮一次性翻完所有更早分页(平台每页 50 条),
然后自动跳到最早一条。

## 功能

- **浏览器半区**(全部功能):注册进 session 作用域的 `conversation.composer.dock`
  槽位,再把浮层 portal 到 `document.body`——热区与面板都是视口级的。
  轮次来自官方会话快照(`useSession` → `ConversationSnapshot.chat`):
  `kind === 'user'` 的节点,按 `chat.order` 顺序遍历。跳转用节点的稳定
  `key`,它正是官方 ChatNodeSeat 打在 `data-chat-anchor-key` 上的同一个值。
  更早历史通过框架 `ctx.conversation.loadOlder()` 加载(每次一页);加载全部
  动作循环调用直到 `hasMore` 清空,上限 200 页(1 万条)。
- **宿主半区**:空占位,仅让包能以 profile bundle 解析、其 `dsh.client`
  声明被扫进 web 插件清单。

## 安装

```sh
# 从 npm(发布后)
dsh plugin --profile web add @linxin666/dsh-round-jump

# 从仓库(开发调试)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-round-jump
```

重启 `dsh web`,然后把鼠标移到视口右缘。

## 使用

1. 鼠标移到窗口最右缘(16px 热区)停留约 180ms。
2. 右侧滑出「跳转到我的消息」弹窗,列出所有用户轮次(序号 + 预览)。
3. 点击任一轮,会话平滑滚动到那条消息;弹窗关闭。移出热区或按 Esc 也会关闭。
4. 点「加载全部历史」一次翻完所有更早分页,落到最早一条。

## 已知限制与后续

- **仅文本预览**:弹窗每轮显示两行文本预览,不含图片/工具块;整轮无文本时
  预览行为空。
- **加载全部有上限**:超过 1 万条的会话在 200 页上限后仍保留「加载更早」
  按钮;不强制一次加载那么多 DOM。
- **跳转只针对已渲染行**:目标轮次所在页未加载时无法滚动定位(用「加载全部
  历史」按钮兜底)。

## Model Experience

无:本插件只在浏览器渲染会话导航、只读会话快照;不触达任何模型请求,
也不写会话状态。

#### KV Cache 影响

无。
