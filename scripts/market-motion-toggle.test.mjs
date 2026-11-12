/**
 * 背景动效开关行为回归（市场站 hero 背景）。
 *
 * 卡片的两个验收点在这里被钉住：
 *   1. 背景动效缺省不开启；
 *   2. 开关状态落到 localStorage，刷新后不被默认值覆盖回「开启」；
 *   3. 「关闭」是真正的关闭：停 RAF、清点击涟漪、canvas 退回不可见，
 *      不再是「暂停但保留最后一帧」的名不副实状态。
 *
 * 做法：用最小 DOM/WebGL 桩在 Node 里执行真实的 market/src/app.js（不复制其逻辑），
 * 观察 RAF 调度次数、canvas 的 ready 类与 localStorage 落盘值。
 * 桩是 backing store 而不是 module mock：断言落在真实脚本的产物上。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const SRC = path.join(fileURLToPath(new URL('..', import.meta.url)), 'market', 'src', 'app.js')
const MOTION_KEY = 'dsh-market-motion'

/** 记录 RAF 调度与取消的最小动画循环桩。 */
function makeRaf() {
  const pending = new Map()
  let nextId = 1
  let frames = 0
  return {
    requestAnimationFrame(cb) {
      const id = nextId++
      pending.set(id, cb)
      return id
    },
    cancelAnimationFrame(id) { pending.delete(id) },
    /** 推进一帧：跑掉当前待执行回调，并统计它是否又排了新的一帧。 */
    tick(now) {
      const entry = [...pending.entries()][0]
      if (!entry) return false
      const [id, cb] = entry
      pending.delete(id)
      frames++
      cb(now)
      return pending.size > 0
    },
    get scheduled() { return pending.size },
    get frames() { return frames },
  }
}

/**
 * 建一个够 app.js 跑起来的页面环境。
 * glEnabled 决定 WebGL 是否可用；reduceMotion 决定系统偏好。
 */
function makePage({ glEnabled = true, reduceMotion = false, stored = null } = {}) {
  const raf = makeRaf()
  const store = new Map()
  if (stored !== null) store.set(MOTION_KEY, stored)
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }

  const canvas = {
    id: 'bgCanvas',
    className: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c) },
      remove(c) { this._s.delete(c) },
      contains(c) { return this._s.has(c) },
    },
    clientWidth: 1200, clientHeight: 800, width: 0, height: 0,
    addEventListener() {}, removeEventListener() {},
  }

  // WebGL 桩：只实现 app.js 实际调用的方法；drawArrays 记录绘制次数。
  let draws = 0
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, TRIANGLES: 7, FLOAT: 8,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, deleteShader() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram() {}, createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation: () => ({}), viewport() {},
    uniform1f() {}, uniform2f() {}, uniform4f() {}, uniform1fv() {}, uniform2fv() {},
    drawArrays() { draws++ },
    getExtension: () => null, getParameter: () => 'TestRenderer',
  }

  // 应用层 bind() 会挂到 #search / #sort / #savedFilter / #motion 上；
  // 这里给出可点击的最小元素，#motion 的点击就是访客的操作。
  function element(id) {
    return {
      id,
      value: '',
      hidden: false,
      open: false,
      innerHTML: '',
      textContent: '',
      title: '',
      disabled: false,
      dataset: {},
      classList: { _s: new Set(), add(c) { this._s.add(c) }, remove(c) { this._s.delete(c) }, toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c) } },
      _attrs: {},
      _listeners: {},
      setAttribute(k, v) { this._attrs[k] = String(v) },
      getAttribute(k) { return this._attrs[k] ?? null },
      hasAttribute(k) { return k in this._attrs },
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn) },
      removeEventListener() {},
      appendChild() {},
      close() { this.open = false },
      click() { for (const fn of this._listeners.click || []) fn({ target: this }) },
    }
  }
  const els = {
    search: element('search'),
    sort: element('sort'),
    savedFilter: element('savedFilter'),
    motion: element('motion'),
    listTitle: element('listTitle'),
    count: element('count'),
    loadMore: element('loadMore'),
    grid: element('grid'),
    filters: element('filters'),
    showcase: element('showcase'),
    detail: element('detail'),
    apiState: element('apiState'),
    toast: element('toast'),
  }
  const ocean = { classList: { _s: new Set(), add(c) { this._s.add(c) }, remove(c) { this._s.delete(c) }, toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c) } } }

  const document = {
    readyState: 'complete',
    hidden: false,
    getElementById: (id) => (id === 'bgCanvas' ? canvas : els[id] || null),
    querySelector: (sel) => {
      if (sel === '.ocean') return ocean
      if (sel.startsWith('#')) return els[sel.slice(1)] || null
      return null
    },
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, appendChild() {}, setAttribute() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
  }

  const window = {
    matchMedia: (q) => ({ matches: reduceMotion && /reduced-motion/.test(q), addEventListener() {} }),
    localStorage,
    addEventListener() {}, removeEventListener() {},
    scrollY: 0, innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    performance: { now: () => 0 },
    crypto: { randomUUID: () => 'fp-0000000000000000' },
    fetch: () => Promise.reject(new Error('offline')),
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState() {} },
  }
  window.window = window
  window.document = document
  document.defaultView = window

  // app.js 以裸全局调用 requestAnimationFrame / performance / navigator，
  // 所以桩既要挂在 window 上，也要作为 vm context 的全局属性。
  const context = vm.createContext({
    window,
    document,
    navigator: { webdriver: true },
    fetch: () => Promise.reject(new Error('offline')),
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState() {} },
    console,
    Math,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    performance: { now: () => 0 },
  })
  context.globalThis = context
  canvas.getContext = glEnabled ? () => gl : () => null

  return { context, window, canvas, els, raf, store, get draws() { return draws } }
}

/** 执行 app.js，得到可断言的页面。 */
function boot(options) {
  const page = makePage(options)
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), page.context, { filename: 'app.js' })
  return page
}

test('访客首次打开市场站时背景动效是关闭的，动画循环不启动', () => {
  // Given 一个没有任何本地偏好的访客
  const page = boot()

  // When 页面完成启动
  // Then 开关关闭、无待执行帧、canvas 不可见
  assert.equal(page.window.marketWave.isEnabled(), false, '缺省必须关闭')
  assert.equal(page.raf.scheduled, 0, '缺省关闭时不应有排队的动画帧')
  assert.equal(page.canvas.classList.contains('ready'), false, '缺省关闭时 canvas 不可见')
})

test('访客开启背景动效后，刷新页面仍保持开启', () => {
  // Given 一个此前手动开启过背景动效的访客
  const page = boot({ stored: '1' })

  // When 页面完成启动
  // Then 动效按上次的偏好继续运行
  assert.equal(page.window.marketWave.isEnabled(), true, '持久化的开启应被恢复')
})

test('访客关闭背景动效后，刷新页面不会被缺省值覆盖回开启', () => {
  // Given 一个明确关闭过背景动效的访客
  const page = boot({ stored: '0' })

  // When 页面完成启动
  // Then 保持关闭
  assert.equal(page.window.marketWave.isEnabled(), false, '持久化的关闭应被恢复')
})

test('访客点击页脚开关后，状态写入本地存储并驱动动效', () => {
  // Given 一个默认关闭且尚无本地记录的访客
  const page = boot()
  assert.equal(page.store.has(MOTION_KEY), false, '未操作前不写存储')

  // When 访客点击页脚开关
  page.els.motion.click()

  // Then 动效运行、状态落盘、按钮文案与可访问性状态同步
  assert.equal(page.window.marketWave.isEnabled(), true, '点击后应开启动效')
  assert.equal(page.store.get(MOTION_KEY), '1', '开启应写入 localStorage')
  assert.equal(page.els.motion.getAttribute('aria-pressed'), 'true', '按钮可访问状态应同步')
  assert.equal(page.els.motion.textContent, '背景动效：开启', '按钮文案应与实际状态一致')

  // And 再点一次回到关闭，关闭同样落盘（刷新后不会被覆盖回开启）
  page.els.motion.click()
  assert.equal(page.store.get(MOTION_KEY), '0', '关闭应写入 localStorage')
  assert.equal(page.els.motion.textContent, '背景动效：关闭', '关闭文案应与实际状态一致')
})

test('系统偏好减少动效时，背景动效即使被开启也保持关闭', () => {
  // Given 一个开启了动效但系统要求减少动效的访客
  const page = boot({ stored: '1', reduceMotion: true })

  // When 页面完成启动
  // Then 系统偏好优先，动效不运行
  assert.equal(page.window.marketWave.isEnabled(), false, '系统偏好应压过用户选择')
  assert.equal(page.raf.scheduled, 0, '系统偏好下不应排队动画帧')
})

test('访客关闭背景动效时，动画循环停止且不再绘制帧', () => {
  // Given 一个正在运行背景动效的页面
  const page = boot({ stored: '1' })
  assert.equal(page.raf.scheduled > 0, true, '开启后应有动画帧排队')

  // When 访客关闭动效并让时间推进
  const before = page.draws
  page.window.marketWave.setEnabled(false)
  page.raf.tick(16)
  page.raf.tick(32)

  // Then 循环停止、canvas 不可见、不再产生新帧
  assert.equal(page.raf.scheduled, 0, '关闭后不应再有排队动画帧')
  assert.equal(page.raf.frames, 0, '关闭后不应再执行动画帧')
  assert.equal(page.draws, before, '关闭后不应再绘制')
  assert.equal(page.canvas.classList.contains('ready'), false, '关闭后 canvas 应退回不可见')
})
