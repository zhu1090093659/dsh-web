# Agent Note: SSH 交互式认证与动态二次验证 (2FA) 支持

状态：已实现 (implemented)

## 问题背景

`dsh-ssh` 此前未在 `ssh2` 连接配置中启用 `keyboard-interactive` 握手（#806），导致两类场景受限：
1. 很多现代 Linux 发行版（如 Ubuntu 24.04、Debian 12）及堡垒机默认将密码认证走 PAM `keyboard-interactive`，导致即使配置了正确密码也握手失败；
2. 启用了动态二次验证（Google Authenticator TOTP / 验证码）的跳板机与服务器无法在连接握手时获取用户一次性口令。

## 技术决策

采取两阶段分层实现方案：
1. **阶段一：PAM 密码交互自动响应（`engine/connection-pool.ts`）**：
   - 在 `buildConnectConfig` 中开启 `tryKeyboard: true`；
   - 在 `connectClient` 握手期监听 `keyboard-interactive` 事件，若配置为密码认证（`auth.kind === 'password'`）且 Prompt 为密码请求，自动使用配置密码应答；
   - 彻底解决了连接池（`ssh_exec`、集群、SFTP、隧道）和终端在 PAM 密码主机上的连接问题。
2. **阶段二：Web 终端动态 2FA 交互流（`pty.ts`、`routes.ts`、`TerminalTab.tsx`）**：
   - 扩展终端 WebSocket 协议帧：新增下行 `auth_prompt` 与上行 `auth_response`；
   - 当收到服务器发出的动态 2FA 挑战（如 `"Verification code: "`）时，中继至前端终端；
   - 终端界面浮层弹出 2FA 模态框，用户输入后回传完成握手；
   - 动态验证码仅在握手内存中流转，**绝不落盘持久化**。

## 影响与收益

- 连接池和自动化工具操作全面兼容 PAM 交互密码环境；
- Web 终端完整支持跳板机/服务器的动态 2FA / TOTP 交互式登录。

## 验证结论

在 `tests/connection-pool.test.ts`、`tests/routes.test.ts` 与 `tests/panel-terminal.test.tsx` 中补充了单元测试覆盖，`packages/dsh-ssh` 144 项测试全部通过。
