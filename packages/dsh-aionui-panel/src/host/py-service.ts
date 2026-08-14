/**
 * Host python analysis service: ruff lint diagnostics and AST symbol/reference
 * extraction for python files. Both tools run through the managed subprocess
 * seam (argv arrays, never a shell) with collected output caps, scoped to the
 * gated project root like every other panel route. Read-only — neither tool
 * mutates the file, and neither echoes file bytes back to the browser.
 * @module dsh-aionui-panel/host/py-service
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {
  PanelError, PyDiagnostic, PyFormatResult, PyLintSeverity, PyLintView, PyRef, PySymbol, PySymbolKind, PySymbolView,
} from '../core/types.ts'
import type { WorkspaceGate } from './gate.ts'

/** One finished tool invocation. */
export interface PyRunResult_ {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** The spawn seam the service runs python tooling through. */
export interface PyRunner {
  run(argv: readonly string[], cwd: string): Promise<PyRunResult_>
}

/** Collected-output cap for one tool run. */
const OUTPUT_CAP_BYTES = 4 << 20

/** Production runner over ctx.subprocess: one managed child per command. */
export function toolRunner(ctx: Context, tool: string): PyRunner {
  return {
    async run(argv, cwd) {
      const spec: SubprocessSpawnSpec = {
        argv: [tool, ...argv],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: OUTPUT_CAP_BYTES },
          stderr: { maxBytes: OUTPUT_CAP_BYTES },
        },
        graceMs: 10_000,
      }
      let handle: SubprocessHandle
      try {
        handle = ctx.subprocess.spawn(spec)
      } catch (error) {
        console.error('[dsh-aionui-panel] tool spawn failed:', error)
        return {
          exitCode: 127,
          stdout: '',
          stderr: `${tool}: spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      try {
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        return { exitCode: outcome.exitCode, stdout, stderr }
      } catch (error) {
        console.error('[dsh-aionui-panel] tool run failed:', error)
        return {
          exitCode: 127,
          stdout: '',
          stderr: `${tool}: run failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  }
}

/** A path resolver the service reuses from the fs service (symlink-guarded). */
export type PyPathResolver = (root: string, rel: string) => Promise<{ ok: true; abs: string } | { ok: false; error: PanelError }>

/** A missing binary degrades to a friendly panel error, not a bare 400. */
function unavailable(tool: string, detail: string): PanelError {
  return { code: 'tool-unavailable', message: `${tool} is unavailable: ${detail}` }
}

/** A present binary that failed or produced unusable output. */
function failed(tool: string, detail: string): PanelError {
  return { code: 'tool-failed', message: `${tool} failed: ${detail}` }
}

/** Map one ruff rule code onto the gutter severity ladder. */
export function ruffSeverity(code: string): PyLintSeverity {
  // E9 = syntax errors, F = pyflakes (real defects); E/W = style warnings.
  if (/^(E9|F)/.test(code)) return 'error'
  if (/^(E|W)/.test(code)) return 'warning'
  return 'info'
}

/** One ruff JSON record before validation (unknown shape at the edge). */
interface RuffRecord {
  code?: unknown
  message?: unknown
  location?: { row?: unknown; column?: unknown }
  end_location?: { row?: unknown; column?: unknown }
}

/** Map ruff's JSON array onto editor-ready 0-based diagnostics. */
export function parseRuffJson(stdout: string): PyDiagnostic[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) return []
  const diagnostics: PyDiagnostic[] = []
  for (const item of parsed) {
    const record = item as RuffRecord
    const code = typeof record.code === 'string' ? record.code : ''
    const message = typeof record.message === 'string' ? record.message : ''
    if (code === '') continue
    const startRow = typeof record.location?.row === 'number' ? record.location.row : 1
    const startCol = typeof record.location?.column === 'number' ? record.location.column : 1
    const endRow = typeof record.end_location?.row === 'number' ? record.end_location.row : startRow
    const endCol = typeof record.end_location?.column === 'number' ? record.end_location.column : startCol
    diagnostics.push({
      fromLine: Math.max(1, startRow) - 1,
      fromCol: Math.max(1, startCol) - 1,
      toLine: Math.max(1, endRow) - 1,
      toCol: Math.max(1, endCol) - 1,
      severity: ruffSeverity(code),
      message,
      code,
    })
  }
  return diagnostics
}

/** Normalize one raw symbol record from the python helper. */
function normalizeSymbol(raw: Record<string, unknown>): PySymbol {
  const name = typeof raw.name === 'string' ? raw.name : ''
  const kindRaw = typeof raw.kind === 'string' ? raw.kind : 'function'
  const kind: PySymbolKind = kindRaw === 'class' || kindRaw === 'method' || kindRaw === 'modulevar' || kindRaw === 'import' ? kindRaw : 'function'
  const line = typeof raw.line === 'number' ? Math.max(1, Math.floor(raw.line)) : 1
  const endLine = typeof raw.endLine === 'number' ? Math.max(line, Math.floor(raw.endLine)) : line
  const doc = typeof raw.doc === 'string' ? raw.doc : ''
  const params = Array.isArray(raw.params) ? raw.params.filter((item): item is string => typeof item === 'string') : []
  const className = typeof raw.className === 'string' && raw.className !== '' ? raw.className : null
  return { name, kind, line, endLine, doc, params, className }
}

/** Normalize one raw reference record from the python helper. */
function normalizeRef(raw: Record<string, unknown>): PyRef {
  const name = typeof raw.name === 'string' ? raw.name : ''
  const line = typeof raw.line === 'number' ? Math.max(1, Math.floor(raw.line)) : 1
  const targetLine = typeof raw.targetLine === 'number' ? Math.max(1, Math.floor(raw.targetLine)) : 1
  return { name, line, targetLine }
}

/** The AST helper executed once per symbols request (read from disk, no stdin). */
export const PY_SYMBOLS_SCRIPT = [
  'import ast, json, sys',
  '',
  'def _params(node):',
  '    names = [a.arg for a in node.args.posonlyargs + node.args.args + node.args.kwonlyargs]',
  '    if node.args.vararg is not None:',
  '        names.append("*" + node.args.vararg.arg)',
  '    if node.args.kwarg is not None:',
  '        names.append("**" + node.args.kwarg.arg)',
  '    return names',
  '',
  'class _Scope:',
  '    __slots__ = ("bindings", "parent", "kind")',
  '    def __init__(self, parent, kind):',
  '        self.bindings = {}',
  '        self.parent = parent',
  '        self.kind = kind',
  '    def lookup(self, name):',
  '        scope = self',
  '        while scope is not None:',
  '            binding = scope.bindings.get(name)',
  '            if binding is not None:',
  '                return binding',
  '            scope = scope.parent',
  '        return None',
  '',
  'class _Walker(ast.NodeVisitor):',
  '    def __init__(self):',
  '        self.module = _Scope(None, "module")',
  '        self.scope = self.module',
  '        self.class_stack = []',
  '        self.defs = []',
  '        self.refs = []',
  '',
  '    def _bind(self, name, line, jump=None):',
  '        self.scope.bindings[name] = {"line": line, "jump": jump}',
  '',
  '    def _bind_target(self, target):',
  '        if isinstance(target, ast.Name):',
  '            jump = target.lineno if self.scope.kind in ("module", "class") else None',
  '            self._bind(target.id, target.lineno, jump)',
  '        elif isinstance(target, (ast.Tuple, ast.List)):',
  '            for item in target.elts:',
  '                self._bind_target(item)',
  '        elif isinstance(target, ast.Starred):',
  '            self._bind_target(target.value)',
  '        else:',
  '            self.visit(target)',
  '',
  '    def _enter(self, kind):',
  '        child = _Scope(self.scope, kind)',
  '        old = self.scope',
  '        self.scope = child',
  '        return old',
  '',
  '    def _def(self, name, kind, node, params, doc):',
  '        line = node.lineno',
  '        end = node.end_lineno or line',
  '        self.defs.append({',
  '            "name": name, "kind": kind, "line": line, "endLine": end,',
  '            "doc": doc, "params": params,',
  '            "className": self.class_stack[-1] if self.class_stack else None,',
  '        })',
  '        self._bind(name, line, line)',
  '',
  '    def _visit_function(self, node):',
  '        kind = "method" if self.class_stack else "function"',
  '        self._def(node.name, kind, node, _params(node), ast.get_docstring(node, clean=True) or "")',
  '        for item in node.decorator_list:',
  '            self.visit(item)',
  '        for item in node.args.defaults:',
  '            self.visit(item)',
  '        for item in node.args.kw_defaults:',
  '            if item is not None:',
  '                self.visit(item)',
  '        if node.returns is not None:',
  '            self.visit(node.returns)',
  '        old = self._enter("function")',
  '        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:',
  '            self._bind(arg.arg, node.lineno)',
  '        if node.args.vararg is not None:',
  '            self._bind(node.args.vararg.arg, node.lineno)',
  '        if node.args.kwarg is not None:',
  '            self._bind(node.args.kwarg.arg, node.lineno)',
  '        for stmt in node.body:',
  '            self.visit(stmt)',
  '        self.scope = old',
  '',
  '    def visit_FunctionDef(self, node):',
  '        self._visit_function(node)',
  '',
  '    def visit_AsyncFunctionDef(self, node):',
  '        self._visit_function(node)',
  '',
  '    def visit_ClassDef(self, node):',
  '        self._def(node.name, "class", node, [], ast.get_docstring(node, clean=True) or "")',
  '        for item in node.decorator_list:',
  '            self.visit(item)',
  '        for base in node.bases:',
  '            self.visit(base)',
  '        for keyword in node.keywords:',
  '            self.visit(keyword.value)',
  '        old = self._enter("class")',
  '        self.class_stack.append(node.name)',
  '        for stmt in node.body:',
  '            self.visit(stmt)',
  '        self.class_stack.pop()',
  '        self.scope = old',
  '',
  '    def visit_Lambda(self, node):',
  '        for item in node.args.defaults:',
  '            self.visit(item)',
  '        for item in node.args.kw_defaults:',
  '            if item is not None:',
  '                self.visit(item)',
  '        old = self._enter("function")',
  '        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:',
  '            self._bind(arg.arg, node.lineno)',
  '        if node.args.vararg is not None:',
  '            self._bind(node.args.vararg.arg, node.lineno)',
  '        if node.args.kwarg is not None:',
  '            self._bind(node.args.kwarg.arg, node.lineno)',
  '        self.visit(node.body)',
  '        self.scope = old',
  '',
  '    def visit_Assign(self, node):',
  '        self.visit(node.value)',
  '        for target in node.targets:',
  '            self._bind_target(target)',
  '',
  '    def visit_AnnAssign(self, node):',
  '        if node.value is not None:',
  '            self.visit(node.value)',
  '        self._bind_target(node.target)',
  '',
  '    def visit_AugAssign(self, node):',
  '        self.visit(node.value)',
  '        if isinstance(node.target, ast.Name):',
  '            return',
  '        self.visit(node.target)',
  '',
  '    def visit_For(self, node):',
  '        self.visit(node.iter)',
  '        self._bind_target(node.target)',
  '        for stmt in node.body + node.orelse:',
  '            self.visit(stmt)',
  '',
  '    def visit_AsyncFor(self, node):',
  '        self.visit_For(node)',
  '',
  '    def visit_While(self, node):',
  '        self.visit(node.test)',
  '        for stmt in node.body + node.orelse:',
  '            self.visit(stmt)',
  '',
  '    def visit_If(self, node):',
  '        self.visit(node.test)',
  '        for stmt in node.body + node.orelse:',
  '            self.visit(stmt)',
  '',
  '    def visit_With(self, node):',
  '        for item in node.items:',
  '            self.visit(item.context_expr)',
  '            if item.optional_vars is not None:',
  '                self._bind_target(item.optional_vars)',
  '        for stmt in node.body:',
  '            self.visit(stmt)',
  '',
  '    def visit_AsyncWith(self, node):',
  '        self.visit_With(node)',
  '',
  '    def visit_Import(self, node):',
  '        for alias in node.names:',
  '            self._bind(alias.asname or alias.name.split(".")[0], node.lineno)',
  '',
  '    def visit_ImportFrom(self, node):',
  '        for alias in node.names:',
  '            if alias.name == "*":',
  '                continue',
  '            self._bind(alias.asname or alias.name, node.lineno)',
  '',
  '    def visit_ExceptHandler(self, node):',
  '        if node.type is not None:',
  '            self.visit(node.type)',
  '        if node.name:',
  '            self._bind(node.name, node.lineno)',
  '        for stmt in node.body:',
  '            self.visit(stmt)',
  '',
  '    def visit_Global(self, node):',
  '        for name in node.names:',
  '            self.module.bindings[name] = {"line": node.lineno, "jump": None}',
  '',
  '    def visit_Nonlocal(self, node):',
  '        return',
  '',
  '    def visit_Delete(self, node):',
  '        for target in node.targets:',
  '            if isinstance(target, ast.Name):',
  '                self.scope.bindings.pop(target.id, None)',
  '            else:',
  '                self.visit(target)',
  '',
  '    def visit_Name(self, node):',
  '        if isinstance(node.ctx, ast.Load):',
  '            binding = self.scope.lookup(node.id)',
  '            if binding is not None and binding["jump"] is not None and node.lineno != binding["jump"]:',
  '                self.refs.append({"name": node.id, "line": node.lineno, "targetLine": binding["jump"]})',
  '',
  'def _main(argv):',
  '    if len(argv) < 2:',
  '        return 2',
  '    with open(argv[1], "r", encoding="utf-8", errors="replace") as handle:',
  '        source = handle.read()',
  '    try:',
  '        tree = ast.parse(source, filename=argv[1])',
  '    except SyntaxError:',
  '        json.dump({"defs": [], "refs": []}, sys.stdout)',
  '        return 0',
  '    walker = _Walker()',
  '    walker.visit(tree)',
  '    json.dump({"defs": walker.defs, "refs": walker.refs}, sys.stdout, ensure_ascii=False)',
  '    return 0',
  '',
  'if __name__ == "__main__":',
  '    sys.exit(_main(sys.argv))',
].join('\n')

/** The AST helper output (unvalidated edge). */
interface PySymbolsRaw {
  defs?: unknown
  refs?: unknown
}

/** Parse and normalize the python helper output. */
export function parseSymbolsJson(stdout: string): PySymbolView {
  const parsed = JSON.parse(stdout) as PySymbolsRaw
  const defs: PySymbol[] = Array.isArray(parsed.defs)
    ? parsed.defs.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null).map((item) => normalizeSymbol(item as Record<string, unknown>))
    : []
  const refs: PyRef[] = Array.isArray(parsed.refs)
    ? parsed.refs.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null).map((item) => normalizeRef(item as Record<string, unknown>))
    : []
  return { defs, refs, tool: 'python' }
}

/** The python analysis service: lint + symbols behind the workspace gate. */
export class PyService {
  private readonly python: string
  private readonly ruff: string
  private ruffVersionCache: string | null = null

  constructor(
    private readonly runner: (tool: string) => PyRunner,
    private readonly gate: WorkspaceGate,
    private readonly resolvePath: PyPathResolver,
  ) {
    this.python = process.env.AIONUI_PANEL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
    this.ruff = process.env.AIONUI_PANEL_RUFF ?? 'ruff'
  }

  /** Ruff version line, probed once per process (cached). */
  private async version(canonical: string): Promise<string> {
    if (this.ruffVersionCache !== null) return this.ruffVersionCache
    const run = await this.runner(this.ruff).run(['--version'], canonical)
    this.ruffVersionCache = run.exitCode === 0 ? run.stdout.trim() : ''
    return this.ruffVersionCache
  }

  /** Lint one python file (relative to the gated root). */
  async lint(root: string, rel: string): Promise<PyLintView | PanelError> {
    const gated = await this.gate(root)
    if (!gated.ok) return gated.error
    const resolved = await this.resolvePath(gated.canonical, rel)
    if (!resolved.ok) return resolved.error
    const run = await this.runner(this.ruff).run(
      ['check', '--output-format', 'json', '--no-fix', resolved.abs],
      gated.canonical,
    )
    if (run.exitCode === 127) return unavailable('ruff', run.stderr.trim())
    // Exit 1 = violations found (not an error); 2 = ruff itself failed.
    if (run.exitCode !== null && run.exitCode > 1) return failed('ruff', run.stderr.trim())
    let diagnostics: PyDiagnostic[]
    try {
      diagnostics = parseRuffJson(run.stdout)
    } catch {
      return failed('ruff', 'unparseable diagnostic output')
    }
    return { diagnostics, tool: 'ruff', version: await this.version(gated.canonical) }
  }

  /** Extract symbols and references for one python file. */
  async symbols(root: string, rel: string): Promise<PySymbolView | PanelError> {
    const gated = await this.gate(root)
    if (!gated.ok) return gated.error
    const resolved = await this.resolvePath(gated.canonical, rel)
    if (!resolved.ok) return resolved.error
    const run = await this.runner(this.python).run(
      ['-X', 'utf8', '-c', PY_SYMBOLS_SCRIPT, resolved.abs],
      gated.canonical,
    )
    if (run.exitCode === 127) return unavailable('python', run.stderr.trim())
    if (run.exitCode !== 0) return failed('python', run.stderr.trim())
    try {
      return parseSymbolsJson(run.stdout)
    } catch {
      return failed('python', 'unparseable symbol output')
    }
  }

  /**
   * Format one python file with ruff. Preview mode (`apply = false`) runs
   * `ruff format --check --diff` (read-only) and returns the unified diff;
   * apply mode runs `ruff format` in place, rewriting the file.
   */
  async format(root: string, rel: string, apply: boolean): Promise<PyFormatResult | PanelError> {
    const gated = await this.gate(root)
    if (!gated.ok) return gated.error
    const resolved = await this.resolvePath(gated.canonical, rel)
    if (!resolved.ok) return resolved.error
    const args = apply ? ['format', resolved.abs] : ['format', '--check', '--diff', resolved.abs]
    const run = await this.runner(this.ruff).run(args, gated.canonical)
    if (run.exitCode === 127) return unavailable('ruff', run.stderr.trim())
    // Exit 0 = already formatted (or applied); 1 = --check found changes; 2 = failure.
    if (run.exitCode !== null && run.exitCode > 1) return failed('ruff', run.stderr.trim())
    return { diff: run.stdout, changed: !apply && run.exitCode === 1 }
  }
}
