# Agent Note: freeze-request parser with redaction and taint gate

Status: implemented

## Problem

Continuation cards need a trustworthy bridge from free-text agent output to structured context snapshots (goal / progress / next). ADR 0001's adversarial review named the security precondition: frozen text can carry tokens, private keys, or slash-prefixed DSH command lines, and unbounded fields invite ledger bloat and injection surfaces. Parsing must be verifiable without a live LLM, session, network, or filesystem.

## Decision

`packages/dsh-task-board/src/core/freeze-snapshot.ts` is a pure-function module (issue #3). `parseFreezeRequest` extracts the system-prompt-agreed `<<<FREEZE ... >>>FREEZE` block with required `目标:` / `进度:` / `下一步:` sections (duplicates and missing sections are structural errors), then applies a three-part gate before returning the snapshot:

- **Redaction**: PEM private key blocks, Bearer credentials, and common token shapes (OpenAI `sk-`, GitHub `ghp_`, GitLab `glpat-`, Slack `xox*`, AWS `AKIA`) collapse to `[REDACTED]`; any hit sets the `redacted` warning. Redaction is lossy by design and never blocks the freeze.
- **Taint**: any line whose first non-blank character is `/` in any field rejects the whole request (`dsh-command-line`), per ADR 0001's rule that frozen text must not carry DSH command lines. Slashes elsewhere (paths like `a/b/c`) stay allowed.
- **Size**: each field is capped at 8 KiB measured in UTF-8 bytes (`field-too-large`); the limit constant is exported as `FREEZE_FIELD_BYTE_LIMIT`.

Every failure returns a discriminated `{ ok: false, error: { code, message } }`; successes carry `{ snapshot, warnings }`. Helper gates (`redactSensitive`, `hasSlashCommandLines`) are exported for the later Host freeze-write path.

## Alternatives considered

- **LLM-assisted extraction with regex pre-filter** — rejected: issue #3 requires full testability without a live LLM; a deterministic parser is exhaustively testable and has no hidden failure modes.
- **Sanitizing slash lines instead of rejecting** — rejected: ADR 0001 states frozen text must not carry `/`-prefixed DSH commands; silent stripping would let a tainted freeze look clean.
- **Whole-request size cap instead of per-field** — rejected: one 20 KiB field with two empty ones would pass a whole-request cap while bloating a single snapshot field; per-field limits bound the worst case each card can carry.

## Consequences

- The parser module touches no session, network, or filesystem API; its spec (`tests/freeze-snapshot.spec.ts`, 19 tests) runs anywhere vitest does.
- The exact wire format (block markers, Chinese section headers) is now a system-prompt contract; changing it later is a breaking change for in-flight sessions and needs a version marker when the freeze-write path lands.
- Sensitive-pattern coverage is a deny-by-list, not a guarantee: novel secret shapes pass through. The `redacted` warning exists so downstream reviewers can flag suspicious freezes; broadening the pattern list is additive.
- Trailing blank lines of each section are trimmed; interior blanks and indentation are preserved verbatim.

## Testing

`pnpm --filter @linxin666/dsh-client-ui-task-board test` 19 tests covering parse happy paths, structural errors, each redaction family, slash-command rejection per field (including leading-whitespace slash lines and prototype-named body lines), and byte-limit boundaries (exactly-at-limit passes, 8193-byte CJK field fails). The spec is pure-function only, per the issue's acceptance criteria.
