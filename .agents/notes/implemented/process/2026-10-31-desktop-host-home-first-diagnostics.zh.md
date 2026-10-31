# Agent Note: 桌面宿主排障从活进程的 DSH_HOME 读起

Status: implemented

## Problem

2026-10-31 一次针对用户 DeepSeek Harness 桌面安装的修复会话，在错误的位置修好了六个症状，之后才发现这些工作根本不可能生效。应用实际读取的是 `DSH_HOME=/Users/zcl/.dsh-trading`、profile 在 `~/.dsh-trading/profiles/desktop`，而每一次编辑——重建的 `settings.yaml`、清理 cookie 后的后续动作、patch 改写、依赖安装——全部落在 `~/.dsh/profiles/desktop`。那个 home 看起来更像权威：它带着完整的 11 KB patch、五个 bundle 和全部模型提供方；而活着的 profile 只是个 1 KB 的存根，两个 bundle、没有提供方。更丰富的那份文件是错的那份，于是每个"修复"都是空转，用户连报三次「修复都没有生效」之后，才由宿主自己的 argv 指出真实 home。

同一次会话随后又踩了五个坑，每一个都推出过看似合理但错误的结论：

- **状态是按 home 分家的。** 任务看板与小队数据存放在 home 旁边而不是 profile 里：`task-board/ledger-v2.json`（2.0 MB、390 个任务）与 `dsh-agents/ledger.json`（3 个小队）只存在于那个没被使用的 home。把 profile 复制进活 home 后两个插件开始加载，它们从新位置的 190 字节与 70 字节账本渲染出空看板。用户把这读成了数据丢失。
- **`settings.yaml` 是遗留格式。** store 的 `importLegacyDocument()` 会把 `profile.home/settings.yaml` 改名成 `.imported`，并把每一节一次性导入到拥有该节的条目 config；此后条目 config 才是真源。往 profile 目录写一份 `settings.yaml` 修不好任何东西，因为没人读它。
- **patch 层按 id 合并。** 顶层 `- id:` 条目只覆盖合成树里已存在的行；新 id 会被 `patch: entry "<id>" not found` 丢弃，新行必须放进 `- insert:` 块。这个 profile 自己的注释里就写过这个坑，会话仍然要靠 `--dump-config` 才看到六个条目被丢。
- **两层里的重复 id。** 把一个被丢弃的条目挪进 `insert:`，而同一个 id 已经在某个既有 `insert:` 块里时，会产生重复行，只能回滚到干净备份重做。
- **cookie 累积会堵住启动。** 外壳每次启动都对着 `127.0.0.1` 发一个 `dsh-auth-*` cookie，且从不清理；累积到 71 个后 welcome 握手回非 2xx，启动以 `desktop welcome: Web authentication failed` 中止。清掉它们能恢复启动，同时终结账号会话，所以用户必须重新登录——这个代价要在动手前说明，而不是事后才发现。

## Decision

桌面宿主的修复先读活进程的身份，再碰任何文件，并把配置与状态当作同一个 home 的两类产物。

- **先定位宿主。** `ps eww -p <宿主 pid>` 得到 `DSH_HOME`；`--expose-internals` 宿主子进程的 argv 指出 profile 目录。两者都在第一次编辑之前读取，任何路径都不从默认的 `~/.dsh` 推断。
- **编辑只落在活 home。** profile 的 patch、`package.json`、依赖与任何 settings 写入都对准运行中宿主指出的那个 profile。磁盘别处更丰富的 profile 是关于另一次安装的证据，不构成偏好它的理由。
- **配置与状态一起迁移，且应用必须停止。** 复制 profile 恢复的是插件；home 旁边的账本才恢复这些插件渲染的数据。迁移要备份目标、移除遗留的 `.lock`、比对 `schemaVersion`，并且只在宿主停止时执行，因为账本只允许一个写入者。
- **`settings.yaml` 永远不是修复目标。** 这一代里它被导入一次即改名；provider 档案属于所属条目的 config。
- **patch 修复靠合成验证，而不是靠读 patch。** 在临时 `DSH_HOME` 下放一份改名 profile 的隔离副本，再跑 `--dump-config`，就能列出被丢弃的条目与名字不匹配；应用会拒绝为自己的受管 profile 做 dump，所以副本是看到合成树的唯一途径。
- **清 cookie 是解堵启动的手段，且要标价。** 它能让卡死的 welcome 握手重新动起来，同时把账号登出；这件事要在动手前告诉用户，而不是事后才说。

## Diagnosing the composed profile

`--dump-config` 把 YAML 写进 stdout、把告警写进 stderr，这正是"patch 能解析"与"patch 能生效"之间的差别：

```
dsh: [...] patch: entry "llm-verifier" not found
dsh: [...] patch: name mismatch for "web-ui-session-archive"
        (expected "@linxin666/dsh-session-archive",
         got "@linxin666/dsh-web-all/session-archive"), skipping
dsh: [...] patch: entry "magpie-mcp-codegraph" not found
```

同一次运行还能证明被合并的条目保留了载荷：`llm-pi-ai` 行出现在 dump 里，带着三个提供方和九个模型，这就排除了"配置缺失"的假设，把排查推向 home。

## Alternatives considered

**去改看起来更新的那份 profile。** 否决：`~/.dsh` 下更完整的 patch 属于应用没有读取的那次安装。按丰富程度做偏好，让会话付出了前三次修复的代价，并从完好的文件里得出两个错误结论（模型"被删"、插件"没了"）。

**从 patch 的 provider 块重建 `settings.yaml`。** 否决：这是遗留导入路径。下次启动时文件会被改名、各节折进条目 config，重建不可能生效；schema 甚至按插件 README 比对过是正确的，这让空转的结果看起来像 schema 问题。

**复制 profile，让插件自己重建状态。** 否决：任务看板与小队的账本不是派生数据，应用回了空看板，读起来就是数据丢失。状态随 home 走。

**不停宿主就迁移账本。** 否决：两个账本都持单写入者锁，运行中宿主的写入会覆盖刚恢复的文件，而复制还在进行。

**把所有被丢弃的条目都插进一个新块。** 否决：其中两个已经在既有 `insert:` 里有同 id 的活行，第一次尝试因此产生重复。正确的修法是删掉多余的顶层副本。

**把备份的 cookie 罐子覆盖回去以撤销登出。** 否决：那会把 71 个陈旧 cookie 带回来，正是它们让启动卡死，等于用可用的启动换一个保存的登录。

## Consequences

- 修复通过合成与数据两方面验证：`--dump-config` 的告警从六条降到零，合成树增长到 2725 行；重启后活 home 报出任务看板 `revision 3966` / 390 个任务、小队 `revision 20` / 3 个小队。
- 六个 patch 条目按类别分别处理：两个已弃用的 id（`llm-verifier`、`im-qqbot`）被删除而不是安装；一处名字改为包的真实名；一个顶层副本被删除、保留其既有 `insert:` 行；两处被挪进 `insert:`。
- 现在有两个 home 各持一份并行数据（`~/.dsh` 与 `~/.dsh-trading`，两边都有 sessions 与 attachments）。本次修复没有合并它们；为桌面应用选定一个 home 仍是待决事项，这条笔记记录的是分裂本身而不是结论。
- cookie 累积是签名包内部无法本地修复的上游缺陷：`ElectronAsarIntegrity` 与硬化运行时同时拒绝 `app.asar` 编辑和 `NODE_OPTIONS` 注入（`node_main.cc:154` 会对被其它应用拉起的进程禁用 Node 环境变量）。用户级脚本只能在启动前重新清罐子；缺陷本身需要外壳修复。
- home 优先这条规则与[探测共享 DSH home 时隔离出自己的 home](../process/2026-10-02-shared-dsh-home-probe-isolation.md) 同族：那条让探针别进用户 home，这条让修复待在正确的 home 里。两者失败的方式相同——路径被假设而不是被读取。
