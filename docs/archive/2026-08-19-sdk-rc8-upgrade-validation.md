# SDK 0.1.0-rc.7 -> 0.1.0-rc.8 升级验证快照（2026-08-19/20）

冻结记录 dsh-web-ui 官方 SDK cohort 升级与新特性适配的验收证据。历史快照，不修改长期文档。

## Cohort 矩阵

| 项 | 基线 | 目标 |
| --- | --- | --- |
| 官方 channel | npm latest（rc.7） | npm next（0.1.0-rc.8，2026-08-19T15:41Z 发布） |
| @deepseek-ai/dsh-* | ^0.1.0-rc.7（26 个 devDeps） | ^0.1.0-rc.8 |
| cordis / cordis-plugin-* | ^4.0.1 / ^1.0.6 / ^1.0.2 | 不变 |
| schemastery | ^3.18.0 | 不变 |
| 宿主 dsh CLI | 0.1.0-rc.7 | 0.1.0-rc.8（npm 全局安装 + profile web 3 个 SDK 依赖同升） |
| dsh-better-sidebar | 0.13.0（peers rc.6） | 0.14.0（peers rc.8，发布适配 rc.8） |

## 变更文件（main 上的 10 个提交，6512a824d..9b9649a82）

- chore(sdk)：15 包 + shared + 模板 devDeps rc.7 -> rc.8；45 条
  minimumReleaseAgeExclude 同步；锁文件 rc.7 残留 0。
- fix(shared)：平台种子表对齐 rc.8 shell 冻结模块表（移除
  dsh-client-web-react / dsh-client-schema-form；rc.8 表恰为 react、
  react/jsx-runtime、react-dom、react-dom/client、cordis、ui-slots、
  ui-primitives，证据：dsh-web-frontend@rc.8 dist staticModules）。
- test(sdk)：持久契约 shared/tests/web-platform.test.ts（种子表 = rc.8
  shell 表）与 scripts/inject-contract.test.mjs（全仓 inject 集合 = 8 个
  rc.8 模块）。
- test(describe-image)：rc.8 新增必填 maxImageDimension（宿主默认 2000，
  证据：dsh-attachment-local@rc.8）。
- fix(chat-recovery,skin-center)：uSES 访问器绑定修复——React 以裸函数调用
  getSnapshot/subscribe，原型方法 this 为 undefined；chat-recovery
  RetrySupervisor.getSnapshot、skin-center background/wallpaper 控制器
  getter+subscribe 改箭头属性，SkinCenter 对 SDK theme 用箭头包一层。
  rc.8 slot 宿主会把这类崩溃打到 console（rc.7 时被边界静默吞掉）。
- feat(describe-image)：rc.8 原生图片请求适配——设置卡新增「原生图片请求」
  区（GET/POST /describe-image/native-images，回环围栏），经官方设置服务
  写 llm-deepseek 模型目录的 inputModalities；send-hook 透传 rc.8 新增的
  AbortSignal 与 SubmitOutcome；切换后失效路由 verdict 缓存。
- fix(describe-image)：切换后使 resolver 缓存失效（否则 UI 与 send hook
  最多沿用旧判定 10 分钟）。
- chore(web-ui-all)：better-sidebar 0.13.0 -> 0.14.0 + docs/publish-prep.md。
- docs(archive)：本快照。

## 验证账本

全量门禁 10/10 通过（typecheck / test / test:scripts / build /
runtime-deps:check / gallery:check / skin-center:check / community:check /
aggregate:check / docs:check；最终状态跑于 gates8 与多次重跑）；git diff
--check 干净；diff 内无源码 checkout 路径、无外部本地链接、无 token。

## 关键 delta 分类（官方 tarball 对照，6 组审计）

- packaging-only：dsh-settings / dsh-host-webserver / dsh-system-prompt /
  dsh-client-ui-slots / dsh-tools / dsh-scope / dsh-timeout（d.ts 逐字节相同）。
- 上游破坏但本仓不消费：dsh-client-ui-settings 值导出移除、构造器签名变更、
  load() 移除；dsh-client-ui-conversation loadImage 移除 / sendSession 返回
  SubmitOutcome；dsh-host-apiproxy host.describe 增必填 home。
- 消费面行为变化：dsh-client-locale 回退链 zh -> en（实测 zh 浏览器仍显示
  中文界面）；dsh-client-ui-settings settingsScope 内部镜像重构（bind 不变）。
- 上游打包缺陷：rc.8 发布 sourceMappingURL 注释但不发布 .map（测试/开发
  工具噪音；shared/vitest.config.ts 已 sourcemapIgnoreList）。
- 既有 flake（非 rc.8 回归）：dsh-ssh panel-hosts 测试 teardown 后未处理
  setError 拒绝，复跑 3/3 通过，记录在案。

## rc.8 GUI 验收证据（宿主 rc.8，profile web）

- 模块表 60 条目（基线 56）：dsh-client-ui-renderer 在位、web-react /
  schema-form 消失、8 个 inject 模块与 16 个 @linxin666 束全部在位。
- 浏览器验收：启动 0 console 错误、0 失败请求；任务看板/SSH/git-graph/pet
  插件根挂载；皮肤 whale-song 生效、语言 zh-CN；桌面与 390px 窄屏截图。
- 交互：设置面板全部分区就位；皮肤中心 13 款皮肤目录渲染、Blue Fantasy
  试穿端到端生效（data-dsh-skin 切换）且零错误。
- 原生图片请求：设置卡「原生图片请求」区渲染 -> 点击启用 -> settings.yaml
  llm-deepseek.models 写入 inputModalities [text,image] -> 路由 verdict
  acceptsImages=true（缓存失效修复后）-> 卡片显示「已启用」；deepseek-v4-pro
  保持启用状态。
- better-sidebar 0.14.0 加载（boot 条目注入链含 dsh-client-modules），右侧
  面板正常。

## 宿主与 profile（执行记录）

- 宿主：npm install -g @deepseek-ai/dsh@0.1.0-rc.8；回滚
  npm install -g @deepseek-ai/dsh@0.1.0-rc.7。
- profile web：dsh-client-ui-subagent / dsh-mcp-client /
  dsh-web-search-exa rc.7 -> rc.8；dsh-better-sidebar 0.13.0 -> 0.14.0；
  minimumReleaseAgeExclude 同步；锁文件 rc.7 残留 0。
- 重启 4 次（升级、host 侧路由、失效修复、sidebar 升级），每次
  /tmp/dsh-rc8-*.log 留痕。

## 回滚

仓库：git revert（10 个提交或整体 revert）；宿主：npm -g 回 rc.7 并恢复
profile 依赖；原生图片开关在设置卡一键停用（写回 inputModalities [text]）。
