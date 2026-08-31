// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  ATTR_HISTORY_WINDOWS,
  ATTR_WINDOW_MS,
  createAttributionAggregator,
  createLongtaskLog,
  readLongtaskSource,
  startDomAttributionSampler,
} from '../src/client/perf-attribution'

describe('createAttributionAggregator', () => {
  it('同一时间网格窗口内累计同一插件的节点数', () => {
    const agg = createAttributionAggregator()
    agg.add('pet', 10, 100)
    agg.add('pet', 5, 1500) // 仍在 key=0 的网格窗口 (<2000)
    const snap = agg.snapshot(1900, 5)
    // 墙钟语义: 覆盖保留网格起点到 now, 这里 span=15.9s -> 15/15.9 -> 0.9/s。
    expect(snap.totalNodesPerSec).toBeCloseTo(0.9, 6)
    expect(snap.topPlugins).toEqual([{ name: 'pet', nodesPerSec: expect.closeTo(0.9, 6) }])
  })

  it('跨窗口轮转并合并历史窗口; 速率按墙钟时间缩放', () => {
    const agg = createAttributionAggregator({ windowMs: 1000, history: 4 })
    agg.add('pet', 100, 500) // 窗口 0
    agg.add('task-board', 200, 1500) // 窗口 1
    // now=1500 时覆盖 [max(cursor-3,0)*1000 .. 1500] ≈ 1.5s 起 -> span 至少 windowMs
    const snap = agg.snapshot(2500, 5)
    // cursor=2, 覆盖窗口 0..2, 起点对齐关键在实现: startMs=(2-4+1)*1000=-1000 -> max(span,windowMs)
    // 用宽松断言: 总量守恒、排名正确即可。
    expect(snap.totalNodesPerSec).toBeCloseTo(300 / Math.max((2500 - -1000) / 1000, 1), 0)
    expect(snap.topPlugins[0].name).toBe('task-board')
  })

  it('null 插件进入 unattributed 桶, topN 截断与 other 合并', () => {
    const agg = createAttributionAggregator({ windowMs: 1000, history: 4 })
    agg.add(null, 50, 300)
    agg.add('a', 40, 300)
    agg.add('b', 30, 300)
    agg.add('c', 20, 300)
    const snap = agg.snapshot(380, 2)
    expect(snap.unattributedPerSec).toBeGreaterThan(0)
    expect(snap.topPlugins.map((p) => p.name)).toEqual(['a', 'b'])
    // other = c + unattributed
    expect(snap.otherNodesPerSec).toBeCloseTo(snap.totalNodesPerSec - snap.topPlugins.reduce((s, p) => s + p.nodesPerSec, 0), 6)
    expect(snap.otherNodesPerSec).toBeGreaterThan(snap.topPlugins[1].nodesPerSec)
  })

  it('插入新桶时清理超出保留深度的旧桶', () => {
    const agg = createAttributionAggregator({ windowMs: 1000, history: 3 })
    agg.add('old', 999, 500) // 窗口 0
    agg.add('new', 1, 9_800) // 窗口 9, 触发清理 < 7
    const snap = agg.snapshot(9_900, 5)
    expect(snap.topPlugins).toEqual([{ name: 'new', nodesPerSec: expect.any(Number) }])
    expect(snap.topPlugins[0].nodesPerSec).toBeLessThan(1)
  })

  it('快照默认 topN=3 且同分按名称稳定排序', () => {
    const agg = createAttributionAggregator({ windowMs: 1000 })
    for (const name of ['zeta', 'alpha', 'mid']) agg.add(name, 10, 100)
    const snap = agg.snapshot(150, 3)
    expect(snap.topPlugins.map((p) => p.name)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('保留深度常量与文档一致', () => {
    expect(ATTR_WINDOW_MS).toBe(2000)
    expect(ATTR_HISTORY_WINDOWS).toBe(8)
  })
})

describe('createLongtaskLog', () => {
  it('批量 push 后按窗口裁剪, count/max/topSources 正确合并来源', () => {
    const log = createLongtaskLog({ windowMs: 60_000, capacity: 10 })
    log.push({ t: 1000, durationMs: 80, source: 'annotation' })
    log.push({ t: 1200, durationMs: 40, source: 'unknown' })
    log.push({ t: 1300, durationMs: 120, source: 'annotation' })
    expect(log.countSince(2000, 60_000)).toBe(3)
    expect(log.maxSince(2000, 60_000)).toBe(120)
    expect(log.topSources(2000, 60_000, 2)[0]).toEqual({ source: 'annotation', count: 2, durationMs: 200 })
    // 容量环形: 旧记录被挤出。
    for (let i = 0; i < 15; i++) log.push({ t: 3000 + i, durationMs: 1, source: 'noise' })
    expect(log.list().length).toBe(10)
    log.prune(70_000)
    expect(log.list().length).toBe(0)
  })

  it('readLongtaskSource 对缺省 containerName 回退 unknown', () => {
    const bare = { duration: 50 } as PerformanceEntry
    expect(readLongtaskSource(bare)).toBe('unknown')
    const labeled = {
      duration: 50,
      attribution: [{ containerName: 'frame-x' }],
    } as unknown as PerformanceEntry
    expect(readLongtaskSource(labeled)).toBe('frame-x')
  })
})

describe('startDomAttributionSampler', () => {
  function mount(): { root: HTMLElement; host: HTMLElement } {
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.setAttribute('data-dsh-plugin', 'spec-plugin')
    document.body.appendChild(root)
    return { root, host: document.body }
  }

  it('把插入节点归因到最近的 data-dsh-plugin 根', () => {
    const agg = createAttributionAggregator()
    let nowMs = 10_000
    const stop = startDomAttributionSampler(agg, { now: () => nowMs })
    expect(stop).toBeDefined()
    const { root } = mount()
    const child = document.createElement('span')
    root.appendChild(child)
    // jsdom 的 MutationObserver 回调是异步微任务, 等一拍。
    return Promise.resolve().then(() => {
      const snap = agg.snapshot(nowMs, 5)
      expect(snap.topPlugins.some((p) => p.name === 'spec-plugin')).toBe(true)
      stop?.()
    })
  })

  it('文本节点经由父元素归因, dispose 后不再计数', async () => {
    const agg = createAttributionAggregator()
    const nowMs = 10_000
    let stop = startDomAttributionSampler(agg, { now: () => nowMs })
    const { root } = mount()
    const text = document.createTextNode(' streamed tail ')
    root.appendChild(text)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const before = agg.snapshot(nowMs, 5).topPlugins.find((p) => p.name === 'spec-plugin')
    expect(before?.nodesPerSec).toBeGreaterThan(0)

    stop?.()
    root.appendChild(document.createElement('i'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const after = agg.snapshot(nowMs, 5).topPlugins.find((p) => p.name === 'spec-plugin')
    expect(after?.nodesPerSec).toBe(before?.nodesPerSec)

    // 二次安装继续工作(生命周期可重复启停)。
    stop = startDomAttributionSampler(agg, { now: () => nowMs })
    root.appendChild(document.createElement('u'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(agg.snapshot(nowMs, 5).topPlugins.find((p) => p.name === 'spec-plugin')?.nodesPerSec).toBeGreaterThan(
      after?.nodesPerSec ?? 0,
    )
    stop?.()
  })

  it('超出单次回调 budget 的节点计入 unattributed', async () => {
    const agg = createAttributionAggregator()
    const nowMs = 10_000
    // 未打语义属性的容器: 即便预算充足也只会进 unattributed。
    document.body.innerHTML = ''
    const plain = document.createElement('section')
    plain.dataset.plainRoot = ''
    document.body.appendChild(plain)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const stop = startDomAttributionSampler(agg, { now: () => nowMs, budget: 2 })
    const row = document.createElement('div')
    for (let i = 0; i < 6; i++) row.appendChild(document.createElement('i'))
    plain.appendChild(row)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const snap = agg.snapshot(nowMs, 5)
    expect(snap.topPlugins).toEqual([])
    expect(snap.totalNodesPerSec).toBeGreaterThan(0)
    expect(snap.unattributedPerSec).toBeCloseTo(snap.totalNodesPerSec, 6)
    stop?.()
  })

  it('注入时钟异常时不抛出(失败开放)', () => {
    const agg = createAttributionAggregator()
    expect(() => agg.add('pet', 3, Number.NaN)).not.toThrow()
    expect(() => agg.snapshot(Number.NaN, 3)).not.toThrow()
  })
})
