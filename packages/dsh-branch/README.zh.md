# dsh-branch — 轨迹回滚/恢复（master/main 树）

[English](README.md) | 中文

可热插拔的 DeepSeek Harness (DSH) Web GUI 插件：为官方「轨迹」标签页增加 git 式回滚/恢复，**不改动官方 UI**——通过 DOM 级注入器在官方台账每行附加操作列（虚拟滚动下自愈）与悬浮的 master/main 树切换器。回滚到某节点会创建编号的 master 树（master1、master2、……）保存该节点的文件状态；恢复则把工作区带回 main 树（轨迹最新状态）。

## 功能

- 官方轨迹 UI 原样保留：不替换视图、不改样式，只增加按钮与一个小树切换器。
- 每个官方行（以及行间每个文件状态点）都有回滚/恢复操作；两者都从轨迹的 write/edit 操作精确计算目标位置的文件状态。
- 回滚按 git 分支模型创建 master 树：master1、master2、……（再次回滚到同一状态时复用已有树，不重复创建）。
- 恢复回到 main 树：应用全部轨迹文件操作，即轨迹最新状态。
- 悬浮树切换器：当前树徽标 + 菜单，可随时检出任一 master 树或 main。
- 确认弹窗在触碰磁盘前预览每个文件变更（创建/写入/删除/无变化）；轨迹窗口外的文件状态如实报告为跳过，绝不猜测。
- 行映射只读复刻官方 ui-trajectory 的 cell-index 枚举（core/official-rows.ts），按钮落在正确行上，不改 dsh 源码。
- 树注册表按工作区持久化在浏览器 localStorage（不落盘文件内容——状态由轨迹操作重算）。
- 全部文件访问走仅限 loopback、工作区围栏的 /branch/* 路由；越界路径与未注册工作区一律拒绝。

## 安装

```sh
### 从 npm 安装（发布后）
dsh plugin --profile web add @linxin666/dsh-client-ui-branch

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-branch
```

- 安装后重启 `dsh web`：官方轨迹标签页即出现注入的操作列（仅刷新页面不够）。

## 配置

- 无需配置文件：挂载即生效，卸载即消失（注入的 DOM 一并移除）。
- localStorage 键（按源与工作区）：`dsh-branch.trees.<encoded-cwd>` 保存树注册表。
- 重置某个工作区的分支状态：在浏览器控制台删除对应的 `dsh-branch.trees.*` 键。

## 已知限制

- 回滚/恢复只应用轨迹窗口内可推导的文件状态：基础状态未知的编辑会跳过并提示；结果在窗口外的工具调用不显示状态。
- 树注册表存于浏览器：刷新与 dsh 重启后仍在，但换浏览器或清理站点数据会清空树（只清注册表，不动文件）。
- main 树跟随轨迹最新状态；会话仍在推进时 main 持续前移，master 树则固定在创建时的状态索引。
- 行注入跟随官方台账的虚拟滚动：按钮随行进入视口而出现（自愈观察器）。
- 文件操作真实落盘：应用前请确认弹窗——除再建 master 树并恢复回 main 外没有撤销。
