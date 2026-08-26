# Agent Note: recover hooks for legacy Workshop skin installs

Status: implemented

## Problem

Workshop skin installs created before the installer began writing `dsh-market.provenance.json` remain in `$DSH_HOME/skins/<id>/` after an upgrade and shadow the repository catalog copy. The hooks trust gate correctly refuses a user-directory skin without provenance, but this also disables reviewed effects from those historical installs. Matrix consequently kept its declarative dark palette while its `hooks.mjs` request returned 403, so the digital-rain canvas and forced-dark lifecycle never mounted.

## Decision

The Skin Center carries a generated registry of sha256 identities for every reviewed repository skin that declares a hooks facet. Valid official-market provenance remains the primary trust path. When provenance is missing or invalid, a user-directory skin may recover hooks only when its id, declared entry path, complete `skin.json` bytes, and hooks bytes all match one generated reviewed identity. The fallback is read-only: it never writes provenance, downloads content, or replaces the user's directory. `scripts/skin-hooks-registry.mjs --check` and `skin-center:check` reject registry drift whenever a reviewed manifest or hook changes.

## Alternatives considered

Automatically force-reinstalling missing-provenance skins from dsh-market.com was rejected because it requires network access and silently replaces local files. Trusting an id that also exists in the repository was rejected because a hand-dropped directory could reuse that id with arbitrary executable hooks. Trusting only a matching hook hash was rejected because a rewritten manifest could repoint or change the declared contract; both the manifest and entry bytes must match the reviewed identity.

## Consequences

Historical official Workshop installs regain reviewed hook effects without mutation or network access. A renamed, manifest-modified, or hook-tampered directory remains fail-closed; declarative CSS and assets stay outside this executable identity and may remain locally customized. The route re-verifies current bytes on every hook request, so a cached catalog cannot preserve trust after tampering. New Workshop installs keep using provenance, and maintainers must regenerate the reviewed registry whenever a hook-bearing skin changes. The Matrix repair is verified in the real GUI at `http://127.0.0.1:3080`: its 1440 by 900 fixed canvas mounts at opacity 0.1, forces the dark flag, and contains rendered green glyph pixels.
