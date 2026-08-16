# AGENTS.md — dsh-skill-manager

dsh Web GUI 的技能管理器：设置页一级分区「技能」，查看 / 启停 / 安装 / 卸载 skill。

## 本包要点

- 双半区：host 半区（src/index.ts + src/routes.ts）提供 loopback 专用
  /api/dsh-skill-manager/*（list / toggle / install / uninstall）；browser 半区
  （src/client/）注册 `settings.section`（id `skills`，order 30）完整管理界面。
- 启停走 DSH 原生机制：改写 SKILL.md frontmatter 的 `disable-model-invocation` /
  `user-invocable`（yaml ^2.4.2，parseDocument 保留注释与其余格式），watcher 让目录
  在下次 agent 步骤自动更新；内置（bundled）与运行时注册技能无文件路径，拒绝启停。
- 安装来源仅「本地目录 / Git 仓库 URL（浅克隆）」；目标仅「当前工作区项目根
  .agents/skills / 用户级 ~/.dsh/skills」；已装清单存 ~/.dsh/skill-manager.json
  （0600 原子写），卸载只允许删账本内路径。
- 纯逻辑在 src/core/（frontmatter / roots / ledger / install / service），禁止在
  routes.ts 内联业务逻辑；测试注入 fake ctx 与临时目录，不碰真实宿主。
- 查看视角 = 会话：cwd 取会话 header，scope 取 live agent（冷会话回退全局层）；
  无 dsh-agent-presets 依赖，web-app 组合中 dsh-skill 注册表在 host 平面，分层合并
  可见 preset 的 filesystem provider。
- 不加 agent 工具、不加系统提示词公告（纯用户侧管理面）。
- 涉及写用户文件的机制改动需同步 README「安全模型」与测试。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-skill-manager typecheck
pnpm --filter @linxin666/dsh-skill-manager test
pnpm --filter @linxin666/dsh-skill-manager build
```
