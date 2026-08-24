# PR_TRIAGE — PR 分类与审批路由

本文件定义 dsh-web 仓库 PR 的自动分类与分派路由机制：PR 打开后由
`.github/workflows/auto-assign-pr-reviewers.yml` 按 PR 描述勾选的类别（`PR 类别（PR Category）`）、
变更文件与标题匹配分类，自动把对应协作者设为负责人（assignee）并请求其审查，
与 [ISSUE_TRIAGE.md](ISSUE_TRIAGE.md) 中 Issue 的自动分派对应。

## 路由配置

分类与审批者的映射在 `.github/pr-review-routes.json`：

| 字段 | 说明 |
| --- | --- |
| `routes[].name` | 分类唯一名，出现在路由日志与评论中 |
| `routes[].label` | 分类的中文展示名 |
| `routes[].types` | PR 描述「PR 类别（PR Category）」中勾选项的标签列表，勾中任一项即匹配 |
| `routes[].authors` | PR 作者登录名列表，作者是其中任一用户即匹配（可选维度，用于需要按作者转交的场景） |
| `routes[].paths` | 变更文件 glob 列表（`*` 不跨目录，`**` 跨目录），命中任一文件即匹配 |
| `routes[].title` | 标题正则（大小写不敏感），可选 |
| `routes[].reviewers` | GitHub 用户名列表，命中后请求这些用户审查 |
| `routes[].assignees` | GitHub 用户名列表，命中后把这些用户设为 PR 负责人（可选） |

匹配规则：`authors`、`types`、`paths` 与 `title` 任一命中即匹配；多个分类可同时命中，
负责人与审查者各取并集；PR 作者本人会被过滤（避免自审，作者本人命中的路由贡献
空集，由其他命中的路由接管），draft PR 不触发。工作流从 base 分支读取配置
（PR 自身无法修改自己的路由），读取失败时跳过并记录警告。

## 当前路由

| name | 分类 | 类别勾选 | 负责人 / 审批者 |
| --- | --- | --- | --- |
| `renderer` | 渲染器 / Wallpaper Engine / WebGL（`packages/skins/skin-center` 的 we-*、pkg-extract、wallpaper、backdrop-scene、WallpaperPanel 等） | 壁纸 / 渲染器 | Aa728848 |


新增分类：在 `routes` 追加条目并同步本表格；纯按标题路由可只写 `title`，
例如 `{"name": "community", "title": "^社区", "reviewers": ["zhu1090093659"]}`；
按类别路由可只写 `types`，值为 PR 描述「PR 类别」勾选项的完整标签（须与模板一致），例如
`{"name": "skin-content", "types": ["皮肤 / 皮肤中心（新皮肤收录、皮肤样式）"], "assignees": ["Aa728848"], "reviewers": ["Aa728848"]}`；
按作者转交可只写 `authors`：`{"name": "maintainer", "authors": ["Aa728848"], "reviewers": ["zhu1090093659"]}`（当前未启用）。

## 自动化行为

- 触发：`pull_request_target` 的 `opened` / `reopened` / `synchronize` /
  `ready_for_review`；
- 命中后调用 `pulls.requestReviewers` 请求审查，并调用
  `issues.addAssignees` 把 `assignees` 中的用户设为 PR 负责人；
- `opened` 时另发布一条分类路由说明评论（负责人与审查者）；
- 无命中时不设置负责人、不请求审查者，只记录日志。

## 合并门禁

`dev` 与 `main` 分支保护：必需状态检查为 `CI checks` / `plugin-mount` /
`Validate PR contribution evidence`（GitHub Actions，strict 关闭）；
**必需人工审批为 0** —— 检查全绿后，具有 write 权限的协作者（如 Aa728848）
即可自行合并 PR（含自己提交的 PR），无需等待维护者审批；维护者仍可随时
追加审查。

## 维护者速查

```sh
# 手动请求审查
gh pr edit <n> -R zhu1090093659/dsh-web --add-reviewer Aa728848

# 查看某 PR 的变更文件
gh api repos/zhu1090093659/dsh-web/pulls/<n>/files --jq '.[].filename'
```
