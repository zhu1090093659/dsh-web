/**
 * Output lines shown before the height cap collapses the middle. Matches the
 * TUI transcript's default tool-output budget so both front ends cut a long
 * command's output at the same place.
 */
export declare const DEFAULT_TERMINAL_MAX_LINES = 16;
/**
 * Display copy for the terminal surface; the owner passes localized labels
 * (this package is cordis-free, so copy arrives via props). Every field
 * defaults to the current built-in value, so existing consumers render
 * unchanged.
 */
export interface TerminalBlockLabels {
    /** Status pill text for a signal-terminated command. */
    signal: (signal: string) => string;
    /** Status pill text for a non-zero exit code. */
    exitCode: (exitCode: number) => string;
    /** Run-state text while the command is still running. */
    running: string;
    /** Run-state text for a signal or non-zero-exit settle. */
    failed: string;
    /** Run-state text for a clean settle. */
    done: string;
    /** Copy-button idle label. */
    copy: string;
    /** Copy-button label during the post-copy confirmation window. */
    copied: string;
    /** Placeholder when a settled command produced no visible output. */
    noOutput: string;
    /** Collapse-toggle aria label while expanded. */
    collapseAria: string;
    /** Collapse-toggle text while expanded. */
    collapse: string;
    /** Expand-toggle aria label while capped, given the hidden line count. */
    expandAria: (hidden: number) => string;
    /** Expand-toggle text while capped, given the hidden line count. */
    expand: (hidden: number) => string;
}
export interface TerminalBlockProps {
    /** The command line, rendered verbatim after the prompt label. */
    command: string;
    /** Working directory for the prompt label; absent renders a plain `$`. */
    cwd?: string | undefined;
    /** Absolute home directory, so a cwd equal to it collapses to `~`; absent disables that collapse. */
    home?: string | undefined;
    /** The command's output text; may contain ANSI escape sequences. */
    output?: string | undefined;
    /** Settled exit code; a non-zero value renders the status pill. */
    exitCode?: number | undefined;
    /** Settled terminating signal name; any value renders the status pill, taking precedence over the exit code. */
    signal?: string | undefined;
    /** The command is still running: the block shows the prompt line alone. */
    running?: boolean | undefined;
    /** Height cap in output lines before the middle collapses (default {@link DEFAULT_TERMINAL_MAX_LINES}); Infinity disables the cap. */
    maxLines?: number | undefined;
    /** Extra class merged onto the wrapper (callers position; this component draws). */
    className?: string | undefined;
    /** Localized display copy; omitted fields keep the built-in defaults. */
    labels?: Partial<TerminalBlockLabels> | undefined;
}
/**
 * Render a shell command as a terminal surface.
 * @param props - see {@link TerminalBlockProps}.
 * @returns the terminal block element.
 */
export declare function TerminalBlock({ command, cwd, home, output, exitCode, signal, running, maxLines, className, labels, }: TerminalBlockProps): import("react").JSX.Element;
//# sourceMappingURL=TerminalBlock.d.ts.map