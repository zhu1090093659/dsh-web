# @linxin666/dsh-client-ui-session-id

[English](README.md) | 中文

纯浏览器端的 DSH Web GUI 插件：在侧边栏底部加入口，打开面板列出全部会话的
会话 ID，一键复制。挂载到官方侧边栏底部席位（`sidebar.footer.action`），不改
任何 DSH 源码，host 侧零行为。

## 是什么

- 在侧边栏底部的设置行旁边新增「会话 ID」入口（56px 收起态显示图标，展开态
  显示带文字的整行按钮）。
- 点击打开居中面板，列出全部会话：显示标题、完整会话 ID（等宽字体），每行
  一个「复制」按钮；当前会话有标记。
- 面板顶部有搜索框，按标题或 ID 子串**本地**过滤（只读、不发起 host 查询），
  会话多时也能快速定位。
- 数据来自官方 `ctx.sessions.list` 实时数据源，会话开始、结束或归档时面板
  自动跟随刷新，无需手动刷新。
- 点击「复制」通过官方剪贴板助手（`writeClipboard`）写入 ID，按钮短暂显示
  「已复制」。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-session-id@latest
```

重启 `dsh web`（或等待热更新生效）后，点击侧边栏底部的「会话 ID」入口即可。

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-session-id
```

## 安全模型

- 会话 ID 是**定位 / 自动化标识，不是认证凭据**：它本身无法访问会话、
  文件或宿主。面板只展示与复制 ID，绝不写入会话日志、agent prompt 或任何
  持久化存储，也绝不自动复制。
- 复制始终由用户手势触发；剪贴板写入失败时按钮显示可操作的「复制失败，请
  重试」状态，不额外申请剪贴板权限、不做后台重试。
- 分享会话 ID 仍可能**暴露工作流关联信息**（标题、运行时间、在 workspace
  中的位置），请只在确实需要在别处引用会话时按需复制。

## 已知限制

- 需要声明了 `sidebar.footer.action` 席位的 DSH Web 外壳（0.1.0-rc.8 及更新版本）；
  旧版外壳上入口不会渲染。
- 只读查看器：只展示与复制 ID，不打开或管理会话。

## 许可证

BSD-3-Clause。