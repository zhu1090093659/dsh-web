# AGENTS.md — dsh-i18n

DSH web GUI plugin dsh-i18n. 包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 本包是集中式语言包：`src/client/ru/<来源包短名>.ts` 每个来源包一个 ru 字典
  文件，`src/client/ru/index.ts` 持有「命名空间 id -> 字典」的唯一映射；文件名
  跟随来源包名（命名空间改名不影响文件名）。host 半区（src/index.ts）是刻意的
  no-op，浏览器半区只注册语言与字典，不渲染 UI、无设置命名空间。
- 维护契约：任何包的 `locales.ts`（或等价字典文件）新增/修改 zh 键后，必须在
  本包 `src/client/ru/` 镜像对应键并运行 `pnpm i18n:check`；门禁校验 zh/en 键集
  一致、ru 覆盖每个 ns 的 zh 键集、占位符集合一致。来源包清单与本包映射同步
  维护：新增家族插件包 = 新增一个 ru 文件 + index.ts 一行 + 脚本清单
  （scripts/i18n-audit.mjs 的 PACKAGES）一项。
- 注册语义（对照 @deepseek-ai/dsh-client-locale 0.1.2-alpha.2 验证）：
  `addLanguage` 在 id 被占用或回退链非法时抛错，抛错只影响语言定义，
  字典注册不依赖定义存在（查找时才解析回退链），因此 catch 后继续注册字典；
  `register(ns, 'ru', dict)` 对重复 (ns, locale) 抛错（单一属主），按 ns 逐个
  catch，抛错的 ns 跳过、其余照常。所有 disposer 幂等，组合释放只释放实际
  注册成功的项。
- 浏览器 bundle 纯度：对本包只 `import type` @deepseek-ai/*；ru 字典不跨包
  import（包间无依赖），键集一致性完全由 `pnpm i18n:check` 保证；包内
  tests/ 做字典内部自洽校验（非空、值为 string、无 CJK、占位符配对），
  跨包键集对齐以门禁为准，不在包内重复。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-i18n typecheck
pnpm --filter @linxin666/dsh-i18n test
pnpm --filter @linxin666/dsh-i18n build
pnpm i18n:check
```
