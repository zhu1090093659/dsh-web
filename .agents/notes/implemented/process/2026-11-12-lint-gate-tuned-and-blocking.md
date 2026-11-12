# Lint 规则集按本仓写法收敛，门禁转为阻断

## Problem

`.oxlintrc.json` 把 correctness / suspicious / perf 三类全部设成 error，CI 的 lint 步骤却是 `pnpm lint || true`：2026-11-12 实测 1239 个问题分布在 460 个文件，从未拦下任何提交，而 `docs/development.md` 要求提交前跑 `pnpm lint`。文档与门禁互相矛盾，开发者既拿到一堆无法处理的告警，也没有任何机制阻止新增。

## Decision

两条一起做，缺一不可：

- **按本仓写法收敛规则集**：关掉 9 条与既有写法必然冲突的规则——`eslint/no-await-in-loop`（顺序 IO 是刻意写法）、`unicorn/consistent-function-scoping`、`eslint/no-shadow`、`promise/always-return`、`unicorn/no-useless-spread`、`oxc/no-map-spread`、`unicorn/no-array-reverse`、`unicorn/prefer-add-event-listener`（DOM 处理函数赋值）、`eslint/no-new`（副作用构造）。同时把 `docs/archive/` 当冻结快照排除。
- **存量清零后让门禁阻断**：余下 293 条按「修代码」处理（no-unused-vars 131、no-useless-escape 40、no-useless-concat 21 等），只在两处保留逐行 `oxlint-disable-next-line` 并写明理由（控制字符正则就是该规范化的全部内容；`'</' + 'script>'` 的拆分是为了源码里永不出现字面闭合标签）。清完后把 CI 的 `|| true` 去掉。

## Alternatives

- **基线棘轮（照 test-standards 的 baseline 做法）**：能让存量不增长，但把 1239 条告警永久留在每个开发者的编辑器里，且没有推动任何人下压。
- **一次修完 1239 条**：跨 460 个文件的大规模改写，回归面与工时都不成比例；规则集本身与本仓写法冲突时，改代码等于迁就错误的规则。
- **只调规则不清零**：门禁仍无法阻断，问题原样存在。

## Consequences

`pnpm lint` 现在是干净且阻断的门禁，新出现的 finding 即回归。规则集的口径写在 `.oxlintrc.json` 与 CI 步骤注释里，后续要新增规则先在整树上跑一遍再决定是否收紧。索引守卫：任何规则重新打开前，先确认它对本仓是缺陷而非风格偏好。
