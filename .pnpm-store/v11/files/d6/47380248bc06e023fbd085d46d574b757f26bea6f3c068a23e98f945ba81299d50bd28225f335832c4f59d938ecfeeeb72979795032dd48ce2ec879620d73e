import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EventEmitter as EventEmitter$1 } from 'node:stream';

declare const DEFAULT_CLOUDFLARED_BIN: string;
/**
 * The path to the cloudflared binary.
 * If the `CLOUDFLARED_BIN` environment variable is set, it will be used; otherwise, {@link DEFAULT_CLOUDFLARED_BIN} will be used.
 * Can be overridden with {@link use}.
 */
declare let bin: string;
/**
 * Override the path to the cloudflared binary.
 * @param executable - The path to the cloudflared executable.
 */
declare function use(executable: string): void;
declare const CLOUDFLARED_VERSION: string;
declare const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/";

/**
 * Install cloudflared to the given path.
 * @param to The path to the binary to install.
 * @param version The version of cloudflared to install.
 * @returns The path to the binary that was installed.
 */
declare function install$1(to: string, version?: string): Promise<string>;
declare function install_linux(to: string, version?: string): Promise<string>;
declare function install_macos(to: string, version?: string): Promise<string>;
declare function install_windows(to: string, version?: string): Promise<string>;

interface Connection {
    id: string;
    ip: string;
    location: string;
}

type TunnelOptions = Record<string, string | number | boolean>;
interface TunnelEvents {
    url: (url: string) => void;
    connected: (connection: Connection) => void;
    disconnected: (connection: Connection) => void;
    stdout: (data: string) => void;
    stderr: (data: string) => void;
    error: (error: Error) => void;
    exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}
type OutputHandler = (output: string, tunnel: Tunnel) => void;
declare class Tunnel extends EventEmitter {
    private _process;
    private outputHandlers;
    constructor(options?: TunnelOptions | string[]);
    get process(): ChildProcess;
    private setupDefaultHandlers;
    /**
     * Add a custom output handler
     * @param handler Function to handle cloudflared output
     */
    addHandler(handler: OutputHandler): void;
    /**
     * Remove a previously added output handler
     * @param handler The handler to remove
     */
    removeHandler(handler: OutputHandler): void;
    private processOutput;
    private setupEventHandlers;
    private createProcess;
    stop: () => boolean;
    private _stop;
    on<E extends keyof TunnelEvents>(event: E, listener: TunnelEvents[E]): this;
    once<E extends keyof TunnelEvents>(event: E, listener: TunnelEvents[E]): this;
    off<E extends keyof TunnelEvents>(event: E, listener: TunnelEvents[E]): this;
    emit<E extends keyof TunnelEvents>(event: E, ...args: Parameters<TunnelEvents[E]>): boolean;
    /**
     * Create a quick tunnel without a Cloudflare account.
     * @param url The local service URL to connect to. If not provided, the hello world mode will be used.
     * @param options The options to pass to cloudflared.
     */
    static quick(url?: string, options?: TunnelOptions): Tunnel;
    /**
     * Create a tunnel with a Cloudflare account.
     * @param token The Cloudflare Tunnel token.
     * @param options The options to pass to cloudflared.
     */
    static withToken(token: string, options?: TunnelOptions): Tunnel;
}
/**
 * Create a tunnel.
 * @param options The options to pass to cloudflared.
 * @returns A Tunnel instance
 */
declare function tunnel(options?: TunnelOptions): Tunnel;
/**
 * Build the arguments for the cloudflared command.
 * @param options The options to pass to cloudflared.
 * @returns The arguments for the cloudflared command.
 */
declare function build_args(options: TunnelOptions): string[];
declare function build_options(options: TunnelOptions): string[];

/**
 * Cloudflared launchd identifier.
 * @platform macOS
 */
declare const identifier = "com.cloudflare.cloudflared";
/**
 * Path of service related files.
 * @platform macOS
 */
declare const MACOS_SERVICE_PATH: {
    readonly PLIST: string;
    readonly OUT: string;
    readonly ERR: string;
};
/**
 * Cloudflared Service API.
 */
declare const service: {
    install: typeof install;
    uninstall: typeof uninstall;
    exists: typeof exists;
    log: typeof log;
    err: typeof err;
    current: typeof current;
    clean: typeof clean;
    journal: typeof journal;
};
/**
 * Throw when service is already installed.
 */
declare class AlreadyInstalledError extends Error {
    constructor();
}
/**
 * Throw when service is not installed.
 */
declare class NotInstalledError extends Error {
    constructor();
}
/**
 * Install Cloudflared service.
 * @param token Tunnel service token.
 * @platform macOS, linux
 */
declare function install(token?: string): void;
/**
 * Uninstall Cloudflared service.
 * @platform macOS, linux
 */
declare function uninstall(): void;
/**
 * Get stdout log of cloudflared service. (Usually empty)
 * @returns stdout log of cloudflared service.
 * @platform macOS, linux (sysv)
 */
declare function log(): string;
/**
 * Get stderr log of cloudflared service. (cloudflared print all things here)
 * @returns stderr log of cloudflared service.
 * @platform macOS, linux (sysv)
 */
declare function err(): string;
/**
 * Get cloudflared service journal from journalctl.
 * @param n The number of entries to return.
 * @returns cloudflared service journal.
 * @platform linux (systemd)
 */
declare function journal(n?: number): string;
/**
 * Get informations of current running cloudflared service.
 * @returns informations of current running cloudflared service.
 * @platform macOS, linux
 */
declare function current(): {
    /** Tunnel ID */
    tunnelID: string;
    /** Connector ID */
    connectorID: string;
    /** The connections of the tunnel */
    connections: Connection[];
    /** Metrics Server Location */
    metrics: string;
    /** Tunnel Configuration */
    config: {
        ingress?: {
            service: string;
            hostname?: string;
        }[];
        [key: string]: unknown;
    };
};
/**
 * Clean up service log files.
 * @platform macOS
 */
declare function clean(): void;
/**
 * Check if cloudflared service is installed.
 * @returns true if service is installed, false otherwise.
 * @platform macOS, linux
 */
declare function exists(): boolean;

declare class ConnectionHandler {
    private connections;
    constructor(tunnel: Tunnel);
    private connected_handler;
    private disconnected_handler;
}
declare class TryCloudflareHandler {
    constructor(tunnel: Tunnel);
    private url_handler;
}
interface ConfigHandlerEvents<T> {
    config: (config: {
        config: T;
        version: number;
    }) => void;
    error: (error: Error) => void;
}
interface TunnelConfig {
    ingress: Record<string, string>[];
    warp_routing: {
        enabled: boolean;
    };
}
declare class ConfigHandler<T = TunnelConfig> extends EventEmitter$1 {
    constructor(tunnel: Tunnel);
    private config_handler;
    on<E extends keyof ConfigHandlerEvents<T>>(event: E, listener: ConfigHandlerEvents<T>[E]): this;
    once<E extends keyof ConfigHandlerEvents<T>>(event: E, listener: ConfigHandlerEvents<T>[E]): this;
    off<E extends keyof ConfigHandlerEvents<T>>(event: E, listener: ConfigHandlerEvents<T>[E]): this;
    emit<E extends keyof ConfigHandlerEvents<T>>(event: E, ...args: Parameters<ConfigHandlerEvents<T>[E]>): boolean;
}

export { AlreadyInstalledError, CLOUDFLARED_VERSION, ConfigHandler, type ConfigHandlerEvents, type Connection, ConnectionHandler, DEFAULT_CLOUDFLARED_BIN, MACOS_SERVICE_PATH, NotInstalledError, type OutputHandler, RELEASE_BASE, TryCloudflareHandler, Tunnel, type TunnelConfig, type TunnelEvents, type TunnelOptions, bin, build_args, build_options, identifier, install$1 as install, install_linux, install_macos, install_windows, service, tunnel, use };
