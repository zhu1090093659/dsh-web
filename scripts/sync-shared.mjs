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
const SETTINGS_CONSUMERS = ['dsh-pet', 'dsh-task-board', 'dsh-remote-web-ui', 'dsh-tool-describe-image', 'dsh-desktop-launcher', 'dsh-doctor', 'dsh-market']
// dsh-perf still runs the pre-0.1.2 per-field settings-form generation (its
// save path judges every write per-field instead of the shared atomic mutate
// + read-back), so the form source must not overwrite it. Its card chrome and
// stylesheet carry no local delta and sync like every other consumer; leaving
// them out is what let dsh-perf serve a stale stylesheet while the aggregate
// inlined the fresh one.
const SETTINGS_CARD_ONLY_CONSUMERS = ['dsh-perf']
const SETTINGS_CARD_CONSUMERS = [...SETTINGS_CONSUMERS, ...SETTINGS_CARD_ONLY_CONSUMERS]

const MANIFEST = [
  {
    file: 'settings-form.ts',
    source: 'shared/client/settings/settings-form.ts',
    targets: SETTINGS_CONSUMERS.map(pkg => `packages/${pkg}/src/client/settings-form.ts`),
  },
  {
    file: 'PluginSettingsCard.tsx',
    source: 'shared/client/settings/PluginSettingsCard.tsx',
    targets: [
      ...SETTINGS_CONSUMERS.map(pkg => `packages/${pkg}/src/client/PluginSettingsCard.tsx`),
      // dsh-perf imports the card under its pre-shared lowercase local name.
      'packages/dsh-perf/src/client/plugin-settings-card.tsx',
    ],
  },
  {
    file: 'settings-card.module.css',
    source: 'shared/client/settings/settings-card.module.css',
    targets: SETTINGS_CARD_CONSUMERS.map(pkg => `packages/${pkg}/src/client/settings-card.module.css`),
  },
  {
    file: 'poll-guard.ts',
    source: 'shared/host/poll-guard.ts',
    targets: [
      'packages/dsh-git-graph/src/host/poll-guard.ts',
    ],
  },
  {
    // Async-boundary guard: routed HTTP handlers of every package with an
    // in-process HTTP face adopt it; more packages adopt incrementally.
    file: 'run-guarded.ts',
    source: 'shared/host/run-guarded.ts',
    targets: [
      'packages/dsh-usage/src/host/run-guarded.ts',
      'packages/dsh-task-board/src/host/run-guarded.ts',
      'packages/dsh-git-graph/src/host/run-guarded.ts',
      'packages/dsh-pet/src/host/run-guarded.ts',
    ],
  },
  {
    file: 'dsh-home.ts',
    source: 'shared/host/dsh-home.ts',
    targets: [
      'packages/dsh-pet/src/dsh-home.ts',
      'packages/dsh-liangshen/src/dsh-home.ts',
      'packages/dsh-task-board/src/dsh-home.ts',
      'packages/dsh-plugin-manager/src/host/dsh-home.ts',
      'packages/dsh-remote-web-ui/src/dsh-home.ts',
      'packages/dsh-ssh/src/dsh-home.ts',
      'packages/dsh-desktop-launcher/src/dsh-home.ts',
      'packages/dsh-web-settings/src/dsh-home.ts',
      'packages/dsh-market/src/dsh-home.ts',
      'packages/dsh-git-graph/src/host/dsh-home.ts',
      'packages/dsh-usage/src/dsh-home.ts',
      'packages/dsh-session-archive/src/dsh-home.ts',
    ],
  },
  {
    file: 'git-runner.ts',
    source: 'shared/host/git-runner.ts',
    targets: ['packages/dsh-git-graph/src/host/git-runner.ts'],
  },
  {
    file: 'legacy-migration.ts',
    source: 'shared/host/legacy-migration.ts',
    targets: [
      'packages/dsh-plugin-manager/src/host/legacy-migration.ts',
      'packages/dsh-doctor/src/agent/legacy-migration.ts',
    ],
  },
  {
    file: 'mount-once.ts',
    source: 'shared/host/mount-once.ts',
    targets: [
      'packages/dsh-pet/src/mount-once.ts',
      'packages/dsh-ssh/src/mount-once.ts',
      'packages/dsh-remote-web-ui/src/mount-once.ts',
      'packages/dsh-liangshen/src/mount-once.ts',
      'packages/dsh-task-board/src/mount-once.ts',
      'packages/dsh-git-graph/src/mount-once.ts',
      'packages/dsh-community-plugins/src/mount-once.ts',
      'packages/dsh-plugin-manager/src/mount-once.ts',
      'packages/dsh-web-settings/src/mount-once.ts',
      'packages/dsh-tool-describe-image/src/mount-once.ts',
      'packages/dsh-desktop-launcher/src/mount-once.ts',
      'packages/dsh-skill-explorer/src/mount-once.ts',
      'packages/dsh-doctor/src/mount-once.ts',
      'packages/skins/skin-center/src/mount-once.ts',
      'packages/dsh-market/src/mount-once.ts',
      'packages/dsh-usage/src/mount-once.ts',
      'packages/dsh-session-archive/src/mount-once.ts',
    ],
  },

  {
    file: 'telemetry.ts',
    source: 'shared/client/telemetry.ts',
    targets: [
      'packages/dsh-market/src/client/telemetry.ts',
      'packages/dsh-pet/src/client/telemetry.ts',
      'packages/skins/skin-center/src/client/telemetry.ts',
      'packages/dsh-desktop-launcher/src/client/telemetry.ts',
      'packages/dsh-doctor/src/client/telemetry.ts',
      'packages/dsh-git-graph/src/client/telemetry.ts',
      'packages/dsh-plugin-manager/src/client/telemetry.ts',
      'packages/dsh-remote-web-ui/src/client/telemetry.ts',
      'packages/dsh-session-id/src/client/telemetry.ts',
      'packages/dsh-skill-explorer/src/client/telemetry.ts',
      'packages/dsh-ssh/src/client/telemetry.ts',
      'packages/dsh-task-board/src/client/telemetry.ts',
      'packages/dsh-tool-describe-image/src/client/telemetry.ts',
      'packages/dsh-web-settings/src/client/telemetry.ts',
    ],
  },
  {
    file: 'sse-leader.ts',
    source: 'shared/client/sse-leader.ts',
    targets: ['packages/dsh-git-graph/src/client/sse-leader.ts'],
  },
  {
    file: 'pair-access.ts',
    source: 'shared/host/pair-access.ts',
    targets: ['packages/dsh-git-graph/src/host/pair-access.ts', 'packages/dsh-pet/src/pair-access.ts', 'packages/dsh-skill-explorer/src/pair-access.ts'],
  },
  {
    file: 'loopback.ts',
    source: 'shared/host/loopback.ts',
    targets: ['packages/dsh-ssh/src/loopback.ts', 'packages/dsh-git-graph/src/host/loopback.ts', 'packages/dsh-remote-web-ui/src/loopback.ts', 'packages/dsh-task-board/src/loopback.ts', 'packages/dsh-skill-explorer/src/loopback.ts', 'packages/dsh-pet/src/loopback.ts', 'packages/dsh-plugin-manager/src/host/loopback.ts', 'packages/dsh-tool-describe-image/src/loopback.ts', 'packages/dsh-desktop-launcher/src/loopback.ts', 'packages/dsh-doctor/src/host/loopback.ts', 'packages/dsh-market/src/loopback.ts', 'packages/dsh-usage/src/host/loopback.ts', 'packages/dsh-session-archive/src/host/loopback.ts'],
  },
  {
    file: 'http.ts',
    source: 'shared/host/http.ts',
    targets: [
      'packages/dsh-pet/src/http.ts',
      'packages/dsh-market/src/http.ts',
      'packages/dsh-skill-explorer/src/http.ts',
      'packages/dsh-desktop-launcher/src/http.ts',
      'packages/dsh-web-settings/src/http.ts',
      'packages/dsh-tool-describe-image/src/http.ts',
      'packages/dsh-doctor/src/host/http.ts',
      'packages/dsh-git-graph/src/host/http.ts',
      'packages/dsh-ssh/src/http.ts',
      'packages/dsh-plugin-manager/src/host/http.ts',
      'packages/skins/skin-center/src/http.ts',
      'packages/dsh-remote-web-ui/src/http.ts',
      'packages/dsh-task-board/src/http.ts',
      'packages/dsh-usage/src/host/http.ts',
      'packages/dsh-session-archive/src/host/http.ts',
    ],
  },
  {
    file: 'vitest.setup.ts',
    source: 'shared/vitest.setup.ts',
    targets: [
      'packages/dsh-web-settings/vitest.setup.ts',
      'packages/dsh-tool-describe-image/vitest.setup.ts',
      'packages/dsh-remote-web-ui/vitest.setup.ts',
    ],
  },
  {
    file: 'sidebar-entry-core.ts',
    source: 'shared/client/sidebar-entry-core.ts',
    targets: [
      'packages/dsh-ssh/src/client/sidebar-entry-core.ts',
      'packages/dsh-task-board/src/client/sidebar-entry-core.ts',
      'packages/dsh-skill-explorer/src/client/sidebar-entry-core.ts',
    ],
  },
  {
    // Center-column takeover lifecycle shared by the two family panels; the
    // wrappers supply the panel tree, container attribute names, and CSS
    // class (pinned by each package's CSS and the semantic-attrs contract).
    file: 'panel-mount-core.ts',
    source: 'shared/client/panel-mount-core.ts',
    targets: [
      'packages/dsh-ssh/src/client/panel-mount-core.ts',
      'packages/dsh-task-board/src/client/panel-mount-core.ts',
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
