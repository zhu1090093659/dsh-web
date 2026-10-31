# dsh-task-board-github · GitHub Issues & PR Synchronization Extension for DSH Task Board

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-task-board-github?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>GitHub Issues & PR Bidirectional Sync Extension for DeepSeek Harness (DSH) Task Board</strong><br>
  <em>Issue to Task Card · Bidirectional Status Sync · Automated PR Creation · Agent Delivery · 7 Agent Tools</em>
</p>

An official external provider extension for the DeepSeek Harness (DSH) Web GUI and desktop client task board (`@linxin666/dsh-task-board`). It seamlessly bridges GitHub Issues and automated DSH agent workflows: selected issues from configured repositories are ingested into task cards, driving autonomous agent execution, automatic pull request creation, and bidirectional status synchronization. It features GUI credential controls and mounts via `cordis.patch.yml` and profiles without modifying DSH source code.

## Features

- **GitHub Issues as an external board source**: every configured repository contributes the issues it selects; the board keeps owning the columns, execution and scheduling.
- **Bounded remote-close synchronization**: a closed issue materializes in Done and moves an existing non-running, unarchived card there without creating an execution record. A running card is never interrupted: the close waits for its execution to settle and applies on a later sync only if the column was not changed again. Reopening returns only an automatically completed card to To Do; a local move out of Done overrides the current close cycle until the issue reopens and closes again. Archived cards stay untouched, and this inbound rule never closes or reopens the remote issue.
- **Per-repository configuration**: owner, repository, inclusion label, an optional inclusion assignee, whether unassigned issues are included, managed label prefix, the GitHub label behind each board column, the pull-request phase label, the poll interval, pull-request creation, the draft policy, close-on-merge and the pull-request base branch.
- **Three ways onto the board**: an issue is included when it carries the inclusion label, when it is assigned to the repository's configured login (`@me` for the account the host is authenticated as), or when it belongs to a repository that takes unassigned issues and nobody is assigned to it at all. An issue that loses every channel is deactivated without losing its history.
- **The unassigned channel**: `includeUnassigned: true` matches only issues with no assignee whatsoever and never takes an issue assigned to somebody else. It suits repositories that manage their issues by label alone and assign nothing.
- **Controlled write-back**: only DSH-owned state and phase labels are added or removed. Repository labels, including the inclusion label itself, are never modified.
- **Execution immutability**: remote title and body refresh a card's content only until the card starts executing. The board's own content gate settles that, and the extension keeps no second opinion about which cards are frozen.
- **A templated execution prompt, not the raw issue body**: a synchronized card runs with a prompt that names the issue (repository, number, link, repository labels), fixes the workflow (read the repository's agent instructions, work on the `issue-<number>` branch against `baseBranch`, run the required checks, report back with `task_board_github_comment`, never close the issue before its pull request merges, and end with a comment instead of inventing changes when the issue needs none), and appends the issue body verbatim inside a provenance wrap that issue text cannot close early. A prompt somebody edited in the task detail is kept by every later sync; an untouched one follows the issue until the card starts executing.
- **Optional AI analysis**: the task-detail seat can ask a model (the picked `provider/model`, else the repository's `analysisModel`, the card's pinned model, then the host default) for a structured analysis — goal, steps, completion criteria, and whether a code change is needed. It becomes one section of the prompt, flagged as unreviewed model output, never a replacement for the verbatim issue body; it runs on the host in the background, is cached against the issue content it was written from, drops out of the prompt as soon as the issue changes, and is refused on a frozen card or, without explicit confirmation, on a hand-edited prompt. A verdict that no code change is needed offers a one-click move to the backlog.
- **Deactivation without loss**: an issue that stops being selected (the label went away and it is no longer assigned to the configured login) hides its card from the active board and keeps every execution; selecting it again restores the same card.
- **Nine model-visible tools**: the seven synchronization and write-back tools (`task_board_github_list`, `task_board_github_get`, `task_board_github_refresh`, `task_board_github_create_pr`, `task_board_github_link_pr`, `task_board_github_comment`, `task_board_github_close_issue`) and two configuration tools (`task_board_github_setup`, `task_board_github_repositories`), contributed through the board's `registerTool` capability, so they follow the board's master switch AND this extension's switch.
- **Issue write-back**: `task_board_github_comment` posts one Markdown comment on the issue (the body must be non-empty and at most 16000 characters; an over-long one is refused rather than truncated into something the model did not write). `task_board_github_close_issue` closes the issue, but ONLY once the card's pull request is MERGED: a passing local run is not a reviewed change, and this guard is the same one automatic close-on-merge uses, so the two paths can never disagree about whether the work landed.
- **Automatic workspace inference**: a synchronized card is pinned to a local workspace whose DIRECTORY name matches the repository (case-insensitive, with `.`, `_` and `-` treated as one separator; POSIX and Windows paths both understood), so a multi-project setup no longer drops an issue into whichever checkout was used last. A MISS pins nothing: a lookalike name (`dsh-web` vs `dsh-web-old`), a substring, and two checkouts of the same project are all unmatched, and the card falls back to the board's own inheritance rules rather than a guess. The whole rule is inert on a deployment that serves no workspace registry.
- **Two board seats**: a task-detail section for the issue, its labels and its pull request, and a `#<issueNumber>` badge in the card's meta row (a link that opens the issue in a new tab when its URL is http(s); clicking it does not also open the task detail). The repository and credential summary renders in this extension's own settings card, beside the switches that govern it.
- **One switch gates both halves**: on by default. Turning it off stops polling, write-back, the event subscriptions and the tool registrations, clears the published summary and hides the seats — without remounting the row and without touching stored cards.
- **Board-owned registration, independent of load order**: the extension registers into the task board's provider surface and imports no task-board internals, so it builds, publishes and loads as a package of its own. Both halves wait for the board's service through a cordis dependency scope, so the board may activate before or after this row: the seats and the provider registration appear as soon as the service is served, and are released when it is withdrawn.
- **Host-side credential handling**: the token is resolved on the host — the harness credential store first (the same store the Models page writes API keys into), then the environment variable named by `tokenEnv`, then `GH_TOKEN`. The settings card and the setup tools write it once; no reply, snapshot or tool result carries its value. Remote issue text is stored as card content and provider metadata only; it never reaches a permission, a workspace identity or a `promptPrefix`.

## Install

Install the aggregate bundle or this package alone, then restart `dsh web`:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-github@latest
```

For local development:

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-github
```

## Configure it in the GUI

Open the Web GUI settings and find the **GitHub Issues sync** card. Everything a normal setup needs is configured in place, with no profile patch and no restart:

1. **Paste a GitHub token** into the credential field and save it. The token goes to the local host once and is stored in the DSH credential store — the same store the Models page writes API keys into — and the browser never reads it back. A fine-grained token with repository read access (contents, issues and pull requests) is enough. A deployment that would rather keep the token out of the store can export `GITHUB_TOKEN` (or another name through `tokenEnv`) or `GH_TOKEN` instead; the card reports which source is in use and whether the store can be written at all.
2. **Add the repositories to synchronize**: type `owner/repo`, paste a GitHub URL or an SSH remote, and optionally name the inclusion label each repository uses plus an inclusion assignee. An issue becomes a board card when it carries that label, is assigned to that login, or — for a repository whose unassigned channel is on — has no assignee at all — put `@me` in the assignee field to follow your own assignments, which is the easy way to pull in the issues you are working on without labeling anything; for a repository that assigns nothing, press that row's take-unassigned button to also collect the unassigned backlog.
3. **Test the connection**: the card reports the authenticated account and, per repository, whether it is reachable and how many open issues carry the inclusion label.
4. **Pick the network proxy** if the machine does not reach GitHub directly: the **Network proxy** block offers the three modes and, under `custom`, a URL box. The line below it names the proxy a request would actually use and where it came from, so an `auto` that found the system proxy says so instead of silently going direct. See [Network proxy](#network-proxy).

The same setup can be delegated to an agent: `task_board_github_setup` stores or clears the credential and runs the connection test, and `task_board_github_repositories` lists, adds, removes and updates repositories. A token passed as a tool argument becomes part of that conversation, so prefer the settings card where you can reach it.

## Configuration

| Key | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the extension; the settings card writes it in place and both halves follow it immediately. |
| `announceToAgent` | `false` | Opt-in: when true, the extension announces itself in agent system prompts. |
| `tokenEnv` | `GITHUB_TOKEN` | Credential reference the token is resolved under: the name it is stored under in the credential store, or the environment variable holding it. |
| `proxyMode` | `auto` | How the Host reaches GitHub: `auto` follows the conventional proxy variables and then the operating system proxy, `custom` pins `proxyUrl`, `direct` never proxies. See [Network proxy](#network-proxy). |
| `proxyUrl` | `''` | Custom proxy URL, read only by the `custom` mode; a missing scheme is filled in as `http://`. |
| `repositories` | `[]` | Repositories to synchronize, each with `owner`, `repository`, `inclusionLabel`, `assignee` (`@me` for this host's account), `includeUnassigned` (whether to also collect issues nobody is assigned), `managedLabelPrefix`, `stateLabels`, `prPhaseLabel`, `pollingIntervalMs`, `prCreationEnabled`, `draftPrPolicy`, `closeIssueOnMerge`, `baseBranch` and `analysisModel` (the `provider/model` the AI issue analysis uses; empty falls back to the card's pinned model, then the host default). |

Every key is volatile, which is what lets the settings card, the setup tools and the profile patch all write it: a saved change reaches the running provider without remounting the row. The card itself renders the credential line, the repository list and the connection test; it reads them from this extension's own host routes, which answer loopback requests only. The read-only summary the running provider publishes (configured repositories and credential presence) still rides the board's own state channel and is what the card falls back to when the host routes are unreachable.

## Network proxy

The Host reaches `api.github.com` through one of three modes. The settings card carries a **Network proxy** block that writes both keys in place, and a profile patch can declare them:

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Reads `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` / `all_proxy` first (`HTTP_PROXY` / `http_proxy` for an `http://` base URL), then the operating system's own proxy (the Windows registry through `reg query`, `scutil --proxy` on macOS), then connects directly. |
| `custom` | Always dials `proxyUrl`. A missing scheme is filled in as `http://`, so `127.0.0.1:7890` is accepted as typed; an empty `proxyUrl` is not a decision, so the mode falls back to `auto`. |
| `direct` | Never proxies, even when a variable or the system proxy names one. |

`NO_PROXY` / `no_proxy` applies to all three modes, down to a per-entry `:port`. Only `http` and `https` proxies are supported: a `socks://` value is refused with a reason and the request goes direct, because this transport is a `CONNECT` tunnel over `node:http` and a SOCKS proxy needs a different handshake. The card reports the proxy a request would actually use and where it came from (`environment`, `system proxy` or `custom`), so `auto` picking up the machine's system proxy is visible rather than assumed.

```yaml
- id: web-ui-task-board-github
  name: '@linxin666/dsh-client-ui-task-board-github'
  config:
    proxyMode: auto    # auto | custom | direct
    proxyUrl: ''       # read only by custom, e.g. http://127.0.0.1:7890
```

Both keys are volatile, so an edit in the card applies to the next request without a restart. The system proxy probe is cached for 30 seconds and any failure reads as "no system proxy": detection can lose the proxy, never the request.

## Migrating from the task board row

Until the migration, the GitHub settings lived on the task board's own row as `githubTokenEnv` and `githubRepositories`. The task board no longer declares them: a profile that still carries them does not fail (the board's schema passes unknown keys through), but the values silently stop having any effect because nothing reads them any more.

Move both keys onto this package's row and rename them:

```yaml
- id: web-ui-task-board-github
  name: '@linxin666/dsh-client-ui-task-board-github'
  config:
    tokenEnv: GITHUB_TOKEN        # was githubTokenEnv on the task board row
    repositories:                  # was githubRepositories on the task board row
      - owner: deepseek-ai
        repository: dsh
        inclusionLabel: dsh
        prCreationEnabled: true
```

The switch defaults (`enabled: true`, `announceToAgent: false`) are the same on both rows.

## Known limitations

- A repository entry must name both `owner` and `repository`; an invalid entry fails the row's activation instead of silently skipping that repository.
- The extension only contributes while the task board is installed and enabled; on its own it configures GitHub access and nothing else.
- Turning the extension off does not delete board cards that were synchronized before, because the board owns its ledger.
- A repository whose poll interval is `0` is synchronized on demand only (a manual refresh, a status change or an execution settlement) and never on a timer.
- **A stalled sync now announces itself.** Every GitHub request is bounded at 30 seconds (`GitHubTimeoutError`), so one request that never returns can no longer wedge an entire pass; the re-entry guard is a timestamp rather than a boolean, so a pass still running after one poll interval is taken over by the next one instead of every later poll returning at its first line. Background failures and the errors a pass collects are written to the host log (`[dsh-task-board-github] ...`) and are **no longer swallowed by `.catch(() => {})`**. The settings card carries a Background sync line: when the last clean pass landed, how long it has been stale, and how many errors the last pass reported; going three poll intervals without a clean pass is marked as stopped.
- **Reaching GitHub through a proxy is configuration, and the transport honours it.** `proxyMode` decides between the environment and system proxy (`auto`, the default), one pinned URL (`custom`, which also accepts a scheme-less `127.0.0.1:7890`), and never proxying (`direct`); `NO_PROXY` / `no_proxy` applies to all three down to a per-entry `:port`, and `https` is tunnelled through a `CONNECT` request. Only `http` and `https` proxies are supported, so a SOCKS-only configuration resolves to a direct connection with a reason naming the scheme. See [Network proxy](#network-proxy). A failure at the transport layer — DNS, TCP, TLS, or a refused tunnel — is retried once with a fresh connection for an idempotent request (`GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`) and then reported as `GitHubTransportError`, which names the endpoint and the transport cause instead of undici's bare `fetch failed`. A `POST` is attempted once only: the connection can die after GitHub accepted the write and before the answer was read, so repeating it would post a comment twice. Node's own `NODE_USE_ENV_PROXY=1` remains an alternative for a deployment that would rather route every host request; the plugin does not require it.
- The listing call takes the FIRST page of `state=all&per_page=100` and never paginates. In a repository with more than 100 issues only the newest 100 take part in the inclusion decision; older ones are seen only when a single-issue read still finds them included.

## Build and test

Node 22.19 or newer and the official NPM SDK packages are required; no DSH source checkout is used.

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board-github typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board-github test
pnpm --filter @linxin666/dsh-client-ui-task-board-github build
```
