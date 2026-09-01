# Agent Note: describe-image reference transcription repair and registry fallback

Status: implemented

## Problem

A text-only model calling `describe_image` transcribes a long percent-encoded attachment reference from a session message into the tool arguments. The transcription is not byte-exact: it can insert or drop a stray structural character at a boundary, and in the worst case it rebuilds the reference wholesale. Both failure shapes caused `describe-image` to fail closed with `image is not a valid attachment reference` even though the image had uploaded correctly — the path id was intact and its sha256 content-addressed bytes were present in the attachment store.

Two real shapes were observed in a session trace:

- A corrupted JSON ref: the closing brace gained an extra colon (`"name":"image.png":}`), which is valid percent-decoding but invalid JSON, so `parseImageAttachmentRef` threw.
- A rebuilt ref: the model replaced the whole JSON with a comma-separated token string (`sha256:...,s,1367,931,image`), which `parseImageAttachmentRef` cannot narrow.

## Decision

`dsh-tool-describe-image` now tolerates a single-transcription-glitch shape without weakening validation, and degrades to the path-id registry only when a reference is genuinely unrecoverable:

- `parseImageAttachmentRef` (`src/attachment-reference.ts`) retries a strict `JSON.parse` failure through `repairImageRefJson`, which removes only unambiguous structural noise — a stray colon before a closing brace/bracket, a doubled comma, a trailing comma before a closing brace, and a colon directly before a comma. Every candidate is re-validated with `JSON.parse` and then passes the same full field validation (non-empty attachmentId, image media type, positive safe-integer bytes/width/height) as before, so a malformed shape never slips through as "repaired". Inputs that no rule repairs still throw `ATTACHMENT_REF_GUIDANCE`.
- `parseMarkdownAttachmentReference` no longer throws when the embedded ref fails strict+repaired parsing, or when the ref attachmentId disagrees with the authoritative path id. It returns the legacy `{ attachmentId }` shape so `vision-client.ts` resolve `ref ?? attachmentRefById(id)` against the registry.
- `serveRawImage` (`src/attach-routes.ts`) no longer answers 404 immediately when the serialized ref fails parsing or disagrees with the path id; it falls through to `ref ??= attachmentRefById(id)`. The path id is treated as authoritative — the registry is keyed by the same content-addressed id, so a stale or corrupted ref still resolves the correct image when it was recently uploaded.

The `decodeURIComponent` failure path (which yields no usable id) and the empty-id path remain hard failures: there is nothing safe to fall back to.

## Alternatives considered

- **Keep fail-closed and surface guidance.** This was the previous behavior and the observed failure mode. It is safe but hostile to the real problem: the model cannot reliably re-transcribe a 350-character encoded reference, so retry alone frequently fails again.
- **Always fall back to the path id registry, dropping ref metadata.** Correct in the rebuilt-ref case, but it discards the durable metadata that lets the tool work after a host restart when the short-lived registry has evicted the id. Repairing the JSON keeps that durability for the far more common one-character glitch.
- **Machine-transcribe the reference rather than trust the model.** Out of scope; the plugin has no channel to see the original session text at call time.

## Consequences

- A model that inserts or drops a single boundary character now gets the image successfully instead of a hard error; the `[image attachment ...]` and `ref=` durability guarantees are preserved for the repaired path.
- A wholesale-rebuilt ref now succeeds only while the id is in the process registry (bounded FIFO, capacity 128) and still fails closed otherwise. This is the honest ceiling: no durable metadata survives a rebuild, and a path id alone cannot be re-metadata without the store.
- Validation strictness is unchanged for genuinely malformed or adversarial input: every repaired candidate must satisfy the same field checks, and inputs no rule repairs still throw.
- The change is confined to three functions in one package; no DSH source, config, or mount points are touched.

## Testing

Verified against the upstream `src/` sources directly (Node 26 `--experimental-strip-types`, no private-cohort tarballs needed):

- `parseImageAttachmentRef`: valid round-trip unchanged; stray-colon, doubled-comma, and trailing-comma shapes repaired to the identical ref; unrepairable garbage and non-object JSON still throw `ATTACHMENT_REF_GUIDANCE`.
- `parseMarkdownAttachmentReference`: valid Markdown returns the full ref; corrupted-Markdown repairs to the full ref; path-id mismatch and legacy no-ref both return `{ attachmentId }` without throwing; malformed `%` id still throws.
- Registry functions (`registerAttachmentRef` / `attachmentRefById`) confirmed against the installed v0.3.10 copy.
- The same assertions were added to the package's vitest suite (`tests/vision-cache.spec.ts`, `tests/attach-routes.spec.ts`) so the permanent gate exercises the new behavior. The full `pnpm test` could not run locally: this machine cannot resolve the private `@deepseek-ai/*` cohort tarballs its devDependencies require.
