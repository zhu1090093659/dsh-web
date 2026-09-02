# AGENTS.md — dsh-web-all

全家桶聚合载具包：安装它 = 全部功能插件 + 皮肤全家桶一个包装齐。本包无自有插件
逻辑（仅 compat shim），只是 child 插件 insert 行的汇总载体。

## 聚合机制

- `cordis.patch.yml` 是各 child 的 insert 行拼接（含每源注释头）；package.json
  dependencies 以 `workspace:*` 拉全部子包。安装单包即全部就位。
- 家族行的 `name` 是按家族的子路径导出 `@linxin666/dsh-web-all/<family>`（官方
  插件列表因此每行显示独立的 `web-all/<family>` 标题），全部子路径都指向共享
  壳再导出模块 `lib/shells/shell.js`；子路径下必须有扫描器标记 manifest
  （`src/shells/package.json`，构建复制到 `lib/shells/`）：无 `dsh` 声明 +
  `type: module`，阻止 client 模块扫描器的 nearest-package 走查到达包根（否则
  与 compat 行构成同包多来源，扫描器 reconcile 直接抛错）。子路径 exports 键由
  生成器维护，勿手改。
- `aggregate.yml` 是唯一手写清单：`patchFrom` 贡献 insert 行（嵌套聚合递归展开、
  按顺序、带源注释），`deps` 解析各子包 name 写入 dependencies。
- `patches:` 段（单行 JSON flow mapping）对本聚合自插入行做整对象 config 覆写：
  用于播种行级默认（如 web-ui-ssh 的 enabled:false），渲染在全部 insert 之后；
  id 必须是本聚合已存在的行，settings 一经用户改动即优先于播种值。

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