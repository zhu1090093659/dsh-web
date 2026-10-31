#!/usr/bin/env node
'use strict'

/**
 * sync-shared — mirror shared/client/settings and shared/host (the
 * family-shared modules) into the consuming plugin packages.
 *
 * The trio lives exactly once under shared/client/settings and is copied,
 * with a generated-file header, to each consumer's src/client/. The copies
 * are committed (same policy as the dsh-skins built assets) so packages stay
 * self-contained for typecheck, test, and publish. The --check mode fails on
 * any drift and runs in CI through test:scripts.
 *
 * Usage:
 *   node scripts/sync-shared.mjs             # rewrite every consumer copy
 *   node scripts/sync-shared.mjs --check     # fail when any copy drifts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')
/**
 * The sync manifest: every shared-module copy this repo carries. Sources
 * live exactly once under shared/; consumers import the committed copy.
 */
// Consumers of the settings card trio: one list, three derivations below.
// dsh-web-settings consumes the trio too: the family-wide telemetry switch is a
// page-level setting, so it renders through the same card chrome (a static
// header plus a trailing switch) instead of a section of its own.
const SETTINGS_CONSUMERS = ['dsh-web-settings', 'dsh-task-board', 'dsh-task-board-github', 'dsh-market', 'dsh-liangshen', 'dsh-agents', 'dsh-usage', 'dsh-browser-view']
const SETTINGS_CARD_CONSUMERS = [...SETTINGS_CONSUMERS]
// Consumers of the entry-bound form fallback: every package whose card binds a
// family settings namespace through the shared forms service. It is a superset
// of the card trio — dsh-session-archive carries its own card but binds the
// same way.
// dsh-web-settings is deliberately absent: it renders the card chrome around a
// local browser preference and binds no Host namespace, so it needs no entry-
// bound form transport.
const SETTINGS_ENTRY_FORM_CONSUMERS = [
  ...SETTINGS_CONSUMERS.filter(pkg => pkg !== 'dsh-web-settings'),
  'dsh-session-archive',
]

const MANIFEST = [
  {
    file: 'settings-form.ts',
    source: 'shared/client/settings/settings-form.ts',
    targets: SETTINGS_CONSUMERS.map(pkg => `packages/${pkg}/src/client/settings-form.ts`),
  },
  {
    file: 'PluginSettingsCard.tsx',
    source: 'shared/client/settings/PluginSettingsCard.tsx',
    targets: SETTINGS_CONSUMERS.map(pkg => `packages/${pkg}/src/client/PluginSettingsCard.tsx`),
  },
  {
    file: 'settings-card.module.css',
    source: 'shared/client/settings/settings-card.module.css',
    targets: SETTINGS_CARD_CONSUMERS.map(pkg => `packages/${pkg}/src/client/settings-card.module.css`),
  },
  {
    // The segmented control with the sliding highlight: the card fields'
    // small choices render through it, and so does the Web Extensions TAB
    // strip in dsh-web-settings.
    file: 'SegmentGroup.tsx',
    source: 'shared/client/settings/SegmentGroup.tsx',
    targets: SETTINGS_CARD_CONSUMERS.map(pkg => `packages/${pkg}/src/client/SegmentGroup.tsx`),
  },
  {
    // The coarse slider bubble a bounded numeric field offers on hover.
    file: 'RangeBubble.tsx',
    source: 'shared/client/settings/RangeBubble.tsx',
    targets: SETTINGS_CARD_CONSUMERS.map(pkg => `packages/${pkg}/src/client/RangeBubble.tsx`),
  },
  {
    // One settings page's seat in either the Web Extensions parent or the
    // legacy first-level settings navigation. The service owns keyed mounting;
    // this helper only reconciles the standalone fallback.
    file: 'web-extension-page.ts',
    source: 'shared/client/settings/web-extension-page.ts',
    targets: [
      'packages/dsh-market/src/client/web-extension-page.ts',
      'packages/dsh-usage/src/client/web-extension-page.ts',
    ],
  },
  {
    // Family plugin-card seat: one card component, dispatched into whichever
    // plugin-card seat the running host declares (the family group's list seat
    // or the official keyed one), with the refusal logged rather than swallowed
    // (issue #1589).
    file: 'plugin-card-seat.ts',
    source: 'shared/client/settings/plugin-card-seat.ts',
    targets: [
      'packages/dsh-task-board/src/client/plugin-card-seat.ts',
      'packages/dsh-liangshen/src/client/plugin-card-seat.ts',
      'packages/dsh-agents/src/client/plugin-card-seat.ts',
      'packages/dsh-browser-view/src/client/plugin-card-seat.ts',
    ],
  },
  {
    // Fallback settings transport for a page that serves no family binder: the
    // form is bound to the profile entry id the Host actually serves, and
    // rebound when the shared describe mirror answers with a different one of
    // this package's rows. A one-shot guess left the card on an entry the Host
    // does not serve, so every save was rejected (issue: the LiangShen card
    // reported "the deployment did not accept these values" for every edit).
    file: 'settings-entry-form.ts',
    source: 'shared/client/settings/settings-entry-form.ts',
    targets: SETTINGS_ENTRY_FORM_CONSUMERS.map(pkg => `packages/${pkg}/src/client/settings-entry-form.ts`),
  },
  {
    file: 'dsh-home.ts',
    source: 'shared/host/dsh-home.ts',
    targets: [
      'packages/dsh-liangshen/src/dsh-home.ts',
      'packages/dsh-task-board/src/dsh-home.ts',
      'packages/dsh-plugin-manager/src/host/dsh-home.ts',
      'packages/dsh-ssh/src/dsh-home.ts',
      'packages/dsh-web-settings/src/dsh-home.ts',
      'packages/dsh-market/src/dsh-home.ts',
      'packages/dsh-git-graph/src/host/dsh-home.ts',
      'packages/dsh-usage/src/dsh-home.ts',
      'packages/dsh-session-archive/src/dsh-home.ts',
      'packages/dsh-remote-bridge/src/host/dsh-home.ts',
    ],
  },
  {
    // Tool-surface conventions: the prompt-section order band, the
    // visibility-gated guidance provider, and the per-agent scoped install
    // lifecycle shared by every package that registers model-facing tools.
    file: 'tool-surface.ts',
    source: 'shared/host/tool-surface.ts',
    targets: [
      'packages/dsh-ssh/src/tool-surface.ts',
      'packages/dsh-task-board/src/tool-surface.ts',
      'packages/dsh-task-board-github/src/tool-surface.ts',
      'packages/dsh-agents/src/tool-surface.ts',
    ],
  },
  {
    file: 'mount-once.ts',
    source: 'shared/host/mount-once.ts',
    targets: [
      'packages/dsh-ssh/src/mount-once.ts',
      'packages/dsh-remote-bridge/src/mount-once.ts',
      'packages/dsh-liangshen/src/mount-once.ts',
      'packages/dsh-task-board/src/mount-once.ts',
      'packages/dsh-task-board-github/src/mount-once.ts',
      'packages/dsh-git-graph/src/mount-once.ts',
      'packages/dsh-plugin-manager/src/mount-once.ts',
      'packages/dsh-web-settings/src/mount-once.ts',
      'packages/dsh-skill-explorer/src/mount-once.ts',
      'packages/dsh-market/src/mount-once.ts',
      'packages/dsh-usage/src/mount-once.ts',
      'packages/dsh-session-archive/src/mount-once.ts',
      'packages/dsh-update/src/mount-once.ts',
    ],
  },

  {
    file: 'telemetry.ts',
    source: 'shared/client/telemetry.ts',
    targets: [
      'packages/dsh-market/src/client/telemetry.ts',
      'packages/dsh-message-edit/src/client/telemetry.ts',
      'packages/dsh-git-graph/src/client/telemetry.ts',
      'packages/dsh-plugin-manager/src/client/telemetry.ts',
      'packages/dsh-session-id/src/client/telemetry.ts',
      'packages/dsh-skill-explorer/src/client/telemetry.ts',
      'packages/dsh-ssh/src/client/telemetry.ts',
      'packages/dsh-task-board/src/client/telemetry.ts',
      'packages/dsh-web-settings/src/client/telemetry.ts',
      'packages/dsh-update/src/client/telemetry.ts',
    ],
  },
  {
    // Main-view Session derivation: the Client Session Controller dropped its
    // global `current` selection at 0.1.6-alpha.2 in favour of per-source
    // ownership counts, so every plugin that needs "the session the main view
    // shows" shares this one derivation instead of guessing at a replacement.
    file: 'main-session.ts',
    source: 'shared/client/main-session.ts',
    targets: [
      'packages/dsh-task-board/src/client/main-session.ts',
      'packages/dsh-session-id/src/client/main-session.ts',
      'packages/dsh-liangshen/src/client/main-session.ts',
      'packages/dsh-git-graph/src/client/main-session.ts',
      'packages/dsh-session-archive/src/client/main-session.ts',
    ],
  },
  {
    file: 'pair-access.ts',
    source: 'shared/host/pair-access.ts',
    targets: ['packages/dsh-git-graph/src/host/pair-access.ts', 'packages/dsh-skill-explorer/src/pair-access.ts', 'packages/dsh-usage/src/host/pair-access.ts'],
  },
  {
    file: 'loopback.ts',
    source: 'shared/host/loopback.ts',
    targets: ['packages/dsh-ssh/src/loopback.ts', 'packages/dsh-git-graph/src/host/loopback.ts', 'packages/dsh-task-board/src/loopback.ts', 'packages/dsh-task-board-github/src/loopback.ts', 'packages/dsh-skill-explorer/src/loopback.ts', 'packages/dsh-plugin-manager/src/host/loopback.ts', 'packages/dsh-market/src/loopback.ts', 'packages/dsh-usage/src/host/loopback.ts', 'packages/dsh-session-archive/src/host/loopback.ts', 'packages/dsh-update/src/loopback.ts', 'packages/dsh-browser-view/src/host/loopback.ts'],
  },
  {
    file: 'http.ts',
    source: 'shared/host/http.ts',
    targets: [
      'packages/dsh-market/src/http.ts',
      'packages/dsh-skill-explorer/src/http.ts',
      'packages/dsh-web-settings/src/http.ts',
      'packages/dsh-git-graph/src/host/http.ts',
      'packages/dsh-ssh/src/http.ts',
      'packages/dsh-plugin-manager/src/host/http.ts',
      'packages/dsh-task-board/src/http.ts',
      'packages/dsh-task-board-github/src/host/http.ts',
      'packages/dsh-usage/src/host/http.ts',
      'packages/dsh-session-archive/src/host/http.ts',
      'packages/dsh-update/src/http.ts',
    ],
  },
  {
    // The shared setup carries the browser-module loader and the storage
    // repair Node 25 needs (see its header); a consumer of the shared vitest
    // config runs this copy through setupFiles.
    file: 'vitest.setup.ts',
    source: 'shared/vitest.setup.ts',
    targets: [
      'packages/dsh-web-settings/vitest.setup.ts',
      'packages/dsh-git-graph/vitest.setup.ts',
      'packages/dsh-task-board/vitest.setup.ts',
      'packages/dsh-task-board-github/vitest.setup.ts',
      'packages/dsh-update/vitest.setup.ts',
    ],
  },
  {
    // Page-wide body mutation hub: exactly one document.body childList
    // observer shared by every family consumer (sidebar entries, center
    // panels, the aggregate shell shims), instead of one per plugin.
    file: 'body-mutations.ts',
    source: 'shared/client/body-mutations.ts',
    targets: [
      'packages/dsh-web-all/src/client/body-mutations.ts',
      'packages/dsh-usage/src/client/body-mutations.ts',
      // The plugin-manager toolbar is injected beside the official Plugins
      // page's "Installed" heading (the page declares no seat there), so it
      // re-seats itself with the same page-wide invalidation hub the sidebar
      // foot card uses instead of paying for a second body observer.
      'packages/dsh-plugin-manager/src/client/body-mutations.ts',
      // The task board hides the official automation-tasks sidebar row while
      // it is on, and the shell owns that row: it may mount or replace it at
      // any time, so the guard re-applies its write through the same hub
      // instead of paying for a second body observer.
      'packages/dsh-task-board/src/client/body-mutations.ts',
    ],
  },
  {
    // Child-process output capture: byte accumulation with a single decode so
    // a Windows console's code page (CP936/GBK) never becomes replacement
    // characters, and a character split across two `data` reads is restored.
    file: 'console-output.ts',
    source: 'shared/host/console-output.ts',
    targets: [
      'packages/dsh-plugin-manager/src/host/console-output.ts',
      'packages/dsh-update/src/console-output.ts',
    ],
  },
  {
    // Leaving the caller's async context: a Host mutation inside
    // `hmr.runExclusive` that writes an HMR-watched file (cordis.patch.yml)
    // makes the watcher's refresh re-enter the transaction and be refused with
    // "HMR transactions cannot be nested". A bare deferral does not detach -
    // see the module header - so the remote-web-ui LAN-bind write and the
    // plugin-manager set-enabled write schedule through this one resource
    // (#1751, #1754, #1816).
    file: 'detached-work.ts',
    source: 'shared/host/detached-work.ts',
    targets: [
      'packages/dsh-plugin-manager/src/host/detached-work.ts',
    ],
  },
]

/** One source-to-consumer copy step. */
export function copyEntries(root = REPO_ROOT) {
  return MANIFEST.flatMap(entry => entry.targets.map(target => ({
    source: join(root, entry.source),
    target: join(root, target),
    file: entry.file,
    sourceRel: entry.source,
  })))
}

/** Generated-file header prepended to every copy. */
export function headerFor(file, sourceRel = `shared/client/settings/${file}`) {
  const body = `Generated by scripts/sync-shared.mjs from ${sourceRel}. Do not edit this copy; edit the shared source and run "node scripts/sync-shared.mjs".`
  return file.endsWith('.css') ? `/* ${body} */` : `// ${body}`
}

/** Render a consumer copy from its shared source. */
export function renderCopy(sourceText, file, sourceRel) {
  return `${headerFor(file, sourceRel)}
${sourceText}`
}

/** Recover the shared source text from a rendered copy (undefined when the header is missing or mangled). */
export function stripHeader(rendered, file, sourceRel) {
  const header = headerFor(file, sourceRel)
  if (!rendered.startsWith(header)) return undefined
  return rendered.slice(header.length + 1)
}

/** Apply every copy step. Returns the number of rewritten files. */
export async function applySync(root = REPO_ROOT) {
  let written = 0
  for (const { source, target, file, sourceRel } of copyEntries(root)) {
    const sourceText = await readFile(source, 'utf8')
    const rendered = renderCopy(sourceText, file, sourceRel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, rendered)
    written += 1
  }
  return written
}

/** Compare every copy against its source. Returns the drifted entries. */
export async function checkSync(root = REPO_ROOT) {
  const drift = []
  for (const { source, target, file, sourceRel } of copyEntries(root)) {
    const sourceText = await readFile(source, 'utf8')
    let rendered
    try {
      rendered = await readFile(target, 'utf8')
    } catch {
      drift.push({ target, reason: 'missing' })
      continue
    }
    const stripped = stripHeader(rendered, file, sourceRel)
    if (stripped === undefined) {
      drift.push({ target, reason: 'header missing or mangled' })
    } else if (stripped !== sourceText) {
      drift.push({ target, reason: 'content drifted from shared source' })
    }
  }
  return drift
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--check') {
    const drift = await checkSync()
    if (drift.length > 0) {
      for (const entry of drift) {
        console.error(`[sync-shared] drift: ${entry.target} (${entry.reason})`)
      }
      console.error(`[sync-shared] ${drift.length} consumer copy(ies) out of sync; run "node scripts/sync-shared.mjs"`)
      process.exit(1)
    }
    console.log('[sync-shared] all consumer copies in sync')
    return
  }
  if (mode !== undefined) {
    console.error('usage: node scripts/sync-shared.mjs [--check]')
    process.exit(2)
  }
  const written = await applySync()
  console.log(`[sync-shared] wrote ${written} consumer copies`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
