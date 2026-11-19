/**
 * Every value this provider sends to a remote host becomes one quoted shell
 * word. These specs expand the quoted word with a real sh, so a value the
 * remote shell would have executed fails here instead of on somebody's server.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { shellEnsureDir, shellJoin, shellQuote, shellWriteFile, shellWriteFiles } from '../src/core/shell.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-task-board-ssh-shell-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Echo one quoted word through the system shell and return what it expanded to. */
function echoThroughSh(value: string): string {
  return execFileSync('sh', ['-c', "printf '%s' " + shellQuote(value)], { encoding: 'utf8' })
}

describe('remote shell quoting', () => {
  it('operator quoting a value with quotes, newlines, substitutions and backticks gets it back verbatim', () => {
    // Given values a card, a prompt or a path may legitimately contain
    const tick = String.fromCharCode(96)
    const hostile = [
      "it's a 'quoted' path",
      'line one\nline two',
      '$(whoami)',
      tick + 'id' + tick,
      '; rm -rf /',
      '* ? [a-z]',
      'a && b || c',
      '$HOME and $PATH',
      'trailing backslash \\',
      '',
    ]

    // When each is quoted and expanded by a real sh
    const expanded = hostile.map(echoThroughSh)

    // Then the shell returns the original bytes and evaluates nothing
    expect(expanded).toEqual(hostile)
  })

  it('operator quoting a command substitution does not let the remote shell run it', () => {
    // Given a value that would create a file if the shell ever evaluated it
    const marker = join(scratch, 'executed')
    const value = '$(touch ' + marker + ')'

    // When the quoted word reaches a real sh
    const expanded = echoThroughSh(value)

    // Then the text comes back unchanged and nothing ran
    expect(expanded).toBe(value)
    expect(() => readFileSync(marker, 'utf8')).toThrow()
  })

  it('operator writing a file through the remote shell gets the exact bytes back', () => {
    // Given content with quotes, newlines, a substitution and a backtick
    const content = "first 'quoted' line\nsecond $(touch /tmp/nope)\nthird backticked\n"
    const target = join(scratch, 'written.txt')

    // When the write command runs under a real sh
    execFileSync('sh', ['-c', shellWriteFile(target, content)], { encoding: 'utf8' })

    // Then the file holds exactly those bytes
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('operator writing several files in one command gets them all written', () => {
    // Given two files whose names contain a space
    const first = join(scratch, 'a file.txt')
    const second = join(scratch, 'b file.txt')

    // When one command writes both
    execFileSync('sh', ['-c', shellWriteFiles([{ path: first, content: 'one' }, { path: second, content: 'two' }])], {
      encoding: 'utf8',
    })

    // Then each holds its own content
    expect([readFileSync(first, 'utf8'), readFileSync(second, 'utf8')]).toEqual(['one', 'two'])
  })

  it('operator creating a directory whose path has spaces and a quote ends up with that exact directory', () => {
    // Given a path with a space and an apostrophe
    const target = join(scratch, "dir with space's")

    // When the directory command runs under a real sh
    execFileSync('sh', ['-c', shellEnsureDir(target)], { encoding: 'utf8' })

    // Then that literal path is a directory
    expect(statSync(target).isDirectory()).toBe(true)
  })

  it('operator joining words gets one quoted word per value', () => {
    // Given three words, one of them empty and one with a space
    const words = ['cmd', '', 'two words']

    // When they are joined
    const joined = shellJoin(words)

    // Then each value is quoted on its own, and an empty value stays an empty word
    expect(joined).toBe("'cmd' '' 'two words'")
  })

  it('operator handing over a value with a NUL byte is refused instead of truncated', () => {
    // Given a value no execve argument can carry
    const value = 'before' + String.fromCharCode(0) + 'after'

    // When it is quoted
    // Then the call refuses it
    expect(() => shellQuote(value)).toThrow(RangeError)
  })
})
