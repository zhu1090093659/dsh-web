# Agent Note: Task board execution content snapshots

Status: implemented

This partially supersedes the permanent content-freeze premise in [Task board execution summaries](2026-10-18-task-board-execution-summary.md). Execution summaries and the refusal to write run output back into the description are unchanged.

## Problem

A card with any execution history could not change its title, description or prompt. Adjusting a recurring instruction therefore required duplicating the card, reattaching its schedule and workspace, and losing continuity with its execution history. The freeze existed because the card's live text was also the only record of what had been sent to an agent.

## Decision

- `startExecution` captures `promptSnapshot` and `titleSnapshot` on the execution record it opens. The fields are optional, add no ledger schema version, survive ledger loading and import, and are never synthesized for a legacy record that lacks them.
- `canEditTaskContent` allows title, description and prompt edits only on an unarchived card with no open execution. `canEditTaskAttachments` remains the separate, stricter gate: attachments freeze at the first execution because no per-run attachment snapshot exists.
- The Host update action applies those two gates independently. The settled-card edit dialog disables only the attachment field, and the detail footer keeps its three-action layout; the tag shortcut and duplicate action stay in the header menu.
- The execution record, rather than the card's current text, owns the opening prompt and title. A description is card-level working text, not a per-run audit credential.

## Alternatives considered

**Keep executed cards permanently read-only.** Rejected: per-run snapshots preserve the audit property without forcing a new task identity for every prompt adjustment.

**Unlock attachments together with text.** Rejected: execution records do not capture attachment bytes or a separate attachment snapshot, so post-run replacement would destroy the existing audit boundary.

**Backfill snapshots on legacy records from the card's current text.** Rejected: that would invent evidence for a run whose opening content is unknown. Absence is the honest compatible representation.

## Consequences

Settled cards can be edited without losing their identity, schedule or history. Running and archived cards remain read-only, and attachment changes still require a duplicate card. Ledger size grows by the opening prompt and title on each retained execution, bounded by the existing execution-retention limit.

## Testing

The task-board suites pin opening snapshots, independence from later edits, ledger and import round-trips, legacy absence without backfill, malformed snapshot rejection, settled versus running editability, the separate attachment gate, and the footer/header action layout. The package typecheck, full test suite and i18n parity check cover the shipped behavior. The remaining live-GUI pass was not part of this delivery.
