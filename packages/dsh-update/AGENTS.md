# AGENTS.md — dsh-update

DSH web GUI 插件 dsh-update（家族自更新）。包级规则：只写本包特有约定，不重复根
AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

- 本包是**独立行**（row id `update`，全家桶不挂载该行、只保留 tombstone 子路径，
  按需单独安装）：自更新能力自 dsh-remote-web-ui 拆出，关闭/禁用远程访问插件不影响
  更新入口。不要把更新入口重新挂回远程访问插件，或让它依赖该插件运行。
- 宿主半区只挂两条 loopback 精确路由 `/api/update/status` 与 `/api/update/run`，
  一律经 `isLoopbackRequest` 门禁：run 会在用户 profile 目录里真实执行 pnpm
  install，任何非本机来源都必须 403。
- 更新目标由宿主进程自身的模块图锚定（先 `@linxin666/dsh-web-all`，缺失时回退本包
  `@linxin666/dsh-update`）；改锚点或回退包名时同步 README 的 `## 安全模型`。
- 安全语义（真实安装执行、本地 link 模式拒绝、版本核对）修改时必须同步更新
  README 双语与本包测试。
- 浏览器半区只有一个入口：官方 `sidebar.footer.action` 列表槽的 entry id
  `update`（`[data-dsh-plugin="update"]`），设置卡与配对面板都不在本包。
- **桌面外壳不挂该席位**：应用交付的页面（`dsh-app://`，判定见
  `src/client/page-target.ts` 的 `shouldMountUpdateSeat`）不注册入口——桌面应用
  自带更新器，该页面的席位只留给手机远程触发器。网页方案清单与
  `dsh-remote-web-ui/src/remote-channel-rules.ts` 的 `WEB_PAGE_PROTOCOLS` 描述同一
  事实，改一处必须同步另一处。
