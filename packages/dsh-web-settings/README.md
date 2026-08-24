# @linxin666/dsh-client-ui-web-ui-settings

English | [中文](README.zh.md)

The dsh web UI plugin group for the DSH settings page: it adds a first-level settings section (a sibling nav item of General / Models / Plugins / Agent presets) that hosts the enable switches and configuration forms of the family plugins.

## What it is

- **One section for the family**: on the DSH settings page it registers a first-level section with a static heading and cards for the remaining dsh web UI family plugins (task-board, remote-web-ui, describe-image). Each plugin card is collapsed by default and expands independently to show its enable switch and configuration form.
- **Built-in version-notes entry**: the same section ends with a built-in "Version Notes" row naming the latest release (version pill, plus a "New" pill while unacknowledged). Clicking it opens the full release page in a modal dialog - lede, highlights, and the complete New / Improved / Fixed lists; opening counts as read.
- **First-level sections**: the Skin Center, the Desktop Pet and the Workshop (store card) each register as their own first-level settings section that opens directly expanded; the official Plugins section ships the official installer beside the plugin-manager tab provided by `dsh-plugin-manager`.

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

`web_settings_namespaces` in `settings.yaml` still decides which family namespaces the bridge serves; when absent, the built-in family list applies. Config changes require a DSH restart, while `web_settings_namespaces` is re-read for every bridge call.

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

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
