# Agent Note: personal developer skills resolve from the skills home

Status: implemented

## Problem

`.dsh/skills/` carried two copies of personal developer skills: `dsh-sdk-upgrade` (with `scripts/profile-cohort-check.sh`) and `dsh-web-sdk-compatibility`. Both duplicate the canonical copies under `~/.agents/skills/`, the home the global instruction layout names for personal instructions, skills, and workflow scripts. The copies had already diverged: `dsh-web-sdk-compatibility/SKILL.md` and `profile-cohort-check.sh` are byte-identical to their personal counterparts, while the repository `dsh-sdk-upgrade/SKILL.md` is older than the personal copy (the desktop-runtime host-floor surface, the mandatory full-suite re-derivation, and `pnpm test:desktop` exist only there). `scripts/rollout-verify.sh` had already switched its delegation to `$HOME/.agents/skills/dsh-sdk-upgrade/scripts/profile-cohort-check.sh`, so the repository copies were dead weight that an agent browsing the project skills root could still load.

## Decision

- Delete `.dsh/skills/dsh-sdk-upgrade/` (both files) and `.dsh/skills/dsh-web-sdk-compatibility/`; `dsh-sdk-upgrade` and `dsh-sdk-compatibility` resolve from `~/.agents/skills/`.
- Keep the four repository-owned skills in `.dsh/skills/`: `dsh-web-skin-developer`, `dsh-web-pet-developer`, `dsh-web-community-plugin-developer`, and `dsh-web-release`. They describe this repository's packages, generators, and release pipeline and version together with it.
- No document or script is updated: the only live reference to a personal skill (`scripts/rollout-verify.sh`) already names the personal path and keeps its skip-with-warning fallback.

## Superseded in part

The "keep the four repository-owned skills in `.dsh/skills/`" bullet is superseded by [repository skills resolve from the .agents skills home](../process/2026-09-14-repository-skills-agents-home.md): those skills now live in `.agents/skills/`. The rest of this decision still holds.

## Alternatives considered

- Keeping the repository copies in sync with the personal skills: rejected - the personal skills evolve on their own schedule, so a vendored copy can only go stale, and the upgrade skill had already done so.
- Moving the four repository-owned skills into the personal home as well: rejected - their content is repository-specific and must version with the code they describe.

## Consequences

- A session listing project skills no longer finds a second, older copy of the upgrade workflow; the personal skills home is the single source.
- The repository no longer vendors `profile-cohort-check.sh`; `scripts/rollout-verify.sh` skips that check with a warning on a machine without the personal skill, which is its existing behavior.

## Testing

- Content comparison before deletion: `dsh-web-sdk-compatibility/SKILL.md` and `dsh-sdk-upgrade/scripts/profile-cohort-check.sh` are identical to the personal copies; the `dsh-sdk-upgrade/SKILL.md` differences are additions present only in the personal copy.
- `pnpm test:scripts` (270 pass, 0 fail) and `pnpm docs:check` pass on the tree with the deletion applied.
- A repository-wide search for `dsh-sdk-upgrade` and `dsh-web-sdk-compatibility` finds no live reference outside frozen archives, release notes, and the personal-path delegation in `scripts/rollout-verify.sh`.
