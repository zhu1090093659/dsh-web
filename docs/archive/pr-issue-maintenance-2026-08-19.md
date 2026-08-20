# PR / Issue 维护摘要（2026-08-19）

一次 pr-issue-maintenance 工作流的收尾记录。目标仓库：zhu1090093659/dsh-web-ui。

## 合并进 main（19 个 PR）

- 社区修复/登记 14 个：#607 #608 #590 #595 #667 #673 #680 #624 #634 #616 #639 #672 #609 #690
  - #595 与 #590 在 community.json 相邻条目冲突：手工合并保留双方条目（logicprobe + session-delete），重生成 generated/community.ts，community:check 35 条通过后推 main
- 维护者修复 5 个：#694（active-state 原子写，#678）、#695（whale-mom bg-base 滑杆全权，#635）、#696（gateway npx 布局，#683）、#697（legacy bridge 双段/空 insert，#676）、#698（技能中心弹窗 bg-overlay，#659）
- #670（dsh-skins legacy junction 叶包，#605）：合并前完成真实升级路径 A/B 验证——0.2.3 载体复现 MODULE_NOT_FOUND、修复载体 11/11 叶包可解析

## 分类关闭（4 个新功能 PR，附分类说明，not planned）

#688（page-annotate + dsh-codex-board 双新包）、#603（啵啵宠物）、#627（SSH 权限模式）、#692（desktop-launcher）

## 关闭 Issue（14 个）

#677（M4 收口）、#594、#606、#633、#614、#605（后两个随 PR 自动关，已补证据评论）、#626（0.2.2 复验）、#678、#635、#683、#676、#659（另有 #637/#646 由 QIU0826 认领、#658 等 #668）

## 等待作者的 PR（已留具体阻断项）

- CHANGES_REQUESTED：#586（/api/pair 围栏绕过 + 4 处冲突）、#654（ctx.agents.get 注册时序竞态）、#665（CI 红 + 4 项）、#628（README/LICENSE 缺失）、#642（LICENSE）、#671（模板节 + 证据）
- 评论待修：#640（缺 generated 提交 + 模板）、#668（英文标题模板不匹配）、#686（draft 转 ready 即合）
- 催办：#572、#392（7 天窗口）
- 挂起：#463（#623 M5 装饰槽协议首参考实现，与 pet-center 会话协调）

## 环境备注（与仓库无关）

- 本机 pnpm 11.9 共享 store 复用导致部分 worktree 安装缺 tsc bin；CI 全新 store 不受影响（当日多次 CI typecheck 全绿佐证）
- pr/* 引用不在默认 fetch refspec 内，fetch --prune 会误删，需显式 fetch 恢复
