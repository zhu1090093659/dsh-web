import { describe, expect, test } from 'vitest'

import {
  apply,
  classifyReasoning,
  hasAnchoredReasoning,
  inject,
  name,
} from '../presets/liangshen/tool-bootstrap.mjs'

const config = {
  commonTools: ['read'],
  shellTools: ['bash', 'pwsh'],
}

const SECTIONS = [
  { name: 'deployment:persona', text: 'You are a helpful software engineer assistant.' },
  { name: 'plan:policy', text: 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds.' },
]

type Listener = (payload: any, next: () => Promise<any>) => Promise<any>

function register(customConfig: Record<string, unknown> = {}): Map<string, { listener: Listener, options: any }> {
  const listeners = new Map<string, { listener: Listener, options: any }>()
  const ctx = {
    on(event: string, callback: Listener, options?: any) {
      listeners.set(event, { listener: callback, options })
    },
  }
  apply(ctx, { ...config, ...customConfig })
  return listeners
}

function listener(listeners: Map<string, { listener: Listener, options: any }>, event: string): Listener {
  const entry = listeners.get(event)
  expect(entry).toBeDefined()
  return entry!.listener
}

function session(events: unknown[] = [], cwd: string | undefined = '/workspace') {
  return { events, header: cwd === undefined ? {} : { cwd } }
}

function agentOf(events: unknown[] = [], cwd?: string) {
  return { session: session(events, cwd) }
}

async function assemble(
  listener: Listener,
  events: unknown[],
  tools: unknown[],
  contexts: unknown[] = [{ name: 'sandbox:policy', text: 'Current DSH file policy: workspace-write.' }],
  sections: unknown[] = SECTIONS,
) {
  return listener(
    undefined,
    { agent: agentOf(events) },
    async () => ({ system: 'minimal persona', tools, contexts, sections }),
  )
}

async function preStep(
  listener: Listener,
  events: unknown[],
  messages: unknown[],
  kind = 'enter',
) {
  return listener(
    { agent: agentOf(events), messages, turn: 1, step: 1, signal: {} },
    async () => ({ kind, messages }),
  )
}

function message(kind: string | undefined, id: string) {
  return { id, source: kind === undefined ? undefined : { kind } }
}

function reasoningEvent(text: string) {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'reasoning', text }] } },
  }
}

function stepEvent() {
  return { type: 'step/start', data: { turn: 1, step: 1 } }
}

function turnEndEvent(turn = 1) {
  return { type: 'turn/end', data: { turn } }
}

describe('anchored-tool-bootstrap', () => {
  test('exports a diagnostic plugin name', () => {
    expect(name).toBe('anchored-tool-bootstrap')
  })

  test('registers both quarantines outermost in their waterfalls', () => {
    const listeners = register()
    expect(listeners.get('system-prompt/assemble')?.options).toMatchObject({ prepend: true })
    expect(listeners.get('agent/pre-step')?.options).toMatchObject({ prepend: true })
  })

  test('first request exposes one platform shell and read, empties contexts, and keeps only the persona section', async () => {
    const result = await assemble(listener(register(), 'system-prompt/assemble'), [], [
      { name: 'pwsh' },
      { name: 'read' },
      { name: 'edit' },
    ])
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['pwsh', 'read'])
    expect(result.contexts).toEqual([])
    expect(result.sections.map((section: any) => section.name)).toEqual(['deployment:persona'])
    expect(result.sections[0].text).toBe(SECTIONS[0].text)
  })

  test('promotion appends the session working directory to the persona', async () => {
    const assembleListener = listener(register(), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }]
    const promoted = await assembleListener(
      undefined,
      { agent: { session: { events: [{ type: 'tool/call' }], header: { cwd: '/Users/zcl/code/demo' } } } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(promoted.sections[0].text).toBe(`${SECTIONS[0].text}\n\nYour working directory is /Users/zcl/code/demo.`)
    expect(promoted.sections[1]).toEqual(SECTIONS[1])
  })

  test('promotion leaves the persona one-line when no workspace is selected', async () => {
    const assembleListener = listener(register(), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }]
    const promoted = await assembleListener(
      undefined,
      { agent: { session: { events: [{ type: 'tool/call' }] } } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(promoted.sections).toEqual(SECTIONS)
  })

  test('phase 1 also keeps the legacy persona section name', async () => {
    const legacySections = [
      { name: 'persona', text: 'You are a helpful software engineer assistant.' },
      { name: 'plan:policy', text: 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds.' },
    ]
    const result = await assemble(
      listener(register(), 'system-prompt/assemble'),
      [],
      [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }],
      undefined,
      legacySections,
    )
    expect(result.sections.map((section: any) => section.name)).toEqual(['persona'])
    expect(result.sections[0].text).toBe(legacySections[0].text)
  })

  test('first request keeps its empty contexts even when none were assembled', async () => {
    const assembleListener = listener(register(), 'system-prompt/assemble')

    const result = await assembleListener(
      undefined,
      { agent: agentOf([]) },
      async () => ({ system: 'minimal persona', tools: [{ name: 'bash' }, { name: 'read' }] }),
    )
    expect(result.contexts).toEqual([])
  })

  test('a durable tool call promotes the complete catalog and restores contexts and all sections', async () => {
    const tools = [{ name: 'pwsh' }, { name: 'read' }, { name: 'edit' }, { name: 'grep' }]
    const contexts = [{ name: 'sandbox:policy', text: 'Current DSH file policy: workspace-write.' }]
    const events = [{ type: 'tool/call', data: { name: 'read' } }]
    const result = await assemble(listener(register(), 'system-prompt/assemble'), events, tools, contexts)
    expect(result.tools).toEqual(tools)
    expect(result.contexts).toEqual(contexts)
    expect(result.sections[0]).toEqual({
      name: SECTIONS[0].name,
      text: `${SECTIONS[0].text}\n\nYour working directory is /workspace.`,
    })
    expect(result.sections[1]).toEqual(SECTIONS[1])
    expect(result.sections.map((section: any) => section.name)).toEqual(['deployment:persona', 'plan:policy'])
  })

  test('sessions derive promotion independently from their own events', async () => {
    const assembleListener = listener(register(), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]

    const promoted = await assemble(assembleListener, [{ type: 'tool/call' }], tools)
    const fresh = await assemble(assembleListener, [], tools)
    expect(promoted.tools).toEqual(tools)
    expect(fresh.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
  })

  test('phase 1 pre-step keeps only explicit user messages', async () => {
    const messages = [
      message('user', 'user'),
      message('agent-instructions', 'instructions'),
      message('skill-catalog', 'skills'),
      message('plugin', 'runtime'),
      message(undefined, 'seed'),
    ]
    const result = await preStep(listener(register(), 'agent/pre-step'), [], messages)
    expect(result.kind).toBe('enter')
    expect(result.messages.map((entry: any) => entry.id)).toEqual(['user'])
  })

  test('phase 1 pre-step leaves rejected decisions untouched', async () => {
    const messages = [message('user', 'user'), message('agent-instructions', 'instructions')]
    const result = await preStep(listener(register(), 'agent/pre-step'), [], messages, 'reject')
    expect(result.kind).toBe('reject')
    expect(result.messages).toEqual(messages)
  })

  test('a promoted pre-step lets injected messages through', async () => {
    const listeners = register()
    const preStepListener = listener(listeners, 'agent/pre-step')
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const sessionEvents = [{ type: 'tool/call' }]
    const sessionObj = { events: sessionEvents }
    await assembleListener(undefined, { agent: { session: sessionObj } }, async () => ({
      system: 'minimal persona',
      tools: [{ name: 'bash' }, { name: 'read' }],
    }))

    const messages = [message('user', 'user'), message('agent-instructions', 'instructions')]
    const result = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(result.messages).toEqual(messages)
  })

  test('instructionHint swaps the first post-promotion instructions dump for a hint (#388)', async () => {
    const listeners = register({ instructionHint: true })
    const preStepListener = listener(listeners, 'agent/pre-step')
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const sessionObj = { events: [{ type: 'tool/call' }] }
    await assembleListener(undefined, { agent: { session: sessionObj } }, async () => ({
      system: 'minimal persona',
      tools: [{ name: 'bash' }, { name: 'read' }],
    }))

    const dump = {
      id: 'instructions',
      role: 'user',
      content: [{
        type: 'text',
        text: '<system-reminder>\n\nInstructions from: ~/.dsh/AGENTS.md\n\nGlobal rules.\n\nInstructions from: AGENTS.md\n\nRepo rules.\n</system-reminder>',
      }],
      source: { kind: 'agent-instructions' },
    }
    const messages = [message('user', 'user'), dump]
    const first = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(first.messages).toHaveLength(2)
    expect(first.messages[0].id).toBe('user')
    const hint = first.messages[1]
    expect(typeof hint.id).toBe('string')
    expect(hint.id).not.toBe('')
    expect(hint.source.kind).toBe('instruction-hint')
    expect(hint.id).toBe('instructions')
    expect(hint.content[0].text).toContain('Reference documents exist: ~/.dsh/AGENTS.md, AGENTS.md.')
    expect(hint.content[0].text).toContain('not task instructions')
    expect(hint.content[0].text).not.toContain('Global rules.')

    // Later injections are dropped silently; the model reads on demand.
    const second = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 2, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(second.messages.map((entry: any) => entry.id)).toEqual(['user'])
  })

  test('instructionHint generates an id when the original instructions message has none (#510)', async () => {
    const listeners = register({ instructionHint: true })
    const preStepListener = listener(listeners, 'agent/pre-step')
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const sessionObj = { events: [{ type: 'tool/call' }] }
    await assembleListener(undefined, { agent: { session: sessionObj } }, async () => ({
      system: 'minimal persona',
      tools: [{ name: 'bash' }, { name: 'read' }],
    }))

    const dump = {
      role: 'user',
      content: [{
        type: 'text',
        text: '<system-reminder>\n\nInstructions from: AGENTS.md\n\nRepo rules.\n</system-reminder>',
      }],
      source: { kind: 'agent-instructions' },
    }
    const messages = [message('user', 'user'), dump]
    const result = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    const hint = result.messages[1]
    expect(hint.source.kind).toBe('instruction-hint')
    expect(hint.id).toEqual(expect.any(String))
    expect(hint.id).not.toBe('')
  })

  test('instructionHint passes an instructions message with no file sections through', async () => {
    const listeners = register({ instructionHint: true })
    const preStepListener = listener(listeners, 'agent/pre-step')
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const sessionObj = { events: [{ type: 'tool/call' }] }
    await assembleListener(undefined, { agent: { session: sessionObj } }, async () => ({
      system: 'minimal persona',
      tools: [{ name: 'bash' }, { name: 'read' }],
    }))
    const empty = {
      id: 'instructions',
      content: [{ type: 'text', text: '<system-reminder>\n\nNo workspace instructions.\n</system-reminder>' }],
      source: { kind: 'agent-instructions' },
    }
    const messages = [message('user', 'user'), empty]
    const result = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(result.messages).toEqual(messages)
  })

  test('phase 1 honors the configured messageSources whitelist', async () => {
    const preStepListener = listener(register({ messageSources: ['user', 'agent-instructions'] }), 'agent/pre-step')
    const messages = [
      message('user', 'user'),
      message('agent-instructions', 'instructions'),
      message('skill-catalog', 'skills'),
    ]
    const result = await preStep(preStepListener, [], messages)
    expect(result.messages.map((entry: any) => entry.id)).toEqual(['user', 'instructions'])
  })

  test('phase 1 lets goal auto-round messages through by default (issue #578)', async () => {
    const preStepListener = listener(register(), 'agent/pre-step')
    const messages = [
      message('goal', 'goal-round'),
      message('agent-instructions', 'instructions'),
      message(undefined, 'seed'),
    ]
    const result = await preStep(preStepListener, [], messages)
    expect(result.messages.map((entry: any) => entry.id)).toEqual(['goal-round'])
  })

  test('a tool-less goal auto-round response still promotes (issue #578 deadlock)', async () => {
    // A goal round that reaches the model can end without any tool call and
    // without a minimal-like reasoning anchor. Branch (d) must still promote
    // — otherwise every later goal round is filtered out again and the goal
    // resume/pause loop deadlocks.
    const assembleListener = listener(
      register({ promoteAfterFirstResponse: true, anchorGate: true, maxBootstrapSteps: 4 }),
      'system-prompt/assemble',
    )
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [
      {
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'Continuing the goal this round.' }] } },
      },
      turnEndEvent(1),
    ]
    const result = await assemble(assembleListener, events, tools)
    expect(result.tools).toEqual(tools)
  })

  test('anchorGate holds promotion after a standard-like first block', async () => {
    const assembleListener = listener(register({ anchorGate: true, maxBootstrapSteps: 4 }), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [stepEvent(), reasoningEvent('Let me start by checking the repo.'), { type: 'tool/call' }]

    const result = await assemble(assembleListener, events, tools)
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
  })

  test('anchorGate promotes once a minimal-like reasoning block appears', async () => {
    const assembleListener = listener(register({ anchorGate: true, maxBootstrapSteps: 4 }), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [stepEvent(), reasoningEvent('We need inspect the repo first.'), { type: 'tool/call' }]

    const result = await assemble(assembleListener, events, tools)
    expect(result.tools).toEqual(tools)
  })

  test('anchorGate falls back to promotion after maxBootstrapSteps', async () => {
    const assembleListener = listener(register({ anchorGate: true, maxBootstrapSteps: 2 }), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [stepEvent(), reasoningEvent('Let me check.'), stepEvent(), stepEvent(), { type: 'tool/call' }]

    const result = await assemble(assembleListener, events, tools)
    expect(result.tools).toEqual(tools)
  })

  test('promoteAfterFirstResponse opens the catalog on the next turn after a tool-less response', async () => {
    const listeners = register({ promoteAfterFirstResponse: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const preStepListener = listener(listeners, 'agent/pre-step')
    const events: unknown[] = []
    const sessionObj = { events, header: { cwd: '/workspace' } }
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const messages = [message('user', 'user'), message('agent-instructions', 'instructions')]

    // Turn 1 runs in the real order: prompt assembly first, then pre-step.
    const phase1 = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(phase1.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    const phase1Step = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(phase1Step.messages.map((entry: any) => entry.id)).toEqual(['user'])

    // The tool-less turn finishes; its events land before the next turn.
    events.push({ type: 'step/start', data: { turn: 1, step: 1 } })
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } })
    events.push(turnEndEvent(1))

    // The next turn assembles first and already sees the complete catalog.
    const nextAssemble = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(nextAssemble.tools).toEqual(tools)
    expect(nextAssemble.sections[0]).toEqual({
      name: SECTIONS[0].name,
      text: `${SECTIONS[0].text}\n\nYour working directory is /workspace.`,
    })
    expect(nextAssemble.sections[1]).toEqual(SECTIONS[1])
    const nextStep = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 2, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(nextStep.messages).toEqual(messages)
  })

  test('anchorGate releases a finished first turn on the next user turn', async () => {
    const listeners = register({ anchorGate: true, maxBootstrapSteps: 4, promoteAfterFirstResponse: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const preStepListener = listener(listeners, 'agent/pre-step')
    const events: unknown[] = []
    const sessionObj = { events, header: { cwd: '/workspace' } }
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const messages = [message('user', 'user'), message('agent-instructions', 'instructions')]

    // Turn 1 runs in the real order: prompt assembly first, then pre-step.
    const phase1 = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(phase1.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    const phase1Step = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(phase1Step.messages.map((entry: any) => entry.id)).toEqual(['user'])

    // The first turn ends standard-like and unanchored, but with a tool call.
    events.push({ type: 'step/start', data: { turn: 1, step: 1 } })
    events.push(reasoningEvent('Let me check the repo.'))
    events.push({ type: 'tool/call' })
    events.push(turnEndEvent(1))

    // The new user turn assembles first, so the `turn/end` release already
    // gives it the complete catalog, and its messages are not stripped.
    const nextAssemble = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(nextAssemble.tools).toEqual(tools)
    expect(nextAssemble.sections[0]).toEqual({
      name: SECTIONS[0].name,
      text: `${SECTIONS[0].text}\n\nYour working directory is /workspace.`,
    })
    expect(nextAssemble.sections[1]).toEqual(SECTIONS[1])
    const nextStep = await preStepListener(
      { agent: { session: sessionObj }, messages, turn: 2, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages }),
    )
    expect(nextStep.messages).toEqual(messages)
  })

  test('deferred sources are stripped for deferredGraceSteps after promotion, then pass', async () => {
    const listeners = register({
      deferredSources: ['agent-instructions', 'skill-catalog'],
      deferredGraceSteps: 1,
    })
    const preStepListener = listener(listeners, 'agent/pre-step')
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const sessionEvents = [{ type: 'tool/call' }]
    const sessionObj = { events: sessionEvents }
    const tools = [{ name: 'bash' }, { name: 'read' }]
    await assembleListener(undefined, { agent: { session: sessionObj } }, async () => ({ system: 'minimal persona', tools }))

    const messages = [
      message('user', 'user'),
      message('agent-instructions', 'instructions'),
      message('skill-catalog', 'skills'),
      message('plugin', 'runtime'),
    ]
    const payload = {
      agent: { session: sessionObj },
      messages,
      turn: 1,
      step: 1,
      signal: {},
    }
    const first = await preStepListener(payload, async () => ({ kind: 'enter', messages }))
    expect(first.messages.map((entry: any) => entry.id)).toEqual(['user', 'runtime'])

    const second = await preStepListener(payload, async () => ({ kind: 'enter', messages }))
    expect(second.messages.map((entry: any) => entry.id)).toEqual(['user', 'instructions', 'skills', 'runtime'])
  })

  test('classifyReasoning anchors on we presence without let me', () => {
    expect(classifyReasoning('We need inspect the repo.').label).toBe('minimal-like')
    expect(classifyReasoning('The user wants me to check. We should inspect the repo.').label).toBe('minimal-like')
    expect(classifyReasoning('Let me start by checking.').label).toBe('standard-like')
    expect(classifyReasoning('We can fix it. Let me check first.').label).toBe('standard-like')
    expect(classifyReasoning('Need inspect the repo.').label).toBe('ambiguous')
  })

  test('hasAnchoredReasoning only inspects the first reasoning block', () => {
    const standardThenMinimal = [
      { type: 'reasoning', text: 'Let me start by checking the repo.' },
      { type: 'reasoning', text: 'We need inspect the repo first.' },
    ]
    expect(hasAnchoredReasoning(standardThenMinimal)).toBe(false)

    const minimalThenStandard = [
      { type: 'reasoning', text: 'We need inspect the repo first.' },
      { type: 'reasoning', text: 'Let me start by checking the repo.' },
    ]
    expect(hasAnchoredReasoning(minimalThenStandard)).toBe(true)
  })

  test('promotedPresentation switches to PTC Mode once per session', async () => {
    expect(inject).toContain('tools')

    const listeners = register({ promotedPresentation: 'code', anchorGate: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const calls: string[] = []
    const sessionObj = { events: [stepEvent(), reasoningEvent('We need inspect the repo.'), { type: 'tool/call' }] }
    const agent = { session: sessionObj, ctx: { tools: { presentAs: (mode: string) => calls.push(mode) } } }
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]

    await assembleListener(undefined, { agent }, async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }))
    await assembleListener(undefined, { agent }, async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }))
    expect(calls).toEqual(['code'])
  })

  test('promotedPresentation retries when the tools view arrives later', async () => {
    const listeners = register({ promotedPresentation: 'code', anchorGate: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const calls: string[] = []
    const sessionObj = { events: [stepEvent(), reasoningEvent('We need inspect the repo.'), { type: 'tool/call' }] }
    // No tools view yet: the switch must not latch.
    const agent: { session: unknown; ctx: { tools?: { presentAs: (mode: string) => void } } } = { session: sessionObj, ctx: {} }
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]

    await assembleListener(undefined, { agent }, async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }))
    expect(calls).toEqual([])

    agent.ctx.tools = { presentAs: (mode: string) => { calls.push(mode) } }
    await assembleListener(undefined, { agent }, async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }))
    expect(calls).toEqual(['code'])
  })

  test('session/event applies the PTC switch at step/end, not mid-step', async () => {
    const listeners = register({ promotedPresentation: 'code', anchorGate: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const eventListener = listener(listeners, 'session/event')
    const calls: string[] = []
    const sessionObj = { events: [] }
    const agent = { session: sessionObj, ctx: { tools: { presentAs: (mode: string) => calls.push(mode) } } }
    const tools = [{ name: 'bash' }, { name: 'read' }]

    await assembleListener(undefined, { agent }, async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }))
    expect(calls).toEqual([])

    sessionObj.events.push(stepEvent(), reasoningEvent('We need inspect the repo.'), { type: 'tool/call' })
    await eventListener(sessionObj, { type: 'tool/call' })
    expect(calls).toEqual([])

    await eventListener(sessionObj, { type: 'step/end' })
    expect(calls).toEqual(['code'])

    await eventListener(sessionObj, { type: 'turn/end' })
    expect(calls).toEqual(['code'])
  })

  test('invalid promotedPresentation fails loudly', () => {
    expect(() => register({ promotedPresentation: 'ptc' })).toThrow(/promotedPresentation/)
  })

  test('a missing bootstrap shell degrades to the full catalog instead of throwing', async () => {
    const result = await assemble(listener(register(), 'system-prompt/assemble'), [], [
      { name: 'read' },
      { name: 'edit' },
    ])
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['read', 'edit'])
  })

  test('a missing common tool degrades to the full catalog instead of throwing', async () => {
    const result = await assemble(listener(register(), 'system-prompt/assemble'), [], [
      { name: 'bash' },
      { name: 'edit' },
    ])
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'edit'])
  })

  test('invalid stability config fails loudly', () => {
    expect(() => register({ maxBootstrapSteps: 0 })).toThrow(/maxBootstrapSteps/)
    expect(() => register({ deferredGraceSteps: -1 })).toThrow(/deferredGraceSteps/)
    expect(() => register({ deferredSources: [''] })).toThrow(/deferredSources/)
    expect(() => register({ bootstrapMaxTokens: 0 })).toThrow(/bootstrapMaxTokens/)
  })

  test('agent/request caps phase-1 maxTokens', async () => {
    const listeners = register({ bootstrapMaxTokens: 1024, anchorGate: true })
    const requestListener = listener(listeners, 'agent/request')
    const result = await requestListener(
      { agent: agentOf([]), turn: 1, step: 1, signal: {} },
      async () => ({ provider: 'p', model: 'm', maxTokens: 384000 }),
    )
    expect(result.maxTokens).toBe(1024)
  })

  test('agent/request strips the cap after promotion and keeps foreign values', async () => {
    const listeners = register({ bootstrapMaxTokens: 1024, anchorGate: true })
    const requestListener = listener(listeners, 'agent/request')
    const agent = agentOf([])
    await requestListener(
      { agent, turn: 1, step: 1, signal: {} },
      async () => ({ provider: 'p', model: 'm', maxTokens: 384000 }),
    )
    agent.session.events.push({ type: 'tool/call' }, reasoningEvent('We need inspect the repo.'))
    const promoted = await requestListener(
      { agent, turn: 2, step: 1, signal: {} },
      async () => ({ provider: 'p', model: 'm', maxTokens: 1024 }),
    )
    expect(promoted.maxTokens).toBeUndefined()
    const other = await requestListener(
      { agent, turn: 2, step: 2, signal: {} },
      async () => ({ provider: 'p', model: 'm', maxTokens: 8192 }),
    )
    expect(other.maxTokens).toBe(8192)
  })

  test('agent/request leaves maxTokens alone without bootstrapMaxTokens', async () => {
    const listeners = register()
    const requestListener = listener(listeners, 'agent/request')
    const result = await requestListener(
      { agent: agentOf([]), turn: 1, step: 1, signal: {} },
      async () => ({ provider: 'p', model: 'm', maxTokens: 384000 }),
    )
    expect(result.maxTokens).toBe(384000)
  })

  test('a compaction falls the session back to the controlled phase', async () => {
    const listeners = register()
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const eventListener = listener(listeners, 'session/event')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }, { name: 'write' }]
    const events: unknown[] = [{ type: 'tool/call' }]
    const sessionObj = { events, header: { cwd: '/workspace' } }

    // Promoted before the compaction: the full catalog is exposed.
    const promoted = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(promoted.tools).toEqual(tools)

    // The compaction rewrites the surface; the next assembly is controlled
    // again: bootstrap pair only, empty contexts, persona section only.
    events.push({ type: 'compaction/end', seq: 10 })
    await eventListener(sessionObj, { type: 'compaction/end', seq: 10 })
    const after = await assembleListener(
      undefined,
      { agent: { session: sessionObj } },
      async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS }),
    )
    expect(after.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(after.contexts).toEqual([])
    expect(after.sections.map((section: any) => section.name)).toEqual(['deployment:persona'])
  })

  test('a cold session with a durable compaction boundary reconstructs the controlled phase', async () => {
    // A fresh session object simulates a process restart: the full durable
    // log is scanned from scratch, and the pre-boundary tool call must NOT
    // re-promote the session.
    const assembleListener = listener(register(), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [
      { type: 'tool/call' },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } },
      { type: 'compaction/end', seq: 10 },
    ]
    const result = await assemble(assembleListener, events, tools)
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
  })

  test('a new tool call after the compaction boundary re-promotes', async () => {
    const assembleListener = listener(register(), 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const events = [
      { type: 'tool/call' },
      { type: 'compaction/end', seq: 10 },
      { type: 'tool/call' },
    ]
    const result = await assemble(assembleListener, events, tools)
    expect(result.tools).toEqual(tools)
  })

  test('the post-compaction controlled phase includes the compactionTools work set', async () => {
    const listeners = register({ compactionTools: ['write', 'edit', 'todo_write'] })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }, { name: 'edit' }, { name: 'grep' }]
    const events = [{ type: 'tool/call' }, { type: 'compaction/end', seq: 10 }]
    const result = await assemble(assembleListener, events, tools)
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read', 'write', 'edit'])
  })

  test('compaction/end disposes the PTC Mode presentation and re-declares on re-promotion', async () => {
    const listeners = register({ promotedPresentation: 'code', anchorGate: true })
    const assembleListener = listener(listeners, 'system-prompt/assemble')
    const eventListener = listener(listeners, 'session/event')
    const modes: string[] = []
    let disposed = 0
    const sessionObj = {
      events: [stepEvent(), reasoningEvent('We need inspect the repo.'), { type: 'tool/call' }],
      header: { cwd: '/workspace' },
    }
    const agent = {
      session: sessionObj,
      ctx: { tools: { presentAs: (mode: string) => { modes.push(mode); return () => { disposed += 1 } } } },
    }
    const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
    const next = async () => ({ system: 'minimal persona', tools, contexts: [], sections: SECTIONS })

    // Promoted: PTC Mode declared.
    await assembleListener(undefined, { agent }, next)
    expect(modes).toEqual(['code'])
    expect(disposed).toBe(0)

    // The compaction releases PTC Mode.
    sessionObj.events.push({ type: 'compaction/end', seq: 10 })
    await eventListener(sessionObj, { type: 'compaction/end', seq: 10 })
    expect(disposed).toBe(1)

    // Still controlled: the phase-1 catalog is back.
    const after = await assembleListener(undefined, { agent }, next)
    expect(after.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])

    // A new anchor re-promotes and re-declares PTC Mode.
    sessionObj.events.push(stepEvent(), reasoningEvent('We need inspect the repo again.'), { type: 'tool/call' })
    await eventListener(sessionObj, { type: 'step/end' })
    const rePromoted = await assembleListener(undefined, { agent }, next)
    expect(rePromoted.tools).toEqual(tools)
    expect(modes).toEqual(['code', 'code'])
  })

  test('invalid compactionTools values fail at apply time', () => {
    expect(() => register({ compactionTools: [''] })).toThrow(/compactionTools/)
    expect(() => register({ compactionTools: [42] as any })).toThrow(/compactionTools/)
  })

  test('phase1FirstCallInstruction appends to the phase-1 persona when set', async () => {
    const instruction = 'Before answering, run pwd through the shell and base your answer on its result.'
    const result = await assemble(
      listener(register({ phase1FirstCallInstruction: instruction }), 'system-prompt/assemble'),
      [],
      [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }],
    )
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read'])
    expect(result.contexts).toEqual([])
    expect(result.sections.map((section: any) => section.name)).toEqual(['deployment:persona'])
    expect(result.sections[0].text).toBe(`${SECTIONS[0].text}${instruction}`)
  })

  test('an empty phase1FirstCallInstruction leaves the exact one-line persona', async () => {
    const result = await assemble(
      listener(register({ phase1FirstCallInstruction: '' }), 'system-prompt/assemble'),
      [],
      [{ name: 'bash' }, { name: 'read' }],
    )
    expect(result.sections[0].text).toBe(SECTIONS[0].text)
  })

  test('phase1FirstCallInstruction is not appended twice', async () => {
    const instruction = 'Before answering, run pwd through the shell and base your answer on its result.'
    const already = [{ name: 'deployment:persona', text: `${SECTIONS[0].text}${instruction}` }]
    const result = await assemble(
      listener(register({ phase1FirstCallInstruction: instruction }), 'system-prompt/assemble'),
      [],
      [{ name: 'bash' }, { name: 'read' }],
      undefined,
      already,
    )
    expect(result.sections[0].text).toBe(`${SECTIONS[0].text}${instruction}`)
  })

  test('phase1FirstCallInstruction does not leak into the promoted assembly', async () => {
    const instruction = 'Before answering, run pwd through the shell and base your answer on its result.'
    const result = await assemble(
      listener(register({ phase1FirstCallInstruction: instruction }), 'system-prompt/assemble'),
      [{ type: 'tool/call' }],
      [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }],
    )
    expect(result.tools.map((tool: any) => tool.name)).toEqual(['bash', 'read', 'edit'])
    expect(result.sections[0].text).toBe(`${SECTIONS[0].text}\n\nYour working directory is /workspace.`)
    expect(result.sections[0].text).not.toContain(instruction)
  })

  test('invalid phase1FirstCallInstruction values fail at apply time', () => {
    expect(() => register({ phase1FirstCallInstruction: 42 as any })).toThrow(/phase1FirstCallInstruction/)
    expect(() => register({ phase1FirstCallInstruction: {} as any })).toThrow(/phase1FirstCallInstruction/)
  })
})
