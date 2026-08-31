# Agent Note: 批量修复核心缺陷与 Bug（覆盖 #1275, #1272, #1269, #1267, #1265, #1257, #1258）

Status: implemented

## Problem

集中解决了仓库中 7 项核心缺陷与 Bug 类 Issues：
1. **#1275**：scripts/build-cohort-tarballs.mjs 在 Windows 下直接 spawn('pnpm') 报 ENOENT、GNU tar 误判盘符为远程主机、跨盘 enameSync 抛出 EXDEV。
2. **#1272**：cordis.patch.yml 中的 !!js dshHomePath(...) 触发 TAG_RESOLVE_FAILED 告警。
3. **#1269**：dsh-perf 的 content-visibility: auto 裁剪 markdown 宽表格（.md-table-wide）横向溢出内容。
4. **#1267**：@linxin666/dsh-doctor 在 Windows 计划任务直接运行 cmd 导致登录弹出并常驻空白控制台窗口。
5. **#1265**：	rading 皮肤的 fixed 悬浮条留白补偿被 skin-center Viewport lock 的 padding: 0 !important 强制清零。
6. **#1257**：dsh-perf better-session 迁移子进程传递 
ew URL(...).pathname 在 Windows 下被拼成 C:\C:\... 重复盘符。
7. **#1258**：deep-current 皮肤流光动画在 
o-repeat 模式下到达终点突变跳断。

## Decision

1. **Windows 脚本跨平台适配（#1275, #1257）**：
   - 在 uild-cohort-tarballs.mjs 中对 pnpm 增加 Windows .cmd/shell 封装，	ar 优先使用 System32 下的 bsdtar，collectTarballs 在 EXDEV 时自动回退 copyFileSync + mSync；
   - 在 dsh-perf/src/bsm/service.ts 中改用 ileURLToPath(moduleUrl)，彻底杜绝 Windows 重复盘符。
2. **消除 YAML Tag 告警（#1272）**：
   - 移除 dsh-perf/cordis.patch.yml 中冗余的 oot: !!js，在 scripts/aggregate.mjs 中将 !!js dshHomePath(...) 自动转换为规范的相对路径，并重新生成了聚合包 cordis.patch.yml。
3. **保护宽表渲染与联动降载设置（#1269）**：
   - 升级 P0 降载 CSS 规则为 :not(:has(.md-table-wide))，对含宽表的行重置 content-visibility: visible !important; contain: none !important;；
   - 将 P0 降载样式注入真正关联到 enderDegrade 设置开关。
4. **Windows 计划任务后台无窗静默运行（#1267）**：
   - 生成 supervisor.vbs 静默包装脚本，由 wscript.exe 原生无窗拉起 supervisor.cmd，消除登录黑框。
5. **皮肤留白与动画修复（#1265, #1258）**：
   - 将 	rading 皮肤的 66px 顶部 + 30px 底部留白补偿迁移至 [id=root]；
   - 将 deep-current 发光流光关键帧调整为 ease-in-out alternate，实现无缝平滑连贯动画；
   - 运行 
ode scripts/market-build 重新同步了 market/dist 产物。

## Consequences

所有全库单元测试、脚本检查与文档门禁全部通过；Windows 安装构建、后台服务、表格渲染与皮肤体验完全恢复正常。
