# Agent Note：内联 client bundle 里 CSS module 样式标签互踩

状态：implemented

## 问题

线上 web GUI 里，除第一个被处理的子包外，其余全部家族设置卡都以 UA 裸默认
样式渲染：折叠卡变成 fit-content 的行内按钮而非全宽折叠行，宠物 / Doctor /
任务板 / 远程访问 / 图像理解 / 桌面启动器的字段完全没有样式，且与皮肤无关。
另外，共享卡片 chrome 的提示与描述文字对比度可能跌破可读线（orca-link 的
`--dsw-alias-label-tertiary` #778399 落在奶油底上，12-13px 下约 3.4:1）；
错误态样式引用了 `--dsw-alias-label-error`——任何皮肤与宿主表面都未定义该
token，保存失败与非法输入的报错信号静默退化为继承墨色。

两个根因：

1. 共享 client 构建预设（`shared/tsdown.client.ts`）用
   `data-plugin-css = "<bundle id>/<basename>"` 作为注入样式标签的去重键。
   聚合构建内联的八个包各带一份 `settings-card.module.css`，八份发射出同
   一个 tag id，幂等守卫让第一个标签吞掉其余七个；而每个包的类名映射携带
   按路径派生的 CSS-modules 哈希——七个类映射指向从未注入的样式表。
2. `scripts/sync-shared.mjs` 的 `SETTINGS_CONSUMERS` 不含 `dsh-perf`，其
   卡片层拷贝随之漂移：聚合为七个子包内联了新鲜共享样式，而 perf 自己
   bundle 里的陈旧拷贝继续吐旧的 tertiary 提示色。

## 决策

- 预设改用完整仓库相对文件 id 作为样式标签键
  （`<bundle id>/packages/<pkg>/src/client/<file>.module.css`），不同包的
  同名 module 不再互相吞并。`data-plugin`（卸载清理键）不变。
- 共享 `settings-card.module.css` 的小字角色（`.description`、`.hint`、
  `.readOnly`）改用 `--dsw-alias-label-secondary`；错误角色（`.failed`、
  `.invalid`、`.inputInvalid` 及其焦点环）改用
  `--dsw-alias-state-error-primary` 并回退 `#b42318`。
- `scripts/sync-shared.mjs` 新增 `SETTINGS_CARD_ONLY_CONSUMERS` 层：
  `dsh-perf` 与其他消费者一样同步卡片层拷贝（`PluginSettingsCard.tsx` +
  `settings-card.module.css`），但 `settings-form.ts` 刻意保持七包目标——
  dsh-perf 仍运行 0.1.2 之前的逐字段表单实现（保存路径按逐字段 judge，
  而非共享的原子 mutate + 回读校验），覆盖它属于行为变更而非样式同步。
  `perf-settings-card.tsx` 的两处 select 提示改走 `css.hint`，不再用内联
  `opacity: 0.66`。

## 已考虑的替代方案

- 按内容哈希去重相同样式表：否决——CSS-modules 哈希由文件路径派生，相同
  内容的拷贝仍产生不同类映射，无法共享标签。
- 聚合构建内把八份拷贝别名到单一规范样式表：否决——按包提交拷贝正是同步
  契约；在预设里重映射会把它耦合到包目录布局。
- 把 dsh-perf 挡在同步名单之外：这就是本次修的 bug（漂移本身）。

## 后果

- 内联多包的 bundle 现在按 module 文件（而非 basename）注入样式标签；聚合
  包多带几份近似重复的 4KB 样式表，代价可忽略，且失效模式从静默丢样式变
  为可见的正确样式。
- dsh-perf 的设置保存路径仍是旧代表单实现，其 bundle 在重建前提示色依旧；
  鉴于 dsh-perf 已计划完全弃用，不再计划对齐它的 `settings-form.ts`——弃
  用时应一并移除 `SETTINGS_CARD_ONLY_CONSUMERS` 层。
- 方角皮肤（orca-link、xp）用 `border-radius: 0 !important` 刻意压平开关、
  下拉与弹层；设置控件在这些皮肤下保持可读但为方角。若判定观感破损，按皮
  肤豁免 `[role="switch"]` 只需一行 patch——留给皮肤负责人决定。

## 测试

`node --test scripts/sync-shared.test.mjs` 4/4（拷贝计数 110 -> 112、
client trio 39 -> 41）；`node scripts/aggregate.mjs --check` OK；全仓
`pnpm typecheck` 与 `pnpm i18n:check` 通过。实测 GUI（127.0.0.1:3080）：
orca-link 皮肤与默认外观下，Web 插件六张卡与宠物卡均为全宽折叠头
（`display: flex`、522px），九份 settings-card 样式表全部注入（聚合 8 +
perf 独立 1），字段/徽标/提示恢复共享 chrome，皮肤下原生 select 回退为
34px 高、token 配色，已同步包的提示计算色为 label-secondary #343b47。
