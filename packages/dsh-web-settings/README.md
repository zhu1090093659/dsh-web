# @linxin666/dsh-client-ui-web-ui-settings

English | [中文](README.zh.md)

The dsh web UI plugin group for the DSH settings page: it adds a first-level settings section (a sibling nav item of General / Models / Plugins / Agent presets) that hosts the enable switches and configuration forms of the family plugins.

## What it is

- **One section for the family**: on the DSH settings page it registers a first-level section with a static heading and cards for the remaining dsh web UI family plugins (task-board, remote-web-ui, describe-image). Each plugin card is collapsed by default and expands independently to show its enable switch and configuration form.
- **First-level sections**: the Skin Center, the Desktop Pet and the Workshop (store card) each register as their own first-level settings section that opens directly expanded; the official Plugins section ships the official installer beside the plugin-manager tab provided by `dsh-plugin-manager`.
- **The group is optional for the family plugins**: this package declares the `web-ui.plugin.item` list seat the family cards register into. A family plugin registers into that seat while this package is loaded, and into the official keyed `plugins.bundle.config` seat of the plugin manager page when it is not (keyed by the bundle's package name), so a profile that installs a family plugin without this group still reaches every card.
- **Native settings transport**: the 0.1.7 settings surface addresses every configuration form by profile entry id. The host bridge resolves the entry id that owns each family namespace from the profile roster and reports it on its describe response, so the browser half binds the native shared form (`ctx.configForms`); the loopback HTTP pair stays the fallback for a page where no entry id resolves.
- **Legacy settings recovery**: the 0.1.7 settings subsystem imports `settings.yaml` once and then renames it, but it imports each section under its own name as a profile entry id, so the family sections (`pet`, `dsh-usage`, ...) match no entry and their values are left orphaned in the renamed file. This package adopts them once — into the entry that serves their namespace, or into the entry whose Config declares a field of that name — without overwriting anything the user already set. See [Legacy settings import](#legacy-settings-import).

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings@latest
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-settings
```

Restart `dsh web` for the section to appear in the settings page.

## Config

The bridge remains loopback-only when `trustedProxyHosts` is empty. A deployment whose authenticated reverse proxy runs on the same Host may opt in an exact authority and name the environment variable that holds a shared proxy token:

```yaml
- id: ui-web-ui-settings
  config:
    trustedProxyHosts:
      - dsh.example.com
    proxyTokenEnv: DSH_WEB_UI_SETTINGS_PROXY_TOKEN
```

Set the named environment variable for both DSH and the reverse proxy. Generate a dedicated high-entropy value; do not put its value in `cordis.patch.yml`. After the authentication handler, replace the internal header before proxying to the loopback-only DSH listener. For Caddy, the upstream portion is:

```caddyfile
reverse_proxy 127.0.0.1:3080 {
    header_up X-Dsh-Web-Ui-Settings-Proxy-Token {$DSH_WEB_UI_SETTINGS_PROXY_TOKEN}
}
```

`header_up` with a value replaces any client-supplied value. Do not combine that line with a deletion of the same field: Caddy 2.6 applies grouped deletes after sets. If the Caddy systemd unit starts `caddy run --environ`, remove that flag or otherwise protect its output because it prints environment variables at startup.

`web_settings_namespaces` in `settings.yaml` still decides which family namespaces the bridge serves; when absent, the built-in family list applies. The Host imports `settings.yaml` once on first boot and renames it to `settings.yaml.imported`, so the bridge reads the renamed import first, the pre-0.1.7 document second, and treats the Host-reported profile patch as a settings document only when its name says it is one. Config changes require a DSH restart, while `web_settings_namespaces` is re-read for every bridge call.

## Legacy settings import

Before the 0.1.7 cohort, `$DSH_HOME/settings.yaml` carried one top-level section per family plugin (`pet:`, `dsh-usage:`, `dsh-liangshen:`, ...). The new settings subsystem imports that document once and renames it to `settings.yaml.imported`, but it imports each section under its own name as a profile entry id — and the family's row ids are `ui-pet` / `web-ui-pet`, `web-ui-usage`, and so on. Those sections matched no entry: the Host logged them as rejected, left them in the renamed file, and every family setting reverted to its schema default.

Once the composition has settled, this package adopts them through two ordered rules:

1. **Alias rule.** Each top-level section name is resolved through the same tables the bridge serves namespaces with: the family namespace aliases first, then the profile entry id that namespace is addressed by.
2. **Field rule.** A section the alias rule cannot place is matched against the top-level Config fields the served entries declare; exactly one entry must declare a field of that name, and that entry takes the section. This is how a namespace a plugin folded into its own Config still lands: the Skin Center declares `skin-background`, `skin-custom-theme`, and `skin-wallpaper` as fields of one entry, so the legacy sections of those names belong at those paths.

Whichever rule placed the section, the write path inside the entry is the same decision: the section is written at a top-level field of its own name when that entry declares one (a namespace the plugin folded into its own Config — the Skin Center's `skin-background` is reached by the alias rule and still lands inside that field), and at the entry root otherwise, which is the ordinary family plugin whose Config carries the section's fields directly. A section both rules could claim keeps the alias rule. Every write goes through the official path, `ctx.settings.update(entryId, patch, expectedRevision)`, with the revision the Host reported, and the section is recorded in the marker below so it is imported at most once.

The import never clobbers. A field path the entry's user layer already holds is dropped from the patch at any depth: a held nested key keeps its value while its untouched siblings still import, and a held subtree (arrays included) is never rewritten. A section no served entry owns, one whose fields the entry's form does not declare, and a field name two or more served entries declare are all left alone and reported in the Host log rather than written blind. Every run logs its outcome — imported, already recorded, skipped, refused — and the repair never blocks activation: if `ctx.settings` or the config editor is absent it does nothing.

Each section that landed is recorded in `$DSH_HOME/dsh-web-settings-legacy-import.json` (`~/.dsh/dsh-web-settings-legacy-import.json` by default), a small versioned JSON document:

```json
{
  "version": 1,
  "sections": {
    "pet": {
      "entryId": "web-ui-pet",
      "path": [],
      "fields": ["visible", "size"],
      "importedAt": "2026-09-22T00:00:00.000Z"
    },
    "skin-wallpaper": {
      "entryId": "web-ui-skin-center",
      "path": ["skin-wallpaper"],
      "fields": ["selection", "dim"],
      "importedAt": "2026-09-22T00:00:00.000Z"
    }
  }
}
```

`entryId` is the entry the section was written into, `path` the field path inside it (empty for a section the alias rule placed at the entry root, `[name]` for a section the field rule matched), and `fields` the section's own field names that were written there. A `path` key missing from a marker written by an earlier build means the entry root.

The marker makes the import one-shot: a recorded section is never re-imported, so a value the user clears afterwards stays cleared. A section the Host refuses, an entry the Host does not serve yet, or a marker this build cannot read stay unrecorded and are retried on the next boot; a marker of an unknown version is left untouched rather than re-imported over. Deleting the marker re-arms the import — the user-layer check still refuses to overwrite anything the entry already carries.

## Security model

- Remote bridge access is off by default. Direct access requires a loopback socket and a loopback Host exactly as before.
- Authenticated-proxy access requires a loopback socket, a canonical configured Host, a same-origin browser request, and the shared token injected upstream. The browser never receives the token.
- The reverse proxy is the authentication boundary: keep DSH bound to loopback, run authentication before `reverse_proxy`, and replace rather than forward the client-supplied internal header.
- The bridge exposes only the intersection of registered family namespaces and `web_settings_namespaces`. It does not expose credentials, native paths, or any other privileged DSH API.

## Troubleshooting

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key" (DSH 0.1.0-rc.6+)

Plugin versions up to 0.1.17 registered the group card in the keyed `settings.plugin.item` slot with an `id` instead of the required `key`. DSH 0.1.0-rc.6 and later reject such entries while the loader entry applies, so the web GUI fails to boot with "Failed to load plugins".

The registration moved to the first-level `settings.section` slot (a list slot addressed by `id`) in 0.1.18 and ships in 0.2.0; the code on `main` is compatible with rc.6 and rc.7. A profile that still fails carries a frozen older install:

1. Bump every `@linxin666/*` dependency in the profile `package.json` to `^0.2.0` (at least `^0.1.18`).
2. Reinstall the profile dependencies (`pnpm install`), and on Windows recreate stale `node_modules/@linxin666/*` junction links (`cmd /c rmdir <link>` then `cmd /c mklink /J <link> <target>`).
3. Restart `dsh web`.

See [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513).

## Known limitations

- The section shows on the dsh settings page only when its prerequisite (`@deepseek-ai/dsh-client-ui-settings`) is present.
- Authenticated-proxy mode does not provide authentication itself; a deployment without a correctly ordered authentication proxy must leave `trustedProxyHosts` empty.
- The compatibility bridge serves dsh-web family settings only. It does not make the official DSH settings or credentials plane remotely available.
- The legacy settings import covers the family settings surface: sections are matched against the family namespaces this package serves (alias rule) and against the top-level Config fields those served entries declare (field rule). A section belonging to the official settings surface or to a non-family plugin stays in `settings.yaml.imported` and is reported as skipped.
- The field rule fails closed: a field name two or more served entries declare, like one no served entry declares, leaves the section in the renamed file.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
