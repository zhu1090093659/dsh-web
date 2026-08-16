# @linxin666/dsh-skill-manager

English | [中文](README.zh.md)

Skill manager for the dsh web GUI: a top-level Settings page ("Skills") that
lists the skills of the current workspace, toggles each one on or off at any
time, and installs or uninstalls skills from a local directory or a git
repository URL. Everything rides the official DSH skill mechanism — no dsh
source changes.

## What it does

- Settings → Skills: a first-class Settings section (nav id `skills`),
  ordered right after Agent presets.
- A workspace selector defaults to the workspace of the current session; the
  catalog is resolved exactly like the official `skill.list` RPC (session
  header cwd + live agent scope, falling back to the global layer for cold
  sessions).
- Each skill row shows its name, description, source/provider badges,
  installed marker, and a single master switch. Turning the switch off writes
  `disable-model-invocation: true` and `user-invocable: false` into the
  skill's SKILL.md frontmatter; turning it on removes both keys. The
  filesystem provider's watcher invalidates the catalog, and the next agent
  step republishes the model-facing catalog — no restart needed.
- Install from a local directory (directory bundles with SKILL.md, flat
  `*.md` files, or a directory of bundles) or a git repository URL
  (shallow clone). Destination is either the current workspace
  (`<projectRoot>/.agents/skills`) or the user level
  (`<dshHome>/skills`, visible in every workspace). Installations are
  validated (frontmatter, kebab-case names, no duplicate or conflicting
  names) and recorded in the installed ledger.
- Uninstall deletes only skills the manager installed (ledger-guarded), with
  an inline confirmation.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-skill-manager
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skill-manager
```

Restart `dsh web`, open Settings → Skills.

## Config

The plugin has no settings namespace; behavior is fixed:

| Aspect | Behavior |
| --- | --- |
| Toggle semantics | One master switch: off hides the skill from both the model catalog and the user slash surface. |
| Toggle scope | Only filesystem skills (an editable skill file) can be toggled; bundled and runtime-registered skills show an uneditable state. |
| Install roots | `<projectRoot>/.agents/skills` (workspace) or `<dshHome>/skills` (user, default `~/.dsh/skills`). |
| Installed ledger | `<dshHome>/skill-manager.json` (0600, atomic write); uninstall is allowed only for recorded paths. |
| Git installs | `git clone --depth 1`; requires a `git` binary on PATH (120 s timeout). |
| View scope | The catalog is resolved per session (header cwd + live agent scope). Cold sessions without a live agent fall back to the global layer, which in the stock web composition shows no filesystem skills. |

## Security model

- All `/api/dsh-skill-manager/*` routes are loopback-only: requests from
  non-local addresses, foreign Host headers, and cross-site origins are
  rejected with 403 (the same fence as dsh-ssh).
- The plugin writes only two kinds of places: skill files under the skill
  roots (frontmatter toggles, installed copies, uninstalls of ledger-recorded
  paths) and the installed ledger under `<dshHome>`.
- Git clones run only for URLs the user pastes into the install form; the
  clone happens in a temporary directory that is removed afterwards.
- The manager adds no agent tools and no system-prompt announcement; it is a
  pure user-side management surface.

## Known limitations

- Toggling bundled or runtime-registered skills is not supported (no
  editable file); re-enabling a skill the manager toggled restores the
  author's original frontmatter defaults.
- A cold session (no live agent) lists only the global registry layer; in
  the stock web composition that layer has no filesystem provider, so the
  section asks you to open the session first.
- Install does not support "create from scratch" templates or pasted
  Markdown bodies yet.
- The settings page requires at least one session: every list/install/
  toggle/uninstall call is addressed by a session (its cwd selects the
  project, matching the official `skill.list` RPC).

## License

Apache-2.0.
