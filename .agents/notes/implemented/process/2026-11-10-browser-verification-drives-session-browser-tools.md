# Agent Note: Browser verification drives the session's browser tools, not a fresh Playwright script

Status: implemented

## Problem

The only browser automation in the tree is the Playwright mount lane, and the verification instructions never said which browser an agent should drive. [dsh-web-web-qa](../../../skills/dsh-web-web-qa/SKILL.md) required the real GUI and a screenshot of it but left the driver unstated, while `playwright.config.ts`, `tests/e2e/mount.e2e.ts` and `scripts/e2e-mount.sh` handed every session one browser-shaped tool that is always present. The drift is silent: the session writes a throwaway Playwright script, it passes, and the screenshot in the report comes from a second browser with an empty scratch profile rather than from the surface the user is looking at. The mount lane also charges its full cost for every look it serves, because it packs the aggregate, installs it into a scratch profile and boots a host before any assertion runs - it is a gate, not an inspection.

## Decision

When a verification needs a browser, the browser tools the session mounts drive it, and Playwright is the fallback rather than the default.

- **The rule and the procedure each have one home.** The one-line rule sits in the Development Workflow section of the root [AGENTS.md](../../../../AGENTS.md); [dsh-web-web-qa](../../../skills/dsh-web-web-qa/SKILL.md) owns the procedure - which tools drive a check, when Playwright is still the right tool, and how the reported evidence names the driver.
- **The browser tools win while they are mounted.** `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_console` and their siblings act on the GUI at its real URL, in the profile the user is running, so the settings, skins, sessions and task board under test are the real ones.
- **Playwright keeps two jobs.** It remains the committed reproducible lane (`pnpm test:mount` through `scripts/e2e-mount.sh` and `tests/e2e/mount.e2e.ts`), untouched by this decision, and it remains the fallback for a session that mounts no browser tool, or for scripted repetition the tools do not offer.
- **The evidence names the driver.** A report carrying a screenshot states which of the two produced it, so a reader can tell a render of the user's own GUI from a render of a scratch instance.

## Alternatives considered

**Always use Playwright for GUI verification.** Rejected: it boots its own browser and its own scratch host, so it verifies a freshly mounted bundle in isolation instead of the surface the user is using, and its screenshot documents a render nobody asked about. Every look costs a pack, an install and a host boot.

**Delete the Playwright lane and verify mount claims by hand with browser tools.** Rejected: the lane is deterministic and machine-checked - DOM markers, console prefixes, crash strips - and it runs in CI and pre-push without a human. Hand verification would replace that with a one-off look and bring back the flake the lane removes.

**State no preference and let each session choose.** Rejected: the tree holds only Playwright, so silence resolves to Playwright, which is exactly the drift this change corrects. A default needs an owner.

**Put the whole procedure in the root AGENTS.md.** Rejected: the root file carries global rules of one to three lines and links their owner, so tool-level procedure there would bloat a file every session reads.

## Consequences

- A GUI verification inspects the running GUI: the captured screenshot shows what the user sees, and the states under test are that profile's states rather than an empty profile's.
- The committed mount lane is unchanged, so CI and pre-push keep the deterministic mount gate.
- A session without browser tools falls back to Playwright and says so, which keeps the evidence honest about what produced it.
- The browser tools act on the user's running host, so the existing boundaries carry the rest: no restart of the running service, no replacement server, and temporary browser task spaces are closed when the check ends ([shared DSH home probe isolation](2026-10-02-shared-dsh-home-probe-isolation.md)).
- This decision changes no runtime code; its gate is `pnpm docs:check` for the links and pairs, plus review of the two edited skills.
