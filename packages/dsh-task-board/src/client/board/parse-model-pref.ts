/**
 * The model the user last picked for AI parsing, remembered per browser so the
 * next new-task modal starts from it instead of the roster's first entry
 * (issue #1621). An empty value is a real choice — "let the Host use its
 * default model" — and is remembered as such.
 */
const PARSE_MODEL_KEY = 'dsh-task-board.parse-model'

/** The nearest browser storage, or undefined when the global itself throws. */
function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** The remembered parse model; '' means the Host default (or no preference). */
export function readParseModelPreference(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): string {
  try {
    return storage?.getItem(PARSE_MODEL_KEY) ?? ''
  } catch {
    // A blocked or full store must never break the form.
    return ''
  }
}

/** Remember the picked parse model; '' records the Host-default choice. */
export function writeParseModelPreference(model: string, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(PARSE_MODEL_KEY, model)
  } catch {
    // Storage is optional: the picker still works without it.
  }
}
