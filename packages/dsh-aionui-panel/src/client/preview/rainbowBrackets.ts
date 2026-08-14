/**
 * Rainbow bracket colorization: each nesting depth gets a distinct color so
 * matching bracket pairs are visually grouped (VS Code's
 * editor.bracketPairColorization). A ViewPlugin scans the visible text, skips
 * string/comment ranges (via the lezer tree), and marks each bracket with a
 * depth-derived class. Unmatched brackets still receive a color.
 * @module dsh-aionui-panel/client/preview/rainbowBrackets
 */

import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/** Number of distinct bracket colors (VS Code Dark+ uses three). */
const COLORS = 3

const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

/** Build the rainbow decorations for the visible viewport. */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc

  // Collect string/comment/regexp ranges so brackets inside them stay plain.
  const skip: { from: number; to: number }[] = []
  syntaxTree(view.state).iterate({
    from: 0,
    to: doc.length,
    enter(node) {
      if (/string|comment|regexp|template/i.test(node.name)) {
        skip.push({ from: node.from, to: node.to })
        return false
      }
      return undefined
    },
  })
  const isSkipped = (pos: number): boolean => skip.some((range) => pos >= range.from && pos < range.to)

  let depth = 0
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos < to; pos += 1) {
      const char = doc.sliceString(pos, pos + 1)
      const open = OPEN.has(char)
      const close = CLOSE.has(char)
      if (!open && !close) continue
      if (isSkipped(pos)) continue
      if (close) depth = Math.max(0, depth - 1)
      const level = depth % COLORS
      if (open) depth += 1
      builder.add(pos, pos + 1, Decoration.mark({ class: `cm-bracket-${level}` }))
    }
  }
  return builder.finish()
}

/** The rainbow-brackets extension (add to the editor's extensions array). */
export function rainbowBrackets() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = build(update.view)
      }
    }
  }, {
    decorations: (value) => value.decorations,
  })
}
