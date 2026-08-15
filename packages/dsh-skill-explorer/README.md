# @linxin666/dsh-client-ui-skill-explorer

English | [中文](README.zh.md)

A **skill center** for the DSH web GUI: browse every loaded skill grouped by
source, enable or disable model invocation, create new skills, and delete
skills into a recoverable trash.

## What it does

- **Sidebar entry** "Skill Center" opens a panel with two tabs.
- **Skills tab**: skills grouped by source (system bundled / project
  `.dsh/skills` / project `.agents/skills` / custom directories / user
  `~/.dsh/skills` / user `~/.agents/skills` / runtime registered), each card
  showing description, when-to-use, invocation marks, an enable/disable
  switch (rewrites `disable-model-invocation` in the SKILL.md frontmatter,
  hot-refreshed by the model catalog) and a delete button (moves the file
  into `.trash`, recoverable).
- **Create tab**: a form to create a new skill under the user root
  (`~/.dsh/skills`) or the project root (`.dsh/skills`), generating a
  standard SKILL.md.
- Data comes from a filesystem scan following the official
  dsh-skill-filesystem root conventions, merged with the `ctx.skills`
  registry (bundled / runtime entries). The plugin never changes the
  skill loading or injection semantics — it is a pure GUI management layer.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skill-explorer
```

Restart `dsh web` after installing; the "Skill Center" entry appears in the
sidebar.

## Routes (all loopback-only)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/dsh-skill-explorer/list` | GET | Grouped skill list |
| `/api/dsh-skill-explorer/set-enabled` | POST | Enable/disable (rewrites frontmatter) |
| `/api/dsh-skill-explorer/create` | POST | Create a skill (user/project root) |
| `/api/dsh-skill-explorer/delete` | POST | Delete (move into .trash) |
| `/api/dsh-skill-explorer/health` | GET | Health probe |

## Security model

- Every `/api/dsh-skill-explorer/*` route is loopback-only (same-origin
  fence, identical to dsh-ssh): LAN-exposed dsh web deployments cannot reach
  the write routes.
- Write routes only touch paths produced by a fresh filesystem scan — a
  request cannot name an arbitrary path.
- Skill content is user-authored markdown; the create form caps content at
  64KB.
- The panel renders skill descriptions with text nodes only (no HTML
  injection).

## Known limitations

- The project root is derived from active session workspaces (nearest `.git`
  ancestor); the list route accepts an explicit `?cwd=` override.
- Frontmatter parsing is a lightweight zero-dependency implementation
  (block scalars, booleans, input nested block); exotic YAML features are not
  supported — the official dsh-skill-filesystem provider remains the
  authoritative parser.

## License

BSD-3-Clause.
