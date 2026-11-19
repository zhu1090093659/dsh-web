/**
 * The one failure type the workspace strategies raise.
 *
 * Every failure a strategy throws is this class, so the run engine can record a
 * workspace that could not be prepared as a run failure without matching on
 * message text. Each message names what was attempted and the host, path or
 * command it failed on, because it lands in a card where the user has no shell
 * to look behind it.
 *
 * @module dsh-task-board-ssh/host/workspace/errors
 */

/** Longest failure text one message carries, in characters. */
const DETAIL_LIMIT = 400

/** A workspace that cannot be prepared or collected. */
export class SshWorkspaceError extends Error {
  /**
   * @param message - what failed, in one sentence a person can act on.
   * @param options - standard error options, used to keep the underlying failure.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshWorkspaceError'
  }
}

/**
 * The one line worth quoting out of a command's failure text.
 *
 * A tool prints progress first and the diagnosis last, so the last non-empty
 * line is the part a person needs; the whole output is bounded away because it
 * would bury the sentence it is quoted in.
 * @param text - captured stderr, stdout or an error message.
 * @returns that line, or undefined when there is nothing to quote.
 */
export function boundedLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  const last = lines.at(-1)
  if (last === undefined) return undefined
  return last.length <= DETAIL_LIMIT ? last : `${last.slice(0, DETAIL_LIMIT)}...`
}
