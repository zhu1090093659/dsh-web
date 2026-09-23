# Agent Note: 脚本无法删除环境里的 DSH home

Status: implemented

## Problem

2026-09-23 当天用户的 `~/.dsh` 被清空两次，随后的排查发现了三条能触达真实 home 的仓库路径，其中一条只要打错一个参数：

1. `packages/dsh-task-board/tests/host-apply.spec.ts` 把环境里的 `DSH_HOME` 还原进 `process.env`，随后删除该变量所指向的路径。在任何导出了 `DSH_HOME` 的 shell 里（宿主派生的 shell 就是这种状态）跑测试会递归删掉整个 home，而测试全绿。该修复已随 `7c513ad5` 发布。
2. `scripts/dsh-skin uninstall <id>` 把 argv 原样拼在 `$DSH_HOME/skins` 之下并对结果递归删除，完全没有 id 校验。`uninstall ..` 解析到 `$DSH_HOME` 本身，连带删掉整个 home（sessions、storages、profiles、凭据、日志）；`uninstall ../..` 解析到操作系统用户目录。
3. `scripts/e2e-mount.sh` 把 `DSH_HOME_BASE` 原样当作 scratch 根，退出时执行 `rm -rf "$SCRATCH"`。`DSH_HOME_BASE=~/.dsh pnpm test:mount` 会删掉 home。

## Decision

`scripts/dsh-skin uninstall` 按 skin-center 的 id 契约校验 id（`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`，与 `uninstallUserSkin` 同一字符类），并在递归删除前断言解析后的目标仍位于用户皮肤根之下。形如路径的 id 以退出码 1 拒绝，输出 `refusing "<id>" — a skin id is a directory name, not a path`。`scripts/dsh-skin.test.mjs` 钉住该行为：`..`、`.`、`sub/../..` 一律被拒，且 `skins/` 旁边的文件与已安装皮肤在尝试之后都还在。

`scripts/e2e-mount.sh` 拒绝解析为 `/`、`$HOME` 或 `$HOME/.dsh` 的 `DSH_HOME_BASE`，并且绝不再整棵删除调用方给出的根目录：清理只删除本次运行在该根之下创建的 `home/` 与 `workspace/` 两个子目录。脚本自己用 `mktemp -d` 建的根仍照旧删除，因此默认路径与 `KEEP_HOME` 行为不变。

## Audit result

两轮独立排查覆盖本仓库，第三轮覆盖本机启动所用的 harness（`Documents/deepseek-harness`；`AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` 是指向它的符号链接，因此属于同一份代码）：

- **测试。** 「还原 `DSH_HOME` 再删除」这一形状只出现过一次，即已修复的 host-apply teardown。其余 teardown 删除的都是各自套件用 `mkdtemp` 建的目录。
- **插件 host 半区与桌面端。** 每一处递归删除都被限制在经校验的 `$DSH_HOME/<子目录>` 内：market、preset-center、session-archive、skin-center 都做 id 校验并再次断言包含关系；task-board、usage、pet、ssh、remote-web-ui、doctor、plugin-manager 只动自己的文件；桌面端 reseed 只删 profile 下四个固定条目且保留 `cordis.patch.yml`。
- **harness 运行时。** 不删除也不改名 home。唯一的 home 级删除是 `<profile>/.dsh-module-fallback` 以及指向它的 `node_modules` 链接；`settings.yaml` 是被改名成 `settings.yaml.imported` 而非删除，`cordis.yml` 每次 profile 启动都由常量重写。
- **实测。** 用一个含 16 个标记文件的诱饵 home 作为 `DSH_HOME` 跑完整门禁面（`typecheck`、`test`、`test:scripts`、`test:desktop`、`test:standards`、`docs:check`、`i18n:check`、`emoji:check`、`aggregate:check`、`libs:check`、`sync-shared:check`、`runtime-deps:check`、`community:check`、`skin-center:check`、`market:check`）：诱饵逐字节完好，没有任何文件被增删。

`scripts/pr-review.mjs --cleanup` 仍会无条件删除其 `--workdir` 根目录（默认 `~/remote-e2e`）。它属于同一类问题，但被有意留给单独的改动——它需要针对 worktree 根的护栏设计，而不是一行的拒绝语句。

## Alternatives considered

- **让 CLI 调用 skin-center lib 的 `uninstallUserSkin()`。** 该函数已做正则校验并断言包含关系，且 CLI 头部声明该逻辑归 lib 所有。被否是因为它未从构建产物入口导出（`packages/skins/skin-center/lib/index.js` 将其保留为内部函数，唯一消费者是路由层），CLI 要用它就得附带 skin-center 的导出与重建改动，只为换取几行校验。
- **在 `cmdUninstall` 里只拒绝 `..` 与 `.`。** 被否：两种写法的黑名单会漏掉分隔符与混合形式（`sub/../..`），而仓库对皮肤已有一份 id 契约。照抄它可让所有调用方共用一条规则。
- **`e2e-mount.sh` 里只拒绝两个灾难性取值、保留整棵删除。** 被否，理由是它按拼写而非归属来保护 `~/.dsh`，且其他调用方给出的根仍距删除仅一个手误。只删除本次运行创建的东西，才是对所有取值都成立的性质。
- **在 `dsh-home` 解析器里挡住 `DSH_HOME=~`。** 暂缓而非否决：解析器是散布在十余个包里的生成副本，且「显式环境变量优先」是已文档化的契约。e2e 的护栏覆盖了唯一会删除该取值的位置。

## Consequences

真实皮肤的卸载不受影响——id 契约接受目录能产出的任何名字，拒绝分支只会对根本无法命名皮肤的取值触发。向 e2e harness 传入调用方根目录的脚本，运行后该目录会被留下，其中只有本次运行自己的 `home/` 与 `workspace/`；`KEEP_HOME` 依旧完全跳过清理。排查的否定结果正是让其余隐患可枚举的原因：某个插件写到自身子目录之外、或新增脚本删除由参数推导出的路径，如今都属于对既定保证的偏离，而不再是开放问题。

## Testing

`node --test scripts/dsh-skin.test.mjs`（9 个用例，含拒绝用例）、`bash -n scripts/e2e-mount.sh`、`DSH_HOME_BASE="$HOME/.dsh" bash scripts/e2e-mount.sh`（在任何目录被创建之前即拒绝，退出码 1），以及仓库门禁 `test:scripts`、`test:standards`、`docs:check`、`emoji:check`、`typecheck`、`test`。
