# dsh-aionui-panel — DSH Web GUI 右侧面板系统

[English](README.md) | 中文

> AionUi 右侧面板的像素级复刻（Apache-2.0 授权参考实现，非抄录）：Explorer 项目面板（文件树 / 文件名搜索 / Git 变更）+ Preview 预览面板（10+ 格式多 tab 预览）+ 统一拖拽布局系统，按项目隔离的偏好持久化。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-client-ui-aionui-panel

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-aionui-panel

```

安装后**重启 `dsh web`**，打开项目会话即可看到聊天区右侧的「预览」与「文件/变更」两块面板。

## 使用

项目会话（当前会话有工作目录）打开后，聊天区右侧出现两块面板：

- **Explorer（最右栏，默认 260px，范围 220~500px）**：`文件 / 变更` 双 tab；文件树整行点击展开/收起文件夹，点击文件在预览面板打开，顶部按文件名搜索（150ms 防抖，点击结果 = 定位到树中，不打断思路）；`变更` tab 按仓库分组显示当前工作区所属仓库与嵌套独立仓库的真实 git 状态，并把 diff / stage / unstage / discard 路由到所选仓库（untracked 走删除，tracked 走 restore，批量放弃有确认）。
- **文件树右键菜单**：右键文件/文件夹弹出菜单——复制路径、复制名称、在文件管理器中显示、用默认应用打开（仅文件）、重命名、新建文件、新建文件夹、删除（二次确认）；全部走工作区门禁（loopback 围栏 + 拒绝 .git 路径），「在文件管理器中显示」Windows 用 `explorer /select`、macOS 用 `open -R`、Linux 桌面回退打开父目录。
- **拖拽文件到输入框**：文件树中的文件行可拖拽（目录行除外），拖到聊天输入框区域松手即把相对路径（如 `deploy/base/deployment.yaml`）插入当前会话草稿的光标处，agent 收到消息后会自行读取该文件，无需手动输入路径；拖拽过程中输入框上方显示高亮提示条。
- **Preview（右二栏，默认 480px，范围 340~1200px）**：多 tab 预览，支持 markdown / html / code / diff / csv / pdf / word / excel / ppt / 图片 / 文本 / url（code 预览经由官方 shiki core 语法高亮）；源码/预览切换、分屏编辑（比例持久化）、保存（mtime 冲突检测）、下载、刷新（4 态：不渲染死按钮）、dirty 点、中键关闭、右键菜单批量关闭（dirty 确认）、tab 溢出渐变指示器。
- **Mermaid 图表**：markdown 预览中的 ```mermaid 代码块会渲染成图表。mermaid 运行时打包在包内，经 `/aionui-panel/vendor/mermaid.js` 同源提供（不走 CDN、离线可用、loopback 围栏）；图表跟随 shell 明暗主题并在切换时重渲染；图源语法错误时回退为原代码块。
- **总开关**（设置 → Web UI 插件 → 右侧面板）：`enabled`，默认开启。关闭后两块面板不再挂载、右侧浮动展开按钮消失、`/aionui-panel/*` 路由不再注册（随之停止工作区文件监视与 git 轮询）——适合与其他侧栏插件并用时彻底让位；聚合包其余插件不受影响。

交互细节：

- 拖拽左缘把手调宽（rAF 每帧合并，body user-select:none）；双击把手复位默认宽度。
- 两级宽度钳位（Explorer 先、Preview 后）数学保证聊天区 >= 360px；超限值回写持久化。
- 折叠 = 宽度缩 0 且组件保持挂载（树展开态 / 预览 tab 不丢），无过渡动画；折叠后在右上角出现浮动展开按钮，位于会话头部下方分隔线之下，不会压到头部区域。
- 明暗双主题跟随 GUI（`body[data-ds-dark-theme]`），prefers-reduced-motion 全局禁用动画。
- 偏好按项目隔离持久化（localStorage keys 与 AionUi 一致）：`chat-workspace-width-px` / `chat-preview-width-px` / `preview-panel-split-ratio` / `project-panel-collapse:<root>` / `explorer-ui:<root>` / `scm-ui:<root>` / `preview-ui:<root>`（LRU 上限 12 scope）。读取一律范围校验，非法值回退默认。

## 数据源

真实文件系统与真实 git 仓库，无任何 mock：

- host 半区（`src/index.ts` + `src/host/`）经 `/aionui-panel/*` HTTP 路由提供目录列举、文件读取（文本 80k 字符上限 / 图片 data URL）、写入（mtime 冲突检测）、文件名搜索（跳过 .git / node_modules）、多仓库 git status（porcelain v1 -z）/ stage / unstage / discard，以及 SSE 变更流（fs 监听 + git 轮询）；并经 `/aionui-panel/vendor/mermaid.js` 提供构建期从固定版本 npm 依赖拷贝的 mermaid IIFE 产物（`lib/assets/mermaid.min.js`），带 etag 再校验。SSE 变更流经跨标签页选主中继共享（Web Locks + BroadcastChannel），同一项目全浏览器只保留一条流，多标签页打开同一项目不再挤满同源 HTTP 连接池导致面板请求挂起（#383）。
- 所有操作经过工作区门卫：路径必须落在已注册 workspace 内（realpath 规范化 + 前缀校验），浏览器只能读写项目根下的相对路径。
- 所有 `/aionui-panel/*` 路由（JSON 操作、raw 读取与 SSE 事件流）默认仅限 loopback：非 loopback 客户端在任何工作区访问前即收到 `403 forbidden: loopback-only`，与 dsh-ssh 的 fence 一致。同时装了 `dsh-remote-web-ui` 时，有效的已配对设备 cookie 是额外放行路径（与 `api/gate` 检查同一枚 cookie）；未配对与已撤销设备仍 403。面板不硬依赖远程插件。
- 递归 watcher 忽略 `node_modules` / `.git` 下的变更；SCM 轮询每 30s 对每个 workspace 探测一次（单次探测有 15s 超时兜底），仓库发现与非仓库结论使用 TTL 缓存。文件编辑经 watcher 即时呈现；仅 `.git` 元数据变更（其他工具的 commit/checkout）与仓库列表变化在一个轮询周期内或窗口重新聚焦（5s 节流）时呈现。
- browser 半区（`src/client/`）以当前会话 cwd 作为项目根，切换会话即切换项目。

## 已知限制

- 嵌套仓库发现会跳过 `node_modules`，不会跟随符号链接目录，每个工作区单轮最多扫描 10,000 个目录。新增或删除仓库后，最多需要等待 30 秒发现缓存过期才会显示。

## 结构

- `src/index.ts` — host 半区入口（cordis 插件：路由注册 + systemPrompt 公告）。
- `src/host/` — fs/git 数据服务与路由层（workspace gate）。
- `src/core/types.ts` — 前后半区共享的线上类型。
- `src/client/` — browser 半区：框架无关状态核心（`store.ts`）、拖拽引擎（`drag.ts` + `hooks/useResizableSplit.ts`）、DOM 布局控制器（`layout.ts`，向 shell 的三栏 grid 追加面板轨道）、React 组件（explorer / scm / preview），以及 mermaid 增强（`preview/mermaid.ts` + `chat/mermaid-chat.tsx`）。
- `tests/` — clamp 公式、porcelain 解析、持久化校验、markdown/csv 渲染、store 行为等纯逻辑测试（vitest，37 个）。

## 构建

```sh
export NPM_TOKEN='<token>'   # 若仍使用私有 scope 认证
pnpm install
pnpm -r build
```

## 署名

本项目是 AionUi（iOfficeAI/AionUi，Apache-2.0）右侧面板系统的复刻实现：尺寸、颜色、动效、交互参数来自对 v2.1.53 的实测调研（研究报告与截图见 aionui-research 仓库），实现为全新代码，未大段抄录源码。上游版权归 AionUi 项目所有，本项目仅按 Apache-2.0 约定保留署名。
