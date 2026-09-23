# Agent Note: 批次 issue 1668-1670——皮肤中心 store 逃逸、桌面 pnpm store 残留与过期的社区文案

Status: implemented

## Problem

三条未关闭报告，均在任何改动之前于本检出上核实：

1. **#1668——无凭据请求可删除整棵 skin-center 树。** `packages/skins/skin-center/src/we-routes.ts` 中的 `safeStoreId()` 用 `/[^a-zA-Z0-9._-]/g` 净化，而该字符类保留了 `.`。于是 `imported/..` 剥掉前缀得 `..` 并通过净化，`joinPath(storeDir, '..')` 解析到 store 根之上。`/we/remove` 只检查 id 以 `imported/` 开头且目标存在，随后执行 `rmSync(dest, { recursive: true, force: true })`。由于 store 根是 `<harnessHome>/skin-center/wallpapers`（`we-library.ts`），递归删除抹掉了整个 `skin-center` 树。该路由族唯一的门是 `requireSameOrigin`，它按设计放行不带 `Origin` 与 `Sec-Fetch-*` 的请求，因此同网段的裸 `curl` 无需任何凭据即可到达。本次已对真实路由工厂复现：`POST /remove {"id":"imported/.."}` 返回 `200 {"ok":true}`，树已消失。同一净化函数也供 `/we/reimport` 使用，后者同样调用 `rmSync`；那里由后续 `source-gone` 的 410 阻断了链路，故不构成独立可利用点，但它依赖同一条被破坏的不变量。

2. **#1669——发货的桌面载荷钉死了构建机的 pnpm store。** `desktop/scripts/build-runtime.mjs` 在 CI runner 上安装两个 runtime 部分，并把 `node_modules` 原样复制进暂存载荷。pnpm 在 `node_modules/.modules.yaml` 中记录产出它的 store，因此发货树携带 `/Users/runner/setup-pnpm/...`——任何用户机器上都不存在的目录。此后任何应用内插件或依赖更新都会以 `ERR_PNPM_UNEXPECTED_STORE` 中止。本次用仓库钉定的 pnpm 11.24.0 复现：把记录中的 `storeDir` 指向不可达路径后，`pnpm add` 以退出码 1 报该错，而 `pnpm install` 成功——这正是只启动宿主的发布冒烟测试从未捕获它的原因。

3. **#1670——归档聊天社区条目宣传了已移除的功能。** `packages/dsh-community-plugins/community.json` 仍把插件命名为「会话档案 / Session Archive」并承诺「历史版本恢复为副本 / History restore-as-copy」，二者在该插件 1.4.1 中均已移除；生成的 `market/dist/manifest/plugins.json` 重复了同一文案。

## Decision

**store 路径是被证明位于 store 之内，而非被假定如此。** 新增的 `storeEntryPath(storeDir, id)` 在 join 之前拒绝纯点号分量（`^\.{1,2}$`，使调用方得到确定性的 `bad-id`，而不是在 `__` 这类名字上得到一个被净化后的「未找到」），随后 join 净化后的名字，并断言解析结果以「store 根 + 分隔符」开头，否则返回 null。三个调用点——`/import`、`/reimport`、`/remove`——全部经由它，遇 null 时回 `400 bad-id`。`safeStoreId` 自身也把 `.` 与 `..` 折叠为占位名，使任何调用方都无法从它得到路径分量。包含性在解析后的路径上断言，因为递归删除真正需要的性质是「留在 store 根之下」，而净化单个分量无法证明这一点。

**暂存的桌面载荷不携带 pnpm store 记录。** `removePnpmModulesManifests(root)` 删除暂存树任意深度的每个 `node_modules/.modules.yaml`；若一个都没删到，`stage()` 直接失败，使未来的 pnpm 布局变化以构建失败暴露，而不是发出一个静默损坏的安装包。删除整个文件才是修复，已对 pnpm 11.24.0 验证：只去掉 `storeDir` 一行仍然失败（pnpm 随后把 store 报为 `undefined`），播种时跑 `pnpm install` 也不会改写记录路径；文件删掉后，pnpm 以用户自己的 store 重建它，`pnpm add` 成功。运行时实际解析所依赖的 `.pnpm` 虚拟 store 与其链接不受影响。

**社区条目描述的是实际发版的插件。** `community.json` 更新为作者提供的 1.4.1 身份——「归档管理 / Archive Management」并移除 History 表述——并由它重新生成 `market/dist`，因为 community.json 是市场插件 manifest 的唯一来源。

## Alternatives considered

- **#1668：只在 `safeStoreId` 内拒绝。** 否决作为唯一修复：它修好了净化器，却让删除操作继续信任一个「名字层面」的性质。未来若出现能通过净化的 id 形态，逃逸就会在无人重新审计的调用点上重现。包含性断言让该不变量局部于真正依赖它的操作。
- **#1668：只修被报告的 `/we/remove`。** 否决：`/we/reimport` 共用净化器与递归 `rmSync`，其可达性当时依赖一个无关的 410。修共享辅助函数同时覆盖两者，且无需为某条路由开特例。
- **#1668：给 `/we/remove` 增加凭据要求。** 否决：该路由族是同源回环 API，其令牌模型假定本地受信 GUI；真正缺失的检查是路径包含性。在此新增认证方案是更大的契约改动，且无法阻止来自其他调用方的路径逃逸。理由与本仓库对同源栅栏既有的一贯处理相同。
- **#1669：去掉 `storeDir` 一行（issue 的第一条建议）。** 依据实测否决，而非偏好：删掉该键后 pnpm 11.24.0 把依赖报为「linked from the store at undefined」，仍然以退出码 1 失败。该建议并未修复所报告故障。
- **#1669：在用户机器播种后跑一次 `pnpm install`（issue 的第二条建议）。** 依据实测否决：普通 `pnpm install` 不会改写已记录的 `storeDir`，随后的 `pnpm add` 在复现中依旧失败。
- **#1669：在桌面侧更新时检测过期的 `storeDir`（issue 的第三条建议）。** 否决作为主修复：它让每次启动都背一条针对「本属打包范畴」缺陷的修复路径，并把坏字节留在安装包里。在暂存阶段移除该文件，意味着载荷在发出之前就是正确的。
- **#1670：保留旧显示名，只改描述。** 否决：作者声明插件名本身在 1.4.1 已改为「归档管理 / Archive Management」，而市场条目正是用户浏览所依据的身份。id、repo、npm 与作者保持不变，因此安装身份不发生迁移。

## Consequences

- 携带 `imported/..`、`imported/.` 或 `imported/` 的 `POST /api/skin-center/we/remove` 现在返回 `400 bad-id`，skin-center 树存活；修复前的链路已失效。真正删除 `imported/<id>` 仍返回 `200` 且只删 store 条目。
- 穿越守卫由 `packages/skins/skin-center/tests/we-routes.spec.ts` 覆盖：两个纯点号 id 在两条删除路由上均被拒绝，且同级目录的哨兵文件仍在；另有一条单测钉定 `safeStoreId` 对普通、嵌套穿越与纯点号 id 的输出。
- 由 `build-runtime.mjs` 暂存的桌面载荷不再含任何 pnpm store 记录，因此在 store 与构建 runner 不同的用户机器上，应用内插件与依赖更新可正常工作。无 manifest 的载荷会让构建失败，这是 pnpm 布局已变的信号。
- skin-center 刷新后的 `lib/index.js` 现已在三个调用点包含 `storeEntryPath`；`packages/skins/skin-center` 与 `packages/dsh-web-all`（内联子插件客户端源码）的已提交产物指纹已在同一改动中重新记录。
- 创意工坊商店与 dsh-market.com 现在展示该插件的当前名称与描述；重新生成的 `market/dist` 同时推进了共享同一日期戳的另外五个 manifest 的 `generated` 字段。

## Testing

- `packages/skins/skin-center/tests/we-routes.spec.ts`：50 项测试全绿，含两条新增回归测试与净化器单测。并已端到端验证：针对真实路由工厂执行原始两步复现（`GET /inventory` 后 `POST /remove` 携带 `imported/..`）返回 400，且哨兵文件完好。
- `desktop/tests/build-runtime.test.mjs`：4 条新测试，覆盖嵌套删除、零删除信号、根不存在，以及清理后的载荷不再残留任何 CI store 路径。
- 在 pnpm 11.24.0（`packageManager` 钉定版本）下本地复现了所记录的 pnpm 故障与修复后的行为。
- 仓库门禁：`typecheck`、`test`、`test:scripts`（346）、`test:desktop`（34）、`test:standards`、`libs:check`、`market:check`、`aggregate:check`、`skin-center:check`、`community:check`、`i18n:check`、`docs:check` 与 `emoji:check` 全部通过。
