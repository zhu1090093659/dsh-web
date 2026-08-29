# Agent Note: Register reasoning-effort with runtime and retention disclosures

Status: implemented

## Problem

The community catalog entry for `dsh-reasoning-effort` did not state which DSH runtime it targets, and its user documentation did not explain that reasoning settings share the host Models page namespace and survive plugin removal. The npm metadata for versions `0.2.0` and `0.2.3` also needed a source trail after the package moved to a standalone repository.

## Decision

The catalog keeps `dsh-reasoning-effort` as an index-only entry after `dsh-free-search`, so the generated Workshop manifest assigns it rank 45. Its Chinese and English descriptions state the runtime floor `DSH >=0.1.1-rc.2`, the verified DSH CLI `0.1.1-rc.2` plus `0.1.2-alpha.1` cohort-store environment, and the fact that uninstalling does not automatically remove reasoning settings from `llm-pi-ai`.

The standalone plugin declares the same floor as `dsh.engines.dsh`. Its paired README files document the shared `llm-pi-ai` namespace, revision-aware `settings.mutate` writes, the fields that may remain after uninstall, manual cleanup and restart guidance, and the `dsh-plugins` commits that supplied npm `0.2.0` and `0.2.3` before `0.2.4` moved to the standalone repository.

## Alternatives considered

- Claiming compatibility with every historical DSH release: rejected because only the stated CLI and cohort-store combination was directly verified; the minimum declaration and evidence are deliberately narrower.
- Removing all plugin-written settings during uninstall: rejected because the namespace is shared with the host Models page and automatic cleanup could discard host configuration; the retained fields and cleanup procedure are disclosed instead.
- Copying the historical sources into the standalone repository: rejected because `Jamsharden/dsh-plugins` is the provenance source for `0.2.0` and `0.2.3`; linking the exact commits preserves attribution without duplicating history.

## Consequences

- The Workshop and dsh-market.com plugin manifest expose the entry at rank 45, immediately after the occupied rank 44.
- Plugin management can use the published `dsh.engines.dsh` floor to identify unsupported older runtimes, while users on the verified environments have explicit evidence.
- Removing the UI does not remove shared model configuration; users who want a clean namespace must remove the documented fields and restart the DSH Web Host.
- Historical npm provenance is reviewable through exact commits in `Jamsharden/dsh-plugins` rather than an unverifiable single-commit standalone history.

## Testing

- `node scripts/community-index` and `node scripts/community-index --check` pass with 45 entries.
- `node scripts/market-build` regenerates the committed manifest with `dsh-free-search` at rank 44 and `dsh-reasoning-effort` at rank 45.
- The standalone package passes its JavaScript syntax checks and existing unit tests; full dsh-web gates are reported with their actual dependency status in the PR evidence.
