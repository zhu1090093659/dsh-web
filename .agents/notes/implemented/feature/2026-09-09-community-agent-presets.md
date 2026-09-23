# Agent Note: Community agent presets distributed through the Workshop

Status: implemented

## Problem

An agent preset is the composition a session runs: its tools, prompt sections, and skills come from the `agent.cordis.yml` a declaring plugin reads. The roster holds exactly the declarations plugins submit to `@deepseek-ai/dsh-agent-preset-registry` at runtime, and the official Settings → Agent presets section lists those declarations and lets a person pick the default. A directory on disk is inert, because nothing discovers a preset by scanning, and the only distribution path a community author had was "copy these files into your DSH home and hope a plugin declares them": there was no catalog, no download, and no enable/disable surface.

The Workshop (`dsh-market`) already solved that shape for skins and pets: a manifest served by dsh-market.com, a loopback-only host gateway that downloads one asset into its DSH home directory with per-file sha256 provenance, and a settings surface that manages what is installed. Two properties of the preset domain made a naive copy of the skin flow wrong:

- **A preset is code, not an asset.** A composition may name relative files (`name: ./tool-catalog.mjs`) and evaluate `!!js` expressions; both run inside the DSH host process when a session is composed from the preset. The harness states the trust plainly: a preset carries the same trust as shell access. The download that puts the bytes on disk must therefore never be the same act as the declaration that makes them live.
- **The roster holds only live declarations.** A preset exists for the host exactly as long as the declaring plugin keeps the registration it submitted: the registry lists it in Settings → Agent presets and offers it to the new-session picker, and a directory no plugin declares is invisible. "Installed" is a fact about bytes on disk and "enabled" a fact about a declaration, so the two must stay separate for a catalog to be browsable safely.

## Decision

Community presets ship as a fourth market asset kind (`preset`) distributed by dsh-market.com, managed from a **预设 / Presets** tab in the Workshop card, with the download kept inert until the panel declares it.

### Storage and state contract

One directory under `$DSH_HOME`, documented as a cross-package contract:

| Path | Meaning |
| --- | --- |
| `agent-presets/<id>/` | **Library**: installed bytes plus the provenance record. Nothing scans it, so the directory is inert until a plugin declares what it holds. |

State is read as the pair of the library directory and the live declaration this plugin holds, never from a private ledger: present and declared is enabled; present and undeclared is installed but inert; absent is not installed. Install downloads the market asset into the library (atomic staging plus rename, per-file sha256) and then declares the composition it reads out of that directory, so one user action carries both the download and the declaration; disable withdraws the declaration and keeps the bytes; uninstall withdraws the declaration and deletes the directory; update re-installs the asset into the library and re-declares the preset when it was declared. Every state read verifies the installed bytes against the provenance record. Updates are notify-only: the card shows an available version and the user runs the update.

### Trust model

- The download is inert and the declaration is the consent boundary: a preset becomes live when the panel declares it, and declaring requires the composition profile plus an explicit confirmation whenever the composition carries an execution surface. Disabling withdraws the declaration and leaves the bytes in place.
- The gateway refuses to declare a preset whose id another declaration already owns (the registry rejects a duplicate, so install would look successful and do nothing), and refuses to disable or uninstall the preset the registry's default names, because a default naming a missing preset makes every new session fail. The message points at Settings → Agent presets for changing the default first.
- Every card shows a **composition profile** computed on the host from the installed bytes: the plugin names it composes, whether it carries local code files (`.mjs`/`.js`), relative rows, or `!!js` expressions, and whether its dependencies resolve. A preset carrying any execution surface requires an explicit confirmation before it is declared, and a read-only viewer renders the composition.
- Declaring is pre-checked and rolled back: a preset the registry reports broken is unregistered and the reason is returned instead of leaving a half-declared preset.
- Provenance is the integrity anchor, as for skins: the workshop records the market version and per-file sha256 at install, reports "本地已修改" when bytes no longer match, and never silently overwrites a locally modified preset.
- The routes answer only loopback requests, and a directory without market provenance is untouchable: it is listed as unmanaged and refused by install and uninstall.

### Market channel and publishing

- Source of truth in this repository: `packages/dsh-preset-center/presets/<id>/` (the preset directory itself) plus `presets/catalog.json` (author, version, tags, English display text, ranking). Preset ids must match the official rule `^[a-z0-9][a-z0-9-]*$`.
- `scripts/market-build` emits `market/dist/manifest/presets.json` and `market/dist/assets/presets/<id>/`, and validates every catalog entry (id rule, reserved shipped ids, composition and metadata files present, `preset.yml` name readable) so a broken preset never publishes. The Chinese display text comes from `preset.yml` so the roster and the store cannot disagree; the catalog carries the English text and market metadata.
- `market/worker`'s asset allowlist maps `preset` to `/manifest/presets.json`; the worker's accepted-kind set and stats buckets needed the same registration, which the first published batch exposed ([Preset likes and installs were rejected by the worker](../../bug-fix/2026-09-10-preset-write-endpoints.md)).

### Ownership and UI

- `@linxin666/dsh-client-ui-preset-center` owns the preset domain: the host library, the live declarations, the loopback-only routes under `/api/preset-center/*`, the composition profile, and the panel component.
- `dsh-market` keeps owning the store shell and the download: its installer gained the `preset` kind (target directory = the library), and its card declares the keyed child slot `dsh-workshop.panel` and renders one cell per contributed kind. The card passes the catalog records, the gateway, and the install reporter as owner props, so the store makes one catalog fetch and owns one gateway for every kind; the preset panel owns the kind-specific state machine behind them.
- Only declared presets appear in Settings → Agent presets, by construction: the official section lists what plugins declare, and a preset this plugin has not declared does not exist for the host. No new first-level settings section exists, so the roster never has two management surfaces.
- The official section re-reads on its own actions, `settings/document-updated`, and `connection/reset`; a declaration made from the workshop triggers none of them, so the panel tells the user that a page refresh surfaces a newly declared preset.

## Alternatives considered

**Make the library itself the enabled set, so a download goes live as it lands.** The simplest mapping — one storage location, no separate declaration to track — and it was rejected because it destroys the two-step consent: a single click on a catalog card would make an executable composition live with no composition review, where the next session can already be composed from it. It also makes "installed but not enabled" unrepresentable, which is the state the product needs for browsing a catalog safely.

**A marker file (`.disabled`) beside the installed directory.** Rejected: enabledness is the declaration the plugin holds, not a file attribute, so a marker would be a second source of truth for a fact the registry already answers — and a preset would still be live, because the registry lists what was declared rather than what a file says.

**Have the declaring plugin register every directory it finds in the library, and track the disabled set itself.** Rejected: it puts the plugin's own mount in the consent seat, so every downloaded composition becomes live on the next `dsh web` start with no review, and the disabled set turns into private state this package maintains instead of simply the presets no declaration covers.

**Symlinking an installed preset instead of declaring it.** Rejected: Windows requires elevated privileges or developer mode for symlink creation, and since the host discovers no directory the link would have to be declared exactly like a real one, so the benefit over declaration is nil.

**Distributing presets as npm plugin packages (the `dsh-liangshen` shape).** Rejected for community distribution: it puts preset content behind a profile patch and an npm install, takes effect only after a DSH restart, and gives the store no per-item surface to install, update, or remove one preset — the opposite of the Workshop experience this feature is modeled on.

**Letting `dsh-market` own the whole feature instead of adding a package.** Rejected because the store would absorb the preset domain's state machine, guards, and composition profile, and every future manageable asset kind would grow it further. The child-slot contract keeps the store a catalog and the domain owner the domain owner.

## Consequences

- The Workshop card carries a fourth tab; without the preset center installed it renders a fallback note instead of the panel, so the store degrades rather than breaking.
- Declaring a preset makes it usable by a new session immediately, while the official settings section may need a page refresh to list it. Declarations live with the host process: after a `dsh web` restart every installed preset is inert until the panel declares it again, one click per preset.
- Disabling or uninstalling a preset never affects a session already composed from it, because a session's composition is fixed at creation.
- The catalog's first content is the 32-entry role-play batch recorded in [Roleplay preset catalog and its content boundary](2026-09-10-roleplay-preset-catalog.md); `packages/dsh-preset-center/presets/catalog.json` remains the publishing source, with the content requirements stated in `presets/README.md`. Review quality of a composition remains a human process; the confirmation gate and provenance reduce accidental risk, not hostile intent.
- A user can delete a preset directory by hand — the official section only lists declarations and picks a default — and the panel then reports it as not installed, so "uninstalled" and "deleted elsewhere" are indistinguishable by design.
- Deleting a directory the host process still has open can fail transiently on Windows; the delete path retries and reports a write error instead of leaving a partial state.

## Testing

- `packages/dsh-preset-center` covers the library and the declaration lifecycle (install/declare, disable, uninstall, unmanaged refusals), the fail-closed composition reader, provenance integrity, the composition profile, the loopback gateway over a real HTTP server (confirmation gate, shadowed id, default-preset refusal, broken-preset rollback, roster unavailability), and the panel (state badges, install/disable flows, confirmation modal, empty and gateway-unavailable degradation).
- `packages/dsh-market` covers the `preset` installer kind (library target, recorded asset version, id rule), the gateway `install-preset` route, the card's preset tab owner props, and the section's child-slot declaration.
- `scripts/market-build` validates the catalog on every build; `pnpm market:check` compares the committed `market/dist` against a fresh build.
