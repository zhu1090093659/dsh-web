# @linxin666/dsh-client-ui-preset-center

[English](README.md) | 中文

DSH Web GUI 的社区 agent 预设管理器：创意工坊的**预设**面板，以及负责安装、声明、停用、卸载从 [dsh-market.com](https://dsh-market.com) 下载的预设的 host 侧库。预设只有被本插件**声明**进 agent-preset 注册表后才会出现在**设置 → Agent 预设**；其余都留在创意工坊。

## 能力

- 在创意工坊商店卡新增**预设**标签页（通过卡片声明的 `dsh-workshop.panel` 子槽位注入），列出社区目录，带安装状态、版本更新提示与安装计数。
- 把预设安装到惰性库 `$DSH_HOME/agent-presets/<id>/`。没有任何东西扫描该目录：harness 不再从磁盘发现预设，因此下载下来的组合不会自行加载。
- 把已安装预设**声明**给 `ctx.agentPresets`（`@deepseek-ai/dsh-agent-preset-registry`）。host 半区从 `preset.yml` 读显示文案、从 `agent.cordis.yml` 读子插件行，然后调用 `register`，因此已声明的预设无需重启 `dsh web` 就能立即组合新会话。停用会撤回声明，卸载会撤回声明并删除库目录。
- 显示由**已安装字节**算出的**组合画像**——组合挂载的插件名、是否携带本地代码文件或 `!!js` 表达式——并在声明任何可执行内容前要求显式确认；声明前可用只读查看器阅读 `agent.cordis.yml`。
- 拒绝 id 已被其它声明占用的预设（注册表会拒绝重复 id，声明看起来成功却毫无效果），也拒绝停用或卸载注册表当前默认值指向的预设（默认值指向不存在的预设会让每个新会话创建失败）。
- 每次读取状态都校验市场 provenance：逐文件 sha256 锚定 `https://dsh-market.com`，因此本地改动过的预设会被标为「本地已修改」，更新也绝不静默覆盖它。

## 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-preset-center
```

创意工坊卡片（`@linxin666/dsh-client-ui-market`）声明面板槽位并负责下载；没有它时 host 路由仍可用，但没有面板驱动。两者都在 `@linxin666/dsh-web-all` 聚合包内。

## 配置

无。面板是唯一界面，所有行为都由目录清单、库目录与实时声明推导。插件不注册设置命名空间，也不向 agent 系统提示注入任何内容。

## 安全模型

预设是代码，不是资源：它的组合可以引用 npm 插件、加载随预设目录分发的文件，并在 DSH 主进程内求值 `!!js` 表达式——全部发生在它被声明之后。harness 对此的表述很直白：预设拥有与 shell 访问同等的信任。因此本插件从不把「下载」当作「运行」：

- **下载是惰性的。** 市场安装器写入 `$DSH_HOME/agent-presets/<id>/`，没有任何发现根扫描它。插件加载时也不声明任何预设。
- **声明才是授权边界。** 声明会把组合注册进注册表，注册表随即在主进程内急切挂载它的行。只要组合携带本地代码、相对路径行或内联表达式，面板就要求显式确认，并展示这些内容是什么。
- **声明前校验、失败回滚。** id 会与实时 roster 比对；roster 报告为 broken 的预设会被注销并显示原因，而不是留在半声明状态。
- **provenance 是完整性锚。** 每次读取都重新校验市场记录的逐文件 sha256；不匹配会被报告，绝不静默修复。
- **路由仅限 loopback。** `/api/preset-center/*` 只应答 loopback 请求，与市场网关同一道栅栏，远程浏览器无法驱动该库。
- **未托管目录不可触碰。** 没有市场 provenance 的预设（自建或由其它工具安装）会被标注，并被卸载拒绝。

## 已知限制

- **声明不是沙箱。** 确认与组合画像降低的是误操作风险，并不能让不可信预设变安全。发布环节的人工审查才是真正的控制点。
- **声明随 host 进程存续。** 插件加载时不声明任何预设，因此 `dsh web` 重启后每个已安装预设都回到惰性状态，需要在创意工坊里逐个点击启用。若把启用状态持久化，重启就会成为下载内容自动生效的时刻，而那正是本面板要收集的授权。
- **官方设置分区可能滞后。** 它只在自身动作、`settings/document-updated` 与 `connection/reset` 时重读，因此在创意工坊声明的预设可能需要刷新页面才出现在**设置 → Agent 预设**；新建会话会立即看到它。
- **运行中的会话保留原预设。** 会话的组合在创建时固定，停用或卸载不会改变正在使用它的会话。
- **组合子集刻意收窄。** 组合由只读懂预设所用 YAML 的读取器解析（块映射与块序列、引号与普通标量、字面块与折叠块、`!!js`），遇到其它构造——锚点、别名、流式集合、额外标签——一律拒绝而不是猜测。被拒绝的组合会被如实报告，并保持未声明。
- **目录为空直到有预设发布。** `packages/dsh-preset-center/presets/catalog.json` 是发布源，贡献格式见该目录的 README。

## 架构

- `src/index.ts` —— host 半区：持有实时声明，每进程挂载一次 loopback 网关。
- `src/routes.ts` —— `GET /api/preset-center/state`、`GET /api/preset-center/composition?id=`、`POST /api/preset-center/{install,disable,uninstall}`；唯一读取 roster 的层，因此保留 id 与默认预设两条策略在这里。
- `src/host/declarations.ts` —— 注册表声明：安装时注册，停用/卸载与插件卸载时注销。
- `src/core/paths.ts` —— 库路径契约与预设 id 规则。
- `src/core/library.ts` —— 库状态：扫描、由声明推导的 `enabled` 标志、卸载。
- `src/core/yaml.ts` —— 组合读取器（fail-closed 的 YAML 子集，`!!js` 保留为数据）。
- `src/core/definition.ts` —— 由已安装字节读出的注册表定义。
- `src/core/provenance.ts` —— 市场 provenance 读取与逐文件校验。
- `src/core/profile.ts` —— 组合画像。
- `src/client/PresetPanel.tsx` —— 创意工坊卡片渲染的面板。
- `presets/` —— `scripts/market-build` 读取的发布源（catalog 加每个预设一个目录）。

库路径是跨包契约：市场安装器把 `preset` 资产写进 `$DSH_HOME/agent-presets/<id>/`，两个包互不 import；路径名与 `dsh-market.provenance.json` 格式是镜像常量，与皮肤中心镜像市场 provenance 的方式一致。
