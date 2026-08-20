# @linxin666/dsh-chat-recovery

English | [中文](README.zh.md)

Chat recovery for DSH Web: edit the last completed user message and supervise
turn retries. Both actions work through the official session fork contract -
a child branch is cut from the history prefix BEFORE the affected message, the
text is re-submitted there, and the original conversation is never touched.

## What it does

- **Edit message** (Codex-style): an Edit button on the last completed turn.
  Clicking it opens an inline editor prefilled with the original text; Save
  forks a child from before that message, opens it and resends the edited
  text; Cancel restores the transcript. The original session keeps its full
  history either way.
  - Only the LAST user message of a completed turn is editable. Running
    sessions, system/plugin-injected messages, and messages containing
    attachments are never editable.
  - First-turn edits fall back to a fresh blank session in the same
    workspace (a fork cannot cut history before the very first turn).
- **Retry**:
  - **Auto retry**: a failed turn whose last attempt is cleanly replayable
    (recoverable model/API error - timeout, network, server error, rate
    limit, empty response - and no tool activity) is retried up to 5 extra
    times with exponential backoff (1s, 2s, 4s, 8s, 16s). A crashed
    (host-errored) interrupted turn without tools is also retried; a turn the
    user stopped on purpose is not.
  - **Manual retry**: every other failed turn (non-recoverable errors,
    tool-involved turns, user stops, max-token caps) shows a Retry button in
    the transcript. One re-run per click - the user confirms the side
    effects of replaying tools.
  - The composer dock shows a status row with the current attempt count,
    wait state and the final failure reason, plus Cancel / Retry-now
    controls. Cancel stops all further attempts.
  - The host's own scheduled llm/retry chain always takes precedence: while
    it is retrying, this plugin stands down.

## Safety model

- **No duplicate user messages**: every retry attempt forks a fresh child
  from the prefix BEFORE the failed turn and prompts the original text once.
  No session ever accumulates the same message twice, and the failed turn's
  stream fragments never enter the next model request.
- **Original sessions stay untouched**: edit and retry only create child
  sessions. A fork or resubmit failure leaves the source session exactly as
  it was.
- **Conservative auto retry**: auth failures, permission errors, invalid
  arguments, quotas, cancellations and any turn that ran tools or commands
  are never auto-retried. Tool side effects replay only on explicit user
  action.
- **Browser-side supervision**: retry state lives in the GUI tab. Closing
  the tab cancels supervision; the failed turn and its history remain
  durable on the host.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-chat-recovery
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-chat-recovery
```

Restart dsh web; the Edit affordance appears on the last completed turn
and the retry status row on the composer dock.

## Known limitations

- The Edit / Retry affordances render in each completed turn's tail row; the
  slot system's chain selector cannot read the conversation snapshot, so the
  entry matches every completed turn and gates internally.
- Editing only covers text-only user messages; attachment messages are not
  editable because they cannot be safely copied into a re-submitted prompt.
- Auto retry requires the GUI tab to stay open (browser-side scheduling,
  like the task board's cron). Reopening the session after a failure shows
  the manual Retry button instead.

## License

BSD-3-Clause.
