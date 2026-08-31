# Agent Note: 双 cohort 客户端兼容修复（存储引擎、注入面）

Status: implemented

## 问题

0.1.2-alpha.1 预览 cohort 迁移合入 `dev` 后，家族插件在正在运行的 0.1.1-rc.2 宿主上拒绝加载（npm 最新可安装版本；预览 cohort 未发布、返回 404）。先后暴露出两处对新 cohort 的硬耦合：

1. **存储引擎 require 未命中模块表。** 迁移把 `dsh-client-store` 定为冻结平台模块，共享客户端构建预设将其 externalize，于是每个重建的客户端 bundle 都在求值期硬 require 它：

   ```
   failed to import loader entry 47c06ebb (@linxin666/dsh-client-ui-web-ui-settings):
   client-modules: require("@deepseek-ai/dsh-client-store") missed the module table —
   not a platform seed word, not a materialized module, and no registered package factory
   ```

   引擎契约跨 cohort 完全一致：rc.2 的 `@deepseek-ai/dsh-client-runtime/client` 导出同样的 `createSnapshotStore` / `defineStore` / `shallowEqual`（就是上游搬进 `dsh-client-store` 的同一份 `contract/store.ts`），且 rc.2 将其物化为 `dsh-client-runtime` 注入模块的 `./client` 面——正是旧 RUNTIME_STORE_EXEMPTION 服务的那个 specifier。

2. **task-board 入口永远 pending 在一个 0.1.2 独有的注入服务上。** Typert 网关迁移把 `'remote.agentPresets'` 加进了客户端入口的硬 `inject` 清单；该服务只在 0.1.2 宿主上注册（api-remotes 贡献），rc.2 上入口停在 `pending (waiting for service: remote.agentPresets)`，boot 报一个入口未激活。而名册本身在 rc.2 有可用来源：迁移前代码就是经 `connection.api.agentPresets.list({})` 读取的。

## 决策

每个包保持一份客户端产物同时服务两种宿主 cohort，cohort 专属面的解析收进共享接缝、在使用点运行时探测：

- **存储引擎（shared/tsdown.client.ts）：** `@deepseek-ai/dsh-client-store` 的值导入不再 external。bundle 纯度插件把它们重定向到生成的 shim 模块，shim 在 bundle 求值期通过 loader 注入的 `require` 解析引擎：先试平台模块，回落到旧 `@deepseek-ai/dsh-client-runtime/client` 面。shim 里的 specifier 用 `join('')` 拼出，静态解析器不可见，require 调用原样落进 factory 作用域。shim 只转发两个引擎共有的值面——`notifySubscribers` 仅存在于 cohort 包，绝不转发；未来对它的值导入会在构建期以缺导出报错，而不是在 rc.2 上静默坏掉。type-only 导入不受影响：打包前已被擦除，类型仍来自已发布的 0.1.2 声明。
- **注入面（task-board 客户端）：** `remote.agentPresets` 移出硬 `inject` 清单（其余入口的服务在 rc.2 上都注册）。preset 名册在使用点经宿主实际提供的面读取——已注册则走 `remote.agentPresets`，否则回落 `connection.api.agentPresets`（迁移前的 rc.2 面）——两种 cohort 的 mode picker 都保留 preset，仅当宿主两者皆无时才空跑。读取失败保留旧选项并在下次重连重试，与之前一致。

相关：[preview SDK cohort via source-built tarball overrides](../process/2026-08-28-preview-cohort-tarball-overrides.zh.md)（引入这一双轨的迁移）。

## 落选方案

- **保留硬耦合，要求升级宿主**：拒绝——0.1.2-alpha.1 cohort 未发布，正在运行的 rc.2 宿主无法升到它；家族会在唯一可安装的环境里持续坏掉。
- **把 `dev` 回退到 rc.2 cohort**：拒绝——推翻既定迁移；源码已改用 0.1.2 面。
- **在各包源码里各自写 try/catch require**（存储引擎）：拒绝——兼容逻辑在九个包里重复、污染客户端源码；预设是所有 bundle 共享的唯一构建期接缝。
- **构建期选择 cohort（每宿主一份产物）**：拒绝——按宿主分产物重新引入有状态构建，必然再次漂移。
- **0.1.2 以下 cohort 放弃 preset 名册**（task-board）：拒绝——rc.2 的 connection 面提供同一份名册，空 picker 是自找的功能回退。
- **软等待服务而非移出 inject 清单**：拒绝——注入等待要么阻塞激活（硬），要么无法表达"没有它也继续"（此处 cordis inject 无可选标记）；使用点探测与 bridge 回落兼容绑定器用的是同一机制。

## 后果

- rc.2 宿主恢复加载家族客户端 bundle，task-board 正常激活；0.1.2-alpha.1 宿主的平台模块与注入面路径不变。
- `engines.dsh >=0.1.2-alpha.1` 下限与 README 的 DSH 徽章现在高估了客户端半区的实际要求（本修复容忍 rc.2），而 host 半区仍使用 0.1.2 面。是否把声明下限降回 rc.2 是维护者的 cohort 政策决定，此处不做。
- inject 契约中的 `dsh-client-store` 行对 0.1.2 宿主仍然正确；rc.2 宿主没有该包可注入，由 shim 回落承担。
- 新增 cohort 独有 store 导出的值导入会在构建期显式报错（缺导出）；新增 cohort 独有注入面必须遵循 task-board 模式（使用点探测），否则入口会在旧 cohort 上 pending。

## 验证

- 重建全部工作区客户端 bundle：硬 `require("@deepseek-ai/dsh-client-store")` 清零；shim 恰好出现在九个值导入 store 的 bundle（desktop-launcher、doctor、market、perf、pet、remote-web-ui、task-board、tool-describe-image、web-ui-settings）。
- 线上 rc.2 宿主已服务修复后的 bundle（抓取 `http://127.0.0.1:3080/plugins/…` 的 web-ui-settings 与 task-board，均 HTTP 200）：双 require 回落存在；task-board bundle 的 `inject` 数组已无 `remote.agentPresets`，发出的读取函数先探测 `remote.agentPresets`、回落 `connection.api.agentPresets`。
- rc.2 宿主树的 `dsh-client-runtime/lib/client.js` 验证导出 `createSnapshotStore` 与 `defineStore`（引擎回落可答）。
- `pnpm typecheck`、`pnpm test`（19 套件）、`pnpm test:scripts`（226 通过）、`pnpm docs:check`、`pnpm aggregate:check`、`pnpm market:check`、`pnpm skin-center:check` 全部通过；task-board 改动后单独复验（tsc 干净、241 测试通过）。
