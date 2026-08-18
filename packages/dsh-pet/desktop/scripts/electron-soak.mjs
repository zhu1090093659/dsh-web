import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'

async function resolveElectronPath() {
  const explicit = process.env.DSH_PET_ELECTRON_EXECUTABLE?.trim()
  let candidate = explicit === undefined || explicit === '' ? undefined : resolve(explicit)
  if (candidate === undefined) {
    try {
      candidate = createRequire(import.meta.url)('electron')
    } catch {
      // Source checkouts intentionally do not require an installed Electron binary.
    }
  }
  if (typeof candidate === 'string') {
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // Fall through to the stable test setup error below.
    }
  }
  throw new Error('Electron soak runtime is unavailable; set DSH_PET_ELECTRON_EXECUTABLE')
}

const electronPath = await resolveElectronPath()

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactDirectory = join(appRoot, '.smoke-artifacts')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-pet-soak-'))

function positiveNumber(value, fallback, minimum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

function slopePerHour(samples, field) {
  if (samples.length < 3) return 0
  const origin = samples[0].elapsedMs
  const points = samples.map(sample => ({ x: (sample.elapsedMs - origin) / 3_600_000, y: sample[field] }))
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  return denominator === 0
    ? 0
    : points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator
}

function range(values) {
  return values.length === 0 ? [0, 0] : [Math.min(...values), Math.max(...values)]
}

function metricValue(metrics, name, fallback = 0) {
  return metrics.find(metric => metric.name === name)?.value ?? fallback
}

const sourceToken = 's'.repeat(43)
const sourceStreams = new Set()
let sourceRequestCount = 0
const sourceSnapshot = {
  animation: 'idle',
  bubble: '长稳测试中',
  phase: 'idle',
  sessionActive: false,
  companion: { enabled: true, visible: true, alwaysOnTop: true, locked: false, scale: 1 },
  affinity: {
    points: 0, rank: '初识', pets: 0, feeds: 0, turns: 0,
    petCooldown: false, feedCooldown: false,
  },
  treats: { stocked: 0, max: 20 },
}
const sourceServer = createServer((request, response) => {
  sourceRequestCount += 1
  if (request.headers.authorization !== `Bearer ${sourceToken}`) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: 'NATIVE_AUTH_INVALID' }))
    return
  }
  if (request.url === '/api/pet/native/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify(sourceSnapshot)}\n\n`)
    sourceStreams.add(response)
    request.once('close', () => sourceStreams.delete(response))
    return
  }
  if (request.url === '/api/pet/native/state') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(sourceSnapshot))
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: false }))
})
await new Promise((resolve, reject) => {
  sourceServer.once('error', reject)
  sourceServer.listen(0, '127.0.0.1', () => resolve(undefined))
})
const sourceAddress = sourceServer.address()
if (sourceAddress === null || typeof sourceAddress === 'string') throw new Error('failed to bind soak source')
sourceServer.unref()
const sourceOrigin = `http://127.0.0.1:${String(sourceAddress.port)}`

const durationMinutes = positiveNumber(process.env.DSH_PET_SOAK_MINUTES, 480, 0.01)
const sampleMs = positiveNumber(process.env.DSH_PET_SOAK_SAMPLE_MS, 30_000, 1_000)
const stress = process.env.DSH_PET_SOAK_STRESS === '1'
const durationMs = durationMinutes * 60_000
await mkdir(artifactDirectory, { recursive: true })

const electronApp = await electron.launch({
  executablePath: electronPath,
  args: [
    join(appRoot, 'out/main/index.js'),
    `--user-data-dir=${userDataDirectory}`,
    '--no-sandbox',
  ],
  cwd: appRoot,
  env: {
    ...process.env,
    DSH_HOME: join(userDataDirectory, 'dsh-home'),
    DSH_PET_ORIGIN: sourceOrigin,
    DSH_PET_NATIVE_TOKEN: sourceToken,
  },
})

const samples = []
const startedAt = Date.now()
try {
  const page = await electronApp.firstWindow()
  await page.locator('.pet-button').waitFor({ state: 'visible', timeout: 15_000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const deadline = startedAt + durationMs
  let iteration = 0
  while (Date.now() < deadline) {
    if (stress) {
      await page.evaluate(async open => window.petDesktop.setDrawerOpen(open), iteration % 2 === 0)
      await page.evaluate(async quality => window.petDesktop.setQuality(quality), iteration % 2 === 0 ? 'low' : 'high')
    }
    const native = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const metrics = app.getAppMetrics()
      const windows = BrowserWindow.getAllWindows()
      const processMetrics = metrics.map(metric => ({
        type: metric.type,
        cpuPercent: Math.max(0, metric.cpu.percentCPUUsage),
        workingSetMb: metric.memory.workingSetSize / 1024,
        privateMb: (metric.memory.privateBytes ?? 0) / 1024,
      }))
      const activeResourceTypes = process.getActiveResourcesInfo().sort()
      return {
        processMetrics,
        totalCpuPercent: processMetrics.reduce((sum, metric) => sum + metric.cpuPercent, 0),
        totalWorkingSetMb: processMetrics.reduce((sum, metric) => sum + metric.workingSetMb, 0),
        totalPrivateMb: processMetrics.reduce((sum, metric) => sum + metric.privateMb, 0),
        gpuWorkingSetMb: processMetrics
          .filter(metric => metric.type === 'GPU')
          .reduce((sum, metric) => sum + metric.workingSetMb, 0),
        rendererCount: processMetrics.filter(metric => metric.type === 'Tab').length,
        processCount: processMetrics.length,
        windowCount: windows.length,
        mainActiveResources: activeResourceTypes.length,
        activeResourceTypes,
        appListenerCount: app.eventNames().reduce((sum, event) => sum + app.listenerCount(event), 0),
      }
    })
    const performanceMetrics = (await cdp.send('Performance.getMetrics')).metrics
    const logicalRendererResources = await page.evaluate(() => ({
      activeAnimationTimers: document.querySelectorAll('.sprite[data-animation-timer-active="true"]').length,
      spriteTextureElements: [...document.querySelectorAll('.sprite')]
        .filter(element => getComputedStyle(element).backgroundImage !== 'none').length,
    }))
    const renderer = {
      domNodes: metricValue(performanceMetrics, 'Nodes'),
      documents: metricValue(performanceMetrics, 'Documents'),
      frames: metricValue(performanceMetrics, 'Frames'),
      rendererEventListeners: metricValue(performanceMetrics, 'JSEventListeners'),
      usedJsHeapMb: metricValue(performanceMetrics, 'JSHeapUsedSize') / 1024 / 1024,
      ...logicalRendererResources,
    }
    samples.push({
      elapsedMs: Date.now() - startedAt,
      ...native,
      ...renderer,
      sourceSseConnections: sourceStreams.size,
      sourceRequestCount,
    })
    iteration += 1
    await page.waitForTimeout(Math.min(sampleMs, Math.max(0, deadline - Date.now())))
  }

  const stableSamples = samples.slice(Math.min(2, Math.max(0, samples.length - 3)))
  const rssSlopeMbPerHour = slopePerHour(stableSamples, 'totalWorkingSetMb')
  const firstRssMb = stableSamples[0]?.totalWorkingSetMb ?? 0
  const lastRssMb = stableSamples.at(-1)?.totalWorkingSetMb ?? 0
  const report = {
    schemaVersion: 1,
    durationMinutes,
    sampleMs,
    stress,
    sampleCount: samples.length,
    summary: {
      firstRssMb,
      lastRssMb,
      maxRssMb: Math.max(...stableSamples.map(sample => sample.totalWorkingSetMb), 0),
      maxPrivateMb: Math.max(...stableSamples.map(sample => sample.totalPrivateMb), 0),
      rssGrowthMb: lastRssMb - firstRssMb,
      rssSlopeMbPerHour,
      cpuP95Percent: percentile(stableSamples.map(sample => sample.totalCpuPercent), 0.95),
      maxGpuWorkingSetMb: Math.max(...stableSamples.map(sample => sample.gpuWorkingSetMb), 0),
      rendererCountRange: range(stableSamples.map(sample => sample.rendererCount)),
      processCountRange: range(stableSamples.map(sample => sample.processCount)),
      windowCountRange: range(stableSamples.map(sample => sample.windowCount)),
      activeResourceRange: range(stableSamples.map(sample => sample.mainActiveResources)),
      appListenerRange: range(stableSamples.map(sample => sample.appListenerCount)),
      domNodeRange: range(stableSamples.map(sample => sample.domNodes)),
      rendererEventListenerRange: range(stableSamples.map(sample => sample.rendererEventListeners)),
      rendererHeapMbRange: range(stableSamples.map(sample => sample.usedJsHeapMb)),
      activeAnimationTimerRange: range(stableSamples.map(sample => sample.activeAnimationTimers)),
      spriteTextureElementRange: range(stableSamples.map(sample => sample.spriteTextureElements)),
      sourceSseConnectionRange: range(stableSamples.map(sample => sample.sourceSseConnections)),
    },
    samples,
  }
  await writeFile(join(artifactDirectory, 'desktop-soak.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report.summary, null, 2))

  if (durationMinutes >= 60 && (report.summary.rssGrowthMb > 32 || rssSlopeMbPerHour > 2)) {
    throw new Error(`sustained RSS growth exceeded the soak budget: ${rssSlopeMbPerHour.toFixed(2)} MB/hour`)
  }
  if (durationMinutes >= 60 && !stress && report.summary.cpuP95Percent > 2) {
    throw new Error(`idle CPU P95 exceeded the soak budget: ${report.summary.cpuP95Percent.toFixed(2)}%`)
  }
  if (new Set(stableSamples.map(sample => sample.rendererCount)).size > 1) {
    throw new Error('renderer process count changed during soak')
  }
  if (Math.max(...stableSamples.map(sample => sample.sourceSseConnections), 0) > 1) {
    throw new Error('more than one native SSE connection was active')
  }
  if ((stableSamples.at(-1)?.sourceSseConnections ?? 0) !== 1) {
    throw new Error('native SSE connection was not healthy at the end of soak')
  }
  for (const field of [
    'processCount',
    'windowCount',
    'appListenerCount',
    'domNodes',
    'rendererEventListeners',
    'activeAnimationTimers',
    'spriteTextureElements',
  ]) {
    if (new Set(stableSamples.map(sample => sample[field])).size > 1) {
      throw new Error(`${field} changed during soak`)
    }
  }
  const firstResources = stableSamples[0]?.mainActiveResources ?? 0
  const lastResources = stableSamples.at(-1)?.mainActiveResources ?? 0
  if (lastResources - firstResources > 4) {
    throw new Error('main-process active resources grew beyond the transient I/O allowance')
  }
} finally {
  await electronApp.close()
  for (const stream of sourceStreams) stream.destroy()
  await new Promise(resolve => sourceServer.close(() => resolve(undefined)))
  await rm(userDataDirectory, { recursive: true, force: true })
}
