# dsh-i18n · Family Russian Dictionaries for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-i18n?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Russian dictionary contributions for the DSH Web plugin family</strong><br>
  <em>Family Namespace Coverage · Host-Provided Russian UI · Central Maintenance · English Fallbacks</em>
</p>

A family dictionary pack for the DeepSeek Harness (DSH) Web GUI and desktop client. DSH provides the Russian language definition and official shell translations; this package centrally carries the Russian dictionaries for family-owned plugin namespaces.

## What it does

The plugin is a pure browser bundle (the host half intentionally has no behavior) that runs once per page load:

- It uses the host-provided `ru` language definition and official shell dictionaries; language selection and shell translation belong to DSH.
- It registers one ru dictionary per covered family namespace through `ctx.locale.register(ns, 'ru', dict)`, alongside each package's own zh/en registrations without modifying those packages.
- Dictionary lookup resolves per key through the SDK fallback chain ns -> common -> en -> key: a family namespace or key this pack does not cover shows English, never Chinese.
- The plugin owns no settings and renders no UI of its own.

### Covered namespaces

| Namespace | Source package |
| --- | --- |
| `liangshen` | dsh-liangshen |
| `dsh-web-ui-market` | dsh-market |
| `pet` | dsh-pet |
| `settings.pluginManager` | dsh-plugin-manager |
| `dsh-web-ui-preset-center` | dsh-preset-center |
| `session-id` | dsh-session-id |
| `dsh-web-ui-session-archive` | dsh-session-archive |
| `dsh-skill-explorer` | dsh-skill-explorer |
| `dsh-ssh` | dsh-ssh |
| `task-board` | dsh-task-board |
| `task-board-github` | dsh-task-board-github |
| `dsh-web-ui-usage` | dsh-usage |
| `web-ui-plugins` | dsh-web-settings |

## Install

Requires DSH 0.2.2-rc.3 or later: the plugin is developed against the 0.2.2-rc.3 DSH cohort and its `@deepseek-ai/*` runtime services are provided by the host itself.

In your profile (e.g. `~/.dsh/profiles/web`):

```sh
dsh plugin --profile web add @linxin666/dsh-i18n
```

or, from a repository checkout:

```sh
dsh plugin --profile web add link:<repo>/packages/dsh-i18n
```

The plugin is also part of the dsh-web-all aggregate bundle, so profiles that install the aggregate carry it automatically. Restart `dsh web` after installing or updating the bundle; family dictionaries are available after the page reloads.

## Configuration

None: the plugin has no settings keys and no settings card. Choosing the language happens in the official locale surface (`Settings -> General -> Language`).

## Known limitations

- Official shell namespaces (`common`, `settings.locale`) belong to DSH and are outside this pack; family namespaces are the only dictionaries contributed here.
- When a source package adds or changes a zh key, the matching ru key must be mirrored in this package; `pnpm i18n:check` enforces the parity and fails on missing keys.
- A namespace another owner already registered keeps that owner's dictionary; the remaining family registrations continue independently.
- Placeholder names inside strings (`{count}`, `{time}`, ...) are shared with zh/en and must be reused verbatim; grammar oddities around placeholders should be reported instead of editing the placeholder names.

## License

Apache-2.0.
