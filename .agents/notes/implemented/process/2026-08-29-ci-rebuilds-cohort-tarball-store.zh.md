# Agent Note: CI 重建预览 cohort tarball store

Status: implemented

## Problem

[预览 cohort overrides](2026-08-28-preview-cohort-tarball-overrides.zh.md) 把所有 `@deepseek-ai` 包解析到本机 store `/Users/zcl/.dsh-cohorts/0.1.2-alpha.1/` 下的 file: tarball，而 frozen lockfile 全程记录这些绝对路径。该分支当晚就在违反其自身前提的情况下合入了 dev，导致所有 GitHub runner 在 `pnpm install --frozen-lockfile` 处因 store 缺失而失败——CI、发布管线和 market 部署全部被 alpha.1 状态卡死。同一次推送还暴露了两个较小的冲突：各 workflow 的 `pnpm/action-setup` `version: 11` 输入与新的 `packageManager: pnpm@11.24.0` 固定值形成双重指定错误；setup-node 的包管理器缓存检测要求 pnpm 二进制存在，而 contributors workflow 并不使用 pnpm。

## Decision

`scripts/build-cohort-tarballs.mjs` 在任何机器上物化该 store。它把 overrides 块解析为期望的 tarball 集合（249 个文件名），store 已齐全时立即退出；否则准备一个固定在源码 tag（`dsh-v0.1.2-alpha.1`，commit cd5ef814）上的 harness checkout（可传入已有 checkout，否则浅克隆），以 frozen lockfile 且禁用脚本的方式安装，用 `pnpm run build:official` 构建（release packer 的 build-record 门禁要求 official 产物 profile），用 harness 自带的 `release:pack` 打包发布 family，对 family 排除但 overrides 仍引用的 private experimental 包直接打包，最后把每个打包产物中的清单归一化为 store 的自包含形态：`peerDependencies` 以规范键序并入 `dependencies` 并删除 peer 段，因为消费方 lockfile 在 autoInstallPeers 关闭下安装；`peerDependenciesMeta` 作为惰性文档保留。最后，脚本把 lockfile 中 cohort tarball 的记录 integrity 刷新为实际 store 内容的字节哈希：pnpm 对 file: tarball 也记录 sha512，而重建 store 因 client face 内嵌构建 checkout 的绝对路径永远不可能与原始字节一致，因此每个环境都把 integrity 锚定到自己验证过的 store；该改写只发生在 runner 本地、不进 git。脚本最终校验每个被引用的 tarball 存在且非空。

五个使用 pnpm 的 job（CI checks、plugin-mount、release publish、release smoke、market deploy）按 `dsh-cohorts-<pnpm-workspace.yaml 哈希>` 为键从 actions cache 恢复 store，然后运行脚本：命中缓存即为 no-op，未命中则完整重建。store 的位置是机器无关的相对位置——checkout 上两级，因为 lockfile 记录的 tarball resolution 是 `file:../../.dsh-cohorts/...`：本机上落在用户主目录，runner 上落在 workspace 父目录。各 workflow 移除 `version: 11` 输入，让 `packageManager` 成为唯一的 pnpm 版本来源；contributors workflow 关闭它无法满足的包管理器缓存检测。

## Alternatives considered

- 等 cohort 上 npm 后再让任何东西进 dev：否决；合并已经发生，且 overrides 仍是 cohort 发布当天可整体拆除的 remove-me 开关。
- 把 251 个 tarball 作为 release 资产供 CI 下载：否决；这等于在公开仓库再分发上游构建产物，且每次 cohort bump 都多一步上传。
- 把 tarball 提交进仓库：出于同样的再分发理由外加仓库膨胀，否决。
- 改用相对 file: overrides 让 store 落在 workspace 内：否决；lockfile 全程记录绝对路径，同时改写两者将放弃 frozen install。

## Consequences

每次 cohort 变更后的首个冷 CI 运行要克隆、安装、构建并打包整个 harness，其后的运行由缓存直接命中 no-op；任何 pnpm-workspace.yaml 改动都会更换缓存键。重建的 client face 内嵌构建 checkout 的绝对路径与 CSS-module 哈希，因此重建 store 与本机 store 的字节差异恰好是文档记载的 per-checkout 不确定性——每个 store 自身自洽，CI 门禁加 mount smoke 对 CI 构建的 store 做端到端验证。cohort 上 npm 后，删除 overrides 块即可连带删除 store、本脚本与缓存步骤。

## Testing

在固定 commit 的隔离 harness worktree 上完整走了一遍脚本的安装、official 构建与打包，产出到全新 store：249/249 个被引用的 tarball 全部产出，所有清单与本机 store 语义一致，其余 lib 差异为文档记载的 per-checkout 路径与 CSS 哈希不确定性；快路径对两个 store 均 no-op。packageManager 冲突从 dev 分支的 CI 失败日志复现，并由 workflow 修改解决。dev 分支的一次 CI 运行在全新 runner 上约四分钟完整物化了 store，验证了 runner 侧构建路径；其后的 install 仍然失败，原因是该次把 store 放在了 overrides 的绝对路径位置，而 lockfile 的 resolution 相对 checkout 根解析——上文的 store 位置已改为遵循这一规则。
