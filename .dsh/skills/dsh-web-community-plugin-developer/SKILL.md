---
name: dsh-web-community-plugin-developer
description: Develop a DSH community plugin and register it in the dsh-web Community Plugins index — author the plugin in the contributor's own repository following the official cordis bundle standard, add its entry to packages/dsh-community-plugins/community.json, regenerate the index with scripts/community-index, rebuild and test the community-plugins package, and submit the PR. Use when the user asks to develop a community plugin (社区插件), register/index/接入 a community plugin into the dsh web GUI, update community.json, or asks how community plugins get listed in the settings page.
whenToUse: 用户要开发/新建一个社区插件、把第三方插件登记/接入社区插件索引、更新 community.json，或询问社区插件如何进入 dsh web GUI 的「社区插件」列表。不适用于：皮肤（dsh-web-skin-developer skill）、宠物（dsh-web-pet-developer skill）、dsh-web 家族插件本身的开发（走 packages/AGENTS.md 与 scripts/dsh-plugin-new 的常规插件流程）。
disable-model-invocation: true
---

# 社区插件开发者（dsh-web 社区插件索引）

本技能覆盖两条路径：

- **路径 A**：社区贡献者在**自己的仓库**里开发一个 DSH 插件（官方 cordis bundle 标准）；
- **路径 B**：把插件**登记进 dsh-web 的社区插件索引**（`packages/dsh-community-plugins/community.json`），
  出现在 GUI 设置页的「社区插件」分区。

## 0. 事实速览（先读）

- **只索引、不内嵌**：`packages/dsh-community-plugins`（npm `@linxin666/dsh-client-ui-community-plugins`）
  只登记条目，每个条目链到贡献者自己的仓库；本仓库**绝不打包第三方代码**。
- **GUI 形态**：社区插件是设置页**一级菜单**（`settings.section` id `community-plugins`，order 140），
  与通用设置/模式/插件/Agent 预设及 Web 插件、皮肤中心、宠物并列，内容**直接展开**
  （`alwaysOpen`，无折叠），自带启用开关（`community-plugins` 设置命名空间，开关就在分区卡片内）。
- **插件管理器联动**：卡片桥接同家族 sibling `dsh-plugin-manager`（cordis 服务
  `pluginManager`，可选）——在场时展示已安装状态并可发起安装/卸载/看进度；缺席时
  降级为只读的复制安装命令索引。
- **数据流**：`community.json` → `node scripts/community-index` →
  `packages/dsh-community-plugins/src/client/generated/community.ts`（自动生成，内嵌进 client bundle）
  → 重建社区插件包。
- **门禁**：`node scripts/community-index --check`（等价 `pnpm community:check`）是 CI 漂移门禁；
  `scripts/community-index.test.mjs` 在 `pnpm test:scripts` 里校验条目契约。

## 1. 路径 A：在自己的仓库开发社区插件

社区插件的实现完全在贡献者自己的仓库完成，dsh-web 只链接它。形态与皮肤包一致的
官方独立 bundle 标准（对照 DSH `docs/user/develop/basic/publish.md`，turtle-ui 为范例）：

1. `package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`，以及 `dsh.client`
   （`platform: "web"` + 浏览器半区注入列表）；
2. `cordis.patch.yml` — bundle patch 层（插入插件行的 id/name）；
3. `prepare` 脚本 = `tsdown`（git 安装后自动构建 `lib/`，自包含，无项目引用）；
4. host 半区 `src/index.ts`（`apply(ctx)`）、browser 半区 `src/client/`，分层与
   exports 约定同 packages/AGENTS.md；
5. 类型只来自 `@deepseek-ai/*` npm SDK devDependencies；browser 半区对 `@deepseek-ai/*`
   只能 type-only 导入（运行时由宿主 shell 的 module table 提供）。

可选：给插件接设置页（host 用 `installSettingsSection` 注册命名空间，browser 用
`ctx.settingsScope.bind` + `settings.plugin.item` / `settings.section` 槽），要点见
`docs/plugins.md`「设置页插件配置」；发布到 npm 用自己的 scope（参考社区条目里的
`npm` 字段写法），用户即可 `dsh plugin add` 安装。

> 若插件要做进 dsh-web 家族（成为官方聚合成员而非社区索引条目），走
> `node scripts/dsh-plugin-new <name>` 脚手架 + `packages/dsh-web-all/aggregate.yml`
> 注册（patchFrom + deps）+ `node scripts/aggregate.mjs` 重生成，门禁
> `pnpm typecheck && pnpm test && pnpm docs:check`。

## 2. 路径 B：登记进社区插件索引

1. 编辑 `packages/dsh-community-plugins/community.json`，追加一条记录。字段契约
   （`scripts/community-index` 强制校验，缺必填即抛错）：
   - 必填：`id`（唯一，小写 kebab）；`name` / `nameEn`（显示名，中/英）；`author`
     （贡献者 GitHub 用户或组织）；`repo`（`https://` 完整 URL，且只允许 path-safe
     字符 `^[A-Za-z0-9._~/-]+$`——卡片会把 repo 拼进 shell 安装命令，空格与 shell
     元字符直接拒绝）；
   - 可选：`description` / `descriptionEn`（一句介绍，建议成对填写）；`npm`（npm 包名，
     **实际发布过才填**，且必须是合法包名）；`category`（`ui` / `agent` / `tools` /
     `knowledge` / `integration` / `security` / `utility` 之一，不在枚举即拒绝）。
2. 重新生成索引、重建并测试：
   ```sh
   node scripts/community-index            # 重写 generated/community.ts（禁手改；改条目只改 community.json）
   node scripts/community-index --check    # 与磁盘一致（CI 同一门禁）
   pnpm --filter @linxin666/dsh-client-ui-community-plugins build
   pnpm --filter @linxin666/dsh-client-ui-community-plugins test   # guard 测试逐条校验条目
   ```
3. 本地验证：重启 `dsh web`，设置页一级菜单「社区插件」直接展开，新条目按 community.json
   顺序出现、仓库链接可点，每条目展示安装命令（已发布 npm 用包名，否则用仓库地址）；
   关闭分区卡片内的开关后列表隐藏。
4. 提交 `community.json` + 重新生成的 `generated/community.ts`，开 PR。条目由维护者在
   community.json 里审核，PR 描述附设置页截图。

## 3. 验收清单（全部满足才算完成）

- [ ] 插件本体在贡献者自己的仓库，官方 bundle 标准四件套齐全（或明确走家族聚合流程）
- [ ] community.json 条目字段契约全部满足（id 唯一、repo 为 path-safe 的 https:// URL、
       category 在枚举内、无 emoji）
- [ ] `node scripts/community-index --check` 通过（生成文件已同步提交）
- [ ] 社区插件包 `build` 与 `test` 通过（guard 测试逐条校验条目）
- [ ] 本地 GUI 实测：一级菜单「社区插件」直接展开，新条目与链接正确
- [ ] PR 附设置页截图，提交信息无 emoji

## 4. 常见坑

- **repo 不是 path-safe 的 https:// URL**：校验直接拒绝（`must be an https:// URL of
  path-safe characters`；空格与 shell 元字符不允许）。
- **category 不在枚举内**：直接拒绝（`category must be one of ...`）。
- **把第三方代码提交进本仓库**：索引只登记元数据，任何第三方实现都应留在贡献者仓库。
- **手改 generated/community.ts**：它是 `scripts/community-index` 的产物，手改会在 --check 门禁下报漂移。
- **npm 字段提前填**：包还没发布就填会误导用户安装失败；发布后再补并重新生成。
- **中英 description 不成对**：索引面向中英双语用户，参考既有条目的成对写法。
- **找不到分区**：社区插件是一级菜单（与皮肤中心/宠物同级），开关在分区卡片内，不在「插件配置」页。
- **把索引开关当成插件开关**：分区自带的开关只控制索引列表显示与否。要运行某个社区插件，复制卡片上的
  安装命令（`dsh plugin --profile web add <npm|repo>`）在终端执行；安装后它的开关与配置由插件
  自己在插件配置/设置里提供，与索引无关。
