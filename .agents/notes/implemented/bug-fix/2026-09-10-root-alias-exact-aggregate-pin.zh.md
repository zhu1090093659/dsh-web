# Agent Note: 根别名精确钉住一个已发布聚合包版本

Status: implemented

## Problem

Issue #1442：profile 通过 git 安装仓库根（`dsh plugin add github:zhu1090093659/dsh-web#v0.3.17`）后进入 loader 恢复模式，所有 `web-ui-*` 行报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。根包 patch 使用聚合包生成的清单，其中的行按家族子路径挂载，而模块来自 `@linxin666/dsh-web-all` 依赖。该依赖当时声明为 `^0.3.6`，范围宽到足以解析出 exports 落后于 patch 的聚合包：家族子路径最早出现在 0.3.13，`./model-capabilities` 在 0.3.18，`./preset-center` 在 0.3.19。git ref 变化时依赖规格字符串没变，已有 lockfile 便保留旧子包（报告里是 0.3.10），新 patch 无法导入它的行。

已发布的聚合包 tarball 是完整的——`npm pack --dry-run` 对 0.3.17 与 0.3.20 都列出 `lib/` 与全部子路径。报告里"没有 lib/ 构建产物"说的是仓库根的 git 载荷，它按设计只携带清单与生成的 patch（见[别名记录](../feature/2026-08-30-repo-root-installable-alias.md)）。

## Decision

- 根 `package.json` 依赖改为 `"@linxin666/dsh-web-all": "0.3.20"`——精确版本而非范围，patch 与模块永远来自同一版发布，lockfile 不可能保留更旧的子包。
- `scripts/verify-version.mjs` 断言根依赖等于发布 tag，并在发布前运行（`release.yml`）；不一致直接让发布失败。检查逻辑在 `scripts/lib/root-alias-pin.mjs`，单元测试在 `scripts/root-alias-pin.test.mjs`（随 `pnpm test:scripts` 运行）。

## Testing

- `node scripts/verify-version.mjs 0.3.20` 输出 "all 21 packages and the root aggregate pin match v0.3.20"；对 v0.3.21 运行同一命令退出码 1 并注解 `package.json`。
- `node --test scripts/root-alias-pin.test.mjs`：接受精确钉版，拒绝 caret 范围、过期的精确版本与缺失依赖。
- `pnpm install --lockfile-only --ignore-scripts` 仅改一行 lockfile（`specifier: 0.3.20`，仍是 `version: link:packages/dsh-web-all`），checkout 内的 workspace 链接行为不变。

## Alternatives considered

- 保留范围、加运行时守卫在解析出的聚合包缺少子路径时提前报错。否决：只是把启动失败提前成另一种启动失败，lockfile 仍会解析出不兼容的子包。
- `>=0.3.19`（第一个导出当前全部行的版本）。否决：今天能强制重新解析，但一旦家族新增子路径就会静默漂移——本 Bug 正是这样出现的。
- 把构建好的聚合包放进根 git 载荷。否决：违背别名设计（薄清单 + 模块来自 npm），并会在用户机器或 git 里重复发布构建。

## Consequences

- 每次家族发版都要把根依赖重新钉到新版本；`verify-version.mjs` 让"忘记重钉"变成发布失败，而不是用户可见的启动失败。
- 安装某个 tag 的 profile 拿到的正是由该 tag 构建的聚合包，patch 行与导出的子路径不再可能不一致。
- 别名记录里的 npm 渠道滞后仍然成立：git 安装某个 commit 时，若其 patch 引用了尚未发布的成员，要等那一版发布后才能解析。
