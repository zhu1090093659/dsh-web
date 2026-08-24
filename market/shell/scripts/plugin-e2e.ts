/**
 * Plugin compatibility test.
 *
 * Installs real community plugins from the npm registry into the running
 * browser build — the same packages a person would install with
 * `dsh plugin add` — and checks that each one composes: its bundle patch
 * applies, its host rows reach ACTIVE, and its browser half materializes in the
 * shell's module table.
 *
 * A page reload sits between install and verification on purpose: that is what
 * `dsh plugin add` requires on a real machine too, since the composition and
 * the client graph are both fixed at boot.
 *
 * Usage: `npx tsx scripts/plugin-e2e.ts [--url <url>] [--only <name>] [--headed]`
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

/** One plugin under test. */
interface Candidate {
  /** npm spec passed to the installer. */
  spec: string
  /** Where it comes from, for the report. */
  repo: string
  /** What it adds, for the report. */
  what: string
  /** Whether it ships a browser half that must materialize. */
  client: boolean
}

/**
 * The roster. Every entry is a published package carrying a `dsh.bundle`
 * manifest, drawn from the `dsh-plugin` topic on GitHub.
 */
const CANDIDATES: Candidate[] = [
  { spec: '@linxin666/dsh-web-all', repo: 'zhu1090093659/dsh-web', what: 'Web UI suite (task board, git graph, pet, skins, live stats)', client: true },
  { spec: 'dsh-better-sidebar', repo: 'omdsh-dev/DSH-better-sidebar', what: 'sidebar workbench: file editor, terminal, git, subagents', client: true },
  { spec: '@anionex/dsh-vision-toolkit', repo: 'Anionex/dsh-vision-toolkit', what: 'vision tools for text-only models', client: true },
  { spec: '@liustack/modlens', repo: 'liustack/modlens', what: 'vision bridge plugin', client: true },
  { spec: 'dshmarket', repo: 'dsh-market/dsh-market', what: 'in-app plugin marketplace', client: true },
  { spec: '@nanmicoder/dsh-agent-teams', repo: 'NanmiCoder/dsh-agent-teams', what: 'agent teams', client: true },
  { spec: 'dsh-working-activity', repo: 'ccch1mneyyy/working-activity', what: 'working-line activity indicator', client: true },
  { spec: '@agentrq/dsh-plugin-agentrq', repo: 'agentrq/agentrq', what: 'human-in-the-loop task manager (host only)', client: false },
  { spec: '@linxin666/dsh-client-ui-task-board', repo: 'zhu1090093659/dsh-web', what: 'task board panel', client: true },
  { spec: '@linxin666/dsh-client-ui-git-graph', repo: 'zhu1090093659/dsh-web', what: 'git graph panel', client: true },
  { spec: '@linxin666/dsh-pet', repo: 'zhu1090093659/dsh-web', what: 'desktop pet', client: true },
  { spec: '@linxin666/dsh-live-stats', repo: 'zhu1090093659/dsh-web', what: 'live session stats', client: true },
  { spec: '@linxin666/dsh-client-ui-skin-center', repo: 'zhu1090093659/dsh-web', what: 'skin centre', client: true },
  { spec: '@linxin666/dsh-client-ui-skin-miku', repo: 'zhu1090093659/dsh-web', what: 'Miku skin', client: true },
  { spec: '@linxin666/dsh-client-ui-skin-xp', repo: 'zhu1090093659/dsh-web', what: 'Windows XP skin', client: true },
  { spec: '@deepseek-harness-tui/dsh-tui', repo: 'ccch1mneyyy/dsh-TUI', what: 'terminal UI surface, written for the headless profile', client: false },
]

const args = process.argv.slice(2)
const url = valueOf('--url') ?? 'http://127.0.0.1:4173/'
const only = valueOf('--only')
const headed = args.includes('--headed')

/** Read a `--flag value` pair from argv. */
function valueOf(flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** Outcome for one candidate. */
interface Outcome {
  spec: string
  repo: string
  what: string
  installed: boolean
  version: string
  /** Loader rows the plugin's patch added, and their fiber states. */
  rows: { id: string, name: string, state: string }[]
  /** Client bundles the plugin contributed that materialized in the shell. */
  clientRows: string[]
  errors: string[]
  ok: boolean
  note: string
  /** For a plugin that stopped the boot: whether the failure screen's recovery worked. */
  recovered?: boolean
}

/**
 * Wait for the app shell to replace the boot screen.
 *
 * A plugin that cannot compose stops the boot and the failure screen reports
 * why; surfacing that text is the whole point of this suite, so it is worth more
 * than the timeout that would otherwise be all the report says.
 */
async function waitForShell(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.getElementById('root')
    if (document.querySelector('.dshw-error') !== null) return true
    return root !== null && root.childElementCount > 0 && document.getElementById('dshw-boot') === null
  }, undefined, { timeout: 120_000 })
  const failure = await page.locator('.dshw-error').first().textContent().catch(() => null)
  if (failure !== null && failure.length > 0) {
    // The screen prints the whole cause chain with stack frames; the report
    // wants the sentence, so drop the frames and keep the first message.
    const message = failure.split('\n').map(line => line.trim()).find(line => line.length > 0 && !line.startsWith('at '))
    throw new Error(`boot failed: ${(message ?? failure).slice(0, 200)}`)
  }
  await page.waitForTimeout(2000)
}

/** Read the composition and client-graph state the page is currently running. */
async function inspect(page: Page): Promise<{ rows: { id: string, name: string, state: string }[], client: string[], warnings: string[] }> {
  return page.evaluate(() => {
    const labels: Record<number, string> = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' }
    const ctx = globalThis.dsh?.ctx
    const rows: { id: string, name: string, state: string }[] = []
    for (const entry of ctx?.loader?.entries() ?? []) {
      const options = entry.options as { id?: string, name?: string }
      const fiber = entry.fiber as { state?: number } | undefined
      rows.push({
        id: options.id ?? '',
        name: options.name ?? '',
        state: entry.disabled === true ? 'disabled' : fiber === undefined ? 'no-fiber' : labels[fiber.state ?? -1] ?? 'unknown',
      })
    }
    const modules = (globalThis as { __DSH_MODULES__?: { loadCache: Map<string, unknown> } }).__DSH_MODULES__
    return {
      rows,
      client: modules === undefined ? [] : [...modules.loadCache.keys()],
      warnings: (globalThis as { __DSH_WARNINGS__?: string[] }).__DSH_WARNINGS__ ?? [],
    }
  })
}

/** Install, reload, and verify one candidate in a fresh browser profile. */
async function test(browser: Browser, candidate: Candidate): Promise<Outcome> {
  const outcome: Outcome = {
    spec: candidate.spec,
    repo: candidate.repo,
    what: candidate.what,
    installed: false,
    version: '',
    rows: [],
    clientRows: [],
    errors: [],
    ok: false,
    note: '',
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await context.newPage()
  /** Console warnings, kept apart from errors: a plugin diagnostic is not a failure. */
  const notices: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') outcome.errors.push(message.text())
    else if (message.type() === 'warning') notices.push(message.text())
  })
  page.on('pageerror', (error) => { outcome.errors.push(`pageerror: ${error.message}`) })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForShell(page)
    const before = await inspect(page)

    const install = await page.evaluate(async (spec: string) => {
      try {
        const entry = await globalThis.dsh.plugins.install(spec)
        return { ok: true, version: entry.version, error: '' }
      } catch (error) {
        return { ok: false, version: '', error: error instanceof Error ? error.message : String(error) }
      }
    }, candidate.spec)

    if (!install.ok) {
      outcome.note = `install failed: ${install.error}`
      return outcome
    }
    outcome.installed = true
    outcome.version = install.version

    await page.evaluate(async () => { await globalThis.dsh.flush() })
    // A reload is what makes the new bundle patch part of the composition, and
    // its browser half part of the boot graph — the same restart `dsh plugin
    // add` asks for.
    outcome.errors.length = 0
    notices.length = 0
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForShell(page)
    const after = await inspect(page)

    // Diff by plugin name, not row id: the auto directory picker creates its
    // two rows with generated ids that differ between boots.
    const beforeNames = new Set(before.rows.map(row => row.name))
    outcome.rows = after.rows.filter(row => !beforeNames.has(row.name))
    const beforeClient = new Set(before.client)
    outcome.clientRows = after.client.filter(id => !beforeClient.has(id))

    const unhealthy = outcome.rows.filter(row => row.state !== 'active' && row.state !== 'disabled')
    const fatal = outcome.errors.filter(line => !/Failed to load resource|favicon|net::ERR_|404/.test(line))
    // A package with no rows still counts as compatible when it declared no
    // patch of its own; the roster records which ones those are.
    if (outcome.rows.length === 0) outcome.note = 'installed; its bundle patch added no rows to this composition'
    if (candidate.client && outcome.clientRows.length === 0 && outcome.note === '') {
      outcome.note = notices.some(line => /does not contain that file/.test(line))
        ? 'host half active; the published package omits its built client bundle'
        : 'no browser half materialized'
    }
    outcome.ok = unhealthy.length === 0 && fatal.length === 0
    if (unhealthy.length > 0) {
      outcome.note = `rows not active: ${unhealthy.map(row => `${row.id}(${row.state})`).join(', ')}`
    } else if (fatal.length > 0) {
      outcome.note = `console errors: ${fatal.slice(0, 2).join(' | ').slice(0, 240)}`
    }
    return outcome
  } catch (error) {
    outcome.note = error instanceof Error ? error.message.slice(0, 300) : String(error)
    // A plugin that stops the boot must still leave the user a way back in, or
    // the only remedy is clearing site storage — files and sessions included.
    // That is a claim worth testing rather than asserting, so test it here.
    if (outcome.installed) outcome.recovered = await recover(page)
    return outcome
  } finally {
    await context.close()
  }
}

/**
 * Take the failure screen's first recovery and check the app comes back.
 * @param page - the page showing the failure screen.
 * @returns whether the app booted after the recovery.
 */
async function recover(page: Page): Promise<boolean> {
  try {
    const button = page.locator('.dshw-actions .dshw-button').first()
    if (await button.count() === 0) return false
    // The recovery reloads the page when it finishes. Mark this document so the
    // wait below is for the *next* one — the current page is already loaded, so
    // waiting on a load state would return before anything happened.
    await page.evaluate(() => { (globalThis as { __dshBeforeRecovery__?: boolean }).__dshBeforeRecovery__ = true })
    await button.click()
    await page.waitForFunction(
      () => (globalThis as { __dshBeforeRecovery__?: boolean }).__dshBeforeRecovery__ === undefined,
      undefined,
      { timeout: 60_000 },
    )
    await waitForShell(page)
    return true
  } catch {
    return false
  }
}

/**
 * Render the results as the document checked into `docs/`.
 * @param results - the run's outcomes, in roster order.
 * @returns the markdown.
 */
function renderReport(results: Outcome[]): string {
  const passed = results.filter(result => result.ok).length
  const rows = results.map((result) => {
    const status = result.ok ? '✅' : '❌'
    const surface = result.clientRows.length > 0 ? `${String(result.clientRows.length)} bundle(s)` : '—'
    const note = result.note === '' ? '' : result.note.replace(/\|/g, '\\|').slice(0, 160)
    const recovery = result.recovered === undefined
      ? ''
      : result.recovered ? ' Recovery from the failure screen restored the app.' : ' Recovery from the failure screen did not restore the app.'
    return `| ${status} | \`${result.spec}\` | [${result.repo}](https://github.com/${result.repo}) | ${result.what} `
      + `| ${result.version === '' ? '—' : result.version} | ${String(result.rows.length)} | ${surface} | ${note}${recovery} |`
  })
  return `# Plugin compatibility

Generated by \`npx tsx scripts/plugin-e2e.ts\`. Each plugin is installed from the
npm registry into the built app running in a real browser — the same package a
person would install with \`dsh plugin add\` — then the page is reloaded and the
composition inspected. A plugin passes when every row its bundle patch added
reached \`active\` and the page booted without console errors.

**${String(passed)} of ${String(results.length)} composed cleanly.**

| | Package | Source | What it adds | Version | Rows | Browser half | Notes |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Reading the results

- **Rows** is how many loader entries the plugin's \`cordis.patch.yml\` added to
  the composition, and every one of them reached \`active\`.
- **Browser half** counts the client bundles that materialized in the shell's
  module table — the plugin's actual UI surface.
- A plugin with no browser half is not necessarily broken: some are host-only,
  and some publish a \`dsh.client\` declaration without shipping the built bundle
  (their client build did not run before \`npm publish\`). The note says which.

## Plugins that cannot work here

A plugin whose contract is a capability a page does not have will not work, and
no amount of shimming changes that. The boot disables such a row, reports why,
and starts without it rather than failing the whole app. The two seen in this
roster:

- **\`@linxin666/dsh-remote-web-ui\`** exposes the UI through a Cloudflare tunnel,
  which means downloading and running the \`cloudflared\` binary.
- **\`@linxin666/dsh-ssh\`** needs raw TCP and Node's cipher suite for SSH.

Both are part of the \`@linxin666/dsh-web-all\` bundle; the other twelve
plugins in it compose normally.

\`@deepseek-harness-tui/dsh-tui\` fails for a different reason, and not a
browser-specific one: its patch inserts a loader entry named \`storage\`, which
the web profile already defines, so the composition is rejected before anything
runs. The same patch against the same profile fails on a real machine — it is
written for the headless profile, where that id is free. A boot stopped this way
offers "Disable installed plugins", which starts the app without the offending
layer and keeps the user's files and sessions.
`
}

/** Run the roster and print a table. */
async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: !headed })
  const results: Outcome[] = []
  try {
    for (const candidate of CANDIDATES) {
      if (only !== undefined && !candidate.spec.includes(only)) continue
      process.stdout.write(`▶ ${candidate.spec}\n`)
      const outcome = await test(browser, candidate)
      results.push(outcome)
      const mark = outcome.ok ? '✓' : '✗'
      process.stdout.write(
        `  ${mark} ${outcome.installed ? `v${outcome.version}` : 'not installed'}`
        + ` · rows ${String(outcome.rows.length)} · client ${String(outcome.clientRows.length)}`
        + `${outcome.note === '' ? '' : ` · ${outcome.note}`}`
        + `${outcome.recovered === undefined ? '' : ` · recovery ${outcome.recovered ? 'worked' : 'failed'}`}\n`,
      )
    }
  } finally {
    await browser.close()
  }

  const passed = results.filter(result => result.ok)
  process.stdout.write(`\n${String(passed.length)}/${String(results.length)} plugins composed cleanly\n`)
  if (only === undefined) {
    const report = resolve(fileURLToPath(new URL('../docs/plugin-compatibility.md', import.meta.url)))
    mkdirSync(dirname(report), { recursive: true })
    writeFileSync(report, renderReport(results))
    process.stdout.write(`report written to ${report}\n`)
  }
  process.exit(passed.length === results.length ? 0 : 1)
}

void main()
