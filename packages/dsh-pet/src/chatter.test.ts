/**
 * Chatter unit tests: the status voice (scene-stable lines, cadence rotation,
 * per-tool families, argument hints) and the murmur engine (keyword moods,
 * cooldown, output-volume budget). Everything is deterministic round-robin,
 * so exact lines are asserted.
 */
import { describe, expect, it } from 'vitest'
import {
  STATUS_POOLS,
  StatusVoice,
  TOOL_POOLS,
  toolArgHint,
  toolCategory,
  WHISPER_GENERIC_POOL,
  WHISPER_RULES,
  WhisperEngine,
  type VoicePackOverrides,
} from './chatter.ts'

describe('StatusVoice', () => {
  it('opens every scene with its legacy fixed line', () => {
    // The first pool line is the wording the plugin has always shown.
    expect(STATUS_POOLS.prepare[0]).toBe('准备开始')
    expect(STATUS_POOLS.waiting[0]).toBe('等待模型响应')
    expect(STATUS_POOLS.thinking[0]).toBe('正在思考')
    expect(STATUS_POOLS.review[0]).toBe('整理回复中')
    expect(STATUS_POOLS.toolResult[0]).toBe('处理工具结果')
    expect(STATUS_POOLS.done[0]).toBe('完成啦')
    expect(STATUS_POOLS.failed[0]).toBe('执行失败')
    expect(STATUS_POOLS.toolFailed[0]).toBe('工具执行失败')
  })

  it('keeps the line stable while a scene repeats within the rotation window', () => {
    const voice = new StatusVoice()
    // Streamed chunks re-emit the same scene many times a second: the copy
    // must not flicker per chunk.
    expect(voice.scene('thinking', 1000)).toBe('正在思考')
    expect(voice.scene('thinking', 2000)).toBe('正在思考')
    expect(voice.scene('thinking', 4999)).toBe('正在思考')
  })

  it('advances the line once the scene persists past the rotation cadence', () => {
    const voice = new StatusVoice()
    expect(voice.scene('thinking', 1000)).toBe('正在思考')
    expect(voice.scene('thinking', 5001)).toBe(STATUS_POOLS.thinking[1])
    expect(voice.scene('thinking', 9002)).toBe(STATUS_POOLS.thinking[2])
  })

  it('rotates round-robin when a scene is revisited after another scene', () => {
    const voice = new StatusVoice()
    expect(voice.scene('thinking', 0)).toBe(STATUS_POOLS.thinking[0])
    expect(voice.scene('review', 100)).toBe(STATUS_POOLS.review[0])
    expect(voice.scene('thinking', 200)).toBe(STATUS_POOLS.thinking[1])
  })

  it('interpolates the tool name and argument hint into tool lines', () => {
    const voice = new StatusVoice()
    expect(voice.tool('bash', 'bash', 'npm test', 0)).toBe('正在使用 bash')
    // Same family within the window: the pool line repeats but the CURRENT
    // call's name/hint are interpolated, so copy never goes stale.
    expect(voice.tool('bash', 'bash', 'pnpm build', 100)).toBe('正在使用 bash')
    // Past the cadence the shell family rotates to a hint-carrying line.
    const rotated = voice.tool('bash', 'bash', 'npm test', 5000)
    expect(rotated).toBe(TOOL_POOLS.shell[1]!.replace('{hint}', 'npm test'))
  })

  it('falls back to the tool name when no argument hint is available', () => {
    const voice = new StatusVoice()
    const line = voice.tool('grep', 'grep', undefined, 5000)
    expect(line).not.toContain('{hint}')
    expect(line).not.toContain('{tool}')
  })

  it('interpolates the running count into the remaining-tools line', () => {
    const voice = new StatusVoice()
    expect(voice.toolRemaining(1, 0)).toBe('还有 1 个工具运行中')
    expect(voice.toolRemaining(3, 5000)).toContain('3')
  })
})

describe('toolCategory', () => {
  it('maps the common tool vocabulary onto copy families', () => {
    expect(toolCategory('read')).toBe('read')
    expect(toolCategory('write')).toBe('write')
    expect(toolCategory('edit')).toBe('edit')
    expect(toolCategory('str_replace_editor')).toBe('edit')
    expect(toolCategory('run_code')).toBe('shell')
    expect(toolCategory('bash')).toBe('shell')
    expect(toolCategory('grep')).toBe('grep')
    expect(toolCategory('glob')).toBe('find')
    expect(toolCategory('web_search')).toBe('webSearch')
    expect(toolCategory('browserFetch')).toBe('webFetch')
    expect(toolCategory('mcp__mem0__search_memories')).toBe('memory')
    expect(toolCategory('subagent')).toBe('subagent')
    expect(toolCategory('todo_write')).toBe('todo')
    expect(toolCategory('some_future_tool')).toBe('generic')
  })
})

describe('toolArgHint', () => {
  it('extracts the shell command', () => {
    expect(toolArgHint('bash', '{"command":"npm test"}')).toBe('npm test')
    expect(toolArgHint('run_code', '{"code":"console.log(1)"}')).toBe('console.log(1)')
  })

  it('reduces file paths to their basename', () => {
    expect(toolArgHint('read', '{"file_path":"/repo/src/client/PetSprite.tsx"}')).toBe('PetSprite.tsx')
  })

  it('extracts search patterns and web queries', () => {
    expect(toolArgHint('grep', '{"pattern":"bubbleStack"}')).toBe('bubbleStack')
    expect(toolArgHint('web_search', '{"query":"dsh 插件"}')).toBe('dsh 插件')
  })

  it('stays hintless for unparseable or shapeless arguments', () => {
    expect(toolArgHint('bash', 'not json')).toBeUndefined()
    expect(toolArgHint('bash', '[]')).toBeUndefined()
    expect(toolArgHint('bash', '{"timeout":1000}')).toBeUndefined()
  })

  it('caps long hints so the bubble stays compact', () => {
    const hint = toolArgHint('bash', JSON.stringify({ command: 'x'.repeat(60) }))
    expect(hint).toBeDefined()
    expect(hint!.length).toBeLessThanOrEqual(28)
    expect(hint!.endsWith('...')).toBe(true)
  })
})

describe('WhisperEngine', () => {
  it('wakes a themed whisper from a keyword in the model output', () => {
    const engine = new WhisperEngine()
    expect(engine.feed('这里有个错误需要处理', 0)).toBe(WHISPER_RULES[1]!.pool[0])
  })

  it('suppresses whispers during the cooldown, then rotates the pool', () => {
    const engine = new WhisperEngine()
    expect(engine.feed('出现一个错误', 0)).toBe(WHISPER_RULES[1]!.pool[0])
    expect(engine.feed('又一个错误', 1000)).toBeUndefined()
    expect(engine.feed('还有一个错误', 9000)).toBe(WHISPER_RULES[1]!.pool[1])
  })

  it('earns an ambient whisper from output volume alone', () => {
    const engine = new WhisperEngine(undefined, 0, 10)
    expect(engine.feed('aaaaaaaa', 0)).toBeUndefined()
    expect(engine.feed('bbbb', 1)).toBe(WHISPER_GENERIC_POOL[0])
    // The counter resets after speaking: another budget must accumulate.
    expect(engine.feed('cccc', 2)).toBeUndefined()
    expect(engine.feed('dddddddddd', 3)).toBe(WHISPER_GENERIC_POOL[1])
  })

  it('ignores empty chunks', () => {
    const engine = new WhisperEngine(undefined, 0, 0)
    expect(engine.feed('', 0)).toBeUndefined()
  })
})

describe('voice-pack overrides (pet-center M4)', () => {
  const PACK = (): VoicePackOverrides => ({
    status: {
      done: ['自定义完工', '第二句完工'],
      thinking: [],
    },
    tools: {
      shell: ['敲命令 {hint}', '再来一次 {tool}'],
    },
    toolRemaining: ['后台还有 {n} 个'],
    whispers: {
      generic: ['自定义碎碎念 A', '自定义碎碎念 B'],
      rules: [{ keywords: ['测试通过'], pool: ['自定义全绿'] }],
    },
  })

  it('replaces a scene pool and keeps untouched scenes on the built-in pools', () => {
    const voice = new StatusVoice(PACK)
    expect(voice.scene('done', 0)).toBe('自定义完工')
    expect(voice.scene('done', 5000)).toBe('第二句完工')
    expect(voice.scene('thinking', 0)).toBe(STATUS_POOLS.thinking[0])
  })

  it('falls back to the built-in pool when the override pool is empty', () => {
    const voice = new StatusVoice(PACK)
    // PACK.thinking is an empty array: a scene line always renders.
    expect(voice.scene('thinking', 0)).toBe(STATUS_POOLS.thinking[0])
  })

  it('interpolates placeholders from an overridden tool pool', () => {
    const voice = new StatusVoice(PACK)
    expect(voice.tool('bash', 'bash', 'npm test', 0)).toBe('敲命令 npm test')
    const rotated = voice.tool('bash', 'bash', 'npm test', 5000)
    expect(rotated).toBe('再来一次 bash')
  })

  it('uses an overridden remaining-tools pool', () => {
    const voice = new StatusVoice(PACK)
    expect(voice.toolRemaining(4, 0)).toBe('后台还有 4 个')
  })

  it('interpolates every occurrence of a repeated placeholder', () => {
    const pack: ReturnType<typeof PACK> = {
      ...PACK(),
      tools: { shell: ['{tool} 和 {tool} 一起跑 {hint} {hint}'] },
      toolRemaining: ['{n} 路并进，共 {n} 路'],
    }
    const voice = new StatusVoice(() => pack)
    expect(voice.tool('bash', 'bash', 'npm test', 0)).toBe('bash 和 bash 一起跑 npm test npm test')
    expect(voice.toolRemaining(2, 5000)).toBe('2 路并进，共 2 路')
  })

  it('follows a provider swap on the next draw without rebuilding the engine', () => {
    let pack: ReturnType<typeof PACK> = PACK()
    const voice = new StatusVoice(() => pack)
    expect(voice.scene('done', 0)).toBe('自定义完工')
    pack = { ...PACK(), status: { done: ['换声了'] } }
    expect(voice.scene('done', 5000)).toBe('换声了')
  })

  it('replaces the whisper rules as a whole', () => {
    const engine = new WhisperEngine(PACK)
    expect(engine.feed('这里有一个错误', 0)).toBeUndefined()
    // The built-in error rule is gone; only the pack's rule fires.
    expect(engine.feed('测试通过', 1000)).toBe('自定义全绿')
  })

  it('replaces the ambient generic pool', () => {
    const engine = new WhisperEngine(PACK, 0, 3)
    expect(engine.feed('aaaa', 0)).toBe('自定义碎碎念 A')
    expect(engine.feed('bbbb', 1)).toBe('自定义碎碎念 B')
  })

  it('mutes ambient whispers when the generic pool is explicitly empty', () => {
    const engine = new WhisperEngine(() => ({ whispers: { generic: [] } }), 0, 3)
    expect(engine.feed('aaaa', 0)).toBeUndefined()
    expect(engine.feed('bbbb', 1)).toBeUndefined()
  })

  it('disables keyword rules when the rules array is explicitly empty', () => {
    const engine = new WhisperEngine(() => ({ whispers: { rules: [] } }), 0, 3)
    // No keyword rule matches anymore; volume still earns a built-in ambient.
    expect(engine.feed('测试通过', 0)).toBe(WHISPER_GENERIC_POOL[0])
  })
})
