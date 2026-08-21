# @linxin666/dsh-chat-recovery

English | [中文](README.zh.md)

Chat recovery for DSH Web: edit the last completed user message and explicitly
retry failed turns. Both actions work through the official session fork contract -
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
  - **Explicit retry by default**: a failed turn shows a Retry button in the
    transcript. One re-run is created per click, so no background retry can
    silently grow the session tree. Tool side effects are replayed only after
    this explicit confirmation.
  - The supervisor still supports opt-in fork-per-attempt automation for
    controlled integrations, but the shipped UI leaves it disabled because
    the current Host API has no in-place turn retry operation.
  - The composer dock shows a status row with the current attempt count,
    wait state and the final failure reason, plus Cancel / Retry-now
    controls. Cancel stops all further attempts.
  - The host's own scheduled llm/retry chain always takes precedence: while
    it is retrying, this plugin stands down.
  - The dock and the Retry button show a visible hint that retrying forks a
    new session branch: the original session stays untouched, and failed
    forks remain in the session list. One failed turn forks at most one
    child: later attempts of the same retry chain continue inside it.

## Safety model

- **No duplicate user messages in the source**: the first attempt forks a
  child from the prefix BEFORE the failed turn; later attempts of the same
  chain continue in that child (one replay per attempt, visible as retry
  history). The source session never accumulates the same message twice, and
  the failed turn's stream fragments never enter the source's next request.
- **Original sessions stay untouched**: edit and retry only create child
  sessions. A fork or resubmit failure leaves the source session exactly as
  it was.
- **Failed forks stay in the list**: a failed turn leaves one retry child,
  and abandoned attempts (cancelled, exhausted or failed) are kept for
  inspection. The client runtime exposes no session-removal API, so stale
  retry forks must be cleaned up manually from the session list.
- **No background session growth by default**: the shipped UI never starts
  fork-per-attempt automation. Each Retry click creates exactly one branch;
  tool side effects replay only on explicit user action.
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

## Config

The shipped UI keeps fork-per-attempt automatic retry disabled. Retry is an explicit transcript action and needs no configuration; controlled integrations that construct `RetrySupervisor` directly may opt in with `{ autoRetry: true }` while accepting visible child sessions for every attempt.

## Known limitations

- The Edit / Retry affordances render in each completed turn's tail row; the
  slot system's chain selector cannot read the conversation snapshot, so the
  entry matches every completed turn and gates internally.
- Editing only covers text-only user messages; attachment messages are not
  editable because they cannot be safely copied into a re-submitted prompt.
- The Host API does not provide an in-place turn retry operation. Retry must
  therefore create a branch, which remains visible in the session list.

## License

BSD-3-Clause.
