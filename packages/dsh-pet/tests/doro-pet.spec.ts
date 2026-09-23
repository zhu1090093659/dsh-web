/**
 * doro (朵拉) pet manifest + on-disk frames guard: 11 frames2d tracks
 * (802 frames) — breathing idle, the work trio, sleep, a wash mode
 * (mood +3/s), four-direction roaming, three idle-director acts
 * (cola / orange / tongue) and the drag-only struggle loop.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePetManifest } from '../src/manifest-v2.ts'
import { petPackageRoot } from '../src/registry.ts'

const DORO_DIR = join(petPackageRoot(import.meta.url), 'assets', 'doro')

/** Webp frames actually shipped for one track. */
const frameCount = (track: string): number =>
  readdirSync(join(DORO_DIR, 'thumb', track)).filter(f => f.endsWith('.webp')).length

describe('doro pet manifest', () => {
  const parsed = JSON.parse(readFileSync(join(DORO_DIR, 'pet.json'), 'utf8'))
  const res = parsePetManifest(parsed, 'doro-assets')

  it('user gets a manifest that parses clean (fail-closed)', () => {
    // Given the shipped doro manifest; when it is parsed; then it is accepted
    // with no error diagnostic.
    expect(res.ok).toBe(true)
    if (res.ok) {
      const errors = res.diagnostics.filter(d => d.level === 'error')
      expect(errors).toEqual([])
    }
  })

  it('user sees every track declared with the 42ms default duration', () => {
    // Given the parsed manifest; when its track table is read; then all eleven
    // tracks exist and none overrides the 42 ms cadence.
    if (!res.ok) throw new Error('manifest rejected')
    const frames2d = res.manifest.frames2d!
    expect(Object.keys(frames2d.tracks).sort()).toEqual(
      ['cola', 'idle', 'move', 'orange', 'sleep', 'struggle', 'tongue', 'wash', 'work', 'work-fail', 'work-success'],
    )
    expect(frames2d.defaultFrameMs).toBe(42)
    // No track overrides the cadence: every row only sets loop/fallback.
    for (const [name, row] of Object.entries<Record<string, unknown>>(parsed.frames2d.tracks)) {
      for (const key of Object.keys(row)) expect(['loop', 'fallback'], name).toContain(key)
    }
    expect(frames2d.phases.idle).toBe('idle')
  })

  it('user sees the one-shot acts and the drag-only loop marked', () => {
    // Given the parsed tracks; when loop and fallback are read; then one-shot
    // acts settle back and the ambient loops keep running.
    if (!res.ok) throw new Error('manifest rejected')
    const tracks = res.manifest.frames2d!.tracks
    // Work results are one-shot and settle back into the work loop.
    for (const name of ['work-success', 'work-fail']) {
      expect(tracks[name]!.loop).toBe(false)
      expect(tracks[name]!.fallback).toBe('work')
    }
    // Idle-director acts are one-shot and settle back into idle.
    for (const name of ['cola', 'orange', 'tongue']) {
      expect(tracks[name]!.loop).toBe(false)
      expect(tracks[name]!.fallback).toBe('idle')
    }
    // Ambient loops keep running: idle, sleep, wash, move, work and the
    // struggle track that the chrome holds for the whole drag.
    for (const name of ['idle', 'sleep', 'wash', 'move', 'work', 'struggle']) {
      expect(tracks[name]!.loop ?? true, name).toBe(true)
      expect(tracks[name]!.fallback, name).toBeUndefined()
    }
  })

  it('user gets the work rule: 10s tick, 50% success, result window over both animations', () => {
    // Given the parsed work block; when its cadence and hold window are read;
    // then the result window outlasts both result animations.
    if (!res.ok) throw new Error('manifest rejected')
    const work = res.manifest.gameplay?.work
    if (!work) throw new Error('work rule missing')
    expect(work.state).toBe('work')
    expect(work.successState).toBe('work-success')
    expect(work.failState).toBe('work-fail')
    expect(work.tickMs).toBe(10000)
    expect(work.successProbability).toBeCloseTo(0.5, 6)
    expect(work.success?.effects?.some(e => e.currency === 'treats' && e.amount === 1)).toBe(true)
    // The hold time must outlast the animation, or the result frames get cut.
    for (const [slot, track] of [['success', 'work-success'], ['fail', 'work-fail']] as const) {
      const animation = frameCount(track) * 42
      expect(work.resultMs?.[slot], slot).toBeGreaterThanOrEqual(animation)
    }
  })

  it('user sees sleep restore energy and wash mode restore mood every second', () => {
    // Given the parsed sleep and wash blocks; when their restore cadences are
    // read; then each pays its declared stat on its own interval.
    if (!res.ok) throw new Error('manifest rejected')
    const sleep = res.manifest.gameplay?.sleep
    if (!sleep) throw new Error('sleep rule missing')
    expect(sleep.state).toBe('sleep')
    expect(sleep.restore).toEqual({ stat: 'energy', amount: 4, intervalMs: 30000 })
    const wash = res.manifest.gameplay?.modes?.['wash']
    if (!wash) throw new Error('wash mode missing')
    expect(wash.state).toBe('wash')
    expect(wash.label).toBe('洗澡')
    expect(wash.activeLabel).toBe('洗澡中')
    expect(wash.restore).toEqual({ stat: 'mood', amount: 3, intervalMs: 1000 })
    // The held track exists and loops.
    expect(res.manifest.frames2d!.tracks[wash.state]!.loop ?? true).toBe(true)
  })

  it('user sees the roam roll every 15s at 30% across the four directions', () => {
    // Given the parsed roam block; when its roll shape is read; then it matches
    // the shipped cadence and distance budget.
    if (!res.ok) throw new Error('manifest rejected')
    const roam = res.manifest.gameplay?.roam
    if (!roam) throw new Error('roam rule missing')
    expect(roam.state).toBe('move')
    expect(roam.intervalMs).toBe(15000)
    expect(roam.probability).toBeCloseTo(0.3, 6)
    expect(roam.distanceMin).toBe(80)
    expect(roam.distanceMax).toBe(220)
    expect(roam.speed).toBe(90)
    expect(roam.directions).toEqual(['up', 'down', 'left', 'right'])
    expect(res.manifest.frames2d!.tracks[roam.state]!.loop ?? true).toBe(true)
  })

  it('user sees the idle director play three acts, each at 30%', () => {
    // Given the parsed idle director; when its acts are read; then each names a
    // declared one-shot track at the same weight.
    if (!res.ok) throw new Error('manifest rejected')
    const director = res.manifest.gameplay?.idleDirector
    if (!director) throw new Error('idle director missing')
    expect(director.intervalMs).toBe(10000)
    expect(director.maxMiss).toBe(10)
    expect(director.idleWeight).toBe(10)
    expect(director.acts.map(a => a.track)).toEqual(['cola', 'orange', 'tongue'])
    for (const act of director.acts) expect(act.weight).toBe(30)
    // Every act names a declared one-shot track.
    for (const act of director.acts) {
      expect(res.manifest.frames2d!.tracks[act.track]!.loop).toBe(false)
    }
  })

  it('user sees the struggle loop while the chrome reports a drag', () => {
    // Given the parsed manifest; when the drag state is read; then it points at
    // the looping struggle track.
    if (!res.ok) throw new Error('manifest rejected')
    expect(res.manifest.gameplay?.dragState).toBe('struggle')
    expect(res.manifest.frames2d!.tracks['struggle']!.loop ?? true).toBe(true)
  })

  it('user sees the on-disk frame counts stay stable', () => {
    // Given the shipped thumb folders; when each track is counted; then the
    // totals match the manifest and add up to 802 frames.
    const counts: Record<string, number> = {
      idle: 73, work: 77, 'work-success': 77, 'work-fail': 77, sleep: 73,
      wash: 70, move: 73, cola: 73, orange: 73, tongue: 73, struggle: 63,
    }
    let total = 0
    for (const [track, expected] of Object.entries(counts)) {
      const files = frameCount(track)
      expect(files, `${track} webp frame count`).toBe(expected)
      total += files
    }
    expect(total).toBe(802)
  })
})
