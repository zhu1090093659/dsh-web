---
name: dsh-web-web-qa
description: Use to validate a dsh-web client or skin change in the real DeepSeek Harness Web GUI, including build readiness, responsive rendering, interaction checks, and evidence capture.
whenToUse: A dsh-web change affects browser-rendered UI, client-side behavior, styles, skins, or GUI-facing plugin integration.
user-invocable: true
---

# Validating dsh-web in the Web GUI

Use the real DSH Web GUI and the profile that loads the affected bundle. This skill covers client-facing verification; it does not replace unit tests, host tests, or repository gates.

## Prepare the actual runtime

1. Build the affected plugin or skin through its documented package command. Run the focused unit tests and `pnpm runtime-deps:check` when client runtime imports changed.
2. Do not start a replacement standalone Vite application. The DSH Web shell requires its host boot data and must be verified through the existing DSH GUI.
3. Confirm whether the documented HMR path applies. Otherwise refresh the real GUI after rebuilding and verify the loaded bundle is the changed one.
4. When the verification needs its own host, point `DSH_HOME` at a scratch directory (`DSH_HOME=/tmp/dsh-verify-<topic>` with a free `--port`). A private home gives the probe its own profiles, sessions, settings, skins and task-board ledger, so it cannot deny the user's host the ledger lock or overwrite their state. A different port alone isolates nothing.
5. Run every helper that writes to a current directory somewhere disposable (`cd "$(mktemp -d)"`), never in the checkout, and name absolute paths in any delete. Archive extraction in particular writes the member under its own basename, which can overwrite a repository file at the tool's default working directory.

## Drive the browser

- Prefer the browser tools this session already exposes. When `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_console` and their siblings are mounted, they drive and capture the whole verification: they act on the GUI at its real URL, in the profile the user is using, with that profile's settings, skins and sessions under test.
- Playwright is the reproducible lane, not a way to look at the GUI. `playwright.config.ts`, `tests/e2e/mount.e2e.ts` and `scripts/e2e-mount.sh` are one committed gate (`pnpm test:mount`): they pack the aggregate, install it into a scratch profile, boot their own host and assert DOM markers headlessly. Run an ad-hoc Playwright script in their place and the evidence describes a second browser and a render the user is not looking at.
- Fall back to Playwright only when the session mounts no browser tool, when the check is that committed lane, or when the behavior needs scripted repetition the tools do not offer. State in the reported evidence which of the two drove the check.
- Leave the user's surface as found. Work in the tabs the tools create, close temporary browser task spaces when the verification ends, and never restart the host or stand up a replacement server to get a page worth looking at (Prepare step 2).

## Exercise the user-visible behavior

- Use the application route and workflow a user actually reaches, not only an isolated component mount.
- Check the changed feature plus its expected empty, loading, error, disabled, and persisted states where they exist.
- Inspect at a desktop and a narrow mobile viewport when the surface is responsive. Verify text fits, controls remain reachable, and layout does not overlap or leave a blank panel.
- Check browser console errors and failed asset loads. For stateful or security-sensitive UI, exercise the relevant confirmation, failure, and cleanup paths.
- Capture a screenshot or other concise evidence when the change is user-visible. Close temporary browser task spaces after the verification unless the user needs the page left open.

## Stop what you started

Every instance the verification starts is stopped before the session reports the result. Launch background instances as managed background jobs, or keep their pid, and terminate them in the same session; an orphan reparented to launchd keeps holding the task-board ledger lock and the user's host cannot take the board.

A shared service that reports a foreign owner names the pid (`task-board ledger is already owned by process <pid>`). Inspect that pid before signalling anything, terminate only processes attributable to this verification, and never signal the user's running host. Terminating one pid is not always enough: instances started in the same batch share a profile and a start time, and whichever survives takes the lock next. Record the reaping in the reported evidence; if an instance cannot be stopped, say so.

## Report evidence honestly

State the exact GUI URL or profile used, the build and reload path, the interactions exercised, and the observed result. If the environment cannot run the live GUI, report that limitation and the strongest non-visual evidence obtained.
