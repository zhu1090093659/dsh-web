# @linxin666/dsh-client-ui-web-ui-settings

English | [中文](README.zh.md)

The dsh web UI plugin group for the DSH settings page: it adds a first-level settings section (a sibling nav item of General / Models / Plugins / Agent presets) that hosts the enable switches and configuration forms of the family plugins.

## What it is

- **One section for the family**: on the DSH settings page it registers a first-level section with a static heading and cards for the remaining dsh web UI family plugins (task-board, remote-web-ui, describe-image). Each plugin card is collapsed by default and expands independently to show its enable switch and configuration form.
- **Sibling sections**: Skin Center, Community Plugins and Desktop Pet ship as their own packages and register their own first-level sections that open directly expanded.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-settings
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

## Known limitations

- The section shows on the dsh settings page only when its prerequisite (`@deepseek-ai/dsh-client-ui-settings`) is present.
- Authenticated-proxy mode does not provide authentication itself; a deployment without a correctly ordered authentication proxy must leave `trustedProxyHosts` empty.
- The compatibility bridge serves dsh-web-ui family settings only. It does not make the official DSH settings or credentials plane remotely available.
