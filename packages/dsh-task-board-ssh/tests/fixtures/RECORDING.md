# Recorded agent output fixtures

Every file here except `codex-documented.jsonl` is the verbatim stdout of a real
CLI run on the machine that authored this package, recorded on 2026-11-19 with
the exact command line the adapter builds, so a parser change is checked against
what the agent actually prints rather than against a guess.

The working directory was `/tmp/dsh-verify-task-board-ssh/record` and
`prompt.txt` held `Reply with exactly the single word pong and nothing else.`

```sh
# dsh start
DSH_HOME=/tmp/dsh-verify-task-board-ssh \
  sh -c 'dsh headless --json --permission-mode danger-full-access - < prompt.txt' \
  > dsh-start.jsonl

# dsh resume: session-4c3bb987-8042-4d3f-9085-795188303693 came out of the run above
DSH_HOME=/tmp/dsh-verify-task-board-ssh \
  sh -c 'dsh headless --json --permission-mode danger-full-access \
         --session-id session-4c3bb987-8042-4d3f-9085-795188303693 - < prompt.txt' \
  > dsh-resume.jsonl

# Claude Code start
sh -c 'claude -p --output-format stream-json --verbose \
       --dangerously-skip-permissions < prompt.txt' > claude-start.jsonl

# Claude Code resume: e52e6de8-dfdb-43c2-a455-40c1943c485c came out of the run above
sh -c 'claude -p --output-format stream-json --verbose \
       --dangerously-skip-permissions --resume e52e6de8-dfdb-43c2-a455-40c1943c485c < prompt.txt' \
  > claude-resume.jsonl
```

Two more files record failure paths that were cheaper to provoke than to
simulate:

- `dsh-unknown-preset.jsonl`: `dsh headless --json --permission-mode not-a-preset`.
  Its error event names the three presets every deployment has, which is where
  `DSH_FULL_ACCESS_PRESET` comes from.
- `dsh-account-sign-in.jsonl`: the same start command against a host whose
  DeepSeek account login is not usable for a headless destination. It is the
  shape a real failed run has: a `turn_end` and a `final` whose `reason.kind`
  is `error`.

`codex-documented.jsonl` is the one file that is NOT recorded: Codex is not
installed on this machine. It reproduces the sample event stream published in
OpenAI's non-interactive-mode documentation (`thread.started`, `item.completed`
with an `agent_message` item, and a closing `turn.completed`), which is the
entire basis of the Codex adapter until a host that has Codex runs it.
