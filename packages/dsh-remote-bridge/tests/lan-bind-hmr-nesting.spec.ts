/**
 * 旧版受管块的清理，以及它为什么必须离开调用方的帧（issues #1751 / #1754）。
 *
 * 原案是「设置保存驱动 sync 写 cordis.patch.yml，配置监视器重入宿主排他的 HMR
 * 事务」。本包没有写回路径（局域网边缘是运行时转发器），也没有设置保存驱动的
 * sync；留下来的唯一一次文件操作是删掉旧版本写的那个块。下面三条钉住的是它的
 * 结构性质，全部按行为断言。
 */
import { describe, expect, it } from 'vitest'
import { bridgeWiringPlanOf, createLegacyBlockCleaner, resolveBridgeConfig } from '../src/index.ts'

/** 一处空的进程环境。 */
const NO_ENV: NodeJS.ProcessEnv = {}

describe('旧版受管块的清理：一次进程一次，只删不写', () => {
  it('operator: 清理排进推迟队列，跑过一次之后重复调用是空操作', () => {
    // Given a cleaner that records where its work actually runs
    const deferred: (() => void)[] = []
    const removed: string[] = []
    const cleaner = createLegacyBlockCleaner({
      profile: () => 'web',
      remove: (profile) => {
        removed.push(profile)
        return { removed: true, host: '192.168.1.5', port: 3080 }
      },
      defer: (fn) => { deferred.push(fn) },
    })
    // When it is asked twice in the same process
    cleaner.run()
    cleaner.run()
    // Then exactly one deferred task exists and no file has been touched yet:
    // the work never runs inside the caller's frame
    expect(deferred).toHaveLength(1)
    expect(removed).toEqual([])
    expect(cleaner.cleanup).toBeUndefined()
    // When the deferred task runs
    deferred[0]?.()
    // Then the removal happened once, with its verdict kept for the status frame
    expect(removed).toEqual(['web'])
    expect(cleaner.cleanup).toEqual({ removed: true, host: '192.168.1.5', port: 3080 })
  })

  it('operator: 清理失败只记一行，绝不抛回调用方', () => {
    // Given a profile file that cannot be rewritten
    const logs: string[] = []
    const cleaner = createLegacyBlockCleaner({
      profile: () => 'web',
      remove: () => { throw new Error('EACCES: permission denied') },
      defer: (fn) => { fn() },
      log: (message) => { logs.push(message) },
    })
    // When the cleaner runs
    // Then the save path (and the caller) is never handed an exception
    expect(() => cleaner.run()).not.toThrow()
    // And the failure is stated instead of being swallowed into a live block
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('EACCES')
    expect(cleaner.cleanup).toBeUndefined()
  })

  it('operator: 清理不看局域网开关，开关没设也照样跑一次', () => {
    // Given a profile whose lanBind toggle was never flipped
    const removed: string[] = []
    const cleaner = createLegacyBlockCleaner({
      profile: () => 'web',
      remove: (profile) => {
        removed.push(profile)
        return { removed: false, host: undefined, port: undefined }
      },
      defer: (fn) => { fn() },
    })
    // When the plugin mounts
    cleaner.run()
    // Then the legacy block is still cleaned (a surviving block keeps replacing
    // the profile row's own bind), while the LAN edge stays off
    expect(removed).toEqual(['web'])
    expect(bridgeWiringPlanOf({ config: resolveBridgeConfig({}, NO_ENV), gatePort: 41000 }).forward)
      .toEqual({ host: undefined, reason: 'off' })
  })
})
