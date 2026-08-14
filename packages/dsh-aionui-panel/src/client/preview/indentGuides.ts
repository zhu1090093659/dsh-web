/**
 * Indent guides for the code reader: one thin vertical line per active
 * indentation level, drawn ONLY on the lines that actually reach that depth —
 * matching VS Code's `editor.guides.indentation` (blank and shallower lines
 * show no guide). CodeMirror has no built-in guides, so this is a small
 * ViewPlugin that injects a zero-width widget at the start of each indented
 * line; the widget's absolutely-positioned children render the lines.
 * @module dsh-aionui-panel/client/preview/indentGuides
 */

import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { getIndentUnit } from '@codemirror/language'

/** Number of leading columns (space + tab aware) at the start of a line. */
function leadingColumns(text: string, unit: number): number {
  let columns = 0
  for (const char of text) {
    if (char === ' ') columns += 1
    else if (char === '\t') columns += unit - (columns % unit)
    else break
  }
  return columns
}

/** One line's guides: `levels` vertical lines at 1..levels indent columns. */
class GuideWidget extends WidgetType {
  constructor(private readonly levels: number, private readonly unit: number) { super() }
  override eq(other: WidgetType): boolean {
    return other instanceof GuideWidget && other.levels === this.levels && other.unit === this.unit
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-indent-guides'
    wrap.setAttribute('aria-hidden', 'true')
    for (let level = 1; level <= this.levels; level += 1) {
      const line = document.createElement('span')
      line.className = 'cm-indent-guide'
      line.style.left = `${level * this.unit}ch`
      wrap.append(line)
    }
    return wrap
  }
  override ignoreEvent(): boolean { return true }
}

/** Build the guide decorations for the visible viewport. */
function buildDecorations(view: EditorView): DecorationSet {
  const unit = getIndentUnit(view.state) || 4
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const depth = Math.floor(leadingColumns(line.text, unit) / unit)
      if (depth > 0) {
        builder.add(line.from, line.from, Decoration.widget({ widget: new GuideWidget(depth, unit), side: 1 }))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** The indent-guides extension (add to the editor's extensions array). */
export function indentGuides() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  }, {
    decorations: (value) => value.decorations,
  })
}
