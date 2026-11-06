# dsh-skill-explorer · Visual Skill & Tool Explorer for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-skill-explorer?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Visual Skill & Tool Explorer for DeepSeek Harness (DSH) Web GUI & Desktop</strong><br>
  <em>Tiered Skill Catalog · Model Invocation Toggle · Visual SKILL.md Editor · Safe Trash · Zero Intrusion</em>
</p>

A visual Skill Explorer for DeepSeek Harness (DSH) Web GUI and desktop client: browse loaded skills tiered by source origin, toggle model invocation permissions, author new skills, and manage files through a safe trash mechanism.

## What it does

- **Sidebar row** "Skill Center" opens a native center-column page — a row in
  the shell's own panel list, beside Plugins, Schedule and the task board —
  with a tab bar. The row opens the page, and opening any session (or a new
  chat) returns the center column to the conversation, exactly like the shell's
  own Plugins and Schedule pages; the page carries no back control of its own.
- **Skills tab**: skills grouped by source (system bundled / project
  `.dsh/skills` / project `.agents/skills` / custom directories / user
  `~/.dsh/skills` / user `~/.agents/skills` / runtime registered), with a
  search box that filters by name or description as you type (name hits listed
  first; Escape clears it) and stacks with the workspace picker. Each row shows
  description, when-to-use, invocation marks, an enable/disable switch
  (rewrites `disable-model-invocation` in the SKILL.md frontmatter,
  hot-refreshed by the model catalog; a plugin-provided file has no such path,
  so its switch is recorded in the panel's own store instead), a duplicate
  action (a copy of the skill as a starting point in the create form), an edit
  action and a delete button
  (moves the file into `.trash`, recoverable). The refresh control hides while
  a load runs.
- **Filters and source folding**: the search box stacks with three facets — the
  source groups to include, the enabled/disabled state, and the row marks
  ("Provided by plugin" / "No local file" / "symlinked") — behind one toolbar
  toggle that shows how many facets are narrowing the list. Each source group's
  header folds and unfolds its rows; on first use only the project and user
  roots are open, so the global sources do not paint every row at once. The
  facets and the fold decisions are view preferences stored in `localStorage`;
  a browser that refuses storage simply does not remember them.
- **Import tab**: batch-create skills from a directory on the host or from a
  `.zip` archive read by the browser. Every candidate is validated against the
  official acceptance rule and resolved by the same source rank the list uses,
  so a candidate a stronger source already provides is reported as skipped
  instead of creating a file the model would never receive. An import only ever
  creates files: an existing skill is never overwritten.
- **Create tab**: a form to create a new skill under the user root
  (`~/.dsh/skills`) or the project root (`.dsh/skills`), generating a
  standard SKILL.md.
- **Edit tab**: opens from a row's edit action, reads the skill through the
  host (the list carries metadata only) and rewrites its description,
  when-to-use and body in place; the name, location and enabled state stay as
  they are.
- Data comes from a filesystem scan following the official
  dsh-skill-filesystem root conventions, merged with the `ctx.skills`
  registry (bundled / runtime entries). The scan reads `customSkillDirs`
  from this plugin's own config **and** from every live `skill-filesystem`
  loader row, so the documented placement (the provider row in a profile
  patch) is manageable too. The plugin never changes the skill loading or
  injection semantics — it is a pure GUI management layer.
- A skill the write routes cannot serve is badged by what actually backs
  it, instead of silently missing its controls. A plugin provider that
  reports a real instruction file (the official `SkillSummary.path`) is
  listed as **"Provided by plugin"** — the file exists, it just sits outside
  the skill roots this panel scans. Only a registration that reports no file
  at all is listed as **"No local file"**. Both stay pathless, so neither row
  offers an edit or delete control that would answer 404. A **"Provided by
  plugin"** row does carry the enable switch (#1854): because the file belongs
  to the provider, the host records the switch in the panel's own store and
  the row reads as switched off (see the known limitations). Only a
  **"No local file"** row has no switch at all.
- A skill is listed only when the official provider would load it: its
  SKILL.md declares a non-empty `name` and `description`, and the name
  satisfies the official skill-name grammar. A file the official provider
  discards is absent from the panel too, so the panel never shows a skill the
  model cannot receive.
- A duplicate skill name resolves by the official source rank (project
  `.dsh/skills` 100, project `.agents/skills` 200, runtime 250, custom 300,
  user `~/.dsh/skills` 400, user `.agents/skills` 500, bundled 600), so
  the row shown names the same skill the model receives.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer@latest
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
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
| `/api/dsh-skill-explorer/read` | GET | One skill's editable fields and body (`?name=&path=`) |
| `/api/dsh-skill-explorer/set-enabled` | POST | Enable/disable (rewrites frontmatter) |
| `/api/dsh-skill-explorer/set-provider-enabled` | POST | Enable/disable a plugin-provided skill (recorded in the panel's own store) |
| `/api/dsh-skill-explorer/create` | POST | Create a skill (user/project root) |
| `/api/dsh-skill-explorer/import` | POST | Batch-create skills from a directory or a .zip archive |
| `/api/dsh-skill-explorer/update` | POST | Edit an existing skill in place (name and location unchanged) |
| `/api/dsh-skill-explorer/delete` | POST | Delete (move into .trash) |
| `/api/dsh-skill-explorer/health` | GET | Health probe |

## Security model

- Every `/api/dsh-skill-explorer/*` route is loopback-only by default (the
  shared plugin-family fence: loopback socket + Host header + browser
  same-origin markers): unpaired LAN clients get `403 forbidden: loopback-only`
  before any skill-file access. Deployments behind an ingress or reverse proxy
  admitted by the host `connection` service (`--trusted-host`, valid signed
  browser session) are admitted directly. When `dsh-remote-web-ui` is also
  loaded, a live paired-device cookie is an additional allow path (the same
  cookie `api/gate` already checks); unpaired and revoked devices stay 403. The
  skill center does not depend on the remote plugin.
- Write routes accept the path displayed by the panel only as an identity claim;
  before mutating, a fresh filesystem scan must resolve the same skill name and
  exact path. Arbitrary paths and stale same-name fallbacks are rejected, so a
  disappeared project skill cannot redirect a pending action to a user or
  custom skill with the same name. The read route applies the same resolution,
  so it cannot be used to read an arbitrary path either. The scan behind that
  check resolves the workspace exactly as the list route does (explicit
  override, then the active session workspace, then the process cwd), so a
  write never re-scans a different project root than the one the panel served.
- The edit route rewrites an existing SKILL.md in place and does not touch the
  skill name or location; it carries the current `disable-model-invocation`
  value over, so an edit can never silently re-enable a disabled skill. Linked
  skills are refused here for the same reason deletion is (see below).
- The plugin-provided switch route stores one `(provider, skill name)` pair
  per record in `$DSH_HOME/dsh-skill-explorer/provider-toggles.json`
  (atomic temp file + fsync + rename; a corrupt, foreign, or oversized
  document degrades to "nothing switched off"). It never receives or writes a
  path: the client sends the identity, never a location. Disabling requires a
  fresh collection to still resolve that pair to a `provider-file` row, so
  the store can only ever hold identities this panel actually showed; enabling
  only removes a record, so it is allowed unconditionally and a stored record
  stays removable after its plugin is gone. Both directions are idempotent, so
  a double click or a retried request cannot stack duplicates.
- The import route is the one creation surface that reads content outside the
  skill roots, and its read set is narrow: a host directory the user names is
  scanned one level for `<name>/SKILL.md` or `<name>.md`, symbolic links and dot
  entries there are skipped rather than followed, or the browser posts an
  archive it read. It writes only new `<skill root>/<name>/SKILL.md` files under
  the documented user/project root, never rewriting an existing one, and the
  request is bounded (archive 4MB, entries 512, one SKILL.md 64KB, 4MB of
  expanded text). A malformed or unsupported archive (zip64, encrypted entries,
  an unknown compression method, a path escaping the archive) is answered with
  400 and the reason, and every refusal names the offending entry.
- Skill content is user-authored markdown; the create form caps content at
  64KB, and the edit and import routes enforce the same cap.
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
  (400). For the same escape reason the edit route refuses linked skills too,
  and the panel hides the edit button for them. Write operations still sit behind the loopback fence and the "trust
  only freshly scanned paths" rule.

## Known limitations

- Project skills follow the workspace shown in the panel: the list route
  accepts an explicit `?cwd=` override, and the create form sends the
  displayed workspace; the project root is the nearest `.git` ancestor of
  that workspace. The write routes resolve the same workspace the list route
  serves, so a project skill stays manageable even when the host process cwd
  is somewhere else.
- Frontmatter parsing is a lightweight zero-dependency implementation
  (block scalars, booleans, input nested block); exotic YAML features are not
  supported — the official dsh-skill-filesystem provider remains the
  authoritative parser.
- The panel covers the filesystem roots it scans plus the global layer of the
  `ctx.skills` registry (bundled and runtime entries). `customSkillDirs`
  declared on a host-plane `skill-filesystem` row are scanned, because the
  host reads that row's config; a skill that reaches an agent only through an
  **agent preset's** own `customSkillDirs` or a preset-scoped provider is
  outside that coverage, because the panel reads the registry without a
  viewing scope. A skill absent from the panel is therefore not necessarily
  absent from the model: the official `skill` tool catalog is the authority on
  what a session can load.
- The switch on a **"Provided by plugin"** row is a panel-local view
  decision: it changes what this panel lists as invocable, not what the host
  registry loads, so the model still receives the skill. Taking such a skill
  away from the model for real means removing or disabling it where its
  provider gets it.
- Linked skills cannot be deleted (see the security model); enable/disable works
  normally on them (rewriting the target's `SKILL.md` frontmatter). Both
  directory and single-file links list normally; a single-file link (pointing
  at one `.md`) is replaced by a plain file during the atomic rewrite — the link
  is not kept and the target file is left untouched.
- A directory import reads one level and does not recurse: a nested tree has to be pointed at the directory that actually holds the skills. A `.zip` import accepts `SKILL.md` at any depth, so a zipped folder of skills works, but other files in the archive are ignored rather than copied as resources.
- Importing a skill whose name resolves at the same or a stronger source is reported as skipped (`exists` / `shadowed`) rather than replacing that skill; bringing such a name in means renaming the candidate first.
- The fold and facet preferences are per browser profile and survive a panel remount and a page refresh, but not a different browser or an incognito window.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.

## License

BSD-3-Clause.