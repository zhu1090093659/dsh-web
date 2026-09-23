# Agent Note: Per-Model Capability Declarations for Custom pi-ai Providers

Status: implemented

## Problem

Custom DSH providers on the Models settings page can declare a model id, display name, context window, and output limit, but the page deliberately ships no editor for two fields the official `llm-pi-ai` settings namespace has always carried: `models[].input`, the request modalities the adapter reads when deciding whether image attachments may ride a request, and `models[].reasoningEfforts`, the level dictionary the session's `reasoningEffort` must land in. A hand-declared vision model therefore could never receive an image, and a hand-declared reasoning model could never offer thinking levels, even though both are plain configuration.

## Decision

- A new package `packages/dsh-model-capabilities` (`@linxin666/dsh-client-ui-model-capabilities`, bundle row `ui-model-capabilities`) seats the official `settings.models.provider-card` keyed slot under key `llm-pi-ai`, so every saved card of that adapter family gains a collapsible "Model capabilities" area; a second seat on `settings.models.footer` lists archived providers whose route is currently down.
- Reads and writes use the official remote settings wire (`remote.settings.describe` / `mutate`) against the `llm-pi-ai` namespace. A save is one `set` path op replacing the provider's whole `models` array, because the settings path walker replaces an array it meets mid-path and cannot address one model by index; entries stay structurally open, so fields the plugin does not edit (id, name, contextWindow, compat, ...) survive.
- Image input is an explicit claim (`["text","image"]` or `["text"]`); the undeclared state is shown as inherited and preserved rather than hidden.
- Reasoning is tri-state: undeclared (inherit), `false` (declared non-reasoning), or an explicit level dictionary from `off` through `max` with a wire value per level, where `off` alone may stay empty ("supported, send nothing"). The editor refuses a dictionary with no level beyond `off` or an empty wire value on a non-`off` level, mirroring the adapter's own acceptance rules before the host would reject the write.
- Provider disable/enable uses the only sanctioned seam: `unset llm-pi-ai.providers.<route>`, the same write the official Remove-provider button performs. Disable first archives the user-layer profile in the plugin's own settings entry — the `Config` the host half declares, which the Host serves under this row's profile entry id (`ui-model-capabilities`, or the aggregate's `web-ui-model-capabilities`), guarded by the shared mount-once copy — and then unsets the route; enable restores the archive verbatim and clears it. The ordering makes the worst case a duplicate archive rather than a lost profile, enable refuses when the route has grown a newer profile, and both namespaces are revision-fenced.
- The composition layer is respected: a route the base layer also declares cannot be taken down by a user-layer unset, so that card offers no disable control and the orchestration refuses with `base-profile` if reached anyway.
- The footer lists only archive entries whose route is still down: an entry whose provider came back (a re-added route, or a partial enable that restored the profile but failed to clear the archive) is hidden, while the archived profile stays restorable.
- Refresh is namespace-scoped: `settings/document-updated` for `llm-pi-ai` or the archive namespace drives the surfaces, concurrent `describe` reads are coalesced onto one wire call, and an open draft survives a background refresh while keeping the revision it was read at as its write fence, so a moved document conflicts instead of silently dropping edits or clobbering the newer state.
- Copy ships as zh/en in the package (`model-caps` namespace) with ru centralized in `dsh-i18n`; `scripts/i18n-audit.mjs` lists the package and the aggregate bundle registers the child.

## Alternatives considered

- **Store a capability table in the plugin's own namespace and rewrite requests in the host half**: rejected. It splits the fact source, since the `input` and `reasoningEfforts` fields the adapter reads live in `llm-pi-ai`, and it forces the host half to own races and double-write consistency; the official namespace carries these fields precisely for a deployment that knows its route.
- **Video and PDF modality checkboxes**: rejected. The pi-ai modality vocabulary is `text | image`, so a wider claim cannot take effect end to end and the UI would lie.
- **Enumerate the built-in catalog from the host half**: not in v1. A route that serves the built-in catalog without a `models` array shows guidance ("add model rows first") instead of an editor, which avoids introducing a custom remote face for enumeration.
- **Hide a disabled provider by writing an enabled flag**: rejected. pi-ai has no such field; the sanctioned removal is the unset the official card performs, and the archive keeps the profile restorable.

## Consequences

- Custom models can declare image input, reasoning levels, and each level's wire spelling in place on the Models page; the composer offers the declared thinking levels and DSH offers image attachments only to a model that claims them.
- Disabling takes a provider out of both model pickers immediately and host-side delegation to it fails closed with `NO_ADAPTER`; its configuration stays recoverable from the footer until the route comes back.
- `THINKING_LEVELS` is a local copy of the adapter's level vocabulary, so an upstream change must be mirrored there; a mismatch surfaces as a host-side rejection naming the level.
- API keys stay in the credentials service; the archive stores configuration only.
- Installing the package requires a DSH restart, either through `dsh plugin --profile web add link:<repo>/packages/dsh-model-capabilities` or through the aggregate bundle.

## Testing

- `tests/capabilities.spec.ts` (25) covers view reads, mode classification, level normalization, validation, draft updates, and the op builder.
- `tests/provider-toggle.spec.ts` (15) covers archive parsing, the four op builders, the layer predicates, and the disable/enable orchestration with revision fencing and every failure branch.
- `tests/panel.spec.tsx` (7) and `tests/toggle-ui.spec.tsx` (12) mount the real components against a fake remote face: whole-array writes, tri-state editing, conflict reload, the read-only posture, the disabled state, the two-write disable/enable order, stale-archive filtering, the base-layer guard, and draft survival across a background refresh.
- Repository gates: `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`, `pnpm test:scripts`, `pnpm sync-shared:check`, and `pnpm runtime-deps:check`.
- Live GUI verification of the slot seating and of both model pickers after a restart remains with the maintainer, because the plugin only mounts on a DSH restart.
