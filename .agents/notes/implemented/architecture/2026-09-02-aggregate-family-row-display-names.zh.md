# Agent Note: 聚合家族行经子路径导出显示真实插件名

Status: implemented

## Problem

官方插件列表（设置 → 插件列表，`dsh-client-ui-settings-plugin-inventory`）的卡片标题完全取自条目挂载的模块说明符——`moduleShortName(entry.options.name)`，没有其它显示字段。故障隔离 shell（[聚合 shell 隔离单插件启动故障](2026-09-01-aggregate-plugin-fault-isolation-shell.zh.md)）把每个家族行都挂在聚合包之下，于是约 17 张家族卡片显示完全相同的标题 "web-all"，只有展开卡片才能分辨 usage、pet、session-archive。

## Decision

每个 shell 包裹的家族行，其 `name` 现在挂载聚合包按家族的子路径导出：`@linxin666/dsh-web-all/<family>`（family = 命名空间行 id 去掉 `web-ui-` 前缀）。列表标题变成一个个独立的 `web-all/<family>` 标签——与宿主自身 `web-app/startup` 行的多条目惯例一致。挂载契约不变：全部子路径导出都解析到同一个共享再导出模块（`src/shells/shell.ts` → `lib/shells/shell.js`，对 main 入口 shell 的纯再导出），行配置继续携带真插件包名（`config.plugin`），故障隔离、degraded 台账、profile 补丁覆盖的行为与从前完全一致。

两个结构不变量保证显示名安全；二者都由 `scripts/aggregate.mjs` 强制（exports 维护 + shells 文件校验），并在 `packages/dsh-web-all/tests/shell-subpath.spec.ts` 回归把关：

- 家族 exports 键由生成器维护（按 aggregate.yml 清单增删，目标恒为 `./lib/shells/shell.js`），因此往 `aggregate.yml` 加家族不可能引导出一条子路径不存在的行。
- 标记 manifest（`src/shells/package.json`，构建进 `lib/shells/`）与再导出模块同目录：client 模块扫描器从条目模块 URL 向上走查最近的 package.json，标记（字符串 `name`、`type: "module"`、无 `dsh` 字段）让走查在到达包根之前停下。没有它，所有家族行都会解析回聚合包自己的 manifest 及其 `dsh.client` 半区——`reconcilePackage` 将抛出 "resolves from multiple active Loader sources"，聚合包浏览器半区（compat shim + client-children 挂载）随之损坏。`type: "module"` 出于同一条最近-manifest 规则：缺了它 Node 会把再导出模块按 CJS 解析。

## Alternatives considered

让行直接指向真插件包（裸 `usage` 标题）被否决：行的 `name` 就是 loader 要 import 的模块，家族包一坏整个 boot 再次回滚——把 shell 存在所要包含的故障原样请回来。在每个家族包内做隔离子路径导出（`<realpkg>/isolated`，真名在前的标题）被否决：行要从 profile 根解析家族包，重新引入聚合包刚消灭的解析脆弱性（每个 profile 安装必须在根上看到全部家族包）、要改 16 个包而非 1 个、还把聚合包发布与全部家族包新版本耦合。把聚合包的 `dsh.client` 半区搬去独立包以避开扫描器多来源检查被否决：新增一个包、搬移 client 入口、发布面搅动，只为省下一个 4 行的标记 manifest。inventory 的上游显示名字段是宿主级的干净答案但在本仓库边界之外；可像 `continueOnError` 一样向上游提案，日后采纳时也无需移除子路径标签。

## Consequences

插件列表里每个家族插件一张独立的 `web-all/<family>` 卡片，展开卡片不再是识别插件的唯一方式。代价：命名链现在横跨三个工件（行名 → exports 键 → 共享再导出 + 标记），全靠生成器门禁与测试而非单一文件强制；`lib/` 内随包发布一个嵌套 package.json（对 npm/pnpm 惰性，但把嵌套 manifest 当 workspace 包的工具必须继续忽略它）；家族子路径必须保持"仅显示"定位——把挂载语义放进子路径模块会分叉 shell 拥有的隔离契约。

## Testing

`packages/dsh-web-all/tests/shell-subpath.spec.ts` 以构建产物把关契约：逐家族的子路径行名且 `config.plugin` 契约完好、exports 键解析到共享再导出、shells 半区与 main 半区的 `apply` 同一（单一 degraded 台账实例）、标记走查（从 `lib/shells/shell.js` 向上最近的 package.json 是无 `dsh` 的标记；从 `lib/index.js` 是带 `dsh.client` 的包根）。`tests/shell-isolation.spec.ts` 新增真实 boot 场景，证明子路径行与 main 半区 shell 一样单独降级。`pnpm aggregate:check`、`pnpm typecheck`、`pnpm test`、`pnpm test:scripts` 通过；`dsh --profile web --dump-config` 显示子路径行名；从 live profile 根的 Node 导入探针经 exports 表与标记解析 `@linxin666/dsh-web-all/usage` 成功。bundle 层变更，需用户重启 `dsh web` 生效。
