# Agent Note: 集中式 ru 语言包（dsh-i18n）与 i18n 审计门禁

Status: implemented

## Problem

Issue #1300 要求 Web GUI 提供 English 与 Русский 支持。en 侧此前已基本完成（全部家族包都有 zh/en locale 对、键集一致性由编译期强制），但 ru 完全不存在，且扫描发现 client bundle 中存在漏网的硬编码中文文案，也没有任何门禁守护第三语言赖以安全的不变量：zh/en 键集一致、占位符一致、字典文件之外不得有未翻译的 CJK 文案。若把 ru 分散塞进 15 个包，翻译工作量会散落到 15 个属主，外部翻译贡献者的 PR 也得横跨 15 个目录。

## Decision

第三语言由一个专门的语言包插件集中承载，不变量由一个仓库级门禁强制：

- `packages/dsh-i18n` 是纯浏览器插件。它调用 `ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })` 扩展共享语言目录，再用单语言非 typed 的 `ctx.locale.register(ns, 'ru', dict)` 为每个家族插件命名空间注册 ru 字典。来源包保持不动，继续拥有 zh/en。
- ru 字典放在 `packages/dsh-i18n/src/client/ru/<来源包短名>.ts`，ns 到文件的映射集中在 `src/client/ru/index.ts`；首版覆盖全部 15 个受审计命名空间（1176 键，zh 全覆盖）。不做任何跨包 import：各包 zh 字典与其 ru 镜像的键集对齐完全由门禁保证。
- 注册失败语义（对照 `@deepseek-ai/dsh-client-locale` 0.1.2-alpha.2 验证）：`addLanguage` 在 id 被占用或回退链非法时抛错——catch 后继续注册字典，因为字典在查找时才解析回退链，不依赖注册时定义存在；`register` 对重复 `(ns, locale)` 抛错——逐 ns 独立 catch，外来属主只跳过它自己的 ns；所有 disposer 幂等，组合释放只释放实际注册成功的项。
- `scripts/i18n-audit.mjs`（`pnpm i18n:check`，与 typecheck/test/docs 同级的合并前主门禁）经 type stripping 加载真实字典模块、从各包 client 入口推导命名空间，校验 zh/en 键集一致、`{placeholder}` 在 zh/en/ru 间一致、每个 ns 的 ru 键集覆盖其 zh 键集，并扫描 client 文件中注释之外的 CJK（字符串、模板串、正则字面量、JSX 文本）。`i18n-allow: <理由>` 注释按行/按文件豁免；host 半区只告警不阻断。`--report` 输出各 ns 覆盖率，`--template` 导出翻译 JSON。
- 门禁首跑发现的漏网文案已在源头修复：dsh-perf 的 HUD 告警字符串移入该包字典并用 `{count}`/`{max}` 占位符（`perf-alert.ts` 助手，翻译位绑定一次、调用时读当前语言）；dsh-remote-web-ui 竖屏适配标签移入 `remote` 字典，翻译位经既有的 `__dshRemoteAdapt` 全局接线（标签随适配层的 sync tick 重渲染）；git-graph / usage 的列表分隔符（`、` / `；`）改为字典键。client 侧剩余的 CJK 只有 mobile-adapt.ts 中两个匹配官方 picker 单元格文本的正则字面量，带 `i18n-allow` 注释。

## 纯 DOM 界面与运行时语言（GUI 实测跟进）

首轮 GUI 实测暴露了外壳回退之外的第二种混杂来源：dsh-task-board、dsh-ssh、dsh-skill-explorer 三个包的 L1 侧边栏入口文案走包内模块级 t/tt 助手，按 `documentElement.lang` 二选 zh/en，而 SDK 的 Language 切换永远不会改它（实测切到 English 后这些入口仍是中文）。修复：模块级助手优先使用已接线的 SDK 翻译位（apply() 在字典注册后调用 `ctx.locale.bind(NS)`），仅在未接线时回退 document-language 二选；shared 的 sidebar-entry 核心新增可选 `refresh` 订阅，在语言变化时重贴 label / aria-label / tooltip；board / panel 挂载点在同一 `ctx.locale.subscribe` 信号下重渲染已打开的视图。

## Alternatives considered

- 把 ru 字典塞进各包（`register(ns, { zh, en, ru })` 或每个 locales 文件加第三个键）：否决——typed 双 locale 重载与各包 `Record<zhKey, string>` 契约都围绕 zh/en 构建，15 个目录的翻译文案会成倍放大外部贡献者的评审面，而集中一个包将来加第四语言时无需再动每个包。
- 只注册语言不带字典（先让语言出现在目录里，翻译按需跟进）：否决——issue 的诉求是全量覆盖，一个每条字符串都回落英文的 ru 选项比没有更糟。
- 门禁只校验键集（不做 CJK 扫描）：否决——首跑就抓到 8 处键集对齐永远看不见的真实漏网；正是这条扫描把「不写硬编码文案」从约定变成了被强制的契约。

## Consequences

- 新增家族包必须在 `scripts/i18n-audit.mjs` 的 PACKAGES 追加一项、在 dsh-i18n 加一个 ru 文件与一行映射，并过 `pnpm i18n:check`；任何既有包新增/修改 zh 键都必须在同一次改动里在 dsh-i18n 镜像 ru。
- 审计依赖字典模块是可裸加载的普通 TS；某包的 locale 文件若长出不可剥离的语法（enum、namespace）会破坏门禁加载，必须保持纯对象字典。
- `mobile-adapt.ts` 中两个 client 正则字面量凭标记永久豁免；若官方 picker 的 zh/en 词汇变化导致它们失配，需在同一次改动里同步处理标记。
- 验证：`pnpm i18n:check` 全绿（15 命名空间 / 1176 zh 键 / 1176 ru 键 / ru 覆盖率 100% / 2 处行级豁免）；dsh-i18n typecheck、test、build 全绿；聚合重生成含 `web-ui-i18n` 行且 `pnpm aggregate:check` 全绿。bundle 行改动需要用户侧重启 DSH 后，Русский 才会出现在 Settings -> General -> Language。 侧边栏跟进：typecheck/test/scripts/i18n 全绿，且实测切到 Русский 后家族侧边栏入口无需刷新即变为「Доска задач」/「Центр навыков」。
