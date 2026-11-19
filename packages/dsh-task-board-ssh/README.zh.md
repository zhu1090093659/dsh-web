# @linxin666/dsh-client-ui-task-board-ssh

[English](README.md) | 中文

任务看板的外部提供方扩展：把钉住目标卡片作为无头 agent 会话，跑在经 dsh-ssh 触达的远端主机上，让卡片的工作发生在持有代码的机器上，并且不随本机离线而中断。

## 是什么

- 向任务看板登记 `ssh` 提供方扩展，并在看板唯一的启动闸口接管钉住了远端目标的卡片。
- 通过一个 POSIX `sh` 启动器在主机上运行 dsh、Claude Code、Codex 或自定义命令，并用 `setsid nohup` 脱离连接。
- 运行的账目留在卡片自己的载荷里，日志留在远端主机上，按字节偏移读回。

## 安装

### 从 npm 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-ssh@latest
```

### 从仓库安装

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-ssh
```

## 配置

- `mode`：`direct` 在主机上直接起无头 agent；`proxy` 起一个本地会话去驱动主机。
- `host`：dsh-ssh 的主机别名。
- `agent`：`dsh`、`claude`、`codex` 或 `custom`，自定义 agent 另需命令模板。
- `workspace`：`in-place` 用已有的远端目录，`git` 用每次运行的工作树，仓库来源可以是仓库 URL 或本地工作区。

## 安全模型

- 每次远端运行都是无人值守的：启动器使用各 CLI 自己的绕过开关，dsh 用 `danger-full-access` 预设。
- 本包发往主机的每个值都由同一个 POSIX shell 转义函数处理，命令行不由裸文本拼接。
- dsh-ssh 不向本包交出凭据、私钥路径或 proxy 命令文本，卡片载荷也不含日志字节。

## 已知限制

- 本包当前只交付冻结的纯逻辑核心：宿主运行引擎、工作区策略与浏览器半区随后落地，因此今天挂载它不改变任何行为。
- Codex 支持按官方文档书写，尚未在装有真实二进制的机器上运行过。
- 启动器需要远端主机上有 POSIX `sh` 与 `setsid`，两者都缺的主机跑不了 direct 模式卡片。

## 许可证

Apache-2.0。
