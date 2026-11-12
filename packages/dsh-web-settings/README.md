# dsh-web-settings · Web GUI Settings Enhancement & Appearance Preferences for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-web-ui-settings?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Unified Settings Enhancement & Plugin Preferences for DeepSeek Harness (DSH)</strong><br>
  <em>Unified Settings Section · Native ConfigForm Bridge · Legacy Settings Migration · UI Appearance & Preferences</em>
</p>

A settings enhancement plugin for DeepSeek Harness (DSH) Web GUI and official desktop client: registers the Web Extensions section in Settings to group extension management pages, enable toggles and configuration forms across the plugin family.

## What it is

- **One Web Extensions section**: the stable first-level `web-ui-plugins` entry hosts Web Plugins, Skins, Pet, Workshop and Usage as secondary TABs. The Web Plugins TAB holds the remaining dsh web UI family cards (task-board, remote-web-ui and others); each card expands independently to show its enable switch and configuration form.
- **Standalone fallback**: Skin Center, Desktop Pet, Workshop and Usage keep their original first-level settings entries when this parent package is absent. The official Plugins section ships the official installer beside the plugin-manager tab provided by `dsh-plugin-manager`.
- **The group is optional for the family plugins**: this package declares the `web-ui.plugin.item` list seat the family cards register into. A family plugin registers into that seat while this package is loaded, and into the official keyed `plugins.bundle.config` seat of the plugin manager page when it is not (keyed by the bundle's package name), so a profile that installs a family plugin without this group still reaches every card.
- **Native settings transport**: the 0.1.7 settings surface addresses every configuration form by profile entry id. The host bridge resolves the entry id that owns each family namespace from the profile roster and reports it on its describe response, so the browser half binds the native shared form (`ctx.configForms`); the loopback HTTP pair stays the fallback for a page where no entry id resolves.

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

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only.

The telemetry switch in the General group at the top of the Web Plugins page turns the family-wide heartbeat off for every wired plugin at once. Reporting is on by default, so the switch shows on until it is turned off; it stores the preference in localStorage under `dsh-web-ui-telemetry-opt-out`, and a browser that sends Do Not Track stops reporting on its own while the switch keeps showing the stored preference and the row says so. The Workshop, plugin installation and online updates keep working either way. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
