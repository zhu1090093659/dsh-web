# AGENTS.md — dsh-web-all

全家桶聚合载具包：安装它 = 全部功能插件 + 皮肤全家桶一个包装齐。本包无自有插件
逻辑（仅 compat shim），只是 child 插件 insert 行的汇总载体。

## 聚合机制

- `cordis.patch.yml` 是各 child 的 insert 行拼接（含每源注释头）；package.json
  dependencies 以 `workspace:*` 拉全部子包。安装单包即全部就位。
- `aggregate.yml` 是唯一手写清单：`patchFrom` 贡献 insert 行（嵌套聚合递归展开、
  按顺序、带源注释），`deps` 解析各子包 name 写入 dependencies。

## 新增 / 改动插件

- 往全家桶加插件，必须**同步改 `aggregate.yml`**（`patchFrom` + `deps` 各加一行）
  并重跑生成，否则子包不被拉入/不展开。
- 生成脚本在仓库根 `scripts/aggregate.mjs`（不在包内），只写本包与它拥有的
  aggregate 缓存，幂等可重跑；`--check` 模式只校验、有漂移退出 1，是 CI 门禁。

## 提交前检查

```sh
node scripts/aggregate.mjs --check
pnpm aggregate:check
```
