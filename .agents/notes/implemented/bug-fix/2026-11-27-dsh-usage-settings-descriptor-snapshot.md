# Agent Note: dsh-usage Settings Descriptor Snapshot (#2100)

Status: implemented

## Problem

`@linxin666/dsh-usage` polls its own `/api/dsh-usage/overview` route from two browser cards (the usage section every 10s, the sidebar foot card every 30s). Each document assembles one row per provider route, and every route resolves the foreign settings namespaces `llm-pi-ai` and `llm-deepseek` for its `apiKeyEnv`/`baseURL`.

That read went through `readNamespace`, whose first branch is the pre-0.1.7 `settings.get(ns)`. A modern host mounts `settings` as `SettingsForms`, which exposes `describe`, `update`, `replace` and `mutate` but **no `get`**, so the fast path never fires and every namespace read fell through to `settings.describe({ redactSecrets: false })`: a full scan of every profile entry with each entry's schema resolved through schemastery. With one read per provider route, a single overview document cost a dozen profile scans, and a running host paid that on both card cadences.

Measured on a 42-entry profile (DSH 0.2.2, macOS, Node inspector sample of 36.6s): `@linxin666/dsh-usage` at 25.2% inclusive host CPU, `schemastery.resolve` at 19.4% self, host event-loop blocked 23.9% of wall clock. The reading path itself is correct — only its cost is the defect, so the fix has to keep every namespace resolution rule from [the #1739 resolution](2026-09-27-open-issues-resolution-1736-1739-1729.md) intact.

## Decision

`packages/dsh-usage/src/host/usage-service.ts` keeps one settings descriptor snapshot per service instance:

- `readSettingsNamespace` (the module-level resolver) takes a `descriptors` provider as its third argument; the service passes `() => this.settingsDescriptors()`, so every read in a poll cycle, an overview document, or a credential resolution shares one `describe()` result instead of triggering its own.
- `settingsDescriptors()` memoizes the descriptor rows in `descriptorSnapshot` and re-scans only when `DESCRIPTOR_CACHE_TTL_MS` (30s) has elapsed.
- `start()` subscribes to the host's `settings/document-updated` event and drops the snapshot, so a profile edit is visible to the very next read rather than after the TTL; `stop()` disposes that subscription beside the session listener.
- An empty descriptor list is never stored: settings that are not ready yet at boot must not pin an empty profile for a whole window.
- A `describe()` that throws clears the memo and reads as no descriptors, keeping the poll loop's never-throw contract.

The resolution order itself is unchanged: pre-0.1.7 `settings.get(ns)`, then the descriptor snapshot, then live loader entries, then `configEditor.configuration()`.

## Alternatives considered

**Prefer `settings.get(ns)` and fall back to `describe()`** (the issue's first suggestion) is already what the code does; it cannot help, because the service a modern host mounts has no `get`. It stays as the legacy branch only.

**Scope the snapshot to one request** — threading one descriptor list through `overview()` alone — removes the per-route multiplication but still pays a full profile scan per browser poll (both cards) and per probe cycle. The waste is not intra-document repetition; it is that nothing is shared between documents arriving seconds apart.

**Cache the assembled overview document behind its own TTL** (the issue's third suggestion) would also freeze balances, plan windows and ledger totals that legitimately change between polls, and `refresh()` would need a bypass to stay honest. The expensive part is the profile scan, not document assembly, so the cache sits at the descriptors instead.

**Only stretch the client poll intervals** (the issue's last suggestion: 60s/120s) lowers freshness to buy CPU and was the reported workaround rather than a fix. Both cards already pause while the tab is hidden, so cadence is not where the cost came from.

**Rely on `settings/document-updated` alone, with no TTL**, would leave the snapshot stale forever if a change lands before `start()` subscribes or a host never emits the event; the TTL is the floor that bounds that staleness at one window.

## Consequences

- A host serving both cards and probing every provider now runs at most two profile scans per minute instead of dozens per poll, which is the CPU regression this note closes.
- The profile facts that only feed probes (`apiKeyEnv`, `baseURL`) can trail a settings change the host does not announce by up to 30s; an announced change applies to the next read.
- Boot-time ordering is preserved: an empty profile is retried on the next read, so provider rows appear as soon as the settings service answers.
- The snapshot is per service instance, so a plugin reload (the host re-creates the row on a config change) starts from a fresh scan.

## Testing

- `packages/dsh-usage/tests/usage-service.spec.ts` adds the `settings descriptor snapshot (#2100)` block: one overview scans the profile once regardless of route count; `settings/document-updated` invalidates the snapshot before the next read; the TTL expiry re-scans when no event arrives; an empty scan is retried and a late `llm-deepseek` `baseURL` still takes effect.
- `npx vitest run` in the package passes 220 tests across 16 files; `tsgo --noEmit` and `tsgo -p tsconfig.test.json` are clean.
