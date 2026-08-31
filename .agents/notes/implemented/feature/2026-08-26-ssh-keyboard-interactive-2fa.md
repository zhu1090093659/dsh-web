# Agent Note: SSH Keyboard-Interactive Auth and Interactive 2FA Support

Status: implemented

## Problem

`dsh-ssh` previously did not enable `keyboard-interactive` in its `ssh2` connection configuration (#806). This caused two major issues:
1. Modern Linux distros (Ubuntu 24.04, Debian 12) and jump hosts that route password authentication through PAM `keyboard-interactive` failed to authenticate even when the password was correct.
2. Servers and jump hosts requiring dynamic 2FA (TOTP / OTP verification codes) were unsupported because there was no bridge to prompt the user during terminal connection handshakes.

## Decision

Implemented a two-phase solution:
1. **Phase 1: Automatic PAM Password Fallback (`engine/connection-pool.ts`)**:
   - Enabled `tryKeyboard: true` in `buildConnectConfig`.
   - In `connectClient`, attached a listener for `keyboard-interactive`. When `auth.kind === 'password'` and all prompts match password challenges (`/password/i`), automatically responds with `config.password`.
   - This fixes non-interactive pooled operations (`ssh_exec`, cluster, SFTP) and terminal connections against PAM password servers without UI friction.
2. **Phase 2: Terminal Interactive 2FA Prompt Flow (`pty.ts`, `routes.ts`, `TerminalTab.tsx`)**:
   - Extended `TerminalServerFrame` with `auth_prompt` and `TerminalClientFrame` with `auth_response`.
   - In `routes.ts`, intercepted unmatched `keyboard-interactive` challenges and relayed them over WebSocket to the client.
   - In `TerminalTab.tsx`, rendered an interactive 2FA modal overlay requesting the ephemeral verification code. Submitting the code sends `auth_response` to complete the handshake.
   - 2FA codes are kept purely in runtime memory and are never persisted to disk or localStorage.

## Consequences

- Full compatibility with PAM keyboard-interactive password authentication across all SSH operations.
- Full interactive 2FA / TOTP challenge-response support in the Web Terminal view.

## Testing

Added automated tests in `tests/connection-pool.test.ts`, `tests/routes.test.ts`, and `tests/panel-terminal.test.tsx`. All 144 tests in `packages/dsh-ssh` passed.
