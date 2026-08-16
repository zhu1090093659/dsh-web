# @linxin666/dsh-client-ui-community-plugins

English | [中文](README.zh.md)

API-backed community plugin manager for the dsh web GUI: the existing Community Plugins first-level settings section browses the live DSH Plugin Store catalog and manages compatible projects in the current Web profile. The same package registers Store tools and a bundled skill for use in conversations.

## What it does

- **Existing first-level section**: keeps the `ui-community-plugins` Cordis entry and the `community-plugins.enabled` settings namespace. The section sits beside Web UI Plugins, Skin Center and Pet and opens directly expanded.
- **Live catalog**: loads project metadata, facets, validation evidence and executable-plan availability from the [DSH Plugin Store API](https://api.dshmk.com/). Search, filters, sorting and refresh all use API data; the last successful catalog remains visible after a refresh failure.
- **Profile lifecycle**: compares Store entries with direct dependencies in the current Web profile, then offers install, update and removal controls. Successful mutations require a DSH Web restart.
- **Conversation integration**: registers `store_catalog`, `store_search`, `store_details`, `store_installed`, `store_install` and `store_remove`, plus the bundled `search-dsh-store` skill. Write tools enter the DSH approval flow before execution.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-community-plugins
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-community-plugins
```

Restart `dsh web` to mount the settings section, lifecycle routes, tools and skill.

## Config

- **Enable switch**: turning off Community Plugins hides only the market UI. It does not disable or remove installed projects, and the choice remains in `community-plugins.enabled`.
- **UI operations**: choose an API project, review the exact recognized plan, acknowledge the third-party-code warning, and confirm the mutation. Update and removal actions appear only when a direct Web-profile dependency can be matched.
- **Conversation use**: ask the agent to search, inspect, install, update or remove a Store project. Read tools may run directly; install, update and removal require explicit DSH approval.

## Security model

- API metadata is untrusted. The browser submits only a repository ID for installation; the Host fetches the current API response again and validates the project identity, fixed CLI arguments and supported source before running it. A verified GitHub plan must be pinned to the API validation SHA.
- Mutations use the official native-command runner with fixed argument arrays, never a shell. Local HTTP write routes require loopback and same-origin requests and serialize mutations; conversation write tools use the DSH approval gate.
- A Store validation state is compatibility evidence, not a security audit, quality guarantee or official endorsement. Review third-party code and permissions before installation.

## Known limitations

- The settings section requires `@deepseek-ai/dsh-client-ui-settings`, and the Store catalog requires network access to `https://api.dshmk.com/`.
- Projects without a supported executable API plan can be browsed but cannot be installed from this package.
- Installed and update states are limited to direct Web-profile dependencies that can be matched to a Store npm or GitHub source.
- Install, update and removal take effect after restarting DSH Web; this package does not restart the process automatically.

Catalog data and listing policy are maintained by [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store); this repository does not carry a second catalog snapshot.

## License

BSD-3-Clause.
