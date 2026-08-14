# dsh-multi-pet

[English](README.md) | 中文

DSH Web 多桌宠兼容插件：让内置桌宠与第三方桌宠（如 whale-girl）在同一 profile 内同时运行。

## 问题

两个桌宠插件在根上下文注册了同名的 Cordis 服务 `pet`：

- `@linxin666/dsh-pet`（随 `@linxin666/dsh-web-ui-all` 内置）
- `whale-girl`（第三方，独立安装）

同时启用时 DSH 启动失败，报 `service "pet" has been registered`。常见的临时
方案是禁用其中一个。

## 方案

本包是一个纯 patch 型 DSH Web bundle。其 `cordis.patch.yml` 对内置桌宠 entry
施加 id 级补丁：

```yaml
- id: pet
  name: '@linxin666/dsh-pet'
  isolate:
    pet: true
```

loader（cordis-plugin-loader）会给 `pet` entry 一个 entry 本地隔离域：它的
`pet` 服务注册在仅属于该 entry 的符号下（`pet#pet`），第三方桌宠则保留根
`pet`。两者共存，各自解析各自的实现。两个插件都无需修改。

为什么用 `true` 而不是 label：`isolate: { pet: some-label }` 会把使用同一
label 的所有 entry 并入同一隔离域，从而重新触发重复注册冲突。entry 本地
（`true`）才是正确取值。

## 安装

```sh
dsh plugin --profile <name> add @linxin666/dsh-multi-pet
```

或挂载本地构建：

```sh
dsh plugin --profile <name> add link:/path/to/dsh-multi-pet
```

bundle patch 在所有 bundle 层之后应用，因此只要本包排在插入 `pet` 行的
bundle 之后（`dsh plugin add` 会追加到 `dsh.profile.bundles` 末尾，天然满足）
补丁即生效。若未安装 `dsh-pet`，补丁匹配不到目标行，只警告并跳过，无害。

查看组合结果：

```sh
dsh --profile <name> --dump-config
```

## 启用、禁用与切换

桌宠是普通插件：在你自己 profile 的补丁文件（`cordis.patch.yml`）中对对应
entry 设置 `disabled`，或增删 `dsh.profile.bundles` 里的 bundle。切换永不卸载
依赖、永不手改生成文件。切换是即时生效还是需要重启，以已验证版本的发布说明
为准（如实披露）。

通用配方——两个第三方桌宠都注册根 `pet`：在你自己的 profile patch 中对其中
一个施加 id 级隔离补丁，例如：

```yaml
- id: <另一个桌宠的 entry id>
  isolate:
    pet: true
```

## 未来桌宠的 provider 约定

- 每个桌宠使用唯一 loader entry id。
- `isolate: { pet: true }`（entry 本地），或每个 provider 使用唯一 label——
  绝不与其他桌宠共享 label。
- 每个桌宠使用独立命名空间的 HTTP 路由（`/api/pet/*`、`/whale-girl/*` 等）。
- 独立命名空间的存储键（数据目录与浏览器 localStorage）。
- 独立 DOM 根节点与明确的 z-index 分配（两只宠物默认都在右下角且 z-index
  相同；后挂载者在上层）。
- 设置项中明确 `visible` / `enabled` 语义。

## 已知限制

- 两个都注册根 `pet` 的第三方桌宠，若不对其中一个做隔离则仍然互斥（见上方
  通用配方）；本包开箱解决内置桌宠 + 第三方的组合。
- 同时模式下两只宠物默认都在右下角、同 z-index，后挂载者在上层。

## 开发

```sh
pnpm install
pnpm test
```

测试（node --test）：

- `patch.test.mjs` — 发布的补丁是单个 id 级 entry 本地隔离。
- `compose.test.mjs` — 补丁经真实 DSH patch 算法（`applyEntryPatches`）
  组合，只改动内置桌宠行；目标行缺失或 name 守卫不匹配时仅警告不失败。
- `isolate-mechanism.test.mjs` — 用真实 cordis + cordis-plugin-loader 验证：
  无隔离时两个 `pet` provider 冲突，有隔离时共存。

## License

MIT
