# dsh-i18n

English | [中文](README.zh.md)

Language pack plugin for the dsh web GUI: it adds the Русский language to the Web GUI language catalog and centrally carries the ru dictionaries for every family plugin namespace, so external contributors can translate and maintain Russian copy in one place.

## What it does

The plugin is a pure browser bundle (the host half intentionally has no behavior) that runs once per page load:

- It registers the language definition `ru` (label `Русский`, fallback `en`) into the shared locale catalog through `ctx.locale.addLanguage`, which is what makes the language selectable in the official `Settings -> General -> Language` row.
- It registers one ru dictionary per covered locale namespace (single-locale untyped `ctx.locale.register(ns, 'ru', dict)`), contributing the third language alongside each package's own zh/en registrations without touching those packages.
- Dictionary lookup resolves per key through the SDK fallback chain ns -> common -> en -> key: a namespace or key this pack does not cover shows English, never Chinese.
- The plugin owns no settings and renders no UI of its own.

### Covered namespaces

| Namespace | Source package |
| --- | --- |
| `desktop-launcher` | dsh-desktop-launcher |
| `doctor` | dsh-doctor |
| `git-graph` | dsh-git-graph |
| `dsh-web-ui-market` | dsh-market |
| `dsh-perf` | dsh-perf |
| `pet` | dsh-pet |
| `settings.pluginManager` | dsh-plugin-manager |
| `remote` | dsh-remote-web-ui |
| `session-id` | dsh-session-id |
| `dsh-skill-explorer` | dsh-skill-explorer |
| `dsh-ssh` | dsh-ssh |
| `task-board` | dsh-task-board |
| `describe-image` | dsh-tool-describe-image |
| `dsh-web-ui-usage` | dsh-usage |
| `web-ui-plugins` | dsh-web-settings |

## Install

Requires DSH 0.1.2-alpha.2 or later: the plugin is developed against the 0.1.2-alpha.2 DSH cohort and its `@deepseek-ai/*` runtime services are provided by the host itself.

In your profile (e.g. `~/.dsh/profiles/web`):

```sh
dsh plugin --profile web add @linxin666/dsh-i18n
```

or, from a repository checkout:

```sh
dsh plugin --profile web add link:<repo>/packages/dsh-i18n
```

The plugin is also part of the dsh-web-all aggregate bundle, so profiles that install the aggregate carry it automatically. Restart `dsh web` after installing or updating the bundle; the language appears after the page reloads.

## Configuration

None: the plugin has no settings keys and no settings card. Choosing the language happens in the official locale surface (`Settings -> General -> Language`).

## Known limitations

- The official shell namespaces (`common`, `settings.locale`) are not part of this pack, so the DSH chrome itself keeps its own zh/en while the family plugins render Russian.
- When a source package adds or changes a zh key, the matching ru key must be mirrored in this package; `pnpm i18n:check` enforces the parity and fails on missing keys.
- If another language pack already defines the `ru` id, this pack's language definition yields to it (the registration continues with the dictionaries); a namespace another owner already registered keeps that owner's dictionary.
- Placeholder names inside strings (`{count}`, `{time}`, ...) are shared with zh/en and must be reused verbatim; grammar oddities around placeholders should be reported instead of editing the placeholder names.

## License

Apache-2.0.
