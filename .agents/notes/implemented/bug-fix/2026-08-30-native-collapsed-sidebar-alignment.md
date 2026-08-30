# Agent Note: Native collapsed sidebar entry alignment

Status: implemented

## Problem

Task Board and SSH require the aggregate's `data-dsh-frame` marker to apply their collapsed entry styles. The official default shell supplies `data-sidebar-collapsed` without that extra marker when the plugins are installed independently. Their entries retain expanded padding and visible label boxes, shifting the icons 4 CSS pixels right of the native rail icons.

## Decision

Both plugin stylesheets use the native `[data-sidebar-collapsed]` ancestor for their CSS-module-scoped entry and label rules. The existing icon dimensions, target dimensions, mobile touch sizing, theme tokens, and expanded styles remain unchanged. The same selector also matches an aggregate-decorated frame.

## Alternatives considered

Adding or requiring the aggregate compatibility frame would couple independent plugins to an unrelated bundle and would leave standalone installations broken.

Hard-coded negative margins or transforms would compensate for one rendered offset while leaving expanded padding and label layout active. The existing collapsed layout already expresses the intended alignment once it matches the native shell.

## Consequences

The official default skin centers the affected icons without requiring a custom skin or aggregate bundle. Regression tests apply the real entry CSS to native and aggregate-decorated DOM fixtures, check centered icon-only collapsed styles, and verify that removing the collapsed attribute restores expanded text and padding. Browser evidence covers the actual default shell; no DSH source changes are required.
