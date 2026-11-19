/**
 * Agent output a spec can hand a run, in the shapes the adapters really parse.
 *
 * Both helpers are plain text: a scripted host serves one as the run's log, and
 * a locally executed run gets it as the prompt file it prints, so the same bytes
 * travel through the adapter either way.
 */

/** The event stream the dsh CLI writes for one finished run, as lines. */
export function dshLines(options: { sessionId: string; text?: string; error?: string }): string[] {
  const lines = [JSON.stringify({ type: 'session', sessionId: options.sessionId })]
  if (options.error !== undefined) {
    lines.push(JSON.stringify({ type: 'final', sessionId: options.sessionId, reason: { kind: 'failed', error: { message: options.error } } }))
  } else {
    lines.push(JSON.stringify({ type: 'final', sessionId: options.sessionId, reason: { kind: 'completed' }, text: options.text ?? '' }))
  }
  return lines
}

/** The same event stream as one text blob, the way a log file holds it. */
export function dshOutput(options: { sessionId: string; text?: string; error?: string }): string {
  return dshLines(options).join('\n') + '\n'
}

/**
 * A prompt that is also a POSIX script: it prints these lines and exits.
 *
 * A run whose agent command is `sh {prompt_file}` really executes its prompt, so
 * a spec can drive the shipped launcher end to end without a model account: the
 * prompt prints the event stream the adapter expects.
 * @param lines - the lines the script prints.
 * @returns the prompt text.
 */
export function printingPrompt(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.includes("'")) throw new Error('a printed line cannot carry a single quote')
  }
  return "printf '%s\\n' " + lines.map(line => "'" + line + "'").join(' ')
}

/**
 * A bounded wait for a flag file, so a run lingers until the spec says so.
 * @param flagPath - file the run waits for.
 * @param spins - how many 20 ms turns to wait before giving up (12 s by default).
 * @returns the script lines.
 */
export function waitingLoop(flagPath: string, spins = 600): string {
  return "i=0\nwhile [ ! -f '" + flagPath + "' ] && [ $i -lt " + String(spins) + ' ]; do i=$((i+1)); sleep 0.02; done'
}
