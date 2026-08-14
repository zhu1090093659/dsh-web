/**
 * Cross-platform native path and text-document openers used by the local GUI
 * carrier.
 *
 * The default intent prefers the default browser for documents it renders when
 * the platform can name one, then falls back to the default application. WSL
 * translates every path for the Windows desktop instead of assuming a Linux
 * GUI. The text-editor intent never consults the browser.
 */
import { type NativeCommandRunner } from '@deepseek-ai/dsh-native-command';
/** Testable command boundary; native implementations never invoke a shell. */
export type PathOpenerRunner = NativeCommandRunner;
/** Injectable platform facts for deterministic adapter tests. */
export interface PathOpenerInternals {
    platform?: NodeJS.Platform;
    /** Kernel release override used to distinguish WSL from desktop Linux. */
    osRelease?: string;
    /** Environment used for WSL markers and the desktop Linux browser convention. */
    env?: NodeJS.ProcessEnv;
    run?: PathOpenerRunner;
}
/**
 * Whether {@link openNativePath} plausibly reaches a desktop on this host.
 *
 * macOS and Windows always carry a desktop opener; Linux does when it is WSL
 * (the Windows desktop takes the path) or a display server is announced.
 * A headless or containerised Linux host answers false, which is what lets a
 * surface show a path as text instead of offering a button that would spawn
 * `xdg-open` into nothing.
 * @param internals - platform and environment seam for deterministic tests.
 * @returns true when handing a path to the native opener can work at all.
 */
export declare function canOpenNativePath(internals?: PathOpenerInternals): boolean;
/**
 * Open a filesystem path with the operating system's default application, or
 * with the default browser when the path names a document a browser renders.
 * @param path - absolute or host-resolvable path (caller owns resolution).
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - Platform, environment, and runner hooks for deterministic tests.
 */
export declare function openNativePath(path: string, signal: AbortSignal, internals?: PathOpenerInternals): Promise<void>;
/**
 * Open a text document for editing; macOS bypasses the file-type association
 * so a YAML association with a browser cannot consume the gesture.
 * @param path - absolute or host-resolvable text-document path.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - Platform and runner hooks for deterministic tests.
 */
export declare function openNativeTextFile(path: string, signal: AbortSignal, internals?: PathOpenerInternals): Promise<void>;
//# sourceMappingURL=native-path-opener.d.ts.map