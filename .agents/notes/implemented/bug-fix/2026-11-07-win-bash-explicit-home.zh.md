# Agent Note: win_bash 为 Unicode Windows 用户目录显式提供 HOME

Status: implemented

## Problem

Issue [#2028](https://github.com/zhu1090093659/dsh-web/issues/2028) 显示，`shellEnvironment()` 没有向随包 MSYS bash 传入 `HOME`。桌面启动的宿主未继承 `HOME` 时，MSYS 会经当前 ANSI 代码页从 `USERPROFILE` 推导它。包含非 ASCII 字符的 Windows 账户目录因此变成不同的字节序列，`~` 展开以及在用户目录下解析配置的工具都可能访问错误位置。

## Decision

`shellEnvironment()` 现在始终提供 `HOME`：已有的 `base.HOME` 优先，缺失时回退到 Node 的 `homedir()`。子进程由此直接取得宿主已知的 Unicode 路径，不再让 MSYS 经当前代码页重建它。前台 shell 与后台任务继续共用同一个环境构造函数。本改动不改写 `USERPROFILE`、不转换路径拼写，也不改变任何其他环境契约。

## Alternatives considered

**不设置 HOME，继续让 MSYS 推导。** 否决：issue 中的字节对照与显式 HOME 对照证明，非 ASCII 用户目录的损坏点正是这段推导。

**始终用 homedir() 覆盖 HOME。** 否决：显式继承的 `HOME` 是调用方或宿主的有意选择，必须保持其权威；只有缺失值才需要操作系统用户目录兜底。

**只在前台 shell 调用点设置 HOME。** 否决：后台命令使用同一套随包 shell 语义，分散在调用点的补丁会让两条路径漂移。

## Consequences

继承了 `HOME` 的 shell 看到的值与之前相同。没有继承它的 shell 现在会取得真实的操作系统用户目录，包括其中的非 ASCII 字符，因此 `~` 与相对用户目录的配置都解析到该目录。函数签名、工具 schema、进程模型与原生 shell 退路均不变。

## Testing

`packages/dsh-win-bash/tests/shell-environment.spec.ts` 覆盖非 ASCII 回退的逐字节一致性、显式 `HOME` 的保留，以及不变的载荷 PATH、私有临时目录、MSYSTEM 与 TERM 条目。包级门禁为 `pnpm --filter @linxin666/dsh-win-bash typecheck`、`test` 与 `build`。
