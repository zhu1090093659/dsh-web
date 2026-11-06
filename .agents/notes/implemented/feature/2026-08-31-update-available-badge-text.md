# Agent Note: Sidebar Update Trigger Renders Text Badge When an Update Is Available

Status: implemented

> Superseded: the package this note describes has been deleted — see [The family removes the self-update package](../simplification/2026-11-06-remove-dsh-update-package.md). The note is kept for the badge's visual rationale only.

## Problem

The `dsh-update` plugin rendered the check-for-updates trigger in the sidebar footer (it was `dsh-remote-web-ui` before the self-update split). When the background probe detected a newer release (`updateAvailable === true`), it only showed a small dot badge (`::after`) on the download icon. The visual indicator was subtle and easy to overlook.

## Decision

- **Text Badge Rendering**: When an update is detected, the sidebar update trigger displays an explicit "Update available" text badge (`update.badge` key) next to the download icon.
- **Wide vs Rail Mode Adaptation**:
  - **Wide expanded mode (`wide === true`)**: The button expands into a pill button (`border-radius: 999px`, `flex: none; width: auto; padding: 0 10px; gap: 6px;`), rendering the icon and text side by side and suppressing the floating corner dot to avoid visual clutter.
  - **Rail collapsed mode (`wide === false`, 56px rail)**: Retains the 36px circular geometry, hides the text label, and preserves the top-right corner dot badge so 56px rail layout is not disturbed.
- **Internationalization (i18n)**:
  - Chinese (`zh`): `'update.badge': '有更新'`
  - English (`en`): `'update.badge': 'Update available'`
  - Russian (`ru`): `'update.badge': 'Есть обновление'` (synchronized in `packages/dsh-i18n/src/client/ru/update.ts`).

## Alternatives considered

- Relying solely on hover `title` / tooltip: Missed by users who do not hover over the icon.
- Forcing text display in rail mode: Breaks the 56px rail geometry and causes awkward overflow clipping.

## Consequences

- Users in the expanded sidebar immediately see that a newer version is available.
- Switching between rail and wide modes remains fluid and maintains the `#1035` uniform rounding family.
