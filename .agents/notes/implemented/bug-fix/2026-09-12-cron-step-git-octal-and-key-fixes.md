# Agent Note: Cron Bare Steps, Git Octal Path Escapes, and Handover Row Keys

Status: implemented

## Problem

Three reader-reported defects, all in code paths that a test could have pinned but none did:

1. `dsh-task-board`'s `parseField` treated a bare cron value carrying a step as a single value: for
   `5/15` it set `low = high = 5`, so the step loop produced only `5`. Standard cron reads that as
   "from 5 to the field maximum, stepping 15" (5, 20, 35, 50), so a schedule written that way silently
   ran once an hour instead of four times, with no error (#1493).
2. `dsh-git-graph`'s `extractBlockedPaths` unescaped git's quoted paths with `replace(/\\(.)/g, '$1')`,
   one character per escape. Git's default `core.quotePath` writes each non-ASCII **byte** as an octal
   escape, so `ämne.txt` arrives as `"\303\244mne.txt"` and the per-character pass turned the two
   escapes into `303244` — mangled filenames in the overwrite-conflict list (#1491).
3. `dsh-task-board`'s task detail keyed each handover reference row by the reference string itself, so a
   repeated reference produced duplicate React keys and a console warning (#1492).

## Decision

1. A bare value with a step now spans to the field maximum (`high = stepRaw === undefined ? low : max`).
   A bare value without a step, the `*/step` form, ranges and lists keep their previous meaning, and the
   existing `low < min || high > max || low > high` guard still rejects out-of-range fields.
2. `extractBlockedPaths` decodes through a new `decodeGitQuoted`: octal runs become bytes, the C-style
   escapes (`\a \b \f \n \r \t \v`) become their control bytes, any other escaped character stays
   literal, and the collected bytes are decoded as UTF-8 through `TextEncoder`/`TextDecoder`. The issue's
   suggested `String.fromCharCode(parseInt(oct, 8))` was **not** used: it maps each byte to a Latin-1 code
   point, so `\303\244` would come back as `Ã¤` — still mojibake, just differently shaped.
3. Handover reference rows key on `${reference}-${index}`, which keeps every row stable without dropping
   or reordering duplicates.

## Verification

- `pnpm --filter @linxin666/dsh-client-ui-git-graph test`: 10 files, 147 tests passed (two new: octal
  UTF-8 decoding, plain escapes).
- `pnpm --filter @linxin666/dsh-client-ui-task-board test`: 36 files passed, 339 tests passed, 1 skipped
  (two new: `5/15` -> {5,20,35,50} with `2/6` -> {2,8,14,20}, `*/15` and `1-30/5` unchanged; duplicate
  references render two rows with no `same key` console error).
- Both packages' `typecheck` scripts pass.

## Alternatives considered

Running git with `-c core.quotePath=false` was rejected: it changes the output contract of every git
invocation for one display path, and quoted output can still arrive from other commands.

Decoding with `Buffer.from(bytes)` was rejected: `src/core/` compiles into both the host and the browser
program, and `Buffer` is Node-only, while `TextEncoder`/`TextDecoder` are available in both.

Deduplicating the reference list instead of keying it was rejected: it would silently change the content
the user wrote into the freeze block.

## Consequences

A cron expression such as `5/15` now fires four times an hour where it previously fired once — a real
behavior change for anyone who wrote it, and the intended reading of the syntax. Non-ASCII paths in the
overwrite-conflict notice display correctly. The git path decoder is now byte-oriented, so a future
`core.quotePath` quirk has one place to extend.
