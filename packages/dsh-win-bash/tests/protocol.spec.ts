/**
 * The win_bash frame protocol: the module that decides where one command's
 * output ends inside the shell's continuous byte stream. Every case here is a
 * shape the vendored shell was measured producing, not a guess.
 *
 * The fixtures are built by {@link stream}, which renders the EXACT bytes the
 * shipped frame makes bash write: the begin printf emits a newline, the
 * marker, and a newline; the command's own bytes follow; the end printf emits
 * a newline, the end marker, the status digits, and a newline.
 */
import { describe, expect, it } from 'vitest'
import { MARKER_PREFIX, buildFrame, hasEndMarker, markerFor, parseFrame, type FrameMarker } from '../src/protocol.ts'

/**
 * The byte stream one framed command leaves on stdout.
 * @param marker - the call's markers.
 * @param output - exactly what the command printed, including its own trailing newline.
 * @param status - the command's exit status.
 * @returns the stream the parser must read.
 */
function stream(marker: FrameMarker, output: string, status: number): string {
  return '\n' + marker.begin + '\n' + output + '\n' + marker.end + status.toString() + '\n'
}

describe('frame markers', () => {
  it('operator reading a trace gets a per-call marker that no other call can collide with', () => {
    // Given two different calls' nonces,
    const first = markerFor('11111111-2222-3333-4444-555555555555')
    const second = markerFor('99999999-8888-7777-6666-555555555555')
    // When their markers are compared,
    // Then each carries its own nonce and the shared prefix, so one call can
    // never parse another call's output.
    expect(first.begin).toBe(MARKER_PREFIX + '11111111222233334444555555555555__BEGIN')
    expect(first.end).toBe(MARKER_PREFIX + '11111111222233334444555555555555__END')
    expect(first.begin).not.toBe(second.begin)
    expect(first.begin.startsWith(MARKER_PREFIX)).toBe(true)
  })

  it('operator reading a trace gets a marker safe to use as a heredoc delimiter', () => {
    // Given a nonce carrying characters a heredoc delimiter cannot hold,
    const marker = markerFor('a-b/c.d e:f')
    // When the marker is built,
    // Then only alphanumerics from the nonce survive.
    expect(marker.end).toBe(MARKER_PREFIX + 'abcdef__END')
    expect(/^[A-Za-z0-9_]+$/.test(marker.end)).toBe(true)
  })
})

describe('frame rendering', () => {
  it('user submitting a multi-line command gets it injected verbatim inside the heredoc', () => {
    // Given a command with several lines and shell metacharacters,
    const command = 'for i in 1 2 3; do\n  echo "i=$i"\ndone'
    const marker = markerFor('nonce1')
    // When the frame is rendered,
    const frame = buildFrame(command, marker)
    // Then the command appears verbatim between the begin and end lines, and
    // the heredoc delimiter is quoted so the shell expands nothing while
    // reading it.
    expect(frame).toContain(". /dev/stdin <<'" + marker.end + "'")
    expect(frame).toContain(command)
    expect(frame.split('\n')).toContain(marker.end)
    expect(frame.endsWith('\n')).toBe(true)
    expect(frame).toContain("printf '\\n%s\\n' '" + marker.begin + "'")
    expect(frame).toContain('__dsh_win_bash_status=$?')
  })

  it('user submitting a command containing its own heredoc gets it delivered unchanged', () => {
    // Given a command that itself opens a heredoc,
    const command = 'cat <<EOF\ninner\nEOF'
    // When the frame is rendered,
    const frame = buildFrame(command, markerFor('nonce2'))
    // Then the inner heredoc survives intact: the outer delimiter is the
    // per-call nonce, which the command cannot accidentally contain.
    expect(frame).toContain(command)
    expect(frame).not.toContain('nonce2E')
  })
})

describe('frame parsing', () => {
  it('user running a completed command gets its exact stdout and exit status', () => {
    // Given the stream one command that printed two lines left,
    const marker = markerFor('n3')
    // When the frame is parsed,
    const outcome = parseFrame(stream(marker, 'hello\nworld\n', 0), marker, true)
    // Then the command's bytes are recovered unchanged and the status comes
    // from the digits after the end marker, not from the shell.
    expect(outcome?.stdout).toBe('hello\nworld\n')
    expect(outcome?.exitCode).toBe(0)
    expect(outcome?.lostPrefix).toBe(false)
  })

  it('user running a failing command gets its non-zero status, not a shell status', () => {
    // Given a stream for a command the payload could not resolve,
    const marker = markerFor('n4')
    // When the frame is parsed,
    const outcome = parseFrame(stream(marker, 'bash: seq: command not found\n', 127), marker, true)
    // Then the recorded status is the command's own.
    expect(outcome?.exitCode).toBe(127)
    expect(outcome?.stdout).toBe('bash: seq: command not found\n')
  })

  it('user running a command killed by a signal gets the status bash reported', () => {
    // Given a stream whose status is the 128+signal convention bash uses,
    const marker = markerFor('n4b')
    // When the frame is parsed,
    const outcome = parseFrame(stream(marker, '', 137), marker, true)
    // Then the reported status is read verbatim.
    expect(outcome?.exitCode).toBe(137)
    expect(outcome?.stdout).toBe('')
  })

  it('operator reading a still-running command gets no outcome instead of a truncated one', () => {
    // Given output that has not reached the end marker,
    const marker = markerFor('n5')
    const text = '\n' + marker.begin + '\npartial output\n'
    // When the frame is parsed,
    const outcome = parseFrame(text, marker, true)
    // Then nothing is returned, so the caller keeps waiting rather than
    // reporting a result that is missing the command's tail.
    expect(outcome).toBeUndefined()
    expect(hasEndMarker(text, marker)).toBe(false)
  })

  it('operator reading output whose head slid out of the window reconstructs the tail and flags it', () => {
    // Given a stream whose leading bytes were dropped by the bounded window,
    const marker = markerFor('n6')
    const text = 'earlier bytes\nstill-visible\n' + marker.end + '3\n'
    // When the frame is parsed with the begin marker already observed,
    const outcome = parseFrame(text, marker, true)
    // Then the tail is recovered and the loss is reported, not hidden.
    expect(outcome?.stdout).toBe('earlier bytes\nstill-visible')
    expect(outcome?.exitCode).toBe(3)
    expect(outcome?.lostPrefix).toBe(true)
  })

  it('operator reading output with no begin marker at all keeps waiting', () => {
    // Given output holding only an end marker, with no begin marker ever seen,
    const marker = markerFor('n7')
    const text = marker.end + '0\n'
    // When the frame is parsed,
    // Then no outcome is produced: a stray end marker cannot be mistaken for
    // this call's completion.
    expect(parseFrame(text, marker, false)).toBeUndefined()
  })

  it('user running an empty command gets an empty stdout rather than a stray newline', () => {
    // Given a stream for a command that printed nothing,
    const marker = markerFor('n8')
    // When the frame is parsed,
    const outcome = parseFrame(stream(marker, '', 0), marker, true)
    // Then stdout is empty and the status is preserved.
    expect(outcome?.stdout).toBe('')
    expect(outcome?.exitCode).toBe(0)
  })

  it('operator reading output that already contains marker-shaped text from the previous call does not mis-parse', () => {
    // Given a call whose command echoed the PREVIOUS call's markers,
    const previous = markerFor('old')
    const marker = markerFor('n10')
    const output = 'echoed ' + previous.begin + ' and ' + previous.end + '\n'
    // When the frame is parsed,
    const outcome = parseFrame(stream(marker, output, 0), marker, true)
    // Then this call's own markers are the only ones that frame it.
    expect(outcome?.stdout).toBe(output)
    expect(outcome?.exitCode).toBe(0)
  })

  it('operator reading output whose command printed the very end marker is protected by the nonce', () => {
    // Given a command that printed text shaped like an end marker, but with a
    // nonce the shell never used for this call,
    const marker = markerFor('n11')
    const text = '\n' + marker.begin + '\nforged ' + MARKER_PREFIX + 'other__END0\n'
    // When the frame is parsed,
    const outcome = parseFrame(text, marker, true)
    // Then no outcome is produced: the forged line is not this call's marker.
    expect(outcome).toBeUndefined()
  })

  it('operator reading output with a CRLF status line gets the status parsed anyway', () => {
    // Given a well-formed stream whose status terminator is CRLF,
    const marker = markerFor('n9')
    const text = stream(marker, 'ok\n', 0).replace(/\n$/, '\r\n')
    // When the frame is parsed,
    const outcome = parseFrame(text, marker, true)
    // Then the exit code is still recovered rather than the call hanging on a
    // Windows newline the parser did not expect.
    expect(outcome?.exitCode).toBe(0)
    expect(outcome?.stdout).toBe('ok\n')
  })
})
