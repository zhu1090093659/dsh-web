# Agent Note: Batch Core Bug Fixes (Resolving #1275, #1272, #1269, #1267, #1265, #1257, #1258)

Status: implemented

## Problem

Resolved 7 core bug and defect issues across the monorepo:
1. **#1275**: scripts/build-cohort-tarballs.mjs failed on Windows with spawn ENOENT on pnpm, GNU tar drive letter misinterpretation, and cross-device rename EXDEV.
2. **#1272**: cordis.patch.yml triggered TAG_RESOLVE_FAILED warning on unparsed !!js dshHomePath(...).
3. **#1269**: dsh-perf content-visibility: auto clipped horizontal overflow of markdown wide tables (.md-table-wide).
4. **#1267**: @linxin666/dsh-doctor Windows scheduled task launched a visible persistent console window on logon.
5. **#1265**: 	rading skin viewport clearance padding was overridden by skin-center Viewport lock padding: 0 !important.
6. **#1257**: dsh-perf better-session migration child spawn produced C:\C:\... duplicate drive letters on Windows.
7. **#1258**: deep-current skin flow animation suffered abrupt jump resetting in 
o-repeat mode.

## Decision

1. **Windows Script Cross-Platform Compatibility (#1275, #1257)**:
   - Added Windows command/shell resolution for pnpm, prioritized System32 bsdtar, and handled EXDEV with copyFileSync fallback in uild-cohort-tarballs.mjs;
   - Used ileURLToPath(moduleUrl) in dsh-perf/src/bsm/service.ts.
2. **Eliminated YAML Tag Warnings (#1272)**:
   - Removed unparsed oot: !!js in dsh-perf/cordis.patch.yml, sanitized !!js tag expressions in scripts/aggregate.mjs, and regenerated aggregate cordis.patch.yml.
3. **Preserved Wide Table Rendering (#1269)**:
   - Excluded .md-table-wide rows from content-visibility and linked P0 CSS injection to the enderDegrade setting.
4. **Silent Windows Supervisor Task (#1267)**:
   - Generated supervisor.vbs silent wrapper executed via wscript.exe to suppress console popup.
5. **Skin Layout & Flow Animation (#1265, #1258)**:
   - Relocated 	rading skin clearance padding to [id=root];
   - Updated deep-current glow keyframes to ease-in-out alternate for smooth seamless loop;
   - Refreshed market/dist artifacts with 
ode scripts/market-build.

## Consequences

All unit tests, script tests, and documentation gates pass cleanly. Cross-platform workflows, background services, table display, and skin animations are fully restored.
