// Resource-count benchmark. Run from an installed checkout, optionally with --ref <commit>.
// Loads the real scheduling and mount code; translation, CSS and SSH responses are fixtures.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const sharedRequire = createRequire(resolve(repo, 'shared/package.json'))
const sshRequire = createRequire(resolve(repo, 'packages/dsh-ssh/package.json'))
const ts = sharedRequire('typescript')
const { JSDOM } = sharedRequire('jsdom')
const React = sshRequire('react')
const { act } = React
const { createRoot } = sshRequire('react-dom/client')
const ref = process.argv[2] === '--ref' ? process.argv[3] : undefined
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const source = path => ref
  ? execFileSync('git', ['show', ref + ':' + path], { cwd: repo, encoding: 'utf8' })
  : readFileSync(resolve(repo, path), 'utf8')
function moduleUrl(path, replacements = {}) {
  let code = ts.transpileModule(source(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  for (const [from, to] of Object.entries(replacements)) {
    code = code.replaceAll("'" + from + "'", "'" + to + "'").replaceAll('"' + from + '"', '"' + to + '"')
  }
  return dataUrl(code)
}
const reactImports = Object.fromEntries(['react', 'react-dom/client', 'react/jsx-runtime']
  .map(name => [name, pathToFileURL(sshRequire.resolve(name)).href]))
const bodyUrl = moduleUrl('shared/client/body-mutations.ts')
const body = await import(bodyUrl)
const panel = await import(moduleUrl('shared/client/panel-mount-core.ts', {
  ...reactImports, './body-mutations.ts': bodyUrl,
}))
const shim = await import(moduleUrl('packages/dsh-web-all/src/client/index.ts', {
  './body-mutations.ts': bodyUrl,
  './mount-children.ts': dataUrl('export const mountClientChildren = async () => {}'),
}))
const { TunnelsTab } = await import(moduleUrl('packages/dsh-ssh/src/client/panel/TunnelsTab.tsx', {
  ...reactImports,
  './helpers.ts': dataUrl('export const tt = key => key; export const errorMessage = value => String(value)'),
  './panel.module.css': dataUrl('export default {}'),
}))
const hubKey = Symbol.for('dsh-web.body-mutation-hub')
const nativeInterval = globalThis.setInterval
const nativeClearInterval = globalThis.clearInterval
const results = []

for (let run = 1; run <= 3; run += 1) {
  const dom = new JSDOM('<!doctype html><body><main data-pane="conversation"></main></body>', { pretendToBeVisual: true })
  for (const name of ['window', 'document', 'MutationObserver', 'HTMLElement', 'Element', 'CustomEvent']) {
    globalThis[name] = dom.window[name]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let frameId = 0
  const frames = new Map()
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
  globalThis.cancelAnimationFrame = id => { frames.delete(id) }
  const metric = { run }

  // A paused animation-frame queue models a background page. Each replaced
  // subtree can otherwise be kept alive through MutationRecord.removedNodes.
  const subscribe = body.subscribeBodyInvalidations ?? body.subscribeBodyMutations
  const disposers = Array.from({ length: 6 }, () => subscribe(() => {}))
  const region = document.createElement('section')
  document.body.appendChild(region)
  for (let index = 0; index < 1000; index += 1) {
    region.replaceChildren(document.createElement('article'))
  }
  await Promise.resolve()
  metric.retainedMutationRecords = globalThis[hubKey].pending.length
  metric.queuedFrames = frames.size
  for (const dispose of disposers) dispose()
  metric.framesAfterDispose = frames.size
  frames.clear()
  region.remove()

  let renders = 0
  const mounts = []
  await act(async () => {
    for (const name of ['ssh', 'taskboard']) {
      mounts.push(panel.mountCenterPanel({
        render: root => { renders += 1; root.render(React.createElement('section', null, name)) },
        viewDatasetKey: 'benchmark' + name, pluginName: name, viewClassName: '',
        activeAttribute: 'data-benchmark-' + name, siblingActiveAttribute: 'data-benchmark-other',
        panelName: name, siblingPanelName: 'other',
        isOpen: () => false, close: () => {}, subscribe: () => () => {},
      }))
    }
  })
  metric.closedPanelRenders = renders
  await act(async () => { for (const dispose of mounts) dispose() })
  frames.clear()

  document.body.innerHTML = '<main><aside class="sidebarCol"></aside><section class="centerCol"></section></main>'
  let disposeShim
  shim.apply({ effect: effect => { disposeShim = effect() } })
  const code = document.createElement('pre')
  document.querySelector('.centerCol').appendChild(code)
  await Promise.resolve()
  let shimFrames = 0
  while (frames.size > 0 && shimFrames < 4) {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(0)
    shimFrames += 1
    if (code.getAttribute('data-dsh-responsive-part') === 'code') break
    await Promise.resolve()
  }
  if (code.getAttribute('data-dsh-responsive-part') !== 'code') throw new Error('Code hook missing')
  metric.framesUntilCodeHook = shimFrames
  disposeShim()
  frames.clear()

  let intervalId = 0
  const intervals = new Map()
  globalThis.setInterval = (callback, delay) => { intervals.set(++intervalId, { callback, delay }); return intervalId }
  globalThis.clearInterval = id => { intervals.delete(id) }
  let calls = 0
  const api = { listHosts: async () => [], listTunnels: async () => { calls += 1; return [] } }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = active => act(async () => { root.render(React.createElement(TunnelsTab, { api, active })) })
  const minute = async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await act(async () => {
        for (const { callback, delay } of [...intervals.values()]) {
          if (delay !== 5000) throw new Error('Unexpected polling interval: ' + delay)
          callback()
        }
      })
    }
  }
  await render(true)
  await render(false)
  let start = calls
  await minute()
  metric.closedTunnelPollsPerMinute = calls - start
  await render(true)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')) })
  start = calls
  await minute()
  metric.hiddenTunnelPollsPerMinute = calls - start
  await act(async () => { root.unmount() })
  metric.intervalsAfterDispose = intervals.size
  globalThis.setInterval = nativeInterval
  globalThis.clearInterval = nativeClearInterval
  dom.window.close()
  results.push(metric)
}
console.log(JSON.stringify({ source: ref ?? 'working-tree', runs: results }, null, 2))
