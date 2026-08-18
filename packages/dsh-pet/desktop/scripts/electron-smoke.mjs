import { copyFile, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
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
  throw new Error('Electron smoke runtime is unavailable; set DSH_PET_ELECTRON_EXECUTABLE')
}

const electronPath = await resolveElectronPath()

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactDirectory = join(appRoot, '.smoke-artifacts')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-pet-desktop-'))
const localModelDirectory = join(appRoot, 'pixelmodel')
const fixtureDirectories = [
  join(localModelDirectory, `smoke-lian-${process.pid}`),
  join(localModelDirectory, `smoke-hachiware-${process.pid}`),
]
await mkdir(artifactDirectory, { recursive: true })
await mkdir(localModelDirectory, { recursive: true })

async function writePetModelFixture(directory, id, displayName) {
  await mkdir(directory)
  await copyFile(
    join(appRoot, '..', 'assets', 'whale', 'spritesheet.webp'),
    join(directory, 'spritesheet.webp'),
  )
  await writeFile(join(directory, 'pet.json'), `${JSON.stringify({
    id,
    displayName,
    description: 'Smoke-test PetDex model',
    spritesheetPath: 'spritesheet.webp',
  }, null, 2)}\n`, 'utf8')
}

await writePetModelFixture(fixtureDirectories[0], 'smoke-lian', 'Lian Smoke')
await writePetModelFixture(fixtureDirectories[1], 'smoke-hachiware', '小八 Smoke')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForDesktopState(page, predicate, label) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.petDesktop.getState())
    if (predicate(state)) return state
    await page.waitForTimeout(25)
  }
  throw new Error(`timed out waiting for desktop state: ${label}`)
}

async function waitForAttribute(locator, name, expected, label) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await locator.getAttribute(name) === expected) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for attribute: ${label}`)
}

const electronApp = await electron.launch({
  executablePath: electronPath,
  // Playwright's Windows process job prevents Chromium from launching the
  // renderer sandbox in this isolated runner (launch-failed, exit 49). This
  // switch is smoke-only; production still creates the window with sandbox:
  // true and never receives this command-line argument.
  args: [
    join(appRoot, 'out/main/index.js'),
    `--user-data-dir=${userDataDirectory}`,
    '--no-sandbox',
  ],
  cwd: appRoot,
  env: { ...process.env, DSH_HOME: join(userDataDirectory, 'dsh-home') },
})

try {
  const page = await electronApp.firstWindow()
  const rendererMessages = []
  page.on('console', message => rendererMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => rendererMessages.push(`pageerror: ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  try {
    await page.locator('.pet-button').waitFor({ state: 'visible', timeout: 10_000 })
  } catch (error) {
    console.error(JSON.stringify({
      url: page.url(),
      title: await page.title(),
      body: await page.locator('body').innerText().catch(() => ''),
      html: (await page.content()).slice(0, 2_000),
      rendererMessages,
    }, null, 2))
    throw error
  }

  const security = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window?.webContents.getLastWebPreferences()
  })
  assert(security?.contextIsolation === true, 'context isolation must stay enabled')
  assert(security?.nodeIntegration === false, 'node integration must stay disabled')
  assert(security?.sandbox === true, 'renderer sandbox must stay enabled')
  assert(security?.webSecurity === true, 'web security must stay enabled')
  assert(security?.webviewTag === false, 'webview tags must stay disabled')
  const trayIconValid = await electronApp.evaluate(
    ({ nativeImage }, path) => !nativeImage.createFromPath(path).isEmpty(),
    join(appRoot, 'resources', 'tray-icon.png'),
  )
  assert(trayIconValid, 'tray icon PNG must decode into a non-empty NativeImage')

  const initial = await waitForDesktopState(
    page,
    state => state.visible,
    'desktop window visible after startup',
  )
  assert(
    initial.returnTarget.kind === 'web' && initial.returnTarget.url === initial.webDshUrl,
    'standalone Return Target should resolve to the managed Web DSH origin',
  )
  const initialViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(initialViewport.width >= 224 && initialViewport.width <= 232, `desktop content should start collapsed: ${JSON.stringify(initialViewport)}`)
  assert(initialViewport.height >= 300 && initialViewport.height <= 308, `desktop content should expose the interaction panel: ${JSON.stringify(initialViewport)}`)
  const backgroundImage = await page.locator('.sprite').evaluate(element => getComputedStyle(element).backgroundImage)
  assert(backgroundImage.includes('spritesheet-'), 'pixel sprite asset must be painted')
  const hiddenPanelOpacity = await page.locator('.interaction-panel').evaluate(element => getComputedStyle(element).opacity)
  assert(hiddenPanelOpacity === '0', 'status and interaction panel should be hidden by default')
  await page.locator('.pet-button').hover()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.interaction-panel')).opacity === '1')
  await page.getByRole('button', { name: '摸头' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '喂食' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '改名' }).waitFor({ state: 'visible' })
  assert(await page.getByText('拖动移动，点击展开').count() === 0, 'obsolete drag hint must be removed')
  await page.locator('.pet-summary strong').getByText('鲸鱼娘', { exact: true }).waitFor({ state: 'visible' })

  await page.getByRole('button', { name: '桌宠设置' }).click()
  await page.getByRole('group', { name: '桌宠设置' }).waitFor({ state: 'visible' })
  await page.getByLabel('当前渲染器能力').getByText('Sprite 2D', { exact: true }).waitFor({ state: 'visible' })
  await page.getByLabel('当前渲染器能力').getByText('动作 · 点击区域 · 透明背景', { exact: true }).waitFor({ state: 'visible' })
  const renderQuality = await page.locator('.renderer-mount').getAttribute('data-render-quality')
  assert(renderQuality === 'balanced', 'Sprite Provider must receive the Runtime quality setting')
  await page.getByRole('combobox', { name: '渲染质量' }).selectOption('high')
  await waitForDesktopState(page, state => state.quality === 'high', 'render quality increased')
  await page.waitForFunction(() => document.querySelector('.renderer-mount')?.getAttribute('data-render-quality') === 'high')
  const pluginSwitch = page.getByRole('switch', { name: '桌面宠物' })
  assert(await pluginSwitch.isDisabled(), 'plugin switch must not claim success while DSH is disconnected')
  const scaleOptions = await page.getByRole('combobox', { name: '桌宠大小' })
    .locator('option').evaluateAll(options => options.map(option => option.value))
  assert(
    JSON.stringify(scaleOptions) === JSON.stringify(['1', '1.25', '1.5', '2']),
    `desktop scale choices must exclude clipped sizes: ${JSON.stringify(scaleOptions)}`,
  )
  await page.getByRole('combobox', { name: '桌宠大小' }).selectOption('1.5')
  const scaled = await waitForDesktopState(page, state => state.scale === 1.5, 'pet scale increased')
  const scaledViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(scaledViewport.width >= 336 && scaledViewport.height >= 450, 'large pet scale must grow the desktop stage')
  assert(
    Math.abs(scaled.bounds.x + scaled.bounds.width - initial.bounds.x - initial.bounds.width) <= 2,
    'resizing the pet must preserve the window right edge',
  )
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-settings.png'),
    omitBackground: true,
  })
  await page.getByRole('combobox', { name: '桌宠大小' }).selectOption('1')
  await waitForDesktopState(page, state => state.scale === 1, 'pet scale restored')

  const primaryWorkArea = await electronApp.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  const topPlacement = await page.evaluate(
    ({ x, y }) => window.petDesktop.moveTo({ x, y }),
    { x: initial.bounds.x, y: primaryWorkArea.y },
  )
  assert(topPlacement.panelPlacement === 'below', 'controls must open below a pet near the top edge')
  await page.waitForFunction(() => document.querySelector('.desktop-shell')?.classList.contains('panel-below'))
  const topPetBounds = await page.locator('.pet-button').boundingBox()
  assert(topPetBounds !== null && topPetBounds.y <= 10, 'the visual pet must reach the top edge')
  const bottomPlacement = await page.evaluate(
    ({ x, y }) => window.petDesktop.moveTo({ x, y }),
    { x: initial.bounds.x, y: primaryWorkArea.y + primaryWorkArea.height - initial.bounds.height },
  )
  assert(bottomPlacement.panelPlacement === 'above', 'controls must open above a pet near the bottom edge')
  await page.waitForFunction(() => document.querySelector('.desktop-shell')?.classList.contains('panel-above'))

  const bubbleViewportBefore = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('pet-desktop:pet-state-changed', {
      connection: 'ready',
      snapshot: {
        animation: 'running',
        bubble: '正在执行任务',
        whisper: '我在这里陪着你',
        phase: 'tool',
        sessionActive: true,
        sessions: [
          { sessionId: 'smoke-session', animation: 'running', bubble: '正在执行任务', phase: 'tool' },
          { sessionId: 'review-session', animation: 'review', bubble: '正在检查结果', phase: 'review' },
        ],
        companion: { enabled: true, visible: true, alwaysOnTop: true, locked: false, scale: 1 },
        affinity: {
          points: 8, rank: '初识', pets: 1, feeds: 1, turns: 1,
          petCooldown: false, feedCooldown: false,
        },
        treats: { stocked: 2, max: 20 },
      },
    })
  })
  const taskStatus = page.getByRole('status', { name: '会话任务状态' })
  await taskStatus.getByText('我在这里陪着你').waitFor({ state: 'visible' })
  await taskStatus.getByText('正在检查结果').waitFor({ state: 'visible' })
  assert(await taskStatus.locator('.task-bubble-whisper').count() === 1, 'pet whisper must use the pink bubble treatment')
  const bubbleViewportAfter = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(
    JSON.stringify(bubbleViewportAfter) === JSON.stringify(bubbleViewportBefore),
    'task bubbles must overlay the pet surface without growing the window',
  )

  const petModels = await page.evaluate(() => window.petDesktop.getModels())
  assert(petModels.some(model => model.id === 'builtin:whale'), 'built-in pet model must stay available')
  assert(petModels.some(model => model.id === 'local:smoke-lian'), 'local PetDex Lian fixture must be discovered')
  assert(petModels.some(model => model.id === 'local:smoke-hachiware'), 'local PetDex Hachiware fixture must be discovered')
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('listbox', { name: '桌宠模型' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '导入 PetDex 模型文件夹' }).waitFor({ state: 'visible' })
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-model-list.png'),
    omitBackground: true,
  })
  await page.getByRole('option', { name: /小八 Smoke/ }).click()
  let hachiwareState = await waitForDesktopState(page, state => state.modelId === 'local:smoke-hachiware', 'Hachiware pet model selected')
  await page.waitForFunction(() => document.querySelector('.sprite')?.getAttribute('data-model-id') === 'local:smoke-hachiware')
  await page.locator('.pet-summary strong').getByText('小八 Smoke', { exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-pixel-hachiware.png'),
    omitBackground: true,
  })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '改名' }).click()
  const nameInput = page.getByRole('textbox', { name: '新的桌宠名字' })
  await nameInput.fill('八仔')
  await page.locator('.rename-form').getByRole('button', { name: '保存' }).click()
  hachiwareState = await waitForDesktopState(
    page,
    state => state.modelAliases['local:smoke-hachiware'] === '八仔',
    'Hachiware custom name saved',
  )
  assert(hachiwareState.modelAliases['local:smoke-hachiware'] === '八仔', 'custom model name must persist in desktop state')
  await page.locator('.pet-summary strong').getByText('八仔', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /Lian Smoke/ }).click()
  const selectedPetModel = await waitForDesktopState(page, state => state.modelId === 'local:smoke-lian', 'pet model selected')
  assert(selectedPetModel.modelId === 'local:smoke-lian', 'selected pet model must persist in desktop state')
  await page.locator('.pet-summary strong').getByText('Lian Smoke', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /八仔/ }).click()
  await waitForDesktopState(page, state => state.modelId === 'local:smoke-hachiware', 'custom-named model restored')
  await page.locator('.pet-summary strong').getByText('八仔', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /Lian Smoke/ }).click()
  await waitForDesktopState(page, state => state.modelId === 'local:smoke-lian', 'Lian pet model restored')
  await page.waitForFunction(() => {
    const sprite = document.querySelector('.sprite')
    return sprite !== null && getComputedStyle(sprite).backgroundImage.includes('dsh-pet-model')
  })
  const spriteAnimationBeforeDrawer = await page.locator('.sprite').getAttribute('data-animation')

  await page.evaluate(() => window.petDesktop.beginDrag())
  const clickSession = await page.evaluate(() => window.petDesktop.endDrag())
  assert(!clickSession.moved, 'a stationary pointer must remain a click')
  const dragged = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 60, y: y - 32 }), initial.bounds)
  assert(dragged.bounds.x < initial.bounds.x - 30 && dragged.bounds.y < initial.bounds.y - 10, 'drag target should move in screen space')
  assert(!dragged.drawerOpen, 'dragging the pet must not toggle the drawer')

  await page.locator('.pet-button').click()
  const expanded = await waitForDesktopState(page, state => state.drawerOpen, 'drawer open')
  await page.getByRole('button', { name: /打开 DSH Web/ }).waitFor({ state: 'visible' })
  const expandedViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const spriteAnimationAfterDrawer = await page.locator('.sprite').getAttribute('data-animation')
  assert(expandedViewport.width >= 528 && expandedViewport.width <= 536, 'drawer should expand the content area')
  assert(
    spriteAnimationBeforeDrawer !== null && spriteAnimationAfterDrawer === spriteAnimationBeforeDrawer,
    `opening the drawer must not switch animation: ${spriteAnimationBeforeDrawer} -> ${spriteAnimationAfterDrawer}`,
  )
  assert(
    Math.abs(expanded.bounds.x + expanded.bounds.width - dragged.bounds.x - dragged.bounds.width) <= 2,
    `opening the drawer after a drag must preserve the pet right edge: ${JSON.stringify({ dragged: dragged.bounds, expanded: expanded.bounds })}`,
  )
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-drawer-open.png'),
    omitBackground: true,
  })

  await page.getByRole('button', { name: '地址' }).click()
  const connectionForm = page.locator('.connection-form')
  const connectionInput = page.getByRole('textbox', { name: 'Web DSH 地址' })
  await connectionInput.fill('https://example.com')
  await connectionForm.getByRole('button', { name: '保存' }).click()
  await page.getByText('仅支持本机 Web DSH 的 http/https 根地址').waitFor({ state: 'visible' })
  await connectionInput.fill('http://localhost:3080/')
  await connectionForm.getByRole('button', { name: '保存' }).click()
  await connectionForm.waitFor({ state: 'hidden' })
  const configured = await page.evaluate(() => window.petDesktop.getState())
  assert(configured.webDshUrl === 'http://localhost:3080', 'Web DSH origin should normalize and persist')

  const rightEdges = [dragged.bounds.x + dragged.bounds.width, expanded.bounds.x + expanded.bounds.width]
  for (let index = 0; index < 3; index += 1) {
    const collapsedCycle = await page.evaluate(() => window.petDesktop.setDrawerOpen(false))
    rightEdges.push(collapsedCycle.bounds.x + collapsedCycle.bounds.width)
    const expandedCycle = await page.evaluate(() => window.petDesktop.setDrawerOpen(true))
    rightEdges.push(expandedCycle.bounds.x + expandedCycle.bounds.width)
  }
  assert(Math.max(...rightEdges) - Math.min(...rightEdges) <= 2, `drawer cycles must not drift: ${rightEdges.join(',')}`)

  await page.getByRole('button', { name: '锁定当前位置' }).click()
  const locked = await waitForDesktopState(page, state => state.locked, 'position locked')
  const lockedMove = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 40, y }), locked.bounds)
  assert(lockedMove.bounds.x === locked.bounds.x, 'locked window must reject move requests')

  await page.getByRole('button', { name: '解除位置锁定' }).click()
  const unlocked = await waitForDesktopState(page, state => !state.locked, 'position unlocked')
  const moved = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 40, y }), unlocked.bounds)
  assert(moved.bounds.x < unlocked.bounds.x, 'unlocked window should accept a safe move request')

  await page.getByRole('button', { name: '隐藏到托盘' }).click()
  await waitForDesktopState(page, state => !state.visible, 'window hidden')
  await waitForAttribute(
    page.locator('.sprite'),
    'data-animation-timer-active',
    'false',
    'hidden sprite timer stopped',
  )
  const hidden = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
  assert(hidden === false, 'hide action should keep the process alive with its window hidden')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
  await waitForDesktopState(page, state => state.visible, 'window restored')
  await waitForAttribute(
    page.locator('.sprite'),
    'data-animation-timer-active',
    'true',
    'restored sprite timer active',
  )
  const pageTitle = await page.title()

  const rendererCrashed = page.waitForEvent('crash', { timeout: 10_000 })
  const rendererReloaded = electronApp.evaluate(async ({ BrowserWindow }) => {
    const webContents = BrowserWindow.getAllWindows()[0]?.webContents
    if (webContents === undefined) throw new Error('missing renderer for crash test')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('renderer did not recover')), 10_000)
      webContents.once('did-finish-load', () => {
        clearTimeout(timeout)
        resolve(undefined)
      })
      webContents.forcefullyCrashRenderer()
    })
    return webContents.executeJavaScript(`(async () => {
      const state = await window.petDesktop.getState()
      return {
        visible: state.visible,
        hasPetButton: document.querySelector('.pet-button') !== null,
        hasSprite: document.querySelector('.sprite')?.getAttribute('data-model-id') !== null,
      }
    })()`, true)
  })
  const [, crashRecovered] = await Promise.all([rendererCrashed, rendererReloaded])
  assert(crashRecovered.visible, 'renderer crash recovery must restore the desktop UI')
  assert(crashRecovered.hasPetButton, 'renderer crash recovery must restore the pet control')
  assert(crashRecovered.hasSprite, 'renderer crash recovery must repaint the selected model')

  console.log(JSON.stringify({
    title: pageTitle,
    initialContentWidth: initialViewport.width,
    expandedContentWidth: expandedViewport.width,
    spritePainted: true,
    trayIconPainted: true,
    petModelsDiscovered: petModels.map(model => model.id),
    petModelSelectionPersisted: true,
    perModelNamePersisted: true,
    modelNameFollowsSelection: true,
    hoverSettingsVisible: true,
    rendererCapabilityVisible: true,
    petScaleResizesWindow: true,
    clippedScaleChoicesRemoved: true,
    adaptiveInteractionPanel: true,
    taskStatusBubbleOverlay: true,
    pluginSwitchRequiresDsh: true,
    petModelMenuVisible: true,
    obsoleteDragHintRemoved: true,
    interactionPanelVisible: true,
    interactionPanelHoverOnly: true,
    dragSessionStable: true,
    drawerAnchoredAfterDrag: true,
    drawerDoesNotSwitchAnimation: true,
    returnTargetGeneralized: true,
    connectionAddressValidated: true,
    lockGuardedMove: true,
    hideAndRestore: true,
    hiddenAnimationPaused: true,
    rendererCrashRecovered: true,
    screenshot: join(artifactDirectory, 'desktop-drawer-open.png'),
  }, null, 2))
} finally {
  await electronApp.close()
  await Promise.all(fixtureDirectories.map(directory => rm(directory, { recursive: true, force: true })))
  await rm(userDataDirectory, { recursive: true, force: true })
}
