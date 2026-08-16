# dsh-skill-manager Implementation Plan

> **For agentic workers:** 本计划由同一会话内联执行（本机无 bash/pnpm，无法逐任务跑测试提交；
> 步骤中的测试命令由 CI/用户本机执行）。步骤使用 checkbox 语法。

**Goal:** 实现 dsh-skill-manager 插件：设置页一级分区「技能」，支持查看、启停、安装、卸载 skill。

**Architecture:** 双半区 cordis bundle（host 路由 + client 设置分区）。host 用
`ctx.skills`（官方注册表）+ 会话 header cwd + live agent scope 解析目录；启停 = 改写
SKILL.md frontmatter（yaml）；安装 = 拷贝/浅克隆到 skill 根；账本存 ~/.dsh/skill-manager.json。

**Tech Stack:** TypeScript strict、cordis 4、@deepseek-ai/dsh-skill / dsh-session / dsh-agent /
dsh-host-webserver / dsh-client-runtime / dsh-client-connection / dsh-client-ui-slots、
react 18、yaml ^2.4.2、vitest + jsdom、tsdown（shared/tsdown.client.ts）。

**Spec:** docs/archive/spec-skill-manager-2026-08-17/README.md

## Global Constraints

- 禁止修改 DSH 源码；类型只来自 @deepseek-ai/* npm SDK（node_modules 解析）。
- 新包 @linxin666/dsh-skill-manager；目录 packages/dsh-skill-manager；cordis 行 id skill-manager。
- 禁 emoji（代码/注释/文档/UI 文案）；文件以单个尾换行结束；ESM；strict:true。
- host/client 半区分层：新增源码必须落 src/（host）、src/client/、src/core/ 之一。
- 浏览器半区：@deepseek-ai/* 仅 type-only 导入；值导入仅平台种子表成员。
- 设置分区注册 `settings.section`（id skills, order 30, label 函数, locale skill-manager）。
- 路由仅 loopback（remoteAddress 127.0.0.1/::1 + Host localhost/127.0.0.1 + same-origin 标记）。
- 启停语义：停用 = frontmatter 写 `disable-model-invocation: true` + `user-invocable: false`；
  启用 = 删除两键。
- 卸载仅限账本记录路径；账本 ~/.dsh/skill-manager.json（0600，原子写）。
- README 三件套（中英 + i18n.yaml）；包级 AGENTS.md；根 AGENTS.md 与 docs/publish-prep.md 同步更新。
- aggregate.yml（patchFrom + deps）与 dsh-web-ui-all 生成产物（cordis.patch.yml + package.json）同步手改。

## File Map

- Create `packages/dsh-skill-manager/package.json`、cordis.patch.yml、tsconfig.json、tsconfig.build.json、
  tsconfig.vitest.json、tsdown.config.ts、vitest.config.ts、vitest.setup.ts、.gitignore、LICENSE、AGENTS.md
- Create `src/index.ts`、src/invariant.ts、src/protocol.ts
- Create `src/core/frontmatter.ts`、roots.ts、ledger.ts、install.ts、service.ts
- Create `src/client/index.ts`、api.ts、controller.ts、SkillManagerSection.tsx、skill-manager.module.css、locales.ts、css-modules.d.ts
- Create `tests/frontmatter.spec.ts`、roots.spec.ts、ledger.spec.ts、install.spec.ts、service.spec.ts、routes.spec.ts、controller.spec.ts、section.client.spec.tsx
- Create `README.md`、README.zh.md、README.i18n.yaml
- Modify `packages/dsh-web-ui-all/aggregate.yml`、cordis.patch.yml、package.json、docs/publish-prep.md、AGENTS.md（根）

## Key Interfaces（跨任务契约）

- `parseSkillText(text): SkillFrontmatter | undefined`（name/description 必填、kebab-case name）
- `setSkillEnabled(text, enabled): string | undefined`
- `resolveDshHome(env, homedir): string`；`findProjectRoot(cwd, exists): Promise<string>`
- `Ledger.load(dir, readFile, writeFile)` / `Ledger.record(entry)` / `Ledger.remove(path)` / `Ledger.has(path)`
- `planInstall(source, targetRoot, fsOps): InstallPlan`（dir bundle / flat md / git → staging）
- `SkillManagerService.list(t)` / `.toggle(t)` / `.install(t)` / `.uninstall(t)`（依赖注入 ctx 接口）
- `registerRoutes(server, service)`；wire：`SkillRow`、`ListRequest`、`ToggleRequest`、`InstallRequest`、`UninstallRequest`（protocol.ts）
- Client：`SkillManagerApi`（fetch）、`SkillManagerController`（状态机 + store）、
  `SkillManagerSection`（PropsRuntime<'settings.section'> & PropsLocale<'skill-manager'> & InjectFace）

## Tasks

### Task 1: 包骨架（配置/构建/文档三件套骨架）
- [ ] 复制 desktop-launcher 模板生成 package.json / tsconfig* / tsdown / vitest / .gitignore / LICENSE；
      name @linxin666/dsh-skill-manager，dsh.client.inject = [runtime, connection, locale, ui-slots]，
      deps: yaml ^2.4.2；devDeps 增加 dsh-skill / dsh-session / dsh-agent / dsh-host-webserver。
- [ ] cordis.patch.yml（id skill-manager）、AGENTS.md。
- [ ] 验证：`pnpm --filter @linxin666/dsh-skill-manager typecheck`（需先 pnpm install）。

### Task 2: core/frontmatter.ts（yaml 启停改写）
- [ ] 测试先行：parse 合法/非法、toggle 写入/删除两键、保留 body 与注释、flow 风格、无 frontmatter。
- [ ] 实现（parseDocument + setIn/deleteIn + toString；DSH 同款校验）。
- [ ] 跑测试。

### Task 3: core/roots.ts + core/ledger.ts
- [ ] 测试先行：DSH_HOME 优先、homedir 回退、git 根向上查找、回退 cwd；账本原子写/损坏回退/去重。
- [ ] 实现。
- [ ] 跑测试。

### Task 4: core/install.ts
- [ ] 测试先行：目录 bundle 拷贝（去 .git）、平铺 .md、单 skill 目录、重名冲突、非法 frontmatter、
      git 来源（注入 runGit）、staging 清理。
- [ ] 实现。
- [ ] 跑测试。

### Task 5: core/service.ts + protocol.ts
- [ ] 测试先行（fake ctx：sessions/agents/skills + 临时目录）：list 视角解析、toggle 权限与写入、
      install 编排、uninstall 账本约束。
- [ ] 实现。
- [ ] 跑测试。

### Task 6: src/routes.ts + src/index.ts + src/invariant.ts
- [ ] 测试先行：loopback 围栏（403）、method 校验、JSON 错误、成功路径。
- [ ] 实现（webServer 可选挂载）。
- [ ] 跑测试。

### Task 7: client（locales/api/controller/Section/index + css）
- [ ] 测试先行：controller 状态机（加载/切换/安装/卸载/错误）、section 冒烟挂载。
- [ ] 实现（settings.section 注册、workspaces 下拉、技能行开关、安装表单、卸载确认）。
- [ ] 跑测试。

### Task 8: 文档与聚合
- [ ] README 三件套（功能/安装/配置/安全模型/已知限制；禁 emoji；i18n.yaml 占位 hash 待重录）。
- [ ] aggregate.yml + dsh-web-ui-all/cordis.patch.yml + package.json 手改一致。
- [ ] 根 AGENTS.md 包清单、docs/publish-prep.md 表。
- [ ] 全仓门禁清单（见 spec 验证约束）交由用户/CI 执行。

## Self-Review 结论

- 覆盖：设计全部决策均有对应任务（开关语义→T2；安装来源→T4；范围与入口→T5/T7；卸载→T4/T5）。
- 无占位符步骤（本计划为同一会话执行者所用，代码随任务产出）。
- 类型一致性：protocol.ts 的 wire 类型在 T5 定义、T6/T7 消费，签名以文件为准。
