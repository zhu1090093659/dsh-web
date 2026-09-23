/**
 * jyn (女仆鲸鱼娘) pet manifest + on-disk frames guard:
 * 78-frame (74 source + 4 RIFE bridge) seamless idle, shy/shy2/shy3
 * interactions, work/success/fail loop, and the sleep -> sleeping loop
 * (sleep intro is one-shot, falls back into the sleeping loop).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePetManifest } from '../src/manifest-v2.ts'
import { petPackageRoot } from '../src/registry.ts'

const JYN_DIR = join(petPackageRoot(import.meta.url), 'assets', 'jyn')

describe('jyn pet manifest', () => {
  const parsed = JSON.parse(readFileSync(join(JYN_DIR, 'pet.json'), 'utf8'))
  const res = parsePetManifest(parsed, 'jyn-assets')

  it('parses clean (fail-closed' + ')', () => {
    expect(res.ok).toBe(true)
    if (res.ok) {
      const errors = res.diagnostics.filter(d => d.level === 'error')
      expect(errors).toEqual([])
    }
  })

  it('declares all tracks with 40ms default duration', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const frames2d = res.manifest.frames2d!
    expect(Object.keys(frames2d.tracks).sort()).toEqual(
      ['anyejinjin-angry', 'anyejinjin-idle', 'anyejinjin-rest', 'bingjing-gongzhu-angry', 'bingjing-gongzhu-idle', 'bingjing-gongzhu-rest', 'bingjing-gongzhu-staff', 'bingjing-gongzhu-tsundere', 'bingjing-gongzhu-work', 'bingjing-gongzhu-work-fail', 'bingjing-gongzhu-work-success', 'idle', 'lanhainishang-idle', 'lanhainishang-lift-skirt', 'shy', 'shy2', 'shy3', 'sleep', 'sleeping', 'work', 'work-fail', 'work-success'],
    )
    for (const t of ['shy', 'shy2', 'shy3']) {
      expect(frames2d.tracks[t].loop).toBe(false)
      expect(frames2d.tracks[t].fallback).toBe('idle')
    }
    for (const t of ['work-success', 'work-fail']) {
      expect(frames2d.tracks[t].loop).toBe(false)
      expect(frames2d.tracks[t].fallback).toBe('work')
    }
    expect(frames2d.tracks.work.loop ?? true).toBe(true)
    // sleep intro is one-shot and settles into the sleeping loop.
    expect(frames2d.tracks.sleep.loop).toBe(false)
    expect(frames2d.tracks.sleep.fallback).toBe('sleeping')
    expect(frames2d.tracks.sleeping.loop ?? true).toBe(true)
    expect(frames2d.defaultFrameMs).toBe(40)
    expect(frames2d.phases.idle).toBe('idle')
  })

  it('declares the anyejinjin skin with a looping idleTrack', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    expect(skins).toBeDefined()
    const skin = skins?.find(s => s.id === 'anyejinjin')
    expect(skin).toBeDefined()
    expect(skin?.label).toBe('暗夜鎏金')
    expect(skin?.idleTrack).toBe('anyejinjin-idle')
    const idleTrack = res.manifest.frames2d?.tracks[skin!.idleTrack]
    expect(idleTrack).toBeDefined()
    expect(idleTrack?.loop ?? true).toBe(true)
  })

  it('anyejinjin skin declares the angry click action at 30%', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'anyejinjin')
    expect(skin?.clickActions).toBeDefined()
    const action = skin?.clickActions?.find(a => a.track === 'anyejinjin-angry')
    expect(action).toBeDefined()
    expect(action?.probability).toBeCloseTo(0.3, 6)
    const track = res.manifest.frames2d?.tracks[action!.track]
    expect(track).toBeDefined()
    expect(track?.loop).toBe(false)
    expect(track?.fallback).toBe('idle')
  })

  it('anyejinjin skin overrides the sleep gameplay track with its rest loop', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'anyejinjin')
    expect(skin?.gameplayTracks).toBeDefined()
    expect(skin?.gameplayTracks?.['sleep']).toBe('anyejinjin-rest')
    const rest = res.manifest.frames2d?.tracks['anyejinjin-rest']
    expect(rest).toBeDefined()
    expect(rest?.loop ?? true).toBe(true)
  })

  it('declares the lanhainishang skin with a looping idleTrack', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    expect(skins).toBeDefined()
    const skin = skins?.find(s => s.id === 'lanhainishang')
    expect(skin).toBeDefined()
    expect(skin?.label).toBe('蓝海霓裳')
    expect(skin?.idleTrack).toBe('lanhainishang-idle')
    const idleTrack = res.manifest.frames2d?.tracks[skin!.idleTrack]
    expect(idleTrack).toBeDefined()
    expect(idleTrack?.loop ?? true).toBe(true)
  })

  it('lanhainishang skin declares the lift-skirt click action at 30%', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'lanhainishang')
    expect(skin?.clickActions).toBeDefined()
    const action = skin?.clickActions?.find(a => a.track === 'lanhainishang-lift-skirt')
    expect(action).toBeDefined()
    expect(action?.probability).toBeCloseTo(0.3, 6)
    // The action track is one-shot and settles back to the idle base.
    const track = res.manifest.frames2d?.tracks[action!.track]
    expect(track).toBeDefined()
    expect(track?.loop).toBe(false)
    expect(track?.fallback).toBe('idle')
    // Skins only inherit actions declared on themselves: lanhainishang
    // never carries the anyejinjin angry action.
    const angry = skin?.clickActions?.find(a => a.track === 'anyejinjin-angry')
    expect(angry).toBeUndefined()
  })

  it('declares the bingjing-gongzhu skin with a looping idleTrack', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    expect(skins).toBeDefined()
    const skin = skins?.find(s => s.id === 'bingjing-gongzhu')
    expect(skin).toBeDefined()
    expect(skin?.label).toBe('冰晶公主')
    expect(skin?.idleTrack).toBe('bingjing-gongzhu-idle')
    const idleTrack = res.manifest.frames2d?.tracks[skin!.idleTrack]
    expect(idleTrack).toBeDefined()
    expect(idleTrack?.loop ?? true).toBe(true)
    // Click-action probabilities are asserted by the dedicated split test below.
  })

  it('bingjing-gongzhu skin overrides the sleep and work gameplay tracks', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'bingjing-gongzhu')
    expect(skin?.gameplayTracks).toBeDefined()
    expect(skin?.gameplayTracks?.['sleep']).toBe('bingjing-gongzhu-rest')
    const rest = res.manifest.frames2d?.tracks['bingjing-gongzhu-rest']
    expect(rest).toBeDefined()
    expect(rest?.loop ?? true).toBe(true)
    // Work: the skin plays its own work loop while the mode is 'work', and its
    // own result animations settle back into that loop (fallback), while the
    // 10s adjudication itself stays the shared gameplay.work rule.
    expect(skin?.gameplayTracks?.['work']).toBe('bingjing-gongzhu-work')
    const work = res.manifest.frames2d?.tracks['bingjing-gongzhu-work']
    expect(work).toBeDefined()
    expect(work?.loop ?? true).toBe(true)
    expect(skin?.gameplayTracks?.['work-success']).toBe('bingjing-gongzhu-work-success')
    expect(skin?.gameplayTracks?.['work-fail']).toBe('bingjing-gongzhu-work-fail')
    for (const [track, state] of [['bingjing-gongzhu-work-success', 'work-success'], ['bingjing-gongzhu-work-fail', 'work-fail']] as const) {
      const result = res.manifest.frames2d?.tracks[track]
      expect(result, state).toBeDefined()
      expect(result?.loop).toBe(false)
      // Result animations fall back into the skin's own work loop, not the default one.
      expect(result?.fallback).toBe('bingjing-gongzhu-work')
    }
    // The adjudication rule is pet-level and shared by every skin.
    const rule = res.manifest.gameplay?.work
    expect(rule?.tickMs).toBe(10000)
    expect(rule?.successProbability).toBeCloseTo(0.5, 6)
    // Other skins keep the default sleep intro and default work loop.
    const other = skins?.find(s => s.id === 'lanhainishang')
    expect(other?.gameplayTracks).toBeUndefined()
  })

  it('bingjing-gongzhu skin splits its three click actions evenly', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'bingjing-gongzhu')
    const actions = skin?.clickActions ?? []
    expect(actions.map(a => a.track)).toEqual([
      'bingjing-gongzhu-staff',
      'bingjing-gongzhu-angry',
      'bingjing-gongzhu-tsundere',
    ])
    for (const action of actions) {
      // Even split: ~1/3 each (the last entry absorbs the float remainder).
      expect(action.probability).toBeCloseTo(1 / 3, 3)
      const track = res.manifest.frames2d?.tracks[action.track]
      expect(track).toBeDefined()
      expect(track?.loop).toBe(false)
      expect(track?.fallback).toBe('idle')
    }
    // The cumulative roll consumes the unit interval, so every click plays
    // exactly one of the three actions (no plain-boost remainder).
    const total = actions.reduce((sum, a) => sum + a.probability, 0)
    expect(total).toBeCloseTo(1, 6)
    expect(total).toBeGreaterThanOrEqual(1 - 1e-9)
    // Skin actions never leak onto other skins.
    const other = skins?.find(s => s.id === 'anyejinjin')
    for (const action of actions) {
      expect(other?.clickActions?.find(a => a.track === action.track)).toBeUndefined()
    }
  })

  it('work gameplay block: 50%, success anim once then back to work', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const work = res.manifest.gameplay?.work
    expect(work).toBeDefined()
    expect(work!.state).toBe('work')
    expect(work!.successState).toBe('work-success')
    expect(work!.failState).toBe('work-fail')
    expect(work!.successProbability).toBeCloseTo(0.5, 6)
    expect(work!.tickMs).toBe(10000)
    const successEffects = work!.success?.effects ?? []
    expect(successEffects.some(e => e.currency === 'treats' && e.amount === 1)).toBe(true)
  })

  it('sleep gameplay block: sleep intro holds the sleep track, restores energy', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const sleep = res.manifest.gameplay?.sleep
    expect(sleep).toBeDefined()
    expect(sleep!.state).toBe('sleep')
    expect(sleep!.restore.stat).toBe('energy')
    expect(sleep!.restore.amount).toBe(4)
    expect(sleep!.restore.intervalMs).toBe(30000)
  })

  it('head-touch triggers shy at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const head = zones.find(z => z.name === 'head')
    expect(head).toBeDefined()
    expect(head?.y1).toBeCloseTo(1 / 3, 2)
    const shyBranch = head?.branches.find(b => b.state === 'shy')
    expect(shyBranch?.probability).toBeCloseTo(0.3, 6)
    expect(shyBranch?.stateMs).toBeGreaterThan(0)
    const acts = res.manifest.gameplay?.idleDirector?.acts ?? []
    expect(acts.some(a => ['shy', 'shy2', 'shy3'].includes(a.track))).toBe(false)
  })

  it('body-touch triggers shy2 at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const body = zones.find(z => z.name === 'body')
    expect(body).toBeDefined()
    expect(body!.y1 - body!.y0).toBeCloseTo(1 / 3, 2)
    const shy2Branch = body?.branches.find(b => b.state === 'shy2')
    expect(shy2Branch?.probability).toBeCloseTo(0.3, 6)
    expect(shy2Branch?.stateMs).toBeGreaterThan(0)
  })

  it('legs-touch triggers shy3 at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const legs = zones.find(z => z.name === 'legs')
    expect(legs).toBeDefined()
    expect(legs!.y1 - legs!.y0).toBeCloseTo(1 / 3, 2)
    const shy3Branch = legs?.branches.find(b => b.state === 'shy3')
    expect(shy3Branch?.probability).toBeCloseTo(0.3, 6)
    expect(shy3Branch?.stateMs).toBeGreaterThan(0)
  })

  it('keeps on-disk frame counts stable', () => {
    const counts: Record<string, number> = {
      idle: 78, shy: 73, shy2: 73, shy3: 73,
      work: 70, 'work-success': 70, 'work-fail': 70,
      sleep: 51, sleeping: 77,
      'anyejinjin-idle': 74, 'anyejinjin-angry': 70, 'anyejinjin-rest': 64,
      'lanhainishang-idle': 74, 'lanhainishang-lift-skirt': 73,
      'bingjing-gongzhu-idle': 74, 'bingjing-gongzhu-staff': 70,
      'bingjing-gongzhu-angry': 69, 'bingjing-gongzhu-tsundere': 66, 'bingjing-gongzhu-rest': 65,
      'bingjing-gongzhu-work': 74,
      'bingjing-gongzhu-work-success': 67, 'bingjing-gongzhu-work-fail': 67,
    }
    for (const [track, expected] of Object.entries(counts)) {
      const files = readdirSync(join(JYN_DIR, 'thumb', track)).filter(f => f.endsWith('.webp'))
      expect(files.length, `${track} webp frame count`).toBe(expected)
    }
  })
})