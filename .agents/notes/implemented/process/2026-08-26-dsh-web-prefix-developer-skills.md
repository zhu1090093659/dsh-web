# Agent Note: dsh-web- prefix for developer skills

Status: implemented

## Problem

The three dsh-web developer skills shipped under bare names — `community-plugin-developer`,
`pet-developer`, `skin-developer` — which collide with the user's global `~/.dsh/skills`
installs of the same skills and carry no repository-ownership signal. Sibling skills in the
same directory already use the `dsh-web-` / `dsh-` prefix (`dsh-web-release`,
`dsh-web-sdk-compatibility`, `dsh-sdk-upgrade`).

## Decision

- Rename the directories and `name:` frontmatter to `dsh-web-<name>`:
  `dsh-web-community-plugin-developer`, `dsh-web-pet-developer`, `dsh-web-skin-developer`.
- Update every in-repository cross-reference: the sibling `dsh-web-release` whenToUse
  text, the renamed skills' own whenToUse disambiguation lists, the miku-pet implemented
  note (EN + ZH), and the `scripts/dsh-skin-new` help text skill paths.

## Alternatives considered

- Keep the bare names and rename only user-facing titles: rejected; the collision with the
  global installs is the problem being fixed.
- Use the `dsh-` prefix: rejected; the sibling skills in the directory already standardize
  on `dsh-web-`.

## Consequences

The skills are invoked as `dsh-web-*` by the model; the global `~/.dsh/skills` copies
under the old names were removed after the rename (2026-08-26), so the loaded catalog
serves the renamed repo copies only.
