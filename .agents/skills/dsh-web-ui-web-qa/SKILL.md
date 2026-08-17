---
name: dsh-web-ui-web-qa
description: Use to validate a dsh-web-ui client or skin change in the real DeepSeek Harness Web GUI, including build readiness, responsive rendering, interaction checks, and evidence capture.
whenToUse: A dsh-web-ui change affects browser-rendered UI, client-side behavior, styles, skins, or GUI-facing plugin integration.
user-invocable: true
---

# Validating dsh-web-ui in the Web GUI

Use the real DSH Web GUI and the profile that loads the affected bundle. This skill covers client-facing verification; it does not replace unit tests, host tests, or repository gates.

## Prepare the actual runtime

1. Build the affected plugin or skin through its documented package command. Run the focused unit tests and `pnpm runtime-deps:check` when client runtime imports changed.
2. Do not start a replacement standalone Vite application. The DSH Web shell requires its host boot data and must be verified through the existing DSH GUI.
3. Confirm whether the documented HMR path applies. Otherwise refresh the real GUI after rebuilding and verify the loaded bundle is the changed one.

## Exercise the user-visible behavior

- Use the application route and workflow a user actually reaches, not only an isolated component mount.
- Check the changed feature plus its expected empty, loading, error, disabled, and persisted states where they exist.
- Inspect at a desktop and a narrow mobile viewport when the surface is responsive. Verify text fits, controls remain reachable, and layout does not overlap or leave a blank panel.
- Check browser console errors and failed asset loads. For stateful or security-sensitive UI, exercise the relevant confirmation, failure, and cleanup paths.
- Capture a screenshot or other concise evidence when the change is user-visible. Close temporary browser task spaces after the verification unless the user needs the page left open.

## Report evidence honestly

State the exact GUI URL or profile used, the build and reload path, the interactions exercised, and the observed result. If the environment cannot run the live GUI, report that limitation and the strongest non-visual evidence obtained.
