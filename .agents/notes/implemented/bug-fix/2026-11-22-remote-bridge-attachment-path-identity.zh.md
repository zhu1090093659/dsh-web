# Agent Note: 远程桥接的附件身份判定读条目本身，不比较 realpath

Status: implemented

## Problem

`windows-smoke` 车道的 `Remote bridge tests` 步骤自附件路径功能落地（`0ed7f493e`，
2026-11-10）起，每次运行都让 `tests/attachment-path.spec.ts` 的 32 个用例里 13 个失败；
这条车道已经连续 30 次红。

`readAttachment` 用「`realpath(path)` 必须等于存下的字符串」判定「这还是不是会话点过的
那个文件」。`windows-latest` 上 `os.tmpdir()` 返回 8.3 短名（`C:\Users\RUNNER~1\...`），
而 `realpath()` 返回长名（`C:\Users\runneradmin\...`），于是这个比较对临时目录下的每个
文件都恒为假。第一道文件判定在 `stat` 之前就把每个路径拒成 `path-not-in-session`：六个
本应被服务的用例在 `.ok` 上失败，`not-found` / `not-an-image` / `frame-too-large` 变成
不可达，软链用例则因为断言写的是解析后的目标名字而失败。

macOS 的 `/var` → `/private/var` 属于同一类失败。CI 里只有 Windows 车道暴露出来，因为
只有它的临时目录是 8.3 短名。

## Decision

`readAttachment` 改成读条目本身：一次 `lstat()`，`isSymbolicLink()` 即拒，`size` 取自
同一次调用。规则现在陈述的是意图——这个名字不能是顶替另一个文件的门面——而不是比较同一
条路径的两种写法。模块注释与 `protocol.ts` 里 `CODE_PATH_NOT_IN_SESSION` 的注释改成
「这个名字是链接」，不再写「realpath 不同」。

`tests/attachment-path.spec.ts` 的软链用例改为断言拒绝说明写的是被请求的路径、且不写链接
指向的目标。这条断言在两种写法下都成立，陈述的是拒绝的用途，而不是临时目录恰好怎么拼。

证据：把 `TMPDIR` 指向一个符号链接（同一种规范化分歧，Linux 上可复现），旧规则对每个文件
都判拒（`realpath(path) !== path` 为真），而 `lstat().isSymbolicLink()` 为假，新规则照常
放行；该 spec 在这个条件下 32/32 通过，正常运行同样 32/32；整包 81 文件 / 1139 用例通过。

## Alternatives considered

**保留 `realpath()`，比较 `join(realpath(dirname(p)), basename(p))`。** 否决：8.3 这一种修好了，
但盘上大小写与会话记下的名字不一致时仍会误拒——Windows 允许这种差异，等于同一种误拒换了
个样子。

**先规范化两边再比较（Windows 上转小写、展开 8.3）。** 否决：把平台相关的字符串处理塞进
安全判定里，而读条目的判据根本没有「写法」需要规范化。

**只用 `realpath()` 拼拒绝说明。** 否决：为一句消息把那次系统调用加回来，而直接说客户端
请求的路径读起来更清楚。

## Consequences

- 系统调用从两次变一次，`not-found` / `not-an-image` / `frame-too-large` 在 Windows 上
  恢复可达。
- 断链现在回 `path-not-in-session`（`lstat` 成功且条目是链接），原先回 `not-found`
  （`realpath` 抛错）。无用例覆盖这条，而「这不是会话点过的那个文件」正是断链的情形。
- 会话点过文件之后父目录被换成链接这一种不再被这次读拦下。文件本身仍必须是常规文件且
  字节带图片签名，而能改写父目录的人同样能直接写入目标文件——旧判据也放行这种情况。
