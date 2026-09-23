# Agent Note: 挂载冒烟改用本检出现场打包的家族 tarball

Status: implemented

## 问题

0.1.7-alpha.2 宿主升级把 CI 的 `plugin-mount` 车道打红了，但原因与被测分支无关；同一轮修复还暴露出另外三处测试基建故障：

1. 挂载冒烟的 auto 模式从 npm registry 解析已发布的家族 tarball。那些 tarball（家族 0.3.24）是按更旧的 cohort 构建的——skin-center 的客户端还在等 alpha.2 宿主已不再提供的 `settingsScope` 服务——于是 scratch profile 启动时报 `1 entry did not activate ... waiting for service: settingsScope`，冒烟超时。仓库源码早就修好了；该车道测的是过期的已发布产物，不是检出本身。
2. `scripts/e2e-mount.sh` 不加保护地展开 `"${TAR_LOCAL[@]}"`，数组为空时在 macOS bash 3.2 的 `set -u` 下直接中止。
3. dsh-liangshen 的 live-run benchmark 有两处宿主耦合故障：`officialMinimalPresetPatch()` 对 `dsh` shim 路径直接 `createRequire`，它不解符号链接，在 homebrew 安装下会走错目录树；两个依赖真实宿主的用例无条件运行，在没装 dsh 的 CI Tests job 上失败（`no dsh command on PATH`）。
4. dsh-web-all 隔离壳的对照测试钉的是 alpha.2 之前的启动契约（直挂插件失败时 boot reject）；alpha.2（cordis 4.0.4）原生隔离了插件故障——boot 正常 resolve，坏条目停在 FAILED 状态，健康服务保持可达——旧断言测的是上游有意改掉的契约。

## 决策

CI 的 `plugin-mount` job 在 Build 之后新增「Pack family tarballs from this checkout」步骤：把每个 `packages/dsh-*` 与 `packages/skins/skin-center` 逐个 `pnpm pack` 到 `$RUNNER_TEMP/family-tgzs`，冒烟步骤以 `FAMILY_TGZS_DIR` 指向该目录运行，让车道用真实 alpha.2 宿主检验的正是本分支要发布的产物。`release.yml` 不动——发布验证刻意保留 registry 语义，因为发布必须证明已发布的 tarball 能挂载。e2e-mount 的数组展开改用 bash 3.2 安全的 `${TAR_LOCAL[@]+"${TAR_LOCAL[@]}"}` 写法。

benchmark 里 `officialMinimalPresetPatch()` 在 `createRequire` 之前先经 `realpathSync` 解出 shim 真实路径；新增 `harnessInstallAvailable()` 导出（`dshCommands()` 非空即为真），用 `it.runIf(...)` 门控两个真实宿主用例。隔离壳对照测试改写为钉新语义：`boot()` 正常 resolve，直挂失败条目报 FAILED 状态，健康的兄弟服务保持可达——文件头注释记录故障隔离已是宿主原生能力，不再是壳的特性。

## 已考虑的替代方案

- 把冒烟的 auto 模式钉到已知能在 alpha.2 上挂载的旧版已发布家族 tarball：否决——该车道将永远验证别人的产物，对本分支实际发布的内容视而不见。
- 给 boot 包一层以维持旧的失败即 reject 契约断言：否决——那是在上游已拥有的能力上重新实现隔离，违反原生优先原则；正确的做法是钉住原生语义。
- 跳过真实 sshd 的 sftp 测试失败：原样接受——它只在这台 macOS 主机的 sshd 配置下失败（`All configured authentication methods failed`），CI ubuntu 上通过，且没有任何 alpha.2 提交碰过 dsh-ssh 或 ssh2；不需要改代码。

## 后果

plugin-mount 车道不再依赖家族的发布状态——弄坏挂载的分支在发布之前就会红，而不是之后。`scripts/e2e-mount.sh` 在 macOS 自带 bash 上恢复可本地运行。benchmark 套件在没有装 dsh 的机器上也能通过（本地 328/328，CI Tests job 只跳过两个真正依赖宿主的用例）。隔离壳规格现在记录并强制「alpha.2 原生隔离插件故障」这一事实；若上游哪天退回快速失败启动，这个测试会第一个红。

## 测试

`FAMILY_TGZS_DIR=/tmp/family-tgzs bash scripts/e2e-mount.sh` 本地通过：19 个包打包，真实 0.1.7-alpha.2 宿主启动，`[data-dsh-frame]` 挂载，被排除的插件确认缺席。`pnpm -C packages/dsh-liangshen test` 328/328 通过。`pnpm -C packages/dsh-web-all test` 47/47 通过，含改写后的隔离套件。同一提交上工作区完整门禁序列通过；唯一的红是上述环境性的 dsh-ssh sftp 用例。
