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
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer@latest
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

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/dsh-skill-explorer/list` | GET | Grouped skill list |
| `/api/dsh-skill-explorer/set-enabled` | POST | Enable/disable (rewrites frontmatter) |
| `/api/dsh-skill-explorer/create` | POST | Create a skill (user/project root) |
| `/api/dsh-skill-explorer/delete` | POST | Delete (move into .trash) |
| `/api/dsh-skill-explorer/health` | GET | Health probe |

## Security model

- Every `/api/dsh-skill-explorer/*` route is loopback-only by default (the
  shared plugin-family fence: loopback socket + Host header + browser
  same-origin markers): unpaired LAN clients get `403 forbidden: loopback-only`
  before any skill-file access. When `dsh-remote-web-ui` is also loaded, a live
  paired-device cookie is an additional allow path (the same cookie `api/gate`
  already checks); unpaired and revoked devices stay 403. The skill center does
  not depend on the remote plugin.
- Write routes accept the path displayed by the panel only as an identity claim;
  before mutating, a fresh filesystem scan must resolve the same skill name and
  exact path. Arbitrary paths and stale same-name fallbacks are rejected, so a
  disappeared project skill cannot redirect a pending action to a user or
  custom skill with the same name.
- Skill content is user-authored markdown; the create form caps content at
  64KB.
- The panel renders skill descriptions with text nodes only (no HTML
  injection).
- Scans follow symbolic links: symlinked skill directories and single `.md`
  links inside a skill root are listed as ordinary skills. Because a link
  expresses the user's intentional mount, the target is not constrained to
  fall inside a skill root; a symlink inside a project root (which may come
  from a cloned repository) is treated as part of that project, and a
  `SKILL.md` in its target directory is read and shown — this is the intended
  trust boundary. Linked skills can be listed and toggled (rewriting the
  target's own frontmatter), but **cannot be deleted**: deletion would move the
  target's `SKILL.md` out of place, escaping the current skill root, so the
  delete button is hidden for linked skills and the delete route refuses them
  (400). Write operations still sit behind the loopback fence and the "trust
  only freshly scanned paths" rule.

## Known limitations

- Project skills follow the workspace shown in the panel: the list route
  accepts an explicit `?cwd=` override, and the create form sends the
  displayed workspace; the project root is the nearest `.git` ancestor of
  that workspace.
- Frontmatter parsing is a lightweight zero-dependency implementation
  (block scalars, booleans, input nested block); exotic YAML features are not
  supported — the official dsh-skill-filesystem provider remains the
  authoritative parser.
- Linked skills cannot be deleted (see the security model); enable/disable works
  normally on them (rewriting the target's `SKILL.md` frontmatter). Both
  directory and single-file links list normally; a single-file link (pointing
  at one `.md`) is replaced by a plain file during the atomic rewrite — the link
  is not kept and the target file is left untouched.

## License

BSD-3-Clause.
