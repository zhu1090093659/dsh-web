## 摘要（Summary）

为右侧预览面板（`packages/dsh-aionui-panel`）的「代码」标签页加入 VS Code 级 Python 代码阅读体验：以 CodeMirror 6 替换原纯文本 `<pre>`，新增 ruff 实时代码检查波浪线、AST 大纲与引用标注（悬停 docstring、Ctrl/Command+点击跳定义、引用计数）、按行缩进参考线、彩虹括号、ruff 格式化（差异预览 + 确认应用）、轻量 PDF 阅读器，并统一编辑器字体与深色主题配色（对齐 VS Code Dark+）。整体为静态只读分析，不执行用户代码。

## 涉及包（Affected Packages）

- [ ] 任务看板 `packages/dsh-task-board`
- [ ] Git 图谱 `packages/dsh-git-graph`
- [x] 右侧面板 `packages/dsh-aionui-panel`
- [ ] 远程 Web UI `packages/dsh-remote-web-ui`
- [ ] SSH 远程运维 `packages/dsh-ssh`
- [ ] 实时令牌统计 `packages/dsh-live-stats`
- [ ] 宠物 `packages/dsh-pet`
- [ ] 皮肤 / 皮肤中心 `packages/dsh-skins` / `packages/skins`
- [ ] 聚合包 / 设置 `packages/dsh-web-ui-all` / `packages/dsh-web-ui-settings`
- [ ] 其他（请说明）：

## PR 类型（PR Type）

- [x] 面向用户的功能或行为变更
- [ ] Bug 修复
- [ ] 仅文档
- [ ] 维护 / 重构

## 最新代码确认（Latest Codebase Confirmation）

- [x] 我已基于最新 `main` 分支开发，或在提交前已 rebase / 合并最新 `main`。

同步命令：

```bash
git fetch origin && git rebase origin/main
```

（本分支自 `main` 的 zip 快照提取开发；提交前请先 rebase 最新 main。）

## AI 编码披露（AI Coding Disclosure）

- [x] 完全 AI 编码：全部编程改动由 AI 产出，并由贡献者接受 / 审查。
- [ ] 部分 AI 辅助：AI 帮助编写或修改了部分编程改动。
- [ ] 未使用 AI 编码辅助。

使用的 AI 模型：

DeepSeek（deepseek-v4-pro）

使用的编码 Agent 工具：

DeepSeek Harness

## 仓库规范检查（Repo Rules）

- [x] 未修改 DSH 官方源码，仅基于官方 NPM SDK（`@deepseek-ai/*`）开发。
- [x] 未新增指向 DSH 源码 checkout 的 tsconfig `extends` / `paths` / `references`。
- [x] 新增包目录以 `dsh-` 前缀命名（本次未新增包，仅修改既有 `dsh-aionui-panel`）。
- [x] 所有新增 / 修改文件不含任何 emoji 字符（已按 Unicode Emoji 范围扫描确认）。

## 本地验证（Local Validation）

执行的命令：

```bash
pnpm --filter @linxin666/dsh-client-ui-aionui-panel build   # tsc -b 类型检查 + tsdown 打包
```

结果摘要：通过。`tsc -b` 类型检查通过；`tsdown` 产出 `lib/index.js`（宿主）与 `lib/client.js`（客户端，约 1.4 MB，内联 CodeMirror 与各语言语法）。`vitest` 因开发机受限 shell 的 spawn EPERM 未能运行；新增 `tests/py-service.spec.ts`，其纯函数（ruff 诊断映射、符号归一化）已在真实样例文件上手工验证。

## 用户可见变更证据（Local Feature Evidence）

证据（基于真实工作区文件 `3_5_plot_ssp585_sst_with_isotherms.py`）：

- ruff：`ruff check` 检出 6 条 E402；AST：解析出 `read_csv` / `draw_panel` / `plot` 及引用关系；格式化：`ruff format` 使文件 336 → 235 行（仅排版，逻辑不变）。
- 构建产物已部署至本地 web profile；宿主模块可正常加载（导出 `apply` / `inject`），客户端 bundle 已含新代码与样式。
- 界面最终视觉确认依赖 `dsh web` 重启（宿主新路由 `py-lint` / `py-symbols` / `py-format` 需进程重载）与页面强刷；纯客户端视觉（高亮 / 缩进参考线 / 彩虹括号 / 字体 / 配色 / PDF 翻页）刷新即可见。
