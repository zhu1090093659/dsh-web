# Agent Note: Task-board goal acceptance

Status: implemented

## Problem

A task-board execution runs an autonomous goal: the runner arms `/goal`, the
goal-round driver keeps starting continuation rounds, and the card settles when
the goal leaves its active phase. Nothing in that loop certifies the WORK. The
only party that decided the objective was achieved was the agent itself, and the
board's own settlement read that self-report: a session that narrated success and
called `update_goal(action: complete)` settled the card as done.

The requested control is an evaluator-backed gate with a narrow, explicit
budget: before `update_goal(action: complete)` may take effect, the board
judges the run's real evidence; the first failure returns findings to the fixing
agent, the second failure ends that execution. The rule to judge with is the
default final acceptance of the installed `dsh-llm-verifier` (0.8.4, MIT), and
the configuration must be frozen per execution so a later settings edit cannot
change the verdict rule of a run already in flight.

## Decision

The board owns the acceptance mechanism end to end, and it reuses the
verifier's default acceptance ALGORITHM rather than the verifier.

- **Gate.** The listener sits on the official tool pre-execution lifecycle
  (`ctx.on('tools/pre-execute')`) and acts on exactly `update_goal` with
  `action: 'complete'`. The session the call arrives from is resolved to the
  board's open execution through `HostExecutionLedger.findOpenExecutionBySession`;
  a pass record for that execution allows the call, a refusal returns the
  feedback and the call never reaches the goal service. The agent is never asked
  to verify itself, and no prompt wording can route around the gate.
- **Algorithm.** `src/core/verification.ts` mirrors the verifier's default
  final acceptance byte-for-byte where the judge prompt depends on it: the three
  coding criteria of `DEFAULT_CRITERIA` (Specification Adherence, Output
  Match, Error Signal Detection), the 20-letter A-T scale and its
  `<score_A>`/`<score_B>` tag contract, the untrusted-evidence framing,
  `EMPTY_WORK_BASELINE` as candidate B, two rounds per criterion with the A/B
  slots swapped on the odd round, per-round scores mapped back to the
  comparison's slots and averaged per criterion, and the pass rule
  `score > baseline && score >= 0.65 && every criterion >= 0.65`
  (`sessionAccepted`). Scoring uses the explicit-tag channel because the
  official DSH adapters expose no token logprobs: the logprob channel the
  verifier prefers needs a capability the public SDK does not carry, so this
  deployment's supported channel is the tag fallback and the recorded channel
  says so.
- **Dispatch.** Every one-shot judge request goes through
  `src/host/llm-dispatch.ts`, which opens the stream with
  `prepareCall(config).stream(request)` — the registration-bound entry point
  the official agent loop itself uses — and falls back to the public
  `llm.stream(options)` only when the runtime exposes no `prepareCall`. The
  public method is an ordinary mutable instance property: a third-party provider
  plugin that replaced it with its `llm/stream` listener signature
  `(options, next)` made every acceptance raise
  `TypeError: next(...) is not a function or its return value is not async
  iterable`, which the runner recorded as a request anomaly after its two
  retries. A plugin registering on `llm/stream` is still invoked through the
  prepared dispatch; the board simply no longer depends on a property a plugin
  may legitimately replace.
- **Evidence.** The judge sees the execution's composed objective and the
  session's own event log windowed from the execution's `startedAt` — tool
  calls with their arguments, tool results (including their error flags),
  assistant prose, goal round markers and team messages — redacted with the
  verifier's patterns, capped per entry and in total, with the newest text kept
  and the truncation reported. Nothing reads the board's own bookkeeping as
  proof of work, and a reused session contributes only events after its own
  execution started. When the deployment records workspace changes, the HOST's
  own record of what the run changed on disk — the file list with its
  added/deleted counts and a bounded per-file comparison — is rendered as the
  prompt's reference-context block and folded into its delimiter token, so a
  patch the agent only described, or a file edited again afterwards, cannot pass
  as an applied edit; a deployment that serves no change service, or a failed
  read of one, degrades to the trajectory alone instead of failing the
  acceptance.
- **Budget.** Two quality acceptances per EXECUTION, recorded on the execution
  record (`ExecutionRecord.verification`, ledger schema v5). The key is the
  execution, not the goal id: an agent cannot mint a new goal to reset the
  budget, and a repeated completion call, a new goal round, a plugin reload and
  a Host restart all reuse the same cycle. A rerun or a scheduled occurrence is
  a new execution with its own budget. Anomalies and time-budget stops are
  bounded separately and clear no quality budget (see below).
- **Anomalies.** A timeout, an authentication failure, an unparseable judge
  answer and an unresolvable judge route are recorded as `exception` attempts
  separately from quality verdicts, never consume the quality budget, are
  bounded, and never pass silently.
- **An anomaly never judges the work (issue #1828).** Reaching
  `MAX_EXCEPTION_ATTEMPTS` does NOT finalize the cycle as failed and does NOT
  block the goal: an unusable judge route is a property of the environment, and
  a card must not be failed for it. The gate HOLDS the cycle open and spends no
  further judge call until the recorded anomalies are cleared. That hold is what
  keeps the bound real — one cycle can spend at most this many judge rounds, and
  clearing them is a human decision.
- **Reset.** `task_board_manage(action: reset-verification)` (ledger action
  `reset-verification`) is the explicit reset: it drops every attempt that is NOT
  a quality verdict — `exception` attempts and `budget` stops alike — and nothing
  else. A quality verdict is the board's own judgement of the work and survives
  every reset, so the reset can never buy an extra acceptance or re-open a
  judged failure; it only lets the environment be judged again. It addresses the
  card's open execution (the run that still needs to complete) and is refused
  with the actual obstacle when there is no open execution, no acceptance block,
  or nothing left to clear. It is deliberately NOT folded into the quality
  budget: a budget reset would let an agent buy an extra acceptance by asking.
- **Time budget (issue #1828).** Two row settings, `goalVerificationCallTimeoutSeconds`
  (30..600, default 150) and `goalVerificationBudgetSeconds` (120..1800,
  default 1200), normalized in `src/core/verification-budget.ts` beside the
  existing `core/poll-cadence.ts` precedent and read LIVE, not frozen into the
  contract: raising a ceiling must unblock a card without a plugin reload. The
  total default is derived from the per-call default times the six judge calls
  one acceptance needs plus two retries, because a total budget smaller than
  six per-call ceilings guarantees that no acceptance can ever finish. Every
  judge call is admitted against the deadline first: a call whose own ceiling
  no longer fits in the time left is refused before it is opened, so a slow route
  cannot spend the whole budget on calls the outer abort will kill anyway. An
  outer abort produced by the budget expiring is classified `budget`, not
  `aborted`, and recorded as a third attempt stage (`budget`) that is charged to
  NO budget at all — it is neither a verdict nor an environment anomaly — so it
  cannot consume either allowance or close the card. Per-call timeouts stay
  `timeout` anomalies; only the outer deadline is a budget stop.
- **Judge recovery.** Terminal events use the SDK `FinishReason.kind` object, including structured errors and cancellation; a failed or truncated stream never supplies a quality verdict, even if it contains score tags. Each criterion request has at most three attempts. Initial requests and retries use a fixed output cap of 16384 tokens without changing the frozen reasoning effort; empty, truncated, or malformed answers retry within that same cap. Authentication and cancellation stop immediately, while transient request failures retain bounded retries. Usage includes every billed attempt and propagates incomplete accounting. This handles reasoning models consuming the initial cap before visible scores without weakening the rubric or resetting the execution budget.
- **Freeze.** `HostExecutionRunner.launch` reports when `/goal` was armed, and
  the service freezes the contract BEFORE the prompt is queued: the judge route
  resolved from the live settings against the host model catalog default
  (`session/modelCatalog`; "inherit host" never means the card's pinned
  execution model), the applicability of this run (`enforced`,
  `goal-unavailable`, `disabled`, `team-member`), and the threshold. An
  explicitly configured reasoning level is sent only when the resolved model's
  adapter declares it; otherwise the incompatible value is dropped, the model's
  own default level is used, and the fallback is recorded and shown.
- **Settlement.** A settled `succeeded` requires a matching pass record
  whenever applicability is `enforced`. The old fallback paths therefore stop
  being able to pass a goal execution: a completed turn, a paused goal, an
  unreadable projection and a manual settle all fail without a pass record, a
  cycle the gate already closed settles from its recorded reason without waiting
  for another inspection, and a run that never became a goal run or is a team
  member is explicitly NOT enforced rather than implied to be verified.
- **A gate that never opened is not a quality verdict (issue #1837).** The
  settlement rule separates "the judge ran and the work did not pass" from "the
  judge never ran once": `core/verification.ts` exposes
  `verificationNeverInvoked` (enforced, zero recorded attempts, no closed cycle)
  and the Host settles that case with its own `NEVER_INVOKED_VERIFICATION_REASON`,
  naming the missing `update_goal(action: complete)` call and stating that nothing
  was judged, while any recorded attempt — quality, anomaly or budget stop —
  keeps `NO_MATCHING_PASS_VERIFICATION_REASON`. A session that narrates
  completion in prose can burn a hundred continuation rounds before the run is
  aborted, and that failure has a different owner (tool adherence, or the
  harness's own goal-round driver) than a rejected delivery, so the card's
  terminal reason must not send the reader to the wrong one. No column, status
  or UI enum is added: the distinction lives in the Host reason and in the pure
  predicate that reads the persisted block.
- **Team runs.** Acceptance applies to the Lead execution, whose session
  evidence is the team summary; a teammate execution is recorded as a
  `team-member` and is not independently accepted.
- **Per-card opt-out.** `TaskRecord.skipVerification` opts ONE card out of the
  gate. Absent means inherit: the execution resolves the same contract it always
  did from the board-wide `goalVerification` switch, so a card that never
  touched the option is unchanged. An explicit `true` resolves the contract from
  an OFF switch instead, and the execution is recorded as a distinct
  `applicability: 'skipped'` rather than reusing `disabled`: the report must be
  able to say WHICH of the two turned the gate off, and a report that renders
  nothing at all would let a user read "the board switch is off" into a card
  they themselves opted out. Only the explicit `true` is persisted (mirroring
  `goalRun`, which persists only its explicit `false`), the option appears in
  the new-task form and the task detail beside the other card-level execution
  switches, and it is exposed on `task_board_create` / `task_board_update`
  like every other card option. It is an execution-time decision, not a
  per-run one: the contract is frozen at launch, so flipping the checkbox
  never rewrites the rule judging a run already open, and a rerun or a
  scheduled occurrence reads the card's current value.
  `ExecutionVerification.applicability` therefore carries five values, and the
  field-level normalizer accepts the new one; a record written by an older
  build still parses, and a block naming an unknown value is still dropped
  (fail closed, as before).
- **Interface.** The settings card gains a task-acceptance section (switch on by
  default, judge model, reasoning level, and the resolved configuration), the
  running column shows executing / verifying / fixing, and each execution row
  carries its own report bound to that execution. `GET
  /api/task-board/verification` serves the resolved options and the host model
  catalog behind the board's usual loopback / authenticated-proxy guard.

## Alternatives considered

- **Import `dsh-llm-verifier/core` and call its exported primitives.** The
  plugin's exports carry `VerifierEngine`, `DEFAULT_CRITERIA`,
  `EMPTY_WORK_BASELINE` and `sessionAccepted`, but not its session
  acceptance (that is a closure inside `apply`) and not its evidence
  extractor, so a host half would still write the gate, the evidence and the
  budget. Against it: this repository's package rule keeps host halves on the
  official `@deepseek-ai/*` SDK, the plugin is not a dependency of this
  repository, and an installed third-party cell path may differ per profile. The
  algorithm is therefore mirrored, and the note records the basis (0.8.4, MIT,
  identical constants) instead of a runtime coupling.
- **Gate at `agent/turn-stopping`.** That is where the third-party verifier
  runs, but it observes a turn that already happened and can only steer
  afterwards; it cannot refuse `update_goal` before the goal service commits.
  The requirement is a gate on the completion call, so the tool lifecycle is the
  only correct seam.
- **Steer feedback instead of denying the call.** Rejected: the agent would still
  be able to mark the goal complete, and the requirement is that a completion
  claim cannot take effect without a pass record.
- **Block the goal as the only stop.** `ctx.goals.block` is used best-effort to
  stop a spent cycle from burning more rounds, but it is not the authority: a
  deployment that serves no goal service (or whose block is refused) would leave
  the execution pending forever. The recorded `failedReason`, consumed by the
  settlement guard, is what actually ends the execution.
- **Key the budget on the goal id.** An agent that creates a new goal would
  receive a fresh allowance, which is exactly the bypass the requirement names.
- **Ask the judge whether the task is "complete".** Rejected by the requirement:
  the verdict uses the A-T scale and the per-criterion threshold rule, not a
  yes/no question.
- **Automatic rubric selection.** Deferred: the first version judges with the
  coding criteria only, and the settings copy says the section is aimed at
  engineering tasks.
- **Reuse `disabled` for the card opt-out instead of adding an applicability
  value.** Rejected: `disabled` already means "the board switch was off at
  start", and the report renders nothing for it. Collapsing the two would make
  a self-service opt-out indistinguishable from a deployment that is not
  running the gate at all, which is the opposite of what a reader needs.
- **A tri-state card option (default / forced / skipped) that overrides the
  board switch.** Rejected as more surface than the requirement asks: the
  board switch is the deployment-wide policy and a card can only decline to
  take part in it, never to re-arm a gate the user turned off. A card that
  wants the gate on while the switch is off is answered by turning the switch
  on.
- **An agent-facing tool to request acceptance instead of a card option.**
  Rejected on the same grounds the option itself is allowed: the point of the
  opt-out is that a PERSON decided this card is not worth six judge requests
  per attempt, so it is a card field a person ticks, not a model parameter.
- **A new `data-dsh-part` value for the report.** The part enum is owned by
  the cross-repository semantic-attribute contract, so the report reuses the
  execution row's existing markup instead of extending that enum.

## Consequences

- A run that never calls `update_goal(action: complete)` still burns
  continuation rounds until the harness's goal-round cap or a manual abort, and
  the board cannot shorten that loop: the driver lives in the official harness,
  not in this package. What the board does own is the terminal reason, and it now
  says the gate never opened instead of implying the judge rejected the work.
- A card whose acceptance environment is unusable is now stuck open rather than
  failed: the agent's completion claim is refused with an explanation naming the
  reset action, the report shows the anomalies, and the run ends only when the
  user settles it (`settle`) or restarts it. That is the intended trade — a
  clock-produced verdict is worse than an honest stuck card — but it does mean a
  user must clear the anomalies (or rerun) rather than read a failure.
- Forced acceptance is a cost decision as much as a quality one: one acceptance
  is three criteria times two rounds (six judge requests) and one execution may
  accept twice, so a goal cycle that needs its one repair spends up to twelve
  extra requests. The switch is on by default, and the settings copy and the
  README say so.
- A deployment that serves no model catalog cannot resolve a judge route: with
  acceptance on, a completion claim is refused and recorded as an anomaly rather
  than passing silently. This is the fail-closed choice, and the anomaly is
  bounded so it cannot loop.
- The installed third-party verifier keeps its own automatic acceptance (its
  `autoVerifyMode` default is `smart`). Both judges then score the same
  session independently: this board's acceptance gates completion and the other
  only steers, and no public SDK interface lets the two share a verdict. The
  only reliable way to avoid paying twice is to disable the other plugin's
  automatic mode; the README states this as a known limitation instead of
  pretending the two are mutually exclusive.
- The ledger schema moves to v5. The migration is additive and deliberately does
  NOT stamp a contract onto an execution that was already open, so no in-flight
  run is retroactively judged. A malformed block is dropped (fail closed), and
  the import path strips it so a fabricated pass record cannot make imported work
  look accepted.
- Acceptance is not a session-level property: it belongs to one execution, so
  history, reruns and scheduled occurrences each carry their own report, and the
  per-execution contract is the reason a settings edit mid-run changes nothing
  for the run already going.
- The gate deliberately does not touch plain chat, a task pinned to
  `goalRun: false`, or a run whose `/goal` was refused: those are not goal
  executions, and their records say which case applies.
- A card that opted out is a COST decision the user makes per card, and it is
  recorded as such: `skipVerification` travels through the legacy import the
  way `goalRun` does (a user restoring their own board keeps their per-card
  execution preferences), while the per-execution `verification` block is
  still stripped on import, so no imported card can arrive already accepted.
  The ledger stays at v5: an optional card field absent from every existing
  row is exactly the additive change the v5 migration already describes, and
  bumping the version for it would make every deployment migrate a document
  whose shape did not change.

## Testing

- `tests/goal-verification-gate.spec.ts` (27 scenarios): pass on the first
  acceptance, fail-then-repair, second-failure closure with a frozen budget, a
  concurrent completion pair sharing one acceptance, a fresh budget on a rerun,
  the budget surviving a Host restart, an unparseable answer and a thrown judge
  route as anomalies with separate bounds, goal-unavailable and team-member runs
  left ungated, a frozen contract judging a run whose live settings changed,
  the two swapped rounds and their averaged criterion, session-reuse evidence
  isolation, effort fallback, an unresolvable route, a cancelled call, a settled
  execution, a malformed stored block, the host's workspace-change evidence
  reaching the judge, that evidence degrading when a comparison read fails, a
  trajectory-only prompt when the deployment records no changes, the
  reference-context block appearing only when there is host evidence, an
  acceptance that still reaches a verdict when a third-party plugin replaced the
  public `llm.stream` with its waterfall-listener signature, and the public
  method kept as the fallback for a runtime that exposes no `prepareCall`.
  Issue #1828 adds: the anomaly budget HELD open instead of finalizing the card
  (no `failedReason`, no goal block, and a third call refused without another
  judge call), the explicit reset clearing the counter and letting a repaired
  route produce a real pass, the reset refused on an execution that only holds a
  quality verdict, a budget stop that opens no judge call and spends no budget,
  and the configured per-call ceiling ending the acceptance as a bounded anomaly.
- `tests/goal-verification-service.spec.ts` (23 scenarios): the contract
  frozen and bound before the prompt, the switch off, `goalRun: false`, a
  refused `/goal`, an explicit route with an unsupported level, a scheduled
  run, the resolved options route, and the settlement rules (completed goal
  without a pass fails, paused goal fails, unreadable projection fails, a pass
  record settles done, a closed cycle settles without another inspection, a
  plain-turn run settles historically, a pre-feature execution is not
  retroactively enforced, the switch only affects later executions, and session
  reuse carries a new execution's own contract), plus the per-card opt-out: a
  checked card freezing an off contract with its own `skipped` reason, an
  unchecked card still enforced, and a skipped execution settling on the
  historical verdict. Issue #1837 adds: a completed goal with zero recorded
  attempts settling with `NEVER_INVOKED_VERIFICATION_REASON`, a failed quality
  verdict and an anomaly-only cycle each settling with
  `NO_MATCHING_PASS_VERIFICATION_REASON` instead, and the two reasons proven to
  name opposite investigation directions.
- `tests/verification-core.spec.ts` (7 scenarios): the pure predicates over a
  persisted block — an enforced execution with no attempts is both required to
  pass and never invoked, while a quality verdict, an anomaly, a budget stop, a
  recorded closed cycle, the four ungated applicability values and a missing
  block are not.
- `tests/verification-runner.spec.ts`: the two budget boundaries at the runner
  itself — an acceptance whose remaining time cannot hold a single judge call
  opens none and records the `budget` stage, while a live budget with a shorter
  configured per-call ceiling charges a `timeout` anomaly that names the
  configured ceiling rather than the outer budget.
- `tests/goal-verification-view.spec.tsx`: a skipped execution renders a report
  that says the CARD skipped acceptance and never claims a pass, while an
  execution whose switch was off still renders nothing at all.
- `tests/host-ledger.spec.ts` and `tests/agent-tools.spec.ts` cover the reset
  action itself: the counter cleared with every recorded verdict preserved, the
  second reset refused because nothing is left to clear, and both refusals that
  name the real obstacle (no open execution, no acceptance gate) — once at the
  ledger and once through the model-facing tool.
- `tests/protocol.spec.ts` and the task-record round trips cover the field
  itself: only an explicit `true` is stored, a hand-edited `false` normalizes
  back to inheriting, the action gate accepts it on create and update, and the
  legacy import carries it while still stripping the acceptance block.
