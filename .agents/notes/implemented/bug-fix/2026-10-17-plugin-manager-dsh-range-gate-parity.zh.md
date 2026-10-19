# Agent Note: 更新门禁用与宿主门禁相同的方式求值 DSH 区间

Status: implemented

## Problem

插件页的更新按钮拒绝每一个 `dsh.engines.dsh` 声明不是单个 `>=X.Y.Z[-pre]` 比较符的版本：界面显示「需要 DSH ...；请先升级 DSH 再更新」并禁用按钮，而运行中的 DSH 是满足该声明的。

门禁本身分两段。`packages/dsh-plugin-manager/src/core/version.ts` 用
`MINIMUM_RANGE_PATTERN = /^>=\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/` 匹配声明，其余形态一律返回
undefined；`src/host/routes.ts` 的 `compatibleVerdict` 随后按 #754 的 fail-closed 策略把 undefined
折叠为 `compatible: false`，于是「解析不了你的声明」变成了「你的 DSH 太旧」送到用户面前。

两个已发布的第三方插件正好撞上这条路径。`dsh-llm-verifier` 0.10.1 声明

```
^0.1.1-rc.2 || ^0.1.2-alpha.1 || ... || ^0.2.1-rc.1 || ^0.2.1-rc.2
```

即 29 段覆盖 0.1.x / 0.2.x 两条线的 `^` 与 `~`（等价于 `>=0.1.1-rc.2 <0.3.0`，已逐版本核对），
`dsh-context` 声明 `>=0.1.7-rc.2 || >=0.2.0-rc.2`。在运行 `0.2.1-rc.2` 的宿主上两个声明都被满足，
两个插件却都被挡住无法更新，且用户没有绕行手段。

官方启动门禁的判定不同。app-boot 的 `evaluatePluginCompatibility`
（`packages/boot/app-boot/src/plugin-compatibility.ts`）委托给
`satisfies(runtimeVersion, range)`，即
`range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
——所有合法的 node-semver 区间形态，prerelease 参与比较。安装器在启动时放行这些插件，插件管理器
随后拒绝更新它们：两个门禁对同一条声明给出了不同答案。

## Decision

**要求由 semver、用官方的调用求值，并落在 host-only 模块里。**

1. 区间判定从 `core/version.ts` 移到新的 host-only 模块
   `packages/dsh-plugin-manager/src/host/dsh-compat.ts`，它导出
   `evaluateDshCompatibility(host, range): DshCompatibility`——三分判定
   （`satisfied` / `host-too-low` / `unverifiable`），使任何调用方都无法把
   「我们没能核验」折叠成「你的 DSH 太旧」（issue #1899）：

```ts
if (range.trim() === '') return { verdict: 'unverifiable' }
if (semver.validRange(range) === null) return { verdict: 'unverifiable' }
if (semver.valid(host) === null) return { verdict: 'unverifiable' }
return semver.satisfies(host, range, { includePrerelease: true })
  ? { verdict: 'satisfied' }
  : { verdict: 'host-too-low' }
```

   因此 `||`、`^`、`~`、空格分隔的比较符集合与 x-range 在这里的判定与启动时逐位相同，
   prerelease 宿主参与比较，而不是被 npm 默认的 prerelease 规则排除。

2. host-only 落位是契约而非偏好。`semver` 是 node 包；`src/core/` 会被两侧 program 编译，
   `src/client/` 也会渲染同一条声明。浏览器半区保留 `displayMinimumVersion` 纯正则的显示逻辑不变
   （`pnpm libs:write` 只刷新了 `packages/dsh-web-all/lib/client.js` 里的注释文本，任何客户端 bundle
   都没有引入区间求值器）。`core/version.ts` 保留 `parseDshVersion`、`compareVersions`、
   `displayMinimumVersion` 与 `dshRequirementOf`——要求读取器仍拥有字段优先级
   （`dsh.engines.dsh` > `engines.dsh` > `@deepseek-ai/dsh` peer），`routes.ts` 只从新模块引入
   判定本身。

3. 返回契约携带原因而不是把原因折叠掉：空声明、node-semver 拒绝的区间，或不是一个合法版本的
   宿主字符串给出 `unverifiable`；只有真的比较过运行版本且输了才给出 `host-too-low`。
   `compatibleVerdict` 对两者都 fail closed，但只为 `host-too-low` 下发 `hostVersion`：
   浏览器正是靠该字段区分「太旧」与「没能核验」，所以一条带 `hostVersion` 的 `unverifiable`
   行会让用户看到「请先升级 DSH」，而那条声明根本没人求值过（issue #1899）。

4. 空声明守卫必须显式，因为它无法委托：`semver.validRange('')` 返回 `'*'`，只查 `validRange`
   会把「没声明」变成「无约束且已满足」。官方门禁同样用 `range.trim() !== ''` 守卫。

5. `>= *` 现在按它本来的含义——无约束区间——读作满足（node-semver 把它归一为 `'*'`），
   与官方门禁一致。旧 `version.spec.ts` 断言它返回 undefined；该断言被有意反转，理由写在测试处。

6. `semver` `^7.8.5` 加入本包 `dependencies`（host 半区运行时 import 它），`@types/semver`
   `^7.8.0` 加入 `devDependencies`。

## Alternatives considered

- **在 `core/version.ts` 里继续自写区间求值器。** 否决：它必须重新实现比较符集合、`||` 备选、
  caret 与 tilde 展开、x-range、prerelease 排序以及 `includePrerelease` 的交互——一套私有方言，
  上游一旦改变语义就会漂移，而这正是本 bug 的成因类型。对用户的承诺是「与启动门禁给出相同答案」，
  只有同一个库能守住它。
- **改第三方插件的清单（把声明收窄成 `>=X.Y.Z`）。** 否决：那是其他仓库的声明，官方安装器与启动
  门禁本已接受；为了迁就一个解析器而收窄它们会削弱其自身的兼容语义，而且每出现一个写合法区间的
  新插件都要重来一次，本仓库的门禁仍然读不懂它自己放行的清单。
- **把区间求值放进 `core/version.ts`，让两侧共用同一函数。** 否决：那会经 `displayMinimumVersion`
  的 import 链把 semver 拖进浏览器 bundle，为浏览器根本不算的判定（结果由宿主经线协议下发）增大
  每个客户端 bundle。
- **让浏览器也自行求值。** 否决：判定已经作为 `compatible` / `hostVersion` 从宿主下发；重复求值
  会多出第二个事实源，并在客户端 bundle 里多一份 semver。
- **区间不符合窄形态时干脆丢掉要求（fail open）。** 否决：#754 有意对门禁无法核验的声明 fail
  closed，使真正不满足的要求永远无法被绕过。缺陷在解析器的覆盖范围，而不是 fail-closed 策略——
  该策略对真正无法核验的输入继续有效。

## Consequences

- 任何 node-semver 区间形态的声明现在都与启动门禁同一个调用判定，安装器与插件管理器不再对同一份
  清单给出矛盾结论。
- 门禁只从 host 半区触达 `semver`；若有人从 `src/client/` 引入 `dsh-compat.ts`，会在打包时暴露
  （`lib/client.js` 出现 semver 内部实现），而判定模块位于 host 目录本身就让这一点可被检查。
- 「无法核验」的集合更窄也更明确：空声明、node-semver 拒绝的区间（`nonsense`、部分合法的
  `||` 链）、以及不是一个合法版本的宿主字符串。其余全部给出判定。
- 线协议靠 `hostVersion` 的有无来携带原因，而不新增字段：被拦的行若点名了宿主版本，说明它真的
  与该版本比较过，只有这种行才提示用户升级 DSH。详情区块与列表级工具条共用同一个 helper
  （`dshGateOf`），两处不可能再对同一个判定给出不同文案（issue #1899）。
- 多形态区间的显示串仍是原声明（`^0.1.0-rc.8`），因此无法缩短的文案读起来就是声明本身。
- `packages/dsh-plugin-manager/package.json` 新增对 `semver` 的运行时依赖，由
  `pnpm runtime-deps:check` 对照产出的 host `lib/` 校验。
- 家族包自身的窄 `>=X.Y.Z` 下限不变：`scripts/family-dsh-engines.test.mjs` 与
  `scripts/plugin-template/package.json` 仍要求该形态，家族继续声明它真正想表达的形态。

## Testing

- `packages/dsh-plugin-manager/tests/dsh-compat.spec.ts`（新增）：真实的 29 段 `dsh-llm-verifier`
  声明被 `0.2.1-rc.2` 满足、被 `0.3.0` 与 `1.0.0` 拒绝；`dsh-context` 的
  `>=0.1.7-rc.2 || >=0.2.0-rc.2` 被 `0.2.1-rc.2` 与 `0.3.0` 满足、被 `0.1.0-rc.8` 拒绝；单比较符下限
  `>=0.1.0-rc.8` / `>=0.1.1-rc.1` 维持原答案；`^`、`~`、x-range、比较符集合与带空格的比较符都给出
  判定；`>= *` 与 `*` 满足；空串、纯空白、`nonsense` 与部分合法的 `||` 链为 undefined；
  `nope` 与 `0.1` 宿主为 undefined。
- `packages/dsh-plugin-manager/tests/version.spec.ts`：区间用例已从 `meetsMinimumDsh` 移出；
  `dshRequirementOf` 新增一条用例，证明多形态区间经读取器原样透传。
- `packages/dsh-plugin-manager/tests/update-route.spec.ts`：「无法核验」用例改用不可解析区间，而不是
  `^0.1.0-rc.8`（如今它是合法且会被求值的区间）；新增用例把 `>=0.1.7-rc.2 || >=0.2.0-rc.2` 的发布
  走完整路由——在 `0.2.1-rc.2` 上放行，在 `0.1.0-rc.8` 上被拦并点名声明与运行版本。
  宿主读得到、但声明解析不了（`nonsense`，以及部分合法的 `>=0.1.0-rc.8 || garbage` 链）时，
  行为 `compatible: false` 且**完全不带** `hostVersion`，用 `toEqual` 全等断言，多出字段即失败；
  同一输入下更新前的 412 说「cannot verify」并点名声明，而不是让用户去升级 DSH。
- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx` 与 `tests/plugin-list-toolbar.spec.tsx`：
  两处界面都从「无 `hostVersion` 的行」渲染「无法核验」文案、从「有 `hostVersion` 的行」渲染升级文案，
  且未声明 DSH 要求的普通发布完全不渲染兼容行。
- 经新模块实测：`0.2.1-rc.2` 对两个真实声明均为 `true`；`0.3.0` 对 `dsh-llm-verifier` 为 `false`、
  对 `dsh-context` 为 `true`；`0.1.0-rc.8` 对两者均为 `false`。
- 本次改动运行的检查：包级 `typecheck`、`build` 与 `vitest run`（0.4.7 基线上 366 个用例，上游的
  实时行覆盖改动扩充了 `gateway-jobs`、`gateway` 与 `rows` 三套用例）、`pnpm typecheck`、
  `pnpm build`、`pnpm libs:write` 后 `pnpm libs:check`、`pnpm runtime-deps:check`、
  `pnpm test:standards`（`version.spec.ts` 缩减后基线随之下调）、`pnpm test:scripts`、
  `pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`。`pnpm lint` 在本次新增的文件上
  没有任何问题，`routes.ts` 与 `update-route.spec.ts` 的既有问题与基线完全一致。对 `packages/dsh-web-all/lib/client.js` 与
  `packages/dsh-market/lib/client.js` grep `parseComparator`、`replaceCaret`、`class SemVer`、
  `includePrerelease`，两者均为 0 命中。
