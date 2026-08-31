# Agent Note: 仓库根可整体作为一个插件安装（npm 聚合包上的别名 bundle）

Status: implemented

## Problem

外部 hub 与 `dsh plugin add` 都按仓库根 `package.json` 分类一个 Git 仓库。dsh-web 的 monorepo 根此前没有声明 `dsh.bundle`，把 hub 或安装器指向 `github:zhu1090093659/dsh-web` 只会得到「不是可安装的插件包」的判定——尽管这个仓库就是 Web GUI 插件全家桶。当时仅有的安装路径是 npm 聚合包（`@linxin666/dsh-web-all`，npm 渠道滞后于仓库）和克隆-构建-链接的开发者流程。

## Decision

仓库根现在是已发布聚合包之上的薄别名 bundle：

- 根 `package.json` 声明 `"dsh": { "bundle": { "patch": "./packages/dsh-web-all/cordis.patch.yml" } }`、`dependencies: { "@linxin666/dsh-web-all": "^0.3.6" }`，并用两项 `files` 白名单保证打包式 git 安装只携带清单；
- checkout 的 `pnpm-workspace.yaml` 设 `linkWorkspacePackages: true`：仓库内部该依赖链接 workspace 工程（同源源码，不拉 npm 副本），profile 安装时则从 npm registry 解析。

`dsh plugin --profile web add github:zhu1090093659/dsh-web` 由此挂载全家桶：根包进入 `dsh.profile.bundles` 层栈，它的 patch 就是聚合包自己生成的 `web-ui-*` 装配清单，npm 聚合包依赖（安装时解析）提供各行引用的全部模块。

## Alternatives considered

- **安装时现场构建成员包（根包做真正的源码 bundle）。** 否决：git 安装将不得不在用户机器上跑 monorepo 构建（prepare 递归、tsdown devDependencies、平台相关构建脚本）——脆弱、缓慢、跨平台不友好；聚合包的 npm tarball 正是为这件事而存在。
- **根包 patch 复制聚合包的行。** 否决：手抄的 patch 会与生成产物漂移（`scripts/aggregate.mjs`）；直接指向生成文件保持单一事实源。
- **只改文档（hub 的判定本身没错）。** 否决：诉求是让仓库可安装，而不是再解释一遍为什么不可安装；hub 卡片本来就会引导读者去看 README。

## Consequences

- npm 渠道的滞后限制 git 安装拿到的东西：patch 来自仓库 commit，成员代码来自最新已发布的聚合包，所以源码 patch 新引用了未发布成员时，要等那一版发布后该行才能解析。发布流程不需要改动，但 patch 增加成员行后应及时发布。
- 别名与 npm 聚合包在同一 profile 中互斥：两者产出完全相同的 `web-ui-*` 行，同时安装会因重复 id 冲突（根 README 已写明）。
- 家族跨过 0.3 大版本时需要上调根依赖范围 `^0.3.6`。
- `linkWorkspacePackages: true` 对整个 checkout 生效；没有其他 workspace 包以 range 规格声明与 workspace 工程同名的依赖，所以只有根依赖受影响。

## Testing

- 用官方命令在一次性 profile 验证：`dsh plugin --profile zprobe-alias add --ignore-scripts git+file://<探针克隆>` 安装根包与 224 个包（聚合包来自 npm），reconcile 把 `dsh-web` 追加进 bundle 列表，`dsh --profile zprobe-alias --dump-config` 组合出全部 23 条 `web-ui-*` 条目；事后删除了一次性 profile 与探针克隆，共享的 `profiles/node_modules` 无变化。
- checkout 内 `pnpm install` 将根依赖解析为 `0.3.8 <- packages/dsh-web-all`（workspace 链接；lockfile +4 行）。
