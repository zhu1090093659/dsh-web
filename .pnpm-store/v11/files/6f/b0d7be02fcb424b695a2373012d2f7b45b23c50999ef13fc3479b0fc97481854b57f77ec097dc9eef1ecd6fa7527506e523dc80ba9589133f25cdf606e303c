import { Context } from './context.ts';
import { Fiber } from './fiber.ts';
import { symbols } from './utils.ts';
declare module './context.ts' {
    interface Intercept {
        logger: LoggerService.Intercept;
    }
}
/** Logger method name and severity category. */
export type LoggerType = 'error' | 'info' | 'warn' | 'debug';
/** Callable shape for one logger severity method. */
export type LoggerMethod = (format: any, ...param: any[]) => void;
/** Formatter used to resolve a printf-style placeholder. */
export type Formatter = (value: any, exporter: Exporter, message: Message) => any;
/** Numeric severity used when exporters decide whether to emit a message. */
export declare const enum LoggerLevel {
    ERROR = 0,
    INFO = 1,
    WARN = 2,
    DEBUG = 3
}
/** Structured log record delivered to exporters. */
export interface Message {
    sn: number;
    ts: number;
    name: string;
    type: LoggerType;
    level: number;
    args: any[];
    fiber?: WeakRef<Fiber>;
}
/** Sink that receives structured log messages. */
export interface Exporter {
    colors?: number | false;
    maxLength?: number;
    levels?: Record<string, number>;
    formatters?: Record<string, Formatter>;
    export(message: Message): void;
}
/** Built-in placeholder formatters used by `Logger.format()`. */
export declare const defaultFormatters: Record<string, Formatter>;
/** Options used when creating a named logger facade. */
export interface LoggerOptions {
    /** The logger name shown with each message. */
    name: string;
    /** Message fields merged into every record from this logger. */
    meta?: Partial<Message>;
    /** Default maximum level exported when an exporter has no own threshold. */
    level?: number;
}
/** Logger facade identity, inherited message metadata, and optional minimum level. */
export interface Logger extends LoggerOptions {
}
/** Logger facade severity methods. */
export interface Logger extends Record<LoggerType, LoggerMethod> {
}
/** Logger facade for one named subsystem. */
export declare class Logger {
    private service;
    static color(exporter: Exporter, code: number, value: any, decoration?: string): string;
    static code(name: string, level?: false | number): number;
    static format(exporter: Exporter, message: Message): string;
    constructor(options: LoggerOptions, service: LoggerService);
    private _method;
}
/** ANSI 16-color palette indexes used for logger name coloring. */
export declare const c16: number[];
/** ANSI 256-color palette indexes used for logger name coloring. */
export declare const c256: number[];
/** Logger service configuration merged from context intercepts. */
export declare namespace LoggerService {
    interface Intercept {
        name?: string;
        level?: number;
    }
}
/** Callable `ctx.logger` service shape. */
export interface LoggerService extends Record<LoggerType, LoggerMethod> {
    (name?: string): Logger;
}
/**
 * Built-in logging service.
 *
 * Call `ctx.logger()` to create a named logger, or call `ctx.logger.info()`
 * directly to log with the current fiber-derived name.
 */
export declare class LoggerService {
    bufferSize: number;
    buffer: Message[];
    ctx: Context;
    _snMessage: number;
    _snExporter: number;
    exporters: Map<number, Exporter>;
    constructor(ctx: Context);
    /**
     * Register an exporter and dispose it with the current fiber.
     *
     * @param exporter — the sink that receives structured log messages.
     * @returns a disposer that removes the exporter.
     */
    exporter(exporter: Exporter): import("./fiber.ts").Disposable<Promise<void>>;
    private _resolveConfig;
    [symbols.invoke](name?: string): Logger;
}
//# sourceMappingURL=logger.d.ts.map