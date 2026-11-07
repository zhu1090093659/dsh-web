# @linxin666/dsh-win-bash

[English](README.md) | 中文

为 Windows x64 的 DSH 会话提供「钉死版本 + 摘要的私有 bash」。插件随包携带自己的
Git for Windows MinGit 载荷，在 `win_bash` 工具背后为每个会话维持一个持久 bash 进程，
且绝不回退到 `PATH` 上找到的 bash。

## 为什么需要它

模型习惯用 bash 语法写 shell 命令——管道、`$VAR`、单引号、here-document——而只有
PowerShell 的 Windows 会话往往只回一句语法错误。每一次报错都要多一轮往返，而且
并不会告诉模型正确的写法。本包用真实、版本与字节都被钉死的 MSYS2 bash 消除这个
循环：模型写什么方言，跑的就是什么方言。

shell 必须持久，因为 shell 是有状态的：一条命令 `cd` 过、export 过变量，下一条命令
就该看得见。每个会话一个进程正是这一点的实现方式。

## 是什么

- 只注册一个模型可见工具 `win_bash`。名字刻意不叫 `bash`：宿主本来就挂了自家的
  bash 系工具，同名要么覆盖别人、要么被别人覆盖，两种都是静默的。
- 每个会话维持一个持久 `bash -s` 进程。当前目录、导出的变量、函数、别名和 shell
  历史在该会话的多次调用之间保留，且不与其它会话共享。
- 每次调用都是前台命令：stdout 与 stderr 分离、各有字节上限、返回命令真实的退出码。
  超出上限的输出会在模型读到的文本里被标记为截断，而不是被无声切掉。
- 在渲染出的文本里剥掉终端转义序列。Windows 上的着色库按平台而不是按「有没有接终端」
  判断，所以管道里的 `vitest`、`pnpm` 照样吐颜色码；本工具把字节原样带回来，在渲染
  成文本这一步丢掉它们，于是读到的是消息本身而不是 `ESC [ 3 3 m`。被进度条原地重绘
  的那一行只保留它最后停在的那一帧。原始流与 spill 文件仍保留精确字节。
- 可选地把命令作为后台任务放进它自己的钉死 bash 进程，立即返回 job id，
  于是长构建或 watch 既不占住这次调用，也不会随会话 shell 一起死。见
  [后台命令](#后台命令)。
- 给每个 shell 一份机器 temp 根下的私有目录（`TMPDIR`/`TMP`/`TEMP`），并在该
  shell 结束时删除它——正常 `exit`、超时或中止、会话销毁、插件卸载，以及后台任务
  结算时都在内。宿主被强杀、来不及删除的目录，会在下次启动时按目录名里的 pid 回收，
  因此 temp 根不会每个 shell 攒一个目录。
- 为每个 shell 显式提供 `HOME`：保留宿主已有值，缺失时使用 Node 返回的 Unicode 用户目录，避免非 ASCII Windows 用户目录经过 MSYS 的 ANSI 推导而损坏。
- 工具注册之前先按 SHA256 清单校验随包载荷，并把校验过的副本发布到 DSH home
  下；摘要不匹配即拒绝挂载，且每个 shell 都从该副本启动，而不是从包目录启动。
- `win_bash` 注册期间，把宿主自带的 `pwsh` 工具从会话的模型可见面上替换掉，
  使命令工作落到 bash，而不是落到模型本来就更熟的那个 shell。见
  [该用哪个 shell](#该用哪个-shell)。

本包不注册设置分区、不注册 HTTP 路由、没有浏览器半区：宿主直接用它自己的 Config
schema 渲染本行的配置表单。

## 该用哪个 shell

本包安装的是一个优先阶梯，而且是一条 Windows 阶梯：

1. **`win_bash`** 承担命令工作。它是钉死版本的 MSYS2 bash，状态跨调用保留，
   模型写什么方言，跑的就是什么方言。
2. **`pwsh`** 承担只有 PowerShell 才做的 Windows 原生工作——cmdlet、注册表、
   Windows 服务——并作为命令不是 bash 时的退路。它由宿主解析：装了 PowerShell 7
   的机器就是 `pwsh`，没装的则是平台自带的 Windows PowerShell。本包不携带任何
   PowerShell 载荷。

`win_bash` 注册期间，本插件把 `pwsh` 从会话的工具面上撤下——这正是第一级能站住
的原因：同时看得见两个 shell 的模型会选自己本来就熟的那个，而工具 schema 里没有
任何东西能推翻这个习惯。效果就是「会话里只列出一个 shell」，因此 `win_bash` 描述里
的记法是「隐藏它而不是禁止它」。

- **只管可见性。** 模型刻意发起的 `pwsh` 调用照常执行：这里没有执行层守卫，也没有
  pre-execute 拒绝——直接把退路那一级拿掉，等于用能力损失换取一个偏好。
- **按会话生效，绝不进程级。** 撤下是本插件所服务会话上的作用域工具限制；同一部署
  里的其它部分保留自己组合出来的面。
- **只在 `win_bash` 真的挂载成功时。** 可用性门控拒绝、载荷校验失败、非 Windows
  宿主，或行里写了 `replacePwsh: false`，都会让 `pwsh` 原封不动。对最终没有替代
  shell 的部署再撤掉它唯一可用的 shell，会让会话两个都没有。
- **仅 Windows。** POSIX 上宿主 shell 是 bash，win_bash 不挂载，这套逻辑不产生任何
  限制、监听器或副作用。
- **可逆。** 每条限制都会在对应会话销毁时、以及插件卸载时被解除，且逐个隔离回调。

把 `replacePwsh` 设为 false 即可让两个 shell 并排列出，只靠工具描述表达偏好。

## 可用性

本工具服务于运行梁神（LiangShen）agent preset 的会话，因此其可用性跟随该预设的
**声明状态**。挂载时插件向宿主的 agent-preset 注册表查询是否声明了 id 为
`liangshen` 的预设：已声明则注册工具；未声明则完全不注册任何工具，并用一行
info 日志说明原因。一个「挂载了但每次调用都报错」的工具等于教模型一个会话并不
具备的能力，比诚实的缺席更糟。

日志中可区分三种判定，因为它们需要不同的处置：预设已声明（已注册）、未声明该
预设（去启用 `dsh-liangshen` 插件行）、本部署没有可用的 agent-preset 注册表。
把 `syncWithLiangShen` 设为 false 会完全跳过门控并总是注册本工具。

判定会先等宿主插件树稳定，再读取名册。若首次读取就已带上该声明，立即判定；
若没有，则按一个短的、有上限的节奏重读——因为声明方插件是在自己的激活返回之后才
发布预设的，两者先后顺序不固定。迟到的声明绝不会被当成拒绝。

注册表不提供声明变更事件，因此判定在每次挂载时做一次。切换梁神插件行后，
`win_bash` 会在插件管理器刷新 profile 后跟随生效——与家族其它部分同一套新鲜度
模型，而非即时生效。

## 安装

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm --filter @linxin666/dsh-win-bash build
dsh plugin --profile web add link:$(pwd)/packages/dsh-win-bash
```

bundle patch 把本包的行在非 Windows 宿主上标为 disabled，因此 POSIX 的 profile 可以
照常携带同一份组合，只是什么都不挂载。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `timeoutMs` | 300000 | 单次调用的墙钟上限（毫秒，1000..3600000）。超时会停掉该 shell，下一次调用起新 shell。 |
| `maxStdoutBytes` | 131072 | stdout 可见字节上限（1024..1048576）。超出部分从前面丢弃，并在结果文本里写明。 |
| `maxStderrBytes` | 32768 | stderr 可见字节上限（1024..524288）。 |
| `enableRunInBackground` | true | 是否提供 `run_in_background`。只有该项为 true 且部署组合了 job registry 时该参数才会被声明；没有 registry 的部署不会声明它，此时仍然请求该参数的调用会被拒绝，而不是退化到前台执行。 |
| `description` | 内置 | 面向模型的工具描述；部署可描述自己的环境。 |
| `syncWithLiangShen` | true | 为 true 时仅在 `liangshen` agent preset 已声明时注册本工具；false 跳过该门控、总是注册。 |
| `replacePwsh` | true | 本工具注册期间，把宿主的 `pwsh` 工具从每个会话的模型可见面上撤下。只管可见性：刻意发起的 `pwsh` 调用照常执行。false 则两个 shell 并列。 |

## 工具接口

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| `command` | 是 | 要执行的 bash 命令，可多行。 |
| `workdir` | 否 | 本次命令的工作目录。省略则沿用 shell 当前目录。 |
| `timeoutMs` | 否 | 单次上限，会被夹到配置的上限。 |
| `run_in_background` | 否 | 在独立的钉死 bash 进程里执行，并立即返回 job id。仅在组合了 job registry 时提供（见[配置](#配置)）。 |

结果包含 `stdout`、`stderr`、命令的 `exitCode`、两条流的截断事实
（`stdoutTruncated`、`stderrTruncated`、`stdoutLostHead`、`stderrLostHead`、
`frameOverflow`，以及保存完整流的 `stdoutSpillPath`/`stderrSpillPath`），
以及本次调用的沙箱事实。

某条流被截断时，模型可见文本末尾会多出一行，例如：

```text
[win_bash: stdout was truncated, only the last 131072 bytes are shown; the beginning was dropped; a middle window was dropped by the frame watch limit]
```

## 后台命令

`run_in_background: true` 会在它**自己的**钉死 bash 进程里执行命令——同一条绝对
载荷路径、同一份环境契约、同一套受限逻辑——并立即返回 job id，而不是等命令结束。
用宿主的 `job_output` 收取该任务，用 `job_kill` 终止它。

独立进程是要点，不是实现细节。会话的持久 shell 位于 subprocess provider 的托管进程
范围内，销毁该范围会终止其中所有仍在运行的进程；因此用 shell 内 `&` 起的任务会随起
它的 shell 一起死——下一次超时、下一次中止、或会话销毁时。所以后台命令拥有自己的进
程，并比发起它的那次调用活得更久。

- **自己的 shell。** 绝不用会话的持久 shell，因此后台命令不会扰乱前台 shell 的当前
  目录、导出变量或历史。
- **同一份环境契约。** `PATH` 以载荷的 `usr/bin` 打头，`MSYSTEM=MSYS`、
  `TERM=dumb`、`--norc --noprofile`，且 `TMPDIR`/`TMP`/`TEMP` 指向该任务私有的
  目录。
- **同一套模式规则。** 受限会话会以与前台调用相同的 `SANDBOX_UNSUPPORTED` 被拒绝，
  且发生在任何进程启动、任何任务注册之前。
- **没有超时。** 任务注册完成即返回；命令的寿命由 `job_kill` 与会话结束界定。
- **绝不静默退化。** 在没有组合 job registry 的部署上，该调用会以
  `BACKGROUND_UNAVAILABLE` 被拒绝并说明原因；绝不会悄悄改成前台执行——那会让调用方
  一直等到命令结束，然后随那个 shell 一起死。

## 权限

本工具从宿主的 sandbox-policy 服务解析**调用会话**的有效沙箱策略——与宿主自己的执行族
读的是同一个来源，且**带上该会话**：会话自身的模式优先于部署默认，因此用户已限制的会话
无法经由部署默认摸到这个 shell。

**本工具只在 `danger-full-access` 下运行。** 其他模式一律在任何进程启动之前以
`SANDBOX_UNSUPPORTED` 拒绝：随包的 MSYS2 bash 在受限令牌下无法启动，所以受限在此
不可能产出一个可用的 shell。在 win32 x64（Windows 10.0.26200）上对真实受限令牌 runner
实测：`bash.exe`、`sh.exe`、`dash.exe`、`echo.exe` 全部在 `main` 之前死亡，报

```text
NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-<hash>): 0xC0000022
```

（退出码 3221225794 / 0xC0000142）；系统 Git for Windows 同样失败（`couldn't create signal
pipe, Win32 error 5`）。同一 runner 下 `cmd.exe`、`node.exe`、`powershell.exe` 均正常，
故 runner 本身是好的，限制属于 MSYS 运行时。

拒绝才是诚实的答案，而不是保守的答案：一个每条命令都在 `main` 之前死掉的 shell，会被
报告成「跑在某个边界内」，而那个边界从未真正拦住任何命令。

**win_bash 是首选 shell，不是唯一 shell。** 它服务不了某个会话时，就退到该平台的原生
shell 工具：受限会话里的 pwsh 会被保留在工具面上（见 `src/pwsh-replacement.ts`），
每一条拒绝与失败信息也都会指明这个去处，避免模型反复重试一个不会恢复的 shell。

本工具不提供单次调用提权参数。

## 载荷

随包载荷来自 Git for Windows `v2.56.0.windows.2`（官方上游 release），裁剪为
shell、其 userland 以及精确的 DLL 闭包。同一 release 的两份资产共同构成它：MinGit
资产 `MinGit-2.56.0.2-64-bit.zip` 提供除 `usr/bin/sleep.exe` 与
`usr/bin/seq.exe` 之外的全部文件，这两个文件 MinGit 并不出货，取自同一 release 的
完整包 `Git-2.56.0.2-64-bit.tar.bz2`。每个文件都登记在
`runtime/win32-x64/checksums.sha256`，每个被再分发组件的许可证文本都随载荷保留。
[PROVENANCE.md](PROVENANCE.md) 记录两份来源资产的 URL 与摘要、裁剪规则、载荷清单与
许可证对照表。

真正运行的是副本，不是包内那棵树。Windows 不允许 rename 一个运行中的可执行文件
所在的目录，而 pnpm 导入包正是用 rename 把 staging 目录换成目标目录，所以从
`node_modules/@linxin666/dsh-win-bash` 里起的 shell，会让此后每次更新或卸载本包
都报 `ERR_PNPM_EPERM`，直到它停下。副本发布在
`<DSH_HOME>/win-bash/runtime/<载荷键>`，键由 checksums 清单导出：只改 JavaScript
的发布会复用已有副本，字节与清单不符的副本会在运行之前被重建，独立的 `DSH_HOME`
得到自己的缓存。副本写不出来时，改由校验过的包内树运行，并有一条警告说明这一点。

清单匹配还不足以让副本「可以运行」。Windows 强制性完整性标签在文件的安全描述符里，
不在字节里：数据树带可继承的 Low 标签时，复制出的 `bash.exe` 也带 Low 标签，于是
Windows 即使从 Medium runner 启动也会得到 Low 完整性进程，写不了普通 Medium 工作区与
临时目录。因此 `win_bash` 在复用副本前、发布副本前、以及发布之后，都会通过 Windows
`icacls` 的 SDDL 输出核验目录链与 `bash.exe` 的强制性完整性标签。带 Low/Untrusted
标签的树不复用、不执行；载荷改为发布到隔离的每用户缓存根（仍在包外），旧 Low 缓存
因此被弃用，不会在重启或更新后靠哈希匹配继续存活。这里只读取元数据：不改任何标签、
DACL 或令牌，也不要求用户降低工作区标签、修改沙箱策略或提权运行 DSH。没有安全候选
根时，改由校验过的包内树运行并给出明确警告；只有连包内映像都带 Low 标签，才以
`unsafe-integrity` 拒绝挂载并指明 `pwsh` 退路。可用 `DSH_WIN_BASH_RUNTIME_HOME`
覆盖隔离缓存根的父目录。

## 已知限制

- 仅支持 Windows x64。载荷是 Windows MSYS2 构建，工具在任何其它平台或架构上都拒绝
  用 `PATH` 上的 bash 顶替。
- 不携带 ssh 客户端。MinGit 树里的 OpenSSH 一族被刻意排除；远程操作用会话自己的
  工具。
- 每个会话一个 shell，并随会话结束而结束。shell 退出或卡死时下一次调用会换一个新的，
  且那次调用会明确说明。
- 命令输出超过可见上限时会丢掉前面的一段。保留的是尾部，结果里会写明被截断、显示了多少
  字节，以及在 provider 留下 spill 文件时完整流在哪里。
- 后台任务是「一个进程执行一条命令」：任务之间没有持久状态，也不能由正在跑的前台调用
  「升级」而来（前台调用到达 `timeoutMs` 时仍然会停掉它的 shell）。
- 发布的载荷通常位于 `<DSH_HOME>/win-bash/runtime/`；当该数据树带 Low 标签时，
  改放在隔离的每用户缓存根。每一份不同的载荷在那里保留一个目录（约 16 MiB），DSH
  停止时可以安全删除它：下一次挂载会重新发布。

## 后续工作

- 打包期校验脚本：重新下载钉死的来源资产、重建载荷并与 `checksums.sha256` 对
  比，使载荷刷新由机器校验而不是靠人工评审。

## 许可证

本包自身源码为 Apache-2.0。随包载荷保留自己的许可证（含 GPL-2.0-or-later 与
GPL-3.0-or-later）；见 [PROVENANCE.md](PROVENANCE.md)。
