/**
 * POSIX shell quoting for every value this provider sends to a remote host.
 *
 * The remote side is an arbitrary `sh` on a machine the provider does not own,
 * so nothing is interpolated: each value becomes one single-quoted word, and a
 * value that cannot survive an `execve` argument list is refused instead of
 * silently truncated. Callers compose command lines out of these functions and
 * never concatenate raw text into one.
 *
 * @module dsh-task-board-ssh/core/shell
 */

/**
 * Quote one value as a single POSIX shell word.
 *
 * The result is a single-quoted string, so the remote shell expands nothing
 * inside it: `$(...)`, backticks, newlines, semicolons and globs stay literal.
 * An embedded quote is closed, emitted as an escaped quote, and reopened, which
 * is the only form that survives quoting inside a quoted string.
 * @param value - text to quote.
 * @returns one shell word that evaluates back to `value`.
 * @throws RangeError when the value contains a NUL byte, which no shell word can carry.
 */
export function shellQuote(value: string): string {
  if (value.includes('\u0000')) throw new RangeError('a shell word cannot carry a NUL byte')
  return `'${value.split("'").join("'\\''")}'`
}

/**
 * Quote and join several words into one command line.
 * @param words - command and arguments, unquoted.
 * @returns the command line with every word quoted separately.
 */
export function shellJoin(words: readonly string[]): string {
  return words.map(shellQuote).join(' ')
}

/**
 * Build the command that ensures one remote directory exists.
 * @param path - absolute remote directory.
 * @returns one shell command.
 */
export function shellEnsureDir(path: string): string {
  return `mkdir -p ${shellQuote(path)}`
}

/**
 * Build the command that writes one file's exact bytes on the remote host.
 *
 * `printf '%s'` copies its argument verbatim, so the content travels as one
 * quoted word: no heredoc delimiter has to be invented and no line is
 * reinterpreted. The command line's own length is the only limit.
 * @param path - absolute remote path.
 * @param content - UTF-8 text without NUL bytes.
 * @returns one shell command.
 */
export function shellWriteFile(path: string, content: string): string {
  return `printf '%s' ${shellQuote(content)} > ${shellQuote(path)}`
}

/**
 * Build one command that writes several files, in order.
 * @param entries - remote path and content pairs.
 * @returns one shell command, or an empty string for an empty list.
 */
export function shellWriteFiles(entries: readonly { path: string; content: string }[]): string {
  return entries.map(entry => shellWriteFile(entry.path, entry.content)).join(' && ')
}

/**
 * Build the command that removes one remote directory, tolerating its absence.
 * @param path - absolute remote directory.
 * @returns one shell command.
 */
export function shellRemoveDir(path: string): string {
  return `rm -rf ${shellQuote(path)}`
}
