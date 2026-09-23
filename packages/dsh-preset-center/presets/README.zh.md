# 社区预设目录

[English](README.md) | 中文

经创意工坊分发的社区 agent 预设的发布源。`scripts/market-build` 读取本目录并产出
`market/dist/manifest/presets.json` 与 `market/dist/assets/presets/<id>/`。

## 新增预设

1. 复制 `_template/` 为 `<id>/`。目录名就是预设 id，必须匹配
   `^[a-z0-9][a-z0-9-]*$`；harness 内置 id（`minimal`、`ptc`、`standard`、
   `cordis`）会被拒绝。
2. 编辑 `preset.yml`（DSH roster 显示的文案：`name`、`description`、可选
   `order`，每项保持单行）与 `agent.cordis.yml`（组合内容）。
3. 在 `catalog.json` 增加条目：

   ```json
   {
     "id": "<id>",
     "nameEn": "English name",
     "descriptionEn": "One sentence in English.",
     "author": "github-handle",
     "version": "1.0.0",
     "category": "roleplay",
     "tags": ["review"],
     "rank": 10,
     "repo": "https://github.com/<owner>/<repo>"
   }
   ```

   `id`、`author`、`version` 必填；`version` 驱动创意工坊的更新提示。
   `category` 可选，取值必须来自 `scripts/market-build` 的预设分类词表（目前为
   `roleplay`）；它成为创意工坊卡片与市场站上的分类筛选胶囊，不填的条目落入
   「其他」桶。中文
   `name`/`description` 来自 `preset.yml`，因此 DSH roster 与商店不会互相矛盾。
4. 运行 `node scripts/market-build` 并提交重新生成的 `market/dist`。

## 审查关注点

内容要求：发布的预设必须是全年龄向。拒绝露骨性内容，也拒绝任何未满 18 岁的角色，
以及在原著中就是儿童的角色；第三方素材需要具备再分发权利并署名来源。首批发布
批次的口径与理由记录在
[角色扮演预设目录及其内容边界](../../../.agents/notes/implemented/feature/2026-09-10-roleplay-preset-catalog.zh.md)。

预设就是代码：组合可以引用 npm 插件、加载随预设目录分发的文件，并在 DSH 主进程
内求值 `!!js` 表达式。因此创意工坊先把预设装进惰性库，只有在用户看到组合画像并
主动启用后，才把它声明进 agent-preset 注册表。审查关注的是组合实际加载了什么、
为什么，而不只是它自称做了什么。
