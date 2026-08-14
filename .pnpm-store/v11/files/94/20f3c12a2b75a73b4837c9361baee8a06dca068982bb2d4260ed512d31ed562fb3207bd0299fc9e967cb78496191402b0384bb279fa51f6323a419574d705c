/**
 * Plugin-owned human-command registry shared by interactive UI adapters.
 * @module @deepseek-ai/dsh-commands
 */
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { CommandId } from './brand.ts';
import type { CommandDescriptor, CommandExecution, CommandInputDescriptor, CommandResult } from './types.ts';
export { CommandId } from './brand.ts';
export type * from './types.ts';
export declare const name = "commands";
/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
    /** Pairing id already written to this invocation's `command/run` event. */
    readonly commandId: CommandId;
    /** Exact agent whose UI received the command. */
    readonly agent: Agent;
    /** Exact text following the registered command name, including separator whitespace. */
    readonly rawInput: string;
    /** Cancellation signal owned by the dispatching UI request. */
    readonly signal: AbortSignal;
}
/** Plugin-owned command registration. */
export interface CommandDefinition {
    /** Lowercase command name without the leading slash. */
    readonly name: string;
    /** Human-readable summary used in discovery UI. */
    readonly description: string;
    /** Optional free-form input hint advertised to capable clients. */
    readonly input?: CommandInputDescriptor;
    /**
     * Whether `command/run` records `rawInput`. Defaults to true. A command
     * whose domain event owns the payload sets this false to avoid duplicating
     * that payload in the session log.
     */
    readonly recordInput?: boolean;
    /** Execute against the receiving agent without sending the command to the model. */
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
/** Syntactically valid slash command before registry resolution. */
export interface ParsedCommand {
    /** Lowercase command name without the leading slash. */
    readonly name: string;
    /** Exact text following the command name. */
    readonly rawInput: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        commands: CommandRuntime;
    }
}
/**
 * Parse an exact slash command without normalizing its trailing input.
 *
 * @param line - Complete candidate command line.
 * @returns The parsed command, or `undefined` when the line is not a command.
 */
export declare function parseCommand(line: string): ParsedCommand | undefined;
/**
 * Human-command registry. Plain-context definitions are global; definitions
 * registered through a command-injected child of an agent context shadow
 * globals for that agent.
 */
export declare class CommandRuntime extends TypertRemoteService {
    private readonly layers;
    /** Monotonic per-instance counter behind {@link mintCommandId}. */
    private commandSeq;
    /** Instance token keeping minted ids unique across process restarts over one resumed log. */
    private readonly instanceToken;
    constructor(ctx: Context);
    /**
     * Register a global or calling-agent-scoped command.
     * @param definition - discovery metadata and direct UI handler.
     * @returns the exact effect disposer that unregisters this definition.
     */
    register(definition: CommandDefinition): () => void;
    /**
     * List the effective immutable command descriptors for one agent.
     * @param agent - exact receiving agent and scoped-layer key.
     * @returns name-sorted descriptors after scoped shadowing.
     */
    list(agent: Agent): readonly CommandDescriptor[];
    /**
     * Resolve one effective command definition.
     * @param agent - exact receiving agent and scoped-layer key.
     * @param name - command name without a slash.
     * @returns the scoped shadow or global definition.
     */
    find(agent: Agent, name: string): CommandDefinition | undefined;
    /**
     * Parse and execute a known command without sending it to the model.
     *
     * A resolved command's lifecycle is logged: `command/run` is appended
     * before the handler is invoked and `command/done` after settlement (a
     * thrown or aborted handler settles as `kind: 'error'`). Both are direct
     * log-only appends — no turn wraps them, and persistence drains them at
     * ordinary checkpoints. Admission misses (syntax or unknown name) log
     * nothing — they never entered a handler. A `command/run` append failure
     * fails the execution loud; a `command/done` append failure on the
     * handler-failure path is contained so the handler's own error stays the
     * reported failure.
     *
     * @param agent - exact receiving agent.
     * @param line - complete slash-command line.
     * @param signal - cancellation signal owned by the UI request.
     * @returns the settled execution (result + lifecycle pairing id), or
     *   `undefined` when syntax or name does not resolve.
     */
    execute(agent: Agent, line: string, signal: AbortSignal): Promise<CommandExecution | undefined>;
    /** Mint the next pairing id (monotonic; instance-token-prefixed so a resumed log never repeats one). */
    private mintCommandId;
    /**
     * Append one log-only lifecycle event directly: no turn is opened for it and
     * no flush is forced — persistence observes the eager `session/event` path
     * and drains at ordinary checkpoints and teardown, like every other
     * standalone plugin event.
     */
    private appendLifecycle;
    /** Resolve global definitions followed by exact scoped shadows. */
    private view;
    /** Notify every registry observer without making UI refresh load-bearing. */
    private notifyChange;
}
export default CommandRuntime;
//# sourceMappingURL=index.d.ts.map