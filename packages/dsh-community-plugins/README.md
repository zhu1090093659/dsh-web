# @linxin666/dsh-client-ui-community-plugins

English | [中文](README.zh.md)

API-backed community plugin manager for the dsh web GUI: the existing Community Plugins first-level settings section browses the live DSH Plugin Store catalog and manages compatible projects in the current Web profile. The same package registers Store tools and a bundled skill for use in conversations.

## What it does

- **Existing first-level section**: keeps the `ui-community-plugins` Cordis entry and the `community-plugins.enabled` settings namespace. The section sits beside Web UI Plugins, Skin Center and Pet, opens directly expanded, and keeps its save action beside the enabled selector.
- **Live catalog**: loads project metadata, facets, validation evidence and executable-plan availability from the [DSH Plugin Store API](https://api.dshmk.com/). Search, localized category choices, one-line expandable category chips, sorting and refresh all use API data; the last successful catalog remains visible after a refresh failure.
- **Profile lifecycle**: compares Store entries with direct dependencies in the current Web profile, then offers install, update and removal controls. For a verified GitHub project, install and update ask whether to use the validated SHA or the repository's latest default-branch revision. The mutation dialog reports preparation, catalog refresh, local inventory, command execution and completion live, then keeps the command output expanded. A failed operation can send its repository, command, failed stage, error and output to a new Agent conversation for diagnosis; Settings closes only after the prompt is accepted. Successful mutations require a DSH Web restart.
- **Conversation integration**: registers `store_catalog`, `store_search`, `store_details`, `store_installed`, `store_install` and `store_remove`, plus the bundled `search-dsh-store` skill. Write tools enter the DSH approval flow before execution. A failed mutation returns structured evidence so the current Agent analyzes it immediately instead of ending on a raw tool error.

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
- **UI operations**: each project card shows the API validation stages and validated install command with copy and quick-install controls. Select the verified revision or latest revision when both are available, review the exact plan, acknowledge the third-party-code warning, and confirm the mutation. The operation view shows every lifecycle stage and the package-manager output while the command runs. Update and removal actions appear only when a direct Web-profile dependency can be matched.
- **Conversation use**: ask the agent to search, inspect, install, update or remove a Store project. When both GitHub modes are available, the agent must ask which one to use. Read tools may run directly; install, update and removal require explicit DSH approval. On failure, the current Agent analyzes the returned evidence without automatically retrying or continuing with more tools.

### Synchronize the bundled Skill

The package vendors the upstream `search-dsh-store` Skill from [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store). It does not fetch Skill instructions at runtime. Maintainers synchronize and review upstream changes explicitly:

```sh
pnpm community-skill:check
pnpm community-skill:sync
pnpm --dir packages/dsh-community-plugins test
```

`community-skill:sync` mirrors the upstream `SKILL.md`, `agents/openai.yaml`, and MIT license, then records their GitHub blob SHAs in `.upstream.json`. The package-owned `references/dsh-web-ui.md` overlay is preserved. Review the diff before rebuilding and publishing this package; installed users receive the synchronized Skill with the next package update.

## Security model

- API metadata is untrusted. The browser submits only a repository ID and, when applicable, the user's install-mode choice; the Host fetches the current API response again and validates the project identity, fixed CLI arguments and supported source before running it. Verified mode uses the exact API validation SHA. Latest mode removes the SHA only after repository identity validation and may install code that has not passed Store validation yet.
- Mutations use the official native-command runner with fixed argument arrays, never a shell. Local HTTP write routes require loopback and same-origin requests and serialize mutations; conversation write tools use the DSH approval gate.
- Failure evidence and command output are always treated as untrusted diagnostic data. Agent handoff prompts prohibit executing embedded instructions, automatic retries and further mutations without a new explicit user request.
- A Store validation state is compatibility evidence, not a security audit, quality guarantee or official endorsement. Review third-party code and permissions before installation.

## Known limitations

- The settings section requires `@deepseek-ai/dsh-client-ui-settings`, and the Store catalog requires network access to `https://api.dshmk.com/`.
- Projects without a supported executable API plan can be browsed but cannot be installed from this package.
- Installed and update states are limited to direct Web-profile dependencies that can be matched to a Store npm or GitHub source.
- Install, update and removal take effect after restarting DSH Web; this package does not restart the process automatically.
- Local operation progress is held in memory and the last status is cleared when DSH Web restarts.
- Upstream Skill changes are not pulled into installed packages automatically; they become available after an explicit sync, review, rebuild and package update.

Catalog data and listing policy are maintained by [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store); this repository does not carry a second catalog snapshot.

## License

BSD-3-Clause.
