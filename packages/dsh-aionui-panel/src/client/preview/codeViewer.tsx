/**
 * Code/text viewer with a VS Code-style reading experience: CodeMirror 6
 * syntax highlighting (folding, line numbers, bracket matching, in-editor
 * search), a lint gutter fed by the host's ruff diagnostics for python files,
 * and an AST-driven outline/hover/goto-definition overlay. The viewer is
 * read-only — editing stays on the panel's existing textarea editor path.
 * @module dsh-aionui-panel/client/preview/codeViewer
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { minimalSetup } from 'codemirror'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  Decoration, EditorView, hoverTooltip, keymap, lineNumbers, highlightActiveLine, WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { bracketMatching, foldGutter, foldKeymap, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { forceLinting, linter, lintGutter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { searchKeymap } from '@codemirror/search'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { PanelApi } from '../api.ts'
import type { PyDiagnostic, PySymbol, PySymbolView } from '../../core/types.ts'
import { t } from '../locales.ts'
import { indentGuides } from './indentGuides.ts'
import { rainbowBrackets } from './rainbowBrackets.ts'
import previewCss from '../styles/preview.module.css'

/** Map one file extension onto a CodeMirror language extension. */
function languageExtension(extension: string): Extension {
  if (extension === 'py') return python()
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return javascript({ jsx: true })
  if (['ts', 'tsx'].includes(extension)) return javascript({ jsx: extension === 'tsx', typescript: true })
  if (['json', 'jsonc'].includes(extension)) return json()
  if (['md', 'markdown'].includes(extension)) return markdown()
  if (['css', 'scss', 'less'].includes(extension)) return css()
  if (['html', 'htm', 'vue', 'svelte'].includes(extension)) return html()
  return []
}

/** The word (identifier) under a document position, or null. */
function wordAt(view: EditorView, pos: number): { from: number; to: number; text: string } | null {
  const line = view.state.doc.lineAt(pos)
  let from = pos
  while (from > line.from && /[\w]/.test(view.state.doc.sliceString(from - 1, from))) from -= 1
  let to = pos
  while (to < line.to && /[\w]/.test(view.state.doc.sliceString(to, to + 1))) to += 1
  if (from === to) return null
  return { from, to, text: view.state.doc.sliceString(from, to) }
}

/** Count references per definition line (1-based target lines). */
function countRefs(symbols: PySymbolView): Map<number, number> {
  const counts = new Map<number, number>()
  for (const ref of symbols.refs) counts.set(ref.targetLine, (counts.get(ref.targetLine) ?? 0) + 1)
  return counts
}

/** The definition line a word resolves to at a given line (references win, then names). */
function resolveTarget(symbols: PySymbolView, word: string, line: number): number | null {
  const ref = symbols.refs.find((item) => item.name === word && item.line === line)
  if (ref !== undefined) return ref.targetLine
  const def = symbols.defs.find((item) => item.name === word && (line < item.line || line > item.endLine))
  if (def !== undefined) return def.line
  return null
}

/** The definition matching a word anywhere (hover fallback). */
function findDef(symbols: PySymbolView, word: string): PySymbol | undefined {
  return symbols.defs.find((item) => item.name === word)
}

/** Jump the view to a 1-based line. */
function jumpToLine(view: EditorView, line: number): void {
  const doc = view.state.doc
  const target = Math.min(doc.lines, Math.max(1, line))
  const pos = doc.line(target).from
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
}

/** Convert host diagnostics (0-based line/col) into editor offsets. */
function toLintDiagnostics(view: EditorView, items: PyDiagnostic[]): LintDiagnostic[] {
  const doc = view.state.doc
  const out: LintDiagnostic[] = []
  for (const item of items) {
    const fromLine = Math.max(0, Math.min(item.fromLine, doc.lines - 1))
    const toLine = Math.max(0, Math.min(item.toLine, doc.lines - 1))
    const from = doc.line(fromLine + 1).from + Math.min(item.fromCol, doc.line(fromLine + 1).length)
    const to = doc.line(toLine + 1).from + Math.min(item.toCol, doc.line(toLine + 1).length)
    out.push({ from, to, severity: item.severity, message: item.message })
  }
  return out
}

/** One reference-count lens widget shown at the end of a definition line. */
class RefLensWidget extends WidgetType {
  constructor(private readonly label: string) { super() }
  override eq(other: WidgetType): boolean { return other instanceof RefLensWidget && other.label === this.label }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = previewCss.codeLens
    span.textContent = this.label
    return span
  }
}

/** Build the reference-count decoration set from the current symbol view. */
function buildLens(view: EditorView, symbols: PySymbolView | null): DecorationSet {
  if (symbols === null) return Decoration.none
  const counts = countRefs(symbols)
  const ranges: { from: number; to: number; value: Decoration }[] = []
  const doc = view.state.doc
  for (const def of symbols.defs) {
    const count = counts.get(def.line) ?? 0
    if (count <= 0 || def.line > doc.lines) continue
    const line = doc.line(def.line)
    ranges.push({
      from: line.to,
      to: line.to,
      value: Decoration.widget({ widget: new RefLensWidget(t('preview.code.refs', { count })), side: 1 }),
    })
  }
  return Decoration.set(ranges, true)
}

/** The human label for a symbol kind (outline + hover). */
function kindLabel(kind: PySymbol['kind']): string {
  if (kind === 'class') return t('preview.code.class')
  if (kind === 'method') return t('preview.code.method')
  return t('preview.code.function')
}

/** Code/text viewer entry point (read-only CodeMirror + python analysis). */
export function CodeViewer({ content, language, root, path }: {
  content: string
  language: string
  root: string
  path: string
}): JSX.Element {
  const isPython = language === 'py'
  const api = useMemo(() => new PanelApi(), [])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const symbolsRef = useRef<PySymbolView | null>(null)
  const diagnosticsRef = useRef<PyDiagnostic[]>([])
  const lintCompRef = useRef(new Compartment())
  const lensCompRef = useRef(new Compartment())
  const themeCompRef = useRef(new Compartment())
  const languageRef = useRef(languageExtension(language))

  const [diagnostics, setDiagnostics] = useState<PyDiagnostic[] | null>(null)
  const [symbols, setSymbols] = useState<PySymbolView | null>(null)
  const [lintError, setLintError] = useState<string | null>(null)
  const [symbolsError, setSymbolsError] = useState<string | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [showLens, setShowLens] = useState(true)

  // Mount the editor once (the call site keys by path, so language is stable).
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    const view = new EditorView({
      parent: host,
      doc: content,
      extensions: [
        minimalSetup,
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        highlightActiveLine(),
        indentGuides(),
        rainbowBrackets(),
        keymap.of([...searchKeymap, ...foldKeymap]),
        indentUnit.of('    '),
        languageRef.current,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        lintGutter(),
        themeCompRef.current.of(dark ? syntaxHighlighting(oneDarkHighlightStyle) : []),
        lintCompRef.current.of(linter(() => {
          const current = viewRef.current
          return current === null ? [] : toLintDiagnostics(current, diagnosticsRef.current)
        })),
        lensCompRef.current.of([]),
        hoverTooltip((hoveredView, pos) => {
          const word = wordAt(hoveredView, pos)
          if (word === null) return null
          const symbolsNow = symbolsRef.current
          if (symbolsNow === null) return null
          const line = hoveredView.state.doc.lineAt(pos).number
          const target = resolveTarget(symbolsNow, word.text, line)
          if (target === null) return null
          const def = findDef(symbolsNow, word.text)
          const refs = countRefs(symbolsNow).get(target) ?? 0
          return {
            pos: word.from,
            end: word.to,
            above: true,
            create: () => {
              const dom = document.createElement('div')
              dom.className = previewCss.codeHover
              const title = document.createElement('div')
              title.className = previewCss.codeHoverTitle
              const name = document.createElement('span')
              name.className = previewCss.codeHoverName
              name.textContent = word.text
              title.append(name)
              if (def !== undefined && def.params.length > 0) {
                const params = document.createElement('span')
                params.className = previewCss.codeHoverParams
                params.textContent = `(${def.params.join(', ')})`
                title.append(params)
              }
              const meta = document.createElement('div')
              meta.className = previewCss.codeHoverMeta
              meta.textContent = `${kindLabel(def?.kind ?? 'function')} · ${t('preview.code.refs', { count: refs })}`
              dom.append(title, meta)
              if (def !== undefined && def.doc !== '') {
                const docText = document.createElement('div')
                docText.className = previewCss.codeHoverDoc
                docText.textContent = def.doc
                dom.append(docText)
              }
              return { dom }
            },
          }
        }),
        EditorView.domEventHandlers({
          mousedown: (event, view2) => {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
            const pos = view2.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            const word = wordAt(view2, pos)
            if (word === null) return false
            const symbolsNow = symbolsRef.current
            if (symbolsNow === null) return false
            const line = view2.state.doc.lineAt(pos).number
            const target = resolveTarget(symbolsNow, word.text, line)
            if (target === null) return false
            event.preventDefault()
            jumpToLine(view2, target)
            return true
          },
        }),
      ],
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync content into the read-only doc when the file (re)loads.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (view.state.doc.toString() === content) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
  }, [content])

  // Keep the hover/goto side-channel pointed at the live symbol state.
  useEffect(() => {
    symbolsRef.current = symbols
  }, [symbols])

  // Fetch lint diagnostics for python files (disk state; debounced).
  useEffect(() => {
    if (!isPython) {
      diagnosticsRef.current = []
      setDiagnostics(null)
      setLintError(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void api.pyLint(root, path).then((result) => {
        if (cancelled) return
        if (result.ok) {
          diagnosticsRef.current = result.value.diagnostics
          setDiagnostics(result.value.diagnostics)
          setLintError(null)
        } else {
          diagnosticsRef.current = []
          setDiagnostics([])
          setLintError(result.error.message)
        }
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [api, root, path, content, isPython])

  // Push diagnostics into the lint gutter when they change.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({ effects: lintCompRef.current.reconfigure(linter(() => toLintDiagnostics(view, diagnosticsRef.current))) })
    forceLinting(view)
  }, [diagnostics])

  // Fetch symbols for python files (disk state).
  useEffect(() => {
    if (!isPython) {
      setSymbols(null)
      setSymbolsError(null)
      return
    }
    let cancelled = false
    void api.pySymbols(root, path).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSymbols(result.value)
        setSymbolsError(null)
      } else {
        setSymbols(null)
        setSymbolsError(result.error.message)
      }
    })
    return () => { cancelled = true }
  }, [api, root, path, isPython])

  // Rebuild reference-count lens decorations.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const extension = showLens ? EditorView.decorations.of(buildLens(view, symbolsRef.current)) : []
    view.dispatch({ effects: lensCompRef.current.reconfigure(extension) })
  }, [symbols, showLens, content])

  const refCounts = useMemo(() => symbols === null ? new Map<number, number>() : countRefs(symbols), [symbols])

  const openAt = (line: number): void => {
    const view = viewRef.current
    if (view !== null) jumpToLine(view, line)
  }

  return (
    <div className={previewCss.codeRoot}>
      {isPython && (
        <div className={previewCss.codeTools}>
          {diagnostics !== null && diagnostics.length > 0 && (
            <span className={previewCss.codeBadge}>{diagnostics.length} {t('preview.code.problems')}</span>
          )}
          <button
            type="button"
            className={`${previewCss.codeToolBtn}${outlineOpen ? ` ${previewCss.codeToolBtnActive}` : ''}`}
            title={t('preview.code.outline')}
            onClick={() => setOutlineOpen(!outlineOpen)}
          >
            {t('preview.code.outline')}
          </button>
          <button
            type="button"
            className={`${previewCss.codeToolBtn}${showLens ? ` ${previewCss.codeToolBtnActive}` : ''}`}
            title={t('preview.code.refLens')}
            onClick={() => setShowLens(!showLens)}
          >
            {t('preview.code.refLens')}
          </button>
        </div>
      )}
      <div ref={hostRef} className={previewCss.codeEditor} />
      {outlineOpen && (
        <aside className={previewCss.codeOutline}>
          {lintError !== null && <div className={previewCss.codeNote}>{t('preview.code.lintUnavailable')}: {lintError}</div>}
          {symbolsError !== null && <div className={previewCss.codeNote}>{t('preview.code.symbolsUnavailable')}: {symbolsError}</div>}
          {diagnostics !== null && diagnostics.length > 0 && (
            <div className={previewCss.codeSection}>
              <div className={previewCss.codeSectionTitle}>{t('preview.code.problems')}</div>
              {diagnostics.map((item, index) => (
                <button
                  key={`d-${index}`}
                  type="button"
                  className={previewCss.codeRow}
                  onClick={() => openAt(item.fromLine + 1)}
                >
                  <span className={`${previewCss.codeDot} ${previewCss[`codeDot${item.severity === 'error' ? 'Error' : item.severity === 'warning' ? 'Warn' : 'Info'}`]}`} />
                  <span className={previewCss.codeRowCode}>{item.code}</span>
                  <span className={previewCss.codeRowMsg}>{item.message}</span>
                </button>
              ))}
            </div>
          )}
          {symbols !== null && (
            <div className={previewCss.codeSection}>
              <div className={previewCss.codeSectionTitle}>{t('preview.code.symbols')}</div>
              {symbols.defs.length === 0 && <div className={previewCss.codeEmpty}>{t('preview.code.noSymbols')}</div>}
              {symbols.defs.map((def) => (
                <button
                  key={`${def.line}-${def.name}`}
                  type="button"
                  className={previewCss.codeRow}
                  title={def.doc !== '' ? def.doc : undefined}
                  onClick={() => openAt(def.line)}
                >
                  <span className={previewCss.codeKind}>{def.kind === 'class' ? 'c' : def.kind === 'method' ? 'm' : 'f'}</span>
                  <span className={previewCss.codeRowName}>{def.name}</span>
                  <span className={previewCss.codeRowRefs}>{refCounts.get(def.line) ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
