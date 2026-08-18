/**
 * Analyze one or more DSH session JSONL exports and report the LiangShen
 * trajectory markers: first-turn surface, promotion boundary, reasoning-block
 * word markers (`we` / `let me` / `let's` / `I`), the first reasoning line,
 * and per-step drift points.
 *
 * Usage:
 *   node tools/analyze-session.mjs <session.jsonl> [more.jsonl ...]
 */

import { createReadStream } from 'node:fs'
import readline from 'node:readline'

import { classifyReasoning, countWord } from '../presets/liangshen/tool-bootstrap.mjs'

const WORD = {
  we: /\bwe\b/gi,
  letMe: /\blet me\b/gi,
  lets: /\blet's\b/gi,
  i: /\bi\b/gi,
}

export function countMarkers(text) {
  return {
    we: countWord(text, WORD.we),
    letMe: countWord(text, WORD.letMe),
    lets: countWord(text, WORD.lets),
    i: countWord(text, WORD.i),
  }
}

/**
 * Incremental session accumulator shared by the array and streaming paths so
 * both report exactly the same facts. It never retains parsed events or full
 * reasoning text: only the first session/header event, one-line header
 * summaries, per-step counters/first lines, marker totals, and the first
 * reasoning line plus its classification are kept.
 */
function createSessionAccumulator() {
  return {
    eventCount: 0,
    hasSession: false,
    session: undefined,
    hasFirstHeader: false,
    firstHeader: undefined,
    firstHeaderSeq: Number.POSITIVE_INFINITY,
    pendingFirstMessages: [],
    firstMessages: [],
    headers: [],
    toolCalls: new Map(),
    steps: new Map(),
    current: null,
    reasoningBlocks: 0,
    markers: zeroMarkers(),
    hasFirstReasoning: false,
    firstReasoningLine: null,
    firstClassification: null,
  }
}

function accumulateSessionEvent(acc, event) {
  if (!acc.hasSession && event.type === 'session') {
    acc.session = event
    acc.hasSession = true
  }
  if (event.type === 'user/message') {
    const kind = event.data?.source?.kind ?? 'unknown'
    if (acc.hasFirstHeader) {
      if (event.seq < acc.firstHeaderSeq) acc.firstMessages.push(kind)
    } else {
      acc.pendingFirstMessages.push({ seq: event.seq, kind })
    }
  }
  if (event.type === 'request/header') {
    if (!acc.hasFirstHeader) {
      acc.firstHeader = event
      acc.hasFirstHeader = true
      acc.firstHeaderSeq = event.seq ?? Number.POSITIVE_INFINITY
      acc.firstMessages = acc.pendingFirstMessages
        .filter(entry => entry.seq < acc.firstHeaderSeq)
        .map(entry => entry.kind)
      acc.pendingFirstMessages.length = 0
    }
    acc.headers.push({
      seq: event.seq,
      reason: event.data?.reason,
      tools: (event.data?.header?.tools ?? []).map(tool => tool.name),
    })
  }
  if (event.type === 'step/start') {
    acc.current = { turn: event.data?.turn, step: event.data?.step }
    const key = stepKey(acc.current)
    if (!acc.steps.has(key)) {
      acc.steps.set(key, { turn: acc.current.turn, step: acc.current.step, blocks: 0, ...zeroMarkers(), text: 0, firstLine: null })
    }
  }
  if (event.type === 'assistant/message' && acc.current !== null) {
    const step = acc.steps.get(stepKey(acc.current))
    for (const block of event.data?.message?.content ?? []) {
      if (block.type === 'reasoning') {
        const text = String(block.text ?? '')
        const markers = countMarkers(text)
        acc.reasoningBlocks += 1
        for (const key of markerKeys()) acc.markers[key] += markers[key]
        if (!acc.hasFirstReasoning) {
          acc.hasFirstReasoning = true
          acc.firstReasoningLine = text.trim().split(/\r?\n/, 1)[0] ?? ''
          acc.firstClassification = classifyReasoning(text)
        }
        step.blocks += 1
        for (const key of markerKeys()) step[key] += markers[key]
        if (step.firstLine === null && text.trim().length > 0) {
          step.firstLine = text.trim().split(/\r?\n/, 1)[0] ?? ''
        }
      } else if (block.type === 'text' && String(block.text ?? '').trim().length > 0) {
        step.text += 1
      }
    }
  }
  if (event.type === 'tool/call') {
    const name = event.data?.name ?? 'unknown'
    acc.toolCalls.set(name, (acc.toolCalls.get(name) ?? 0) + 1)
  }
  acc.eventCount += 1
}

function finalizeSessionReport(acc, droppedLines) {
  if (!acc.hasFirstHeader) {
    acc.firstMessages = acc.pendingFirstMessages
      .filter(entry => entry.seq < Number.POSITIVE_INFINITY)
      .map(entry => entry.kind)
    acc.pendingFirstMessages.length = 0
  }
  const markers = { ...acc.markers }
  const totalMarkers = markers.we + markers.letMe
  const driftSteps = [...acc.steps.values()]
    .filter(step => step.letMe > 0 || (step.firstLine !== null && classifyReasoning(step.firstLine).label === 'standard-like'))
    .map(step => ({
      turn: step.turn,
      step: step.step,
      letMe: step.letMe,
      we: step.we,
      text: step.text,
      firstLine: step.firstLine,
    }))
  const visibleReplies = [...acc.steps.values()].reduce((sum, step) => sum + step.text, 0)

  return {
    sessionId: acc.session?.id,
    preset: acc.session?.agentPreset,
    cwd: acc.session?.cwd,
    createdAt: acc.session?.createdAt,
    firstMessages: acc.firstMessages,
    firstHeader: !acc.hasFirstHeader ? null : {
      system: acc.firstHeader.data?.header?.system,
      tools: (acc.firstHeader.data?.header?.tools ?? []).map(tool => tool.name),
      config: acc.firstHeader.data?.header?.config,
    },
    headers: acc.headers,
    reasoningBlocks: acc.reasoningBlocks,
    markers,
    ratio: totalMarkers === 0 ? null : markers.we / totalMarkers,
    firstReasoningLine: acc.firstReasoningLine,
    firstClassification: acc.firstClassification,
    visibleReplies,
    toolCalls: [...acc.toolCalls.entries()].sort((a, b) => b[1] - a[1]),
    driftSteps,
    droppedLines,
  }
}

/** Aggregate one session's model-visible trajectory facts from an event array. */
export function analyzeSession(events) {
  const acc = createSessionAccumulator()
  for (const event of events) accumulateSessionEvent(acc, event)
  return finalizeSessionReport(acc, 0)
}

/**
 * Incrementally aggregate a JSONL line stream without materializing events.
 * Returns null when no line yielded a processable event, preserving the
 * historical empty/all-bad file behavior of the CLI.
 */
export async function analyzeSessionStream(lines) {
  const acc = createSessionAccumulator()
  let droppedLines = 0
  for await (const line of lines) {
    const trimmed = String(line).trim()
    if (trimmed.length === 0) continue
    try {
      accumulateSessionEvent(acc, JSON.parse(trimmed))
    } catch {
      droppedLines += 1
    }
  }
  if (acc.eventCount === 0) return null
  return finalizeSessionReport(acc, droppedLines)
}

/** Stream one session JSONL file through the incremental accumulator. */
export async function analyzeSessionFile(path) {
  const input = createReadStream(path)
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  return analyzeSessionStream(lines)
}

function stepKey(step) {
  return `${step.turn}:${step.step}`
}

function markerKeys() {
  return ['we', 'letMe', 'lets', 'i']
}

function zeroMarkers() {
  return { we: 0, letMe: 0, lets: 0, i: 0 }
}

export function renderSessionReport(report) {
  const lines = []
  lines.push(`session ${report.sessionId ?? '(unknown)'}`)
  lines.push(`  preset=${report.preset ?? '(none)'} cwd=${report.cwd ?? '(none)'}`)
  if ((report.droppedLines ?? 0) > 0) {
    lines.push(`  dropped lines: ${report.droppedLines} (unparseable JSONL lines skipped)`)
  }
  lines.push(`  first messages: ${report.firstMessages.join(', ')}`)
  lines.push(`  first header: ${report.firstHeader?.tools.join('/') ?? '(none)'} | system=${JSON.stringify(report.firstHeader?.system ?? '')}`)
  for (const header of report.headers) {
    lines.push(`  header seq=${header.seq} reason=${header.reason ?? '?'} tools=${header.tools.length} [${header.tools.slice(0, 6).join(', ')}${header.tools.length > 6 ? ', ...' : ''}]`)
  }
  lines.push(`  reasoning blocks=${report.reasoningBlocks} we=${report.markers.we} let_me=${report.markers.letMe} let's=${report.markers.lets} I=${report.markers.i}`)
  lines.push(`  we/(we+let_me)=${report.ratio === null ? 'n/a' : report.ratio.toFixed(2)} visible replies=${report.visibleReplies}`)
  if (report.firstReasoningLine !== null) {
    lines.push(`  first reasoning: ${report.firstReasoningLine}`)
    lines.push(`  first block label: ${report.firstClassification?.label ?? 'n/a'} (score ${report.firstClassification?.score ?? '-'})`)
  }
  if (report.toolCalls.length > 0) {
    lines.push(`  top tools: ${report.toolCalls.slice(0, 6).map(([name, count]) => `${name}=${count}`).join(' ')}`)
  }
  if (report.driftSteps.length > 0) {
    lines.push(`  drift steps: ${report.driftSteps.slice(0, 12).map(step => `(${step.turn},${step.step}) lm=${step.letMe} we=${step.we} vis=${step.text}`).join(' | ')}`)
  } else {
    lines.push('  drift steps: none')
  }
  return lines.join('\n')
}

const isMain = process.argv[1] !== undefined
  && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: node tools/analyze-session.mjs <session.jsonl> [more.jsonl ...]')
    process.exitCode = 1
  } else {
    for (const file of files) {
      const report = await analyzeSessionFile(file)
      if (report === null) {
        console.error(`no events read from ${file}`)
        process.exitCode = 1
        continue
      }
      console.log(renderSessionReport(report))
      console.log()
    }
  }
}
