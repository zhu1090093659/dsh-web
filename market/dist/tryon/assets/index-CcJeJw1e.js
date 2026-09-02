import{CordisDynamicPluginId as p,CordisDynamicPackageId as b,HOST_BUILTIN_INSPECTION as E}from"./index-C4YD8-Y4.js";import{b6 as c,c as M}from"./index-DGS2ur_Y.js";import"./index-CYLJUZo6.js";import"./git-DJDr4heb.js";import"./shim-vm-shuIvv6B.js";const D=[{key:"agentDefaultModel",summary:"Owns the default model selection independently of any Host or transport.",description:"Owns the default model selection independently of any Host or transport. The composition entry remains usable without a settings provider; when one is mounted, its user layer is read live.",methods:[{signature:"currentSelection(): ModelSelection",description:"Read the current default model selection.",parameters:[],returns:"a detached provider, model, and optional reasoning selection."},{signature:"async saveSelection(next: ModelSelection): Promise<void>",description:"Save the complete default model selection. A deployment without a settings provider keeps its composition entry.",parameters:[{name:"next",description:"resolved selection accepted by an entry point."}],returns:"fulfillment after the optional settings write settles."}]},{key:"agentLoop",summary:"Concrete agent factory and driver service.",description:"Concrete agent factory and driver service.",methods:[{signature:"readonly config: ResolvedConfig",description:"Validated configuration owned by the agent-loop service.",parameters:[]},{signature:"create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent",description:"Create an agent and session under one caller-supplied identity, owned by the accessing fiber. Constructor-driven config calls mint a fresh combined id before entering this boundary.",parameters:[{name:"id",description:"shared agent/session identity."},{name:"options",description:"concrete loop options."},{name:"meta",description:"optional fresh-session workspace metadata."}],returns:"the published running agent."},{signature:"async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>",description:"Create an owned agent on a caller-supplied session id.",parameters:[{name:"ownerCtx",description:"caller context that structurally owns the lifecycle."},{name:"options",description:"identities, session seed/metadata, loop options, setup, and cancellation."}],returns:"the published handle."},{signature:"async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>",description:"Resume an owned agent from the configured persistence service.",parameters:[{name:"ownerCtx",description:"caller context that owns load, setup, and the live lifecycle."},{name:"options",description:"persisted identity, loop options, setup, and cancellation."}],returns:"the published handle."}]},{key:"agentPresets",summary:"Registry over the deployment's agent presets.",description:"Registry over the deployment's agent presets.\n\nDiscovery is unmemoized: `list()` and `resolve()` re-read the roots on every call so a preset authored while the process runs is visible immediately, and a preset deleted underneath a picker disappears from the next read.",methods:[{signature:"async list(): Promise<AgentPreset[]>",description:"Every preset the configured roots currently supply.",parameters:[],returns:"the presets, first-root-wins per id."},{signature:"async resolve(id?: string): Promise<AgentPreset>",description:`Resolve one preset by id.

A broken preset resolves — deleting one, reading one, and reporting one all need the row — and the mounting paths refuse it AFTER resolution through resolveMountable.`,parameters:[{name:"id",description:"the preset id, or `undefined` for {@link defaultId}."}],returns:"the resolved preset.",throws:["when no configured root supplies that id."]},{signature:"async mount(agentCtx: Context, id?: string): Promise<AgentPreset>",description:"Compose one agent from a preset: ensure the preset's standing mount, then parent the agent's scope key to it so the mount's registrations and listeners cover this agent.\n\nCall from the agent factory's `setup(agentCtx)`; a rejection there rolls the agent creation back, so a broken preset never yields a half-composed session.",parameters:[{name:"agentCtx",description:"the agent's scope context."},{name:"id",description:"the preset id, or `undefined` for {@link defaultId}."}],returns:"the preset that was composed, for the caller to record.",throws:["when the preset is unknown or its composition is unusable."]},{signature:"composeFrom(agentCtx: Context, parentCtx: Context): string | undefined",description:`Join one agent to the SAME standing composition another already runs on.

This is how a child agent inherits its parent's capabilities. It is a bind, not a mount: the parent's generation is already composed, so the child gets that exact instance — the same plugin objects, the same tool registrations, the same prompt sections. Re-resolving the parent's preset by id instead would re-read the roster, and a composition file edited since the parent started would hand the child a DIFFERENT generation than the one its parent's history was produced under (and a preset deleted since would fail the child outright while its parent keeps running).

Synchronous, and with no composition failure mode of its own — it reads no roster, mounts nothing, and touches no file — which is what lets a child creation window use it: the two in-process subagent drivers compose their children inside a synchronous \`setup\`. It still rejects a caller error, as the \`@throws\` below record.

A parent that joined no preset — a rosterless deployment — yields no join and no error: there, the model-facing rows sit in the host composition and the child already sees them through the global layer.`,parameters:[{name:"agentCtx",description:"the joining agent's scope context."},{name:"parentCtx",description:"the scope context of the agent whose composition to join."}],returns:"the preset id joined, or undefined when the parent joined none.",throws:["when `agentCtx` carries no scope, or has already joined a preset."]},{signature:"composedPreset(agentCtx: Context): string | undefined",description:`The preset one live agent runs on.

Read from the live scope chain rather than from the session, so it answers for an agent whose session has not recorded a preset yet — a child agent whose durable header is being built from its parent's composition.`,parameters:[{name:"agentCtx",description:"the agent's scope context."}],returns:"the preset id, or undefined when the agent joined none."},{signature:"async read(id: string): Promise<string>",description:"Read one preset's composition text.",parameters:[{name:"id",description:"the preset id."}],returns:"the composition exactly as stored.",throws:["when no configured root supplies that id."]},{signature:"async copy(from: string, id: string, name?: string): Promise<void>",description:`Create a locally authored preset by copying an existing one whole.

Copy is the only authoring write. Composition text never crosses this seam: the source is named by id and its directory is copied as it stands, so the copy is exactly as loadable as its source and authoring grants no capability the roster did not already carry. The copy is NOT mounted to validate — a source that mounts today yields a copy that mounts today.`,parameters:[{name:"from",description:"the preset the copy starts from; shipped presets are the primary source, so any trust is accepted."},{name:"id",description:"the new preset's id, which becomes its directory name."},{name:"name",description:"display name for the copy; absent falls back to the id."}],throws:["when the source is unknown, the id is unusable or already taken, or the deployment configures no writable root."]},{signature:"async remove(id: string): Promise<void>",description:"Delete a locally authored preset.",parameters:[{name:"id",description:"the preset id."}],throws:["when the preset is unknown or ships with the deployment."]},{signature:"serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined",description:"One agent's instance of a service its preset mounted.\n\nA preset publishes services behind `isolate` realms, which are invisible outside the group that declares them — including to the host. This is how a caller holding the agent reads one anyway: a request that is ABOUT a session but arrives from outside it, which is every browser RPC.\n\nRead addressing only. A host row that `inject`s a service cannot use this, because injection resolves before any session exists and has no agent to key by; such a service belongs on the host plane instead.",parameters:[{name:"agent",description:"the agent whose composition to look inside."},{name:"name",description:"the service name as the preset's rows resolve it."}],returns:"the agent's instance, or undefined when its preset mounts none."},{signature:"async recompose(agentCtx: Context, id: string): Promise<AgentPreset>",description:`Re-link one agent to a different preset's standing composition.

Only valid while the agent has produced nothing: swapping tools mid conversation would leave logged tool calls the new composition cannot make. The CALLER owns that check — this method does not read session history.

The swap is a parent re-link, not an unmount: standing mounts are shared and permanent, so the old composition stays for its other agents and the new one is ensured BEFORE the link moves. An unknown or unusable preset therefore throws with the agent exactly as it was — there is no torn-down state to restore. The re-link runs through the binding this roster kept from the agent's mount — dsh-scope's only re-link authority. An agent that never composed one has nothing to re-link: the switch is then the agent's first bind, exactly a mount.`,parameters:[{name:"agentCtx",description:"the agent's scope context."},{name:"id",description:"the preset to compose the agent from instead."}],returns:"the preset now installed.",throws:["when the preset is unknown or its composition is unusable."]},{signature:"async standingKeyFor(id?: string): Promise<ScopeKey>",description:`The standing scope key of one preset, for a host reader with no agent.

A cold transcript read resolves tool presenters against the composition the session recorded, and the standing mount makes that possible without resuming anything: ensuring the mount composes plugins but starts no agent, no session, and no turn.`,parameters:[{name:"id",description:"the preset id, or `undefined` for {@link defaultId}."}],returns:"the standing scope key readers pass as a registry view scope.",throws:["when the preset is unknown or its composition is unusable."]}]},{key:"agents",summary:"Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain.",description:"Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory.\n\nInitiator methods provide same-process causal attribution only. Ambient presence is neither liveness proof nor authorization; subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries. Returned Promise boundaries drain during teardown, except a nested lineage that starts an owning-fiber unload is excluded from its own drain.",methods:[{signature:"currentInitiator(): Agent | undefined",description:"Read the Agent that initiated the inherited asynchronous driver chain. Use this optional form for logging, tracing, metrics, or host attribution that also supports agentless calls. When a parent creates a child, setup reports the causal parent while `agentCtx.agent` identifies the child.",parameters:[],returns:"the inherited Agent, or `undefined` outside an initiator boundary and inside an explicit clearing boundary.",throws:["when this service instance has been disposed."]},{signature:"requireInitiator(): Agent",description:"Read the initiating Agent and fail when no initiator boundary is active. Use this for private helpers contractually below a driver, or for a deployment-owned outbound request whose contract forbids agentless calls. Generic or direct-call paths use optional lookup or explicit request fields.",parameters:[],returns:"the inherited Agent.",throws:["when no initiator is active or this service instance has been disposed."]},{signature:"withInitiator<T>(agent: Agent, operation: () => T): T",description:"Run an operation with one exact Agent as its process-local initiator. The exact synchronous value or Promise returned by the operation is preserved. Custom drivers and test harnesses wrap their complete returned foreground lifetime. A queue or wire receiver may establish this boundary only after validating explicit identity and resolving the exact live Agent; this method does neither. Detached work remains owned by the subsystem that starts it.",parameters:[{name:"agent",description:"initiating Agent to inherit; presence is neither liveness proof nor authorization."},{name:"operation",description:"synchronous or asynchronous operation to invoke."}],returns:"the exact value returned by `operation`.",throws:["when the initiator scope is closing/disposed, or when `operation` throws."]},{signature:"withoutInitiator<T>(operation: () => T): T",description:"Run an operation inside a boundary that hides any inherited initiating Agent. The exact synchronous value or Promise is preserved. Use this while creating lazy shared timers, queue pumps, pool maintenance, watchers, or exporters so they do not inherit the first Agent that happens to initialize them. It clears only initiator attribution, not explicit fields, and does not own or drain detached resources.",parameters:[{name:"operation",description:"synchronous or asynchronous operation to invoke without an initiator."}],returns:"the exact value returned by `operation`.",throws:["when the initiator scope is closing/disposed, or when `operation` throws."]},{signature:"setFactory(factory: AgentFactory): () => void",description:"Register the agent-creation factory (the loop calls this on construction, effect-scoped). A traced Cordis service is canonicalized to its concrete target; each create/resume call is then traced through that caller's context so ownership follows the caller without stacking proxy layers. Throws if a factory is already registered. Returns the disposer; on dispose the factory slot is cleared.",parameters:[{name:"factory",description:"the loop-owned factory {@link create}/{@link resume} delegate to."}],returns:"the disposer that clears the factory slot. The exact Cordis effect disposer (single-shot): composite (generator) effects may yield it directly — exact identity nests the teardown in order."},{signature:"async create(options: CreateAgentOptions): Promise<AgentHandle>",description:"Create and publish a new agent through the registered factory. Distinct from register (which records an already-constructed agent): this constructs the agent and its session. Rejects if no factory is registered or creation/setup fails. The resolved AgentHandle lets the owner tear down exactly this agent.",parameters:[{name:"options",description:"shared identity, session seed/metadata, and agent options."}],returns:"the handle after setup, rollback-covered publication, and loop start complete."},{signature:"async resume(options: ResumeAgentOptions): Promise<AgentHandle>",description:"Load a persisted session and resume an agent on it through the registered factory. Rejects if no factory is registered; the factory rejects if session persistence is not configured or persistence/setup fails.",parameters:[{name:"options",description:"persisted identity, configuration, and optional setup."}],returns:"the handle after setup, rollback-covered publication, and loop start complete."},{signature:"register(agent: Agent): () => void",description:"Register a live agent. Throws if an agent with the same id is already registered. Emits `agent/created` on registration and `agent/disposed` when the calling fiber is disposed — both with the agent's scope carrier (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the emits are scope-filtered regardless of which context invoked `register` (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always requires passing the carrier). Returns the disposer.",parameters:[{name:"agent",description:"the already-constructed agent to record in the store."}],returns:"the EXACT Cordis effect disposer (single-shot; a repeat call returns undefined without awaiting an in-flight teardown). Exact identity is load-bearing: a composite (generator) effect that owns a teardown ORDER — the agent factory's lifecycle chain — must yield THIS function so Cordis nests the unregistration at that yield position; yielding a wrapper would leave it disposing as a concurrent sibling on owner unload, unregistering the agent (and emitting `agent/disposed`) while its final turn is still draining."},{signature:"enter(agent: Agent, owner: Agent | undefined): () => void",description:"Insert an already-constructed agent without announcing it. This is the advanced ordered-lifecycle primitive used by the async agent factory: it first completes setup while the agent is unpublished, then assigns the returned detach closure into its pre-installed composite teardown before calling announce. Ordinary callers use register.",parameters:[{name:"agent",description:"the prepared, unpublished agent."},{name:"owner",description:"live agent whose scoped context created this agent, or undefined for a top-level runtime root. This is runtime ownership, not the resumed session's durable parent lineage."}],returns:"an idempotent closure that removes this exact entry and emits `agent/disposed` with listener failures contained. When called from a synchronous `agent/created` listener, removal and disposal wait until that creation dispatch unwinds."},{signature:"announce(agent: Agent): void",description:"Announce an agent previously inserted with enter.",parameters:[{name:"agent",description:"the live inserted agent to announce."}],throws:["if `agent` is not the exact live registry entry for its id, or its creation announcement already began (including a reentrant call from a creation listener)."]},{signature:"get(id: SessionId): Agent | undefined",description:"Look up a live agent.",parameters:[{name:"id",description:"the shared agent/session id to look up."}],returns:"the agent, or undefined when no live agent has that id."},{signature:"isOwnedBy(id: SessionId, owner: Agent): boolean",description:"Test whether a live agent was created through one exact parent agent's scoped context. Runtime ownership is independent of durable session lineage and remains unambiguous when unrelated providers reuse an id.",parameters:[{name:"id",description:"the candidate child agent's shared agent/session id."},{name:"owner",description:"the expected runtime creator agent."}],returns:"true only while the exact child entry is live under that owner."},{signature:"list(): Agent[]",description:"All live agents, in registration order.",parameters:[],returns:"a fresh array; mutating it does not affect the registry."},{signature:"roots(): Agent[]",description:"All live top-level agents in registration order. A top-level agent was created without an owning agent context; durable session lineage does not affect this runtime relation, so a resumed fork may still be a root.",parameters:[],returns:"a fresh array; mutating it does not affect the registry."}]},{key:"agentTeams",summary:"Agent Teams service backed by the exact live Lead Session log.",description:"Agent Teams service backed by the exact live Lead Session log.",methods:[{signature:"membership(agent: Agent): TeamMembership",description:"Resolve one exact live Agent's Team role.",parameters:[{name:"agent",description:"exact live Agent used as the authority credential."}],returns:"its root, Team identity, role, and model-facing name."},{signature:"listMembers(agent: Agent): TeamMemberView[]",description:"List the runtime-enriched roster visible to one Team member.",parameters:[{name:"agent",description:"exact live Team member."}],returns:"Lead and teammate rows in creation order."},{signature:"async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>",description:"Create one named, continuable direct child of the Team Lead.",parameters:[{name:"caller",description:"exact live Lead Agent."},{name:"request",description:"immutable name, description, prompt, context mode, provider, and cancellation."}],returns:"the active roster row."},{signature:"async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>",description:"Queue one durable peer message, then attempt immediate delivery.",parameters:[{name:"caller",description:"exact live sending Team member."},{name:"request",description:"target name, content, scheduling mode, and pre-queue cancellation."}],returns:"durable message identity and immediate-delivery observation."},{signature:"async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>",description:"Create one unowned pending task in the Team Lead log.",parameters:[{name:"caller",description:"exact live Team member creating the task."},{name:"request",description:"task text, blockers, and advisory write scopes."}],returns:"the revision-one task view."},{signature:"getTask(caller: Agent, id: TeamTaskId): TeamTaskView",description:"Return one task, including a deleted tombstone.",parameters:[{name:"caller",description:"exact live Team member reading the task."},{name:"id",description:"Team-local task identity."}],returns:"the latest task value and derived readiness diagnostics."},{signature:"listTasks(caller: Agent): TeamTaskView[]",description:"List current non-deleted tasks in numeric creation order.",parameters:[{name:"caller",description:"exact live Team member reading the board."}],returns:"detached current task views."},{signature:"async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>",description:"Compare-and-set one authorized task transition.",parameters:[{name:"caller",description:"exact live Team member authorizing the mutation."},{name:"request",description:"task identity, expected revision, action, and action fields."}],returns:"the committed next task revision."},{signature:"async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>",description:"Wait for the next Team-domain or member-status change.",parameters:[{name:"caller",description:"exact live Team member waiting for activity."},{name:"timeoutMs",description:"bounded wait duration from ten seconds through one hour."},{name:"signal",description:"caller cancellation for the wait only."}],returns:"one observed change or a timeout result."},{signature:"interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }",description:"Interrupt one live teammate turn without clearing its pending inbox.",parameters:[{name:"caller",description:"exact live Lead Agent."},{name:"targetName",description:"durable teammate name."}],returns:"the target status sampled before cancellation."},{signature:"tryMembership(agent: Agent): TeamMembership | undefined",description:"Resolve a caller without throwing, used by scoped-tool installation and observers.",parameters:[{name:"agent",description:"candidate exact live Agent."}],returns:"Team membership, or undefined for non-Team subagents and stale identities."}]},{key:"apiProxy",summary:"Root interface of the unified API.",description:"Root interface of the unified API. New client-request domain = one new file pair + one field here + one map row.",methods:[{signature:"downloads: DownloadsApi",description:"Host-only download surfaces (GET, no wire envelope); absent from IApiClient.",parameters:[]},{signature:"respond(message: ClientResponse): Promise<RpcReceipt>",description:"Response entry for server requests; not a domain method.",parameters:[{name:"message",description:"Client response carrying the server request's rpcId."}],returns:"Transport receipt for the response delivery."}]},{key:"approval",summary:"Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session.",description:"Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.",methods:[{signature:"setPolicy(agent: Agent, policy: ApprovalPolicy): void",description:"Switch one live agent's policy and queue the transition for its next model step. Session initialization uses setApprovalPolicy directly because there is no previously visible policy to change.",parameters:[{name:"agent",description:"the live agent whose policy is changing."},{name:"policy",description:"the new effective policy."}]},{signature:"async request(req: ApprovalRequest): Promise<ApprovalOutcome>",description:"Ask the composed answerers to decide one readonly same-process request. The service borrows the request, agent, session, and live signal directly. The request requires an open turn because the audit pair must be enclosed by the durable log's commit/replay boundary; an idle ask rejects before appending anything. The answerer phase always produces an outcome: an aborted signal yields `'cancelled'`, a missing or throwing answerer yields `'unavailable'` (fail closed), and a rogue non-vocabulary return value is normalized to `'unavailable'`. A failure that prevents either audit append from committing still rejects because returning an unlogged decision would violate the pair. Session contains post-commit observer failures, so an authoritative append cannot reject the request or suppress its matching audit event.",parameters:[{name:"req",description:"the pending decision (agent, tool identity, reason, signal)."}],returns:"the closed outcome; `'allowed-once'` is the only grant.",throws:["when no turn is open or either audit event fails before the session append commit point."]},{signature:"overrideOf(session: Session): ApprovalPolicy | undefined",description:"Read the session override without applying the configured default.",parameters:[{name:"session",description:"session whose log supplies the override."}],returns:"the last logged policy, or `undefined` without one."}]},{key:"attachments",summary:"Immutable binary attachment service.",description:"Immutable binary attachment service. Implementations validate bytes before publishing a reference.",methods:[{signature:"abstract readonly imageLimits: ImageAttachmentLimits",description:"Deployment-resolved image policy used by authoritative and fast-path validation.",parameters:[]},{signature:"abstract validateImage(input: SaveImageAttachment): Promise<void>",description:"Validate one image without persisting it. Batch callers validate every member before saving any member.",parameters:[{name:"input",description:"encoded bytes, declared media type, and optional display name."}],returns:"completion after the encoded raster has been fully decoded."},{signature:"async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>",description:"Validate and durably commit one ordered image batch.",parameters:[{name:"inputs",description:"encoded images in owning-message order."}],returns:"durable normalized attachment references in the same order after every member succeeds."},{signature:"abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>",description:"Validate and durably commit one image before its owning session event is appended. The returned reference describes the persisted normalized image. When normalization reduces the raster, its `originalDimensions` records the orientation-applied input dimensions.",parameters:[{name:"input",description:"encoded bytes, declared media type, and optional display name."}],returns:"the durable content-addressed normalized image reference."},{signature:"abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>",description:"Read one image and verify that bytes still match the recorded reference.",parameters:[{name:"ref",description:"durable reference from the session log."},{name:"signal",description:"optional cancellation for backend read and verification work."}],returns:"the verified bytes and normalized attachment reference.",throws:["the signal reason when aborted, or a storage error when verification fails."]},{signature:"readImageRequest( ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal, ): Promise<RequestImageAttachment>",description:"Generate or read one deterministic model-request version from the stored normalized image.",parameters:[{name:"ref",description:"durable provider-independent normalized attachment reference."},{name:"policy",description:"exact route pixel and encoded-byte budget."},{name:"signal",description:"optional cancellation."}],returns:"request bytes and the cache/upload identity covering every transform input."}]},{key:"authorization",summary:"`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.",description:"`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.",methods:[{signature:"registerFlow(flow: AuthorizationFlow): () => void",description:"Offer a way to obtain one credential. One flow per key: two plugins claiming the same key would each write a record in their own format, and whichever ran last would leave the other reading a payload it cannot parse.",parameters:[{name:"flow",description:"the key it writes, its label, its methods, and its runner."}],returns:"Disposer that withdraws this flow.",throws:["{AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed."]},{signature:"list(): readonly AuthorizationEntry[]",description:"Every registered flow, for a surface listing what can be authorized.",parameters:[],returns:"one entry per flow, in registration order."},{signature:"describe(key: CredentialKey): AuthorizationEntry | undefined",description:"One registered flow.",parameters:[{name:"key",description:"the credential record to ask about."}],returns:"the entry, or undefined when no flow claims that key."},{signature:"cancel(key: CredentialKey): void",description:"Withdraw the attempt running for a key, if any. Separate from the request's own signal because a request/response transport answers a Cancel button on a second call, with no handle on the first one's signal.",parameters:[{name:"key",description:"the credential record whose attempt should stop."}]},{signature:"async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>",description:`Run one attempt to authorize a key, and report how it ended.

One attempt per key at a time. A second caller is refused rather than joined: the two would be prompting different humans through the same flow, and the second would answer questions the first was asked.`,parameters:[{name:"request",description:"the key, the method, the surface, and the cancel signal."}],returns:"`authorized` once the flow's record is committed during this attempt and observed, or `cancelled` when the human declined or the caller withdrew.",throws:["{AuthorizationError} code `NO_FLOW` when nothing claims the key, `UNKNOWN_METHOD` when the named method is not one the flow offers, `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or `NOT_COMMITTED` when the flow resolved without committing a record during the attempt."]}]},{key:"clientModules",summary:"The web plugin table service: incremental `dsh.client` scan + wire composition + bundle route + index injection rows.",description:"The web plugin table service: incremental `dsh.client` scan + wire composition + bundle route + index injection rows. Construction runs the activation scan synchronously — a malformed declaration or missing bundle among the already-loaded entries aggregates into one loud throw (FAILED fiber; the boot activation audit reports it).",methods:[{signature:"graph(): WebBootGraph",description:"Current composed entry graph (stable object between changes).",parameters:[],returns:"the graph served as `window.__DSH_BOOT__`."},{signature:"clientPath(id: string): string | undefined",description:"Absolute path of an entry's client bundle.",parameters:[{name:"id",description:"entry id (package name)."}],returns:"the path, or undefined for an unknown id."},{signature:"rebuilt(id: string): string | undefined",description:"Re-hash one bundle (the HMR watch's registration hook — the only entry point through which bundle content changes reach the graph).",parameters:[{name:"id",description:"entry id (package name)."}],returns:"the new rev, or undefined for an unknown id."},{signature:"onRebuilt(listener: (id: string, rev: string) => void): () => void",description:"Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.",parameters:[{name:"listener",description:"receives the entry id and its new bundle rev."}],returns:"the unsubscriber."},{signature:"onGraphChanged(listener: () => void): () => void",description:"Fires after any flush that recomposed the graph (row added/removed, or a rebuilt rev change). Pull model: listeners re-read graph.",parameters:[{name:"listener",description:"notified with no payload."}],returns:"the unsubscriber."}]},{key:"codeRuntime",summary:"Registers one `ctx.codeRuntime` implementation.",description:"Registers one `ctx.codeRuntime` implementation. Program, budget, abort, and substrate failures resolve in CodeRunResult; only Service Definition contract misuse rejects. Implementations bridge structured-cloneable bindings, materialize each declared namespace rejection class, treat programs as hostile peers, isolate runs from one another, and terminate and await in-flight runs during disposal.",methods:[{signature:"abstract readonly language: string",description:"The source language run expects `program` to be written in, as a lowercase identifier. Informational, not gating — a consumer that generates language-specific presentation (typed SDK stubs, usage instructions) switches on it and fails loud on a language it cannot present. Well-known values: `'typescript'` and `'python'`, those `dsh-tools` presents; only `'typescript'` has a published backend.",parameters:[]},{signature:"abstract readonly isolation: string",description:"The execution substrate, as a lowercase identifier. Informational, not gating — a descriptor so deployments and diagnostics can tell backends apart, not a security claim. Well-known values: `'worker-thread'`, `'process'`, `'container'`.",parameters:[]},{signature:"abstract run(request: CodeRunRequest): Promise<CodeRunResult>",description:"Execute one program against the request's bindings and capture what it emitted. See the class doc for the resolution contract (error is a result field; rejection means Service Definition contract misuse only).",parameters:[{name:"request",description:"the program, its bindings, and the abort signal; the request carries everything the runtime acts on, with no hidden defaults."}],returns:"the run's outcome: completion value (when transferable), the ordered log capture, and the failure (if any)."}]},{key:"commands",summary:"Human-command registry.",description:"Human-command registry. Plain-context definitions are global; definitions registered through a command-injected child of an agent context shadow globals for that agent.",methods:[{signature:"register(definition: CommandDefinition): () => void",description:"Register a global or calling-agent-scoped command.",parameters:[{name:"definition",description:"discovery metadata and direct UI handler."}],returns:"the exact effect disposer that unregisters this definition."},{signature:"@Remote list(agent: Agent): readonly CommandDescriptor[]",description:"List the effective immutable command descriptors for one agent.",parameters:[{name:"agent",description:"exact receiving agent and scoped-layer key."}],returns:"name-sorted descriptors after scoped shadowing."},{signature:"find(agent: Agent, name: string): CommandDefinition | undefined",description:"Resolve one effective command definition.",parameters:[{name:"agent",description:"exact receiving agent and scoped-layer key."},{name:"name",description:"command name without a slash."}],returns:"the scoped shadow or global definition."},{signature:"@Remote async execute( agent: Agent, line: string, images: readonly EncodedImageAttachment[], signal: AbortSignal, ): Promise<CommandExecution | undefined>",description:"Parse and execute a known command without sending it to the model.\n\nA resolved command's lifecycle is logged: `command/run` is appended before the handler is invoked and `command/done` after settlement (a thrown or aborted handler settles as `kind: 'error'`). Both are direct log-only appends — no turn wraps them, and persistence drains them at ordinary checkpoints. Admission misses (syntax or unknown name) log nothing — they never entered a handler. A `command/run` append failure fails the execution loud; a `command/done` append failure on the handler-failure path is contained so the handler's own error stays the reported failure.\n\nImage admission is enforced here, not in the composer: images sent to a command that does not declare `input.images`, an absent attachment store, and an exceeded attachment limit each settle as an error result before the handler runs, and a rejected batch publishes no durable object.",parameters:[{name:"agent",description:"exact receiving agent."},{name:"line",description:"complete slash-command line."},{name:"images",description:"base64-encoded composer images accompanying the line, in submission order; empty for a plain invocation."},{name:"signal",description:"cancellation signal owned by the UI request."}],returns:"the settled execution (result + lifecycle pairing id), or `undefined` when syntax or name does not resolve."}]},{key:"compaction",summary:"Abstract compaction service.",description:"Abstract compaction service. Implementations own trigger policy, retention, and summarization, and may consume a separate measurement service. A successful run replaces the selected surface span with one summary node and prevents concurrent compaction of the same session. The replacement user message uses compactCheckpointSource with the transaction identity so consumers recognize and correlate it independently of the backend. Load one implementation per context as `ctx.compaction`.",methods:[{signature:"abstract compactIfNeeded( agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal, ): Promise<CompactionResult | null>",description:"Consider automatic compaction for one explicit trigger. Pressure policy uses the latest durable routed request, while context-overflow policy may force a useful balanced reduction even below the normal threshold. Return `null` when no safe range can be compacted. A single oversized retained unit or request envelope cannot be repaired through surface compaction.",parameters:[{name:"agent",description:"agent context owning the session surface and routing options."},{name:"trigger",description:"normal pressure or provider-confirmed context overflow."},{name:"signal",description:"cancellation signal; model-backed implementations must forward it."}],returns:"the compaction result, or `null` if no compaction was needed."},{signature:"abstract compactNow( agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId, ): Promise<CompactionResult | null>",description:"Explicitly compact useful history even below automatic pressure thresholds. Implementations synchronously start an idle task before any asynchronous work, select a useful range without writing on a no-op, then append a standalone `compaction/start` before summarization. That durable marker is the compaction lock until one `compaction/end` attempt. Later waking prompts remain accepted in FIFO order and start only after the optional durability checkpoint and idle-task settlement. Context injected while the summary runs may sit between the marker pair; only the selected span must remain stable.",parameters:[{name:"agent",description:"idle agent whose durable history should be compacted."},{name:"signal",description:"cancellation scoped to this compaction request."},{name:"sourceCommandId",description:"initiating command identity for a manual compaction."}],returns:"the compaction result, or `null` when no safe useful range exists.",throws:["{@link ManualCompactionError} for expected busy, agent-cancellation, changed-span, summarization/shrink, commit-stage, or persistence failures; an aborted request preserves its exact abort reason. Failed attempts remain visible in the log."]},{signature:"abstract compactRegion( start: number, end: number, agent: CompactionAgentContext, signal?: AbortSignal, ): Promise<CompactionResult>",description:"Forcibly compact a range of surface nodes into a single summary node. `start` and `end` name an inclusive span by surface position, not numeric seq order; replacements can make visible seqs non-monotonic. Both edges must be balanced so assistant tool calls remain paired with their results. A model- backed implementation forwards cancellation and rejects active, missing, reversed, or unbalanced ranges. The target session is `agent.session`. Its replacement user message must use compactCheckpointSource with the transaction's `CompactionId`. Use toolPairingBalancedBefore and toolPairingBalancedAfter for the edge checks.",parameters:[{name:"start",description:"first surface seq, inclusive."},{name:"end",description:"last surface seq, inclusive."},{name:"agent",description:"context whose session is mutated and whose routing options guide summarization."},{name:"signal",description:"optional cancellation; model-backed implementations must forward it."}],returns:"the appended event seqs, summary, replaced range, and token accounting.",throws:["when compaction is active or the range is missing, reversed, or unbalanced."]}]},{key:"credentials",summary:"Abstract credential service over two key spaces that answer two questions.",description:'Abstract credential service over two key spaces that answer two questions.\n\nA CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.\n\nA CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).',methods:[{signature:"abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>",description:"Resolve one reference to its current value. Resolution is per call: consumers re-resolve at each operation and must not cache across operations — that per-operation read is what makes a changed credential reach the next operation without a restart.",parameters:[{name:"ref",description:"the reference to resolve."}],returns:"the value and its source, or `undefined` while unconfigured."},{signature:"abstract describe(ref: CredentialRef): Promise<CredentialInfo>",description:"Describe one reference for configuration surfaces without exposing the value.",parameters:[{name:"ref",description:"the reference to describe."}],returns:"configured state, supplying source, and writability."},{signature:"abstract set(ref: CredentialRef, value: string): Promise<void>",description:"Durably store one value in the provider-managed writable source. Rejects while a read-only source shadows the reference — the write would appear to succeed while resolution keeps returning the shadowing value — and rejects an empty value (use unset).",parameters:[{name:"ref",description:"the reference to store."},{name:"value",description:"the non-empty secret value."}]},{signature:"abstract unset(ref: CredentialRef): Promise<void>",description:"Remove one reference from the provider-managed writable source; removing an absent reference is a no-op. Rejects while a read-only source shadows the reference, like set.",parameters:[{name:"ref",description:"the reference to remove."}]},{signature:"abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>",description:"Read one stored record. The value is returned as its owner wrote it; a GrantRecord payload is not interpreted on the way out.",parameters:[{name:"key",description:"the record to read."}],returns:"the record, or `undefined` while none is stored."},{signature:"abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>",description:"Describe one record for configuration surfaces without exposing its value.",parameters:[{name:"key",description:"the record to describe."}],returns:"presence, discriminant, and writability."},{signature:"abstract listRecords(): Promise<readonly CredentialRecordEntry[]>",description:"Enumerate every stored record's address and tag. Unlike the reference half, which has no enumeration because configuration surfaces learn which references exist from settings schemas, records have no such discovery path: a surface that cannot list them cannot show what a user is authorized for, nor find an orphan left by an uninstalled plugin.",parameters:[],returns:"every stored record, values excluded."},{signature:"abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>",description:"Serialized read-modify-write over one record — the only write path. `mutate` sees the record as it stands at the moment the write is exclusive, and returning `undefined` leaves the entry untouched. Exclusion holds across processes where the backing store supports it, which is what makes a token refresh safe: two processes rotating one refresh token concurrently would otherwise lose whichever wrote first.",parameters:[{name:"key",description:"the record to modify."},{name:"mutate",description:"receives the current record and returns its replacement, or `undefined` to leave it."}],returns:"the record after the write, or the current one when `mutate` declined."},{signature:"abstract deleteRecord(key: CredentialKey): Promise<void>",description:"Remove one record; removing an absent record is a no-op.",parameters:[{name:"key",description:"the record to remove."}]}]},{key:"directoryPicker",summary:"Abstract directory-picking service.",description:"Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.",methods:[{signature:"abstract capability(): DirectoryPickerCapability",description:"The backend's interaction capability.",parameters:[],returns:"the discriminated capability consumers switch on."}]},{key:"e2b",summary:"Creates one lazily consumable E2B SDK handle and deletes the sandbox at timeout or disposal.",description:"Creates one lazily consumable E2B SDK handle and deletes the sandbox at timeout or disposal. Creation begins at plugin construction; adapters await getSandbox before their first operation.",methods:[{signature:"readonly cwd: string",description:"Validated remote working directory shared by provider adapters.",parameters:[]},{signature:"readonly runtimeRoot: string",description:"Remote directory reserved for adapter-owned process and terminal state.",parameters:[]},{signature:"async getSandbox(): Promise<Sandbox>",description:"Return the shared live SDK handle.",parameters:[],returns:"the created sandbox after the configured cwd exists.",throws:["when E2B rejects creation or the service is disposing."]}]},{key:"fileReferences",summary:"Host capability for cancellable file-reference discovery.",description:"Host capability for cancellable file-reference discovery.",methods:[{signature:"abstract list( agent: Agent, query: string, signal: AbortSignal, ): Promise<FileReferenceCandidate[]>",description:"List file and directory candidates for one agent's working directory.",parameters:[{name:"agent",description:"target agent whose session cwd bounds discovery."},{name:"query",description:'path text following `@` or `@"`.'},{name:"signal",description:"caller cancellation."}],returns:"deterministic path-only candidates."},{signature:"@Remote('list') remoteExportList( agent: Agent, query: string, signal: AbortSignal, ): Promise<FileReferenceCandidate[]>",description:"Remote face of list; the decorator cannot mark the abstract member, so this concrete adapter carries the identical contract.",parameters:[{name:"agent",description:"target agent whose session cwd bounds discovery."},{name:"query",description:'path text following `@` or `@"`.'},{name:"signal",description:"caller cancellation."}],returns:"deterministic path-only candidates."}]},{key:"fs",summary:"Abstract filesystem provider.",description:"Abstract filesystem provider. Targets must preserve identity across aliases; reads expose regular UTF-8 text or typed errors, listings are stable and content-free, and mutations are atomic. Optional guards add stale protection without changing the unguarded provider contract.",methods:[{signature:"abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>",description:"Resolve a model/plugin-supplied path into a stable FsTarget. May perform I/O (a remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence async even though the local backend only normalizes + realpaths.",parameters:[{name:"path",description:"the path to resolve; relative paths resolve against `opts.cwd`."},{name:"opts",description:"optional cwd override and cancellation signal."}],returns:"the stable target; the same file yields the same `targetKey`."},{signature:"abstract processPath(target: FsTarget): string",description:"Return the canonical absolute path a subprocess in this filesystem's execution world can open. The path is deliberately separate from FsTarget.targetKey: consumers may pass this value to another OS capability, but must continue treating the target key as opaque.",parameters:[{name:"target",description:"the resolved target whose process path is required."}],returns:"an absolute path in the backend's execution world."},{signature:"abstract fileUrl(target: FsTarget): string",description:"Return the canonical `file:` URI for a target in this filesystem's execution world. Backends own URI encoding because the host platform may differ from the execution platform.",parameters:[{name:"target",description:"the resolved target to encode."}],returns:"the target's canonical file URI."},{signature:"abstract contains(parent: FsTarget, child: FsTarget): boolean",description:"Test canonical containment without exposing or parsing backend target keys. Both targets must come from this provider.",parameters:[{name:"parent",description:"canonical directory target."},{name:"child",description:"canonical candidate target."}],returns:"true when `child` is `parent` or a descendant of it."},{signature:"abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>",description:"Return target metadata, or `undefined` when the target does not exist.",parameters:[{name:"target",description:"the resolved target to stat."},{name:"signal",description:"aborts the metadata round-trip."}],returns:"metadata only, never content; undefined for an absent target."},{signature:"abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>",description:"Return path metadata without following the final path component when it is a symbolic link. This is intentionally path-shaped, not target-shaped: resolve follows symlinks to produce the stable identity used by normal reads/writes, while `lstat` lets a consumer reject the path itself before that follow happens.\n\n`opts.cwd` follows resolve's cwd rules. `undefined` means the path is absent.",parameters:[{name:"path",description:"the path to inspect; relative paths resolve against `opts.cwd`."},{name:"opts",description:"`cwd` overrides the backend's default base for relative paths."},{name:"signal",description:"aborts the metadata round-trip."}],returns:"metadata only, never content; undefined for an absent path."},{signature:"abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>",description:"Read the whole regular text file as a single decoded string.",parameters:[{name:"target",description:"the resolved target to read."},{name:"signal",description:"aborts the read."}],returns:"the full decoded UTF-8 content."},{signature:"abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>",description:"Stream the whole regular text file as decoded text chunks (same text semantics as readText, for large files). The backend owns cross-chunk UTF-8 decoding and binary rejection so the policy layer never touches raw bytes.",parameters:[{name:"target",description:"the resolved target to read."},{name:"signal",description:"aborts the stream, including between chunks."}],returns:"the chunk iterable, decoded and validated like {@link readText}."},{signature:"abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>",description:"Read the whole regular file as raw bytes with no decoding or binary rejection. The bound lives at this seam so a backend can never buffer an unbounded file: a target known or discovered to exceed `maxBytes` fails with `FS_TOO_LARGE` instead of returning a truncated result.",parameters:[{name:"target",description:"the resolved target to read."},{name:"signal",description:"aborts the read."},{name:"maxBytes",description:"inclusive byte cap on the complete content."}],returns:"the full raw content, at most `maxBytes` long."},{signature:"abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>",description:"List direct children of a directory in stable name order. Returns resolved child targets plus cheap metadata only; never reads file contents.",parameters:[{name:"target",description:"the resolved directory target."},{name:"signal",description:"aborts the listing."}],returns:"one entry per direct child, in stable name order."},{signature:"abstract writeText( target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsWriteOutcome>",description:"Atomically create or replace UTF-8 text. `expected` guards intent and staleness; omission allows unconditional overwrite.",parameters:[{name:"target",description:"the resolved target to write."},{name:"content",description:"the full new file content."},{name:"expected",description:"the write intent guarding the write; omit for unconditional."},{name:"signal",description:"aborts before atomic publication takes effect."},{name:"sandboxPolicy",description:"the per-call mode and workspace root this write runs under; a sandboxing backend fences the write by it, the bare backend ignores it. Omit to leave the backend its own default."}],returns:"the outcome, including the version the write produced."},{signature:"abstract editText( target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsEditOutcome>",description:"Atomically edit literal text. When supplied, the version guard is checked before matching so stale content reports `FS_STALE_VERSION`; omission edits the current content without a freshness precondition.",parameters:[{name:"target",description:"the resolved target to edit."},{name:"edit",description:"the literal search/replace request."},{name:"expected",description:"the version guard; omit for an unconditional edit."},{name:"signal",description:"aborts before atomic publication takes effect."},{name:"sandboxPolicy",description:"the per-call mode and workspace root this edit runs under; a sandboxing backend fences the edit by it, the bare backend ignores it. Omit to leave the backend its own default."}],returns:"the outcome, including the version the edit produced."}]},{key:"goals",summary:"Goal service (`ctx.goals`) backed exclusively by the owning session log.",description:"Goal service (`ctx.goals`) backed exclusively by the owning session log.",methods:[{signature:"get(agent: Agent): GoalView | undefined",description:"Read the current goal for one exact live agent.",parameters:[{name:"agent",description:"owning live agent."}],returns:"a fresh view or `undefined` when no goal is current.",throws:["{@link GoalError} when the agent is not the registry's live instance."]},{signature:"disarm(agent: Agent): GoalView | undefined",description:"Remove process-local continuation authority without changing durable goal phase or revision. Lifecycle owners use this before unloading a driver; a later human-authorized resume records the new activation edge.",parameters:[{name:"agent",description:"owning live agent."}],returns:"a fresh disarmed view, or `undefined` when no goal is current."},{signature:"create(agent: Agent, request: CreateGoalRequest): GoalView",description:"Create and arm a goal. A completed goal may be replaced; every other current phase must be cleared or resumed instead.",parameters:[{name:"agent",description:"owning live agent."},{name:"request",description:"objective and optional round cap."}],returns:"the created live view."},{signature:"@Remote('edit') edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView",description:"Edit objective and/or round cap without changing phase.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."},{name:"request",description:"at least one replacement field."}],returns:"the edited view."},{signature:"@Remote('pause') pause(agent: Agent, ref: GoalRef): GoalView",description:"Pause an active goal and disarm automatic continuation.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."}],returns:"the paused view."},{signature:"@Remote('resume') resume(agent: Agent, ref: GoalRef): GoalView",description:"Resume and arm a stopped goal, or rearm an active goal after a session-start edge, while its round budget still has capacity.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."}],returns:"the active view."},{signature:"@Remote('complete') complete(agent: Agent, ref: GoalRef): GoalView",description:"Mark a current non-complete goal complete and disarm it.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."}],returns:"the completed view."},{signature:"block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView",description:"Mark an active goal blocked and disarm it.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."},{name:"reason",description:"policy-owned stable code and human-readable explanation."}],returns:"the blocked view with its durable reason."},{signature:"@Remote('clear') clear(agent: Agent, ref: GoalRef): GoalRef",description:"Clear the current goal while retaining a durable tombstone and history.",parameters:[{name:"agent",description:"owning live agent."},{name:"ref",description:"expected current revision."}],returns:"the tombstone ref whose revision is one past the cleared snapshot."},{signature:"@Remote('create') remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult",description:"Create one Goal through the remote boundary.",parameters:[{name:"agent",description:"exact live Agent resolved from the wire identity."},{name:"request",description:"objective and optional round cap."}],returns:"the created Goal identity."}]},{key:"invariants",summary:"Package-owned invariant registry with global and regex-based selection.",description:"Package-owned invariant registry with global and regex-based selection.",methods:[{signature:"register(packageName: string, installer: InvariantInstaller): () => void",description:"Register one package's invariant installer. The package name is reserved even when filtering disables its checks. Enabled installers run in a child fiber; failure disposes that fiber and releases the reservation.",parameters:[{name:"packageName",description:"full npm package name that owns the contribution."},{name:"installer",description:"listener or startup-check installer for the child context."}],returns:"an effect-scoped disposer for the registration."}]},{key:"jobs",summary:"Abstract background job registry.",description:`Abstract background job registry. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as \`ctx.jobs\` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Registrations outlive producer and controller fibers. Owner and service disposal cancel live work and await compliant producers; a throwing teardown cancel force-fails only the record. Teardown cancellation also marks the record reported, because a record its owner is being destroyed for has no reader left.
- Owned-job access is fenced by the owner's session id. Ids are predictable, so authorization — not secrecy — is the boundary.
- Settlement is first-wins: one terminal record, released waiters, and one round of contained listener notification, even against a late producer outcome. Completion is announced last, after the record is committed and every other observer of the settlement has seen it, because a reporter may open a model turn synchronously.
- start refuses work while no attached job controller serves the spec's owner, so a producer cannot start work that owner cannot collect or stop. One registry serves every composition in the process, so this question — and completion-listener delivery — is owner-relative rather than process-wide: registrations made from an unscoped context serve every owner, and registrations made under an agent composition's scope serve exactly the agents composed under it.`,methods:[{signature:"abstract start(spec: JobStart): JobId",description:"Preflight access, validation, owner cleanup, and implementation-owned admission before starting and atomically registering work. Any preflight rejection leaves no job id or execution resource. A throwing starter leaves nothing registered; after it returns, registration cannot fail. Settlement records the outcome, notifies listeners, and releases waiters.",parameters:[{name:"spec",description:"job identity, owner, and synchronous starter."}],returns:"the registry-issued `<kind>-N` id."},{signature:"abstract list(caller?: Agent): JobSnapshot[]",description:"List caller-owned and unowned jobs in registration order without exposing another session's labels.",parameters:[{name:"caller",description:"reading agent; a non-agent caller sees only unowned jobs."}],returns:"fresh snapshots."},{signature:"abstract get(id: JobId, caller?: Agent): JobSnapshot",description:"Return a non-consuming snapshot without changing its read cursor or notice state. Throws for an unknown or foreign job.",parameters:[{name:"id",description:"job to look up."},{name:"caller",description:"reading agent checked against the owner."}],returns:"a fresh snapshot."},{signature:"abstract read(id: JobId, caller?: Agent): JobRead",description:"Read the next stream delta, or the idempotent final output after settlement. A terminal read marks the job reported. Throws for an unknown or foreign job.",parameters:[{name:"id",description:"job to read."},{name:"caller",description:"reading agent checked against the owner."}],returns:"output text and the post-read snapshot."},{signature:"abstract kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished'",description:"Request cancellation, then mark the job stopping and reported. A producer throw propagates without changing job state. Throws for an unknown or foreign job.",parameters:[{name:"id",description:"job to cancel."},{name:"caller",description:"killing agent checked against the owner."},{name:"reason",description:"logged reason forwarded to the producer."}],returns:"`requested` for live work, otherwise `already-finished`."},{signature:"abstract wait(id: JobId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<JobSnapshot>",description:"Wait for settlement or timeout without cancelling the job. Caller abort rejects only while the job is live; after settlement the terminal snapshot wins so a notice suppressed for this waiter is still delivered. Throws for invalid, unknown, or foreign input.",parameters:[{name:"id",description:"job to wait for."},{name:"timeoutMs",description:"positive finite wait bound in milliseconds."},{name:"caller",description:"waiting agent checked against the owner."},{name:"signal",description:"optional cancellation of the wait itself."}],returns:"snapshot at settlement or timeout."},{signature:"abstract onJobDone(listener: JobDoneListener): () => void",description:"Register an effect-scoped completion listener. It receives the settlements of the owners its registering context's scope covers; each listener is contained; returned promises are observed but not awaited. No listener runs after service disposal.",parameters:[{name:"listener",description:"receives each terminal snapshot and its exact owner."}],returns:"disposer that unregisters the listener."},{signature:"abstract onJobsChanged(listener: JobsChangedListener): () => void",description:`/** Register an effect-scoped observer of visible-set changes. It fires after every commit that changes what list returns for that owner — registration, every stopping transition (including the one teardown performs before it awaits a slow producer), settlement, owner-disposal removal, and the emptying that service disposal commits — so an observer re-reads rather than accumulating deltas.

Delivery is owner-relative on the same terms as onJobDone: an observer registered from an unscoped context — a host composition's own carrier — sees every owner, while one registered under an agent composition's scope sees exactly the agents composed under it.

This is not a superset of onJobDone: that one delivers the terminal record under first-wins semantics a job controller couples to notice delivery, while this one carries no delivery meaning and marks nothing reported. Listeners are contained and never awaited.`,parameters:[{name:"listener",description:"receives the owner whose visible set changed, or `undefined` when an unowned job changed and every caller's set did."}],returns:"disposer that unregisters the listener."},{signature:"abstract attachController(name: string): () => void",description:"Attach an effect-scoped controller that can read and stop jobs. It serves the owners its registering context's scope covers, and start refuses an owner no attached controller serves.",parameters:[{name:"name",description:"diagnostic label; duplicate names remain independent."}],returns:"disposer that detaches this controller."}]},{key:"llm",summary:"The abstract `llm` service: an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall.",description:"The abstract `llm` service: an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall.",methods:[{signature:"registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle",description:"Register an adapter for the given provider routes. Throws `LlmError` with code `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing). Disposed with the fiber.",parameters:[{name:"providers",description:"every provider route this adapter should serve."},{name:"adapter",description:"the adapter that streams calls for those providers."}],returns:"the disposer, carrying {@link AdapterRegistrationHandle.replace}."},{signature:"listProviders(): LlmProviderInfo[]",description:"Describe provider routes with a registered adapter.",parameters:[],returns:"detached provider metadata in registration order."},{signature:"registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle",description:"Declare provider routes an adapter plugin can activate through configuration. Registration is all-or-nothing: an empty list, invalid entry, or a provider already declared by any registration throws `LlmError` without registering the rest. Disposed with the fiber.",parameters:[{name:"entries",description:"every configurable provider this plugin owns."}],returns:"a handle that withdraws all of them, and can atomically replace them."},{signature:"listConfigurableProviders(): LlmConfigurableProvider[]",description:"List every declared configurable provider, registered or dormant.",parameters:[],returns:"detached directory entries in declaration order."},{signature:"registerModelDiscovery( settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>, ): () => void",description:"Offer to interrogate provider endpoints on behalf of the settings namespace this plugin owns. The namespace is the key because that is what a configuration surface already holds from the configurable-provider directory, and because a provider being *added* has no route to name yet. Disposed with the fiber.",parameters:[{name:"settingsNs",description:"the namespace whose profiles this discovery serves."},{name:"discover",description:"interrogates one endpoint; must honor `request.signal`."}],returns:"the disposer that withdraws the offer."},{signature:"async discoverModels( settingsNs: string, request: LlmModelDiscoveryRequest, ): Promise<LlmDiscoveredModel[]>",description:"Interrogate one provider endpoint for the models it advertises. The request describes a draft, not a stored route, so nothing here reads or writes settings or credentials — the caller owns both, and the reply is candidate metadata a surface may offer for adoption.",parameters:[{name:"settingsNs",description:"namespace whose registered discovery serves this draft."},{name:"request",description:"the endpoint, protocol, and one-shot credential to use."}],returns:"the advertised models, deduplicated in endpoint order."},{signature:"providerRetryPolicy(provider: string): ResolvedRetryPolicy",description:"Resolve the retry policy captured when one provider route was registered.",parameters:[{name:"provider",description:"registered provider route to inspect."}],returns:"the provider-owned policy, with normal defaults already resolved."},{signature:"async listModels(provider: string): Promise<LlmModelInfo[]>",description:"Discover models advertised by one registered provider. Catalog membership is advisory and never changes routing or request validation.",parameters:[{name:"provider",description:"registered provider route to inspect."}],returns:"detached model metadata in adapter-preferred order."},{signature:"async resolveModelInfo( provider: string, model: string, signal?: AbortSignal, ): Promise<LlmResolvedModelInfo>",description:"Resolve and validate all metadata from the adapter that owns one exact route. The result is detached from adapter-owned objects; catalog membership remains advisory and does not control request routing.",parameters:[{name:"provider",description:"registered provider route to inspect."},{name:"model",description:"exact model id passed to the adapter."},{name:"signal",description:"optional cancellation for adapter-owned asynchronous lookup."}],returns:"exact model identity plus available context and reasoning metadata."},{signature:"async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>",description:"Validate a conversation call config against its exact model capability and materialize adapter-configured defaults. Unsupported explicit efforts reject before provider I/O; no clamping or aliasing is performed. This standalone query does not bind a later dispatch; use prepareCall when logging and streaming must share one adapter registration.",parameters:[{name:"config",description:"provider/model route and optional request controls."},{name:"signal",description:"optional cancellation for adapter-owned capability lookup."}],returns:"a detached config only when a default must be materialized."},{signature:"async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>",description:"Resolve one call under its current adapter registration. The returned one-shot handle keeps that registration across header logging and dispatch, so HMR cannot combine one adapter's capability result with another adapter.",parameters:[{name:"config",description:"provider/model route and optional request controls."},{name:"signal",description:"optional cancellation for adapter-owned capability lookup."}],returns:"a prepared config and its registration-bound stream entry point."},{signature:"stream(options: GenerateOptions): AsyncIterable<StreamChunk>",description:"Stream one model call as raw chunks (token-level deltas). Replay state is retained only when the same adapter instance owns its historical provider and the target provider. Final adapter selection remains fixed through asynchronous exact-model resolution and dispatch. Adapter selection, dispatch, and iteration failures become terminal `error` or `aborted` finish chunks; middleware, nested-call, cleanup, and consumer failures remain thrown.",parameters:[{name:"options",description:"the full request; `options.provider` selects the adapter."}],returns:"the chunk stream, possibly wrapped by `llm/stream` listeners."}]},{key:"lsp",summary:"The LSP capability seam (`ctx.lsp`).",description:"The LSP capability seam (`ctx.lsp`). Owns provider registration/selection and normalized query execution; exposes exactly the four operations and no protocol escape hatch.",methods:[{signature:"registerProvider(provider: LspProvider): () => void",description:"Register a provider, atomically reserving its id and every normalized extension. Any conflict or invalid input publishes nothing and throws `LspError`; the returned disposer releases all reservations. Disposed with the calling fiber.",parameters:[{name:"provider",description:"the backend to register."}],returns:"a synchronous disposer releasing the id and all extension reservations."},{signature:"query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>",description:"Select a provider by the file's extension and run one query. Selection is per-query and order-independent; no match throws `LspError` `LSP_UNAVAILABLE`.",parameters:[{name:"request",description:"the normalized query."},{name:"signal",description:"optional cancellation forwarded to the selected provider."}],returns:"the normalized, closed-union result."}]},{key:"messageFeedback",summary:"Storage-domain sidecar service.",description:"Storage-domain sidecar service. It inspects persisted Session history and never creates or resumes an Agent or Session.",methods:[{signature:"@Remote('list') async list(request: MessageFeedbackListRequest): Promise<MessageFeedbackListResult>",description:"Read feedback belonging to the current persisted Session lifecycle. A stale row from a reused Session id is invisible.",parameters:[{name:"request",description:"Session identity to inspect and list."}],returns:"current immutable items or `session-not-found`."},{signature:"@Remote('put') put(request: MessageFeedbackPutRequest): Promise<MessageFeedbackPutResult>",description:"Create or replace feedback for one derived append-origin assistant message. Every request must match the addressed item's current version; a matching no-op returns the stored item without changing its revision.",parameters:[{name:"request",description:"target, desired value, and observed item version."}],returns:"the committed item or an explicit business failure."},{signature:"@Remote('delete') delete(request: MessageFeedbackDeleteRequest): Promise<MessageFeedbackDeleteResult>",description:"Delete one feedback item. Absence is successful regardless of the supplied version; an existing item requires an exact version match.",parameters:[{name:"request",description:"Session, message, and observed item version."}],returns:"the stable absent postcondition, or an explicit failure."}]},{key:"permissionPresets",summary:"Owns the deployment's permission presets and their write path.",description:"Owns the deployment's permission presets and their write path. Requires a confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are reported as CUSTOM_PRESET, not an error.",methods:[{signature:"current(events: readonly SessionEvent[]): string",description:"Resolve the preset matching the effective knob values. A still-matching last selection wins shared-bundle ties; otherwise the first table match wins, or CUSTOM_PRESET when no entry matches.",parameters:[{name:"events",description:"the session's events in log order."}],returns:"the effective preset name, or `custom` when nothing matches."},{signature:"selectFor(state: KnobState): PermissionSelect",description:"Build the whole select value for one folded knob state: every table option in declaration order, `custom` appended exactly while derived.",parameters:[{name:"state",description:"the folded knob overrides."}],returns:"the `permissions` projection payload."},{signature:"resolve(name: string): PresetSpec",description:"Resolve a preset's knob bundle.",parameters:[{name:"name",description:"the preset name to resolve."}],returns:"the configured bundle.",throws:["when `name` is not in the table."]},{signature:"optionOf(name: string): PresetOption",description:"Build the client option for a table entry or CUSTOM_PRESET. A missing label falls back to the table key.",parameters:[{name:"name",description:"a table key, or `custom`."}],returns:"the option a client renders.",throws:["when `name` is neither a table key nor `custom`."]},{signature:"set(session: Session, name: string): void",description:"Record a changed preset, then update each changed knob through its own setter. Selecting the effective preset again appends nothing.",parameters:[{name:"session",description:"the session the switch belongs to."},{name:"name",description:"the preset to switch to; unknown names throw."}]}]},{key:"planMode",summary:"`ctx.planMode`: owns logged plan state, applies and narrates selected state at step start, the `plan:policy` section, the `/plan` command, and the stable exit tool.",description:"`ctx.planMode`: owns logged plan state, applies and narrates selected state at step start, the `plan:policy` section, the `/plan` command, and the stable exit tool. UIs observe committed flips through `session/event`; there is no live mirror.",methods:[{signature:"get(agent: Agent): { active: boolean; pending?: boolean }",description:"Read the logged plan state and any selected state awaiting the next accepted in-turn pre-step.",parameters:[{name:"agent",description:"The agent to read."}],returns:"Current logged state plus a pending selection, when present."},{signature:"set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'",description:"Select whether plan mode should be active. Between turns the method appends the change immediately because no in-turn pre-step will run until another prompt starts a turn. The open-turn fold is the idle signal: agent status stays `running` through post-turn checkpointing, when no further in-turn pre-step runs. During an open turn the selection remains pending until the next accepted in-turn pre-step. Repeated selection of the current or already-pending state is a no-op.",parameters:[{name:"agent",description:"The agent to switch."},{name:"active",description:"Whether plan mode should be active."}],returns:"what happened: `committed` (logged now), `queued` (awaiting the next accepted in-turn pre-step), `cancelled` (an opposite pending selection was cleared; the logged state already matches), or `noop` (already in that state)."}]},{key:"sandbox",summary:"Abstract process-sandbox service.",description:"Abstract process-sandbox service. confine must return enforcing argv or fail closed at wrap or runner-execution time; silent unconfined passthrough is forbidden. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.",methods:[{signature:"abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv",description:"Wrap `argv` so it executes confined under `policy` on this host; the caller spawns the returned argv in place of its own.",parameters:[{name:"argv",description:"the exact argv the caller is about to spawn (program plus arguments), NOT a shell string — a shell-shaped consumer passes `['bash', '-c', command]`."},{name:"policy",description:"the file-effect policy this execution runs under, carried per call (see {@link SandboxPolicy})."}],returns:"the argv to spawn instead, plus the enforcement completeness the selected backend achieves for it."}]},{key:"sandboxPolicy",summary:"The sandbox-policy service (`ctx.sandboxPolicy`).",description:"The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment default mode, fallback workspace root, and current request-time policy section. Tool layers call resolve for each execution so a session's mode log and immutable cwd travel together to every enforcing capability.",methods:[{signature:"readonly defaultMode: SandboxMode",description:"The deployment default mode — the fallback beneath a session override.",parameters:[]},{signature:"readonly workspaceRoot: string",description:"The absolute `workspace-write` fallback root for calls without a session cwd.",parameters:[]},{signature:"resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy",description:"Resolve the complete policy for one capability call. An approved explicit mode outranks the session's last `sandbox/mode` event, which outranks the deployment default. A session cwd is its workspace-write boundary; the configured root is the fallback for agentless calls and sessions without a cwd.",parameters:[{name:"request",description:"optional session and approved mode override."}],returns:"the fully resolved per-call mode and absolute workspace root."},{signature:"overrideOf(session: Session): SandboxMode | undefined",description:"Read the session override without applying the deployment default.",parameters:[{name:"session",description:"session whose log supplies the override."}],returns:"the last logged mode, or `undefined` without one."}]},{key:"sessionPersistence",summary:"Durable append-only session storage.",description:"Durable append-only session storage. Implementations preserve contiguous, losslessly JSON-serializable events; append resolves only after durability, and load balances a complete interrupted tail without rewriting committed events.",methods:[{signature:"abstract locate(meta: SessionHeader): SessionLocation | undefined",description:"Resolve this backend's independent local artifact for a session without reading, creating, flushing, or otherwise materializing it. Backends such as SQLite that do not own one artifact per session return `undefined`.",parameters:[{name:"meta",description:"the immutable session header whose artifact is requested."}],returns:"the backend-specific absolute location, when one exists."},{signature:"abstract readonly supportsRawArtifacts: boolean",description:"Whether this backend exposes one verbatim raw artifact per session. A backend that declares `true` must override readRaw.",parameters:[]},{signature:"readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>",description:"Read a session's backend-owned artifact text verbatim — the exact durable bytes the backend wrote (decoded from its physical encoding, e.g. a decompressed JSONL). The returned `content` is the raw text, not a reconstruction from parsed events, so it preserves backend-specific serialization (chunk packing, key order, line breaks). Callers first test supportsRawArtifacts; `undefined` then means only that the requested session has no materialized artifact.",parameters:[{name:"_id",description:"the persisted session to read (unused by the default: no per-session artifact)."},{name:"signal",description:"optional cancellation for backend read work."}],returns:"the raw artifact plus its parsed header, or `undefined` when the session is absent.",throws:["when this backend does not expose per-session raw artifacts."]},{signature:"abstract create(meta: SessionHeader): Promise<void>",description:"Register a new session's metadata. A backend MAY defer the physical write until the first append (lazy materialization), in which case a created-but-never-appended session is absent from list — abandoned sessions leave nothing behind.",parameters:[{name:"meta",description:"the immutable header (id, version, cwd, lineage) to record."}]},{signature:"abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>",description:"Durably persist a batch of events. Honors the append-only and contiguous- seq contracts: the first event's `seq` MUST equal the stored next-seq (after `load` has durably closed any interrupted turn). Rejects non-JSON- serializable `event.data` with an error naming the offending event type.",parameters:[{name:"id",description:"the session the batch belongs to."},{name:"events",description:"the contiguous batch to persist, in seq order."}]},{signature:"async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>",description:"Prepare the exact unpublished Session used by resume. Implementations may reuse object graphs retained by an earlier inspect after confirming their durable revision is still current; disposal releases an unpublished reservation. Revision retries require the durable log to remain unchanged for one read/check round trip; continuous external writers may delay completion.",parameters:[{name:"id",description:"persisted session to prepare."},{name:"signal",description:"optional cancellation for preparation work."}],returns:"one owned unpublished Session preparation."},{signature:"abstract load(id: SessionId): Promise<SessionInspection>",description:"Load an immutable balanced logical view and commit any required cold recovery. A complete interrupted final turn is preserved and durably closed with missing tool errors plus any open step and turn boundaries; only a torn final record is discarded. Unknown versions and corruption in the committed prefix reject. Implementations MUST NOT crash-repair an identity still bound to a live Session: a balanced live log may return as a durable snapshot, while an open live turn rejects. Returned values may be shared with immutable live or prepared state and must not be mutated. Revision-based implementations may wait for one stable read/check round trip.",parameters:[{name:"id",description:"the persisted session to reload."}],returns:"the header and a log ending on a balanced `turn/end`."},{signature:"abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>",description:"Inspect an immutable logical session without committing recovery or publishing it. A cold complete interrupted turn receives synthetic closers in memory and a torn physical tail remains untouched. An already-live Session instead yields its current immutable snapshot, which may contain an open turn and its `session/end-seed` boundary. Coordinator-backed implementations retain the exact cold unpublished Session for bounded reuse by a later prepare. A stale ready source is reloaded; a source already committing or reserved for resume remains exclusive, and inspection may borrow its immutable view. Callers borrow only the immutable header and log. Continuous external writers may delay revision convergence.",parameters:[{name:"id",description:"the persisted session to inspect."},{name:"signal",description:"optional cancellation for queued and backend read work."}],returns:"the validated header and current logical event log."},{signature:"abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>",description:"Read the stored events from `fromSeq` onward — the read-from-seq primitive for read models that resume from a watermark (e.g. a persisted projection cache folding only the tail past its checkpoint). Unlike inspect, it is a detached physical suffix read: no preparation cache, torn-tail truncation, synthetic closers, or coordinator-state publication. Only events from the valid contiguous stored prefix are returned, so a torn fragment never reaches the caller. `fromSeq` at or beyond the stored prefix returns an empty event list (never an error). Backends whose medium can seek by seq (SQLite) read only the suffix; sequential media (JSONL, both encodings) still parse the whole artifact and skip forward — the primitive bounds what is RETURNED and refolded, not every backend's physical read.",parameters:[{name:"id",description:"the persisted session to read."},{name:"fromSeq",description:"first event seq to include; a non-negative safe integer."},{name:"signal",description:"optional cancellation for queued and backend read work."}],returns:"the header and the stored events with `seq >= fromSeq`."},{signature:"abstract list(signal?: AbortSignal): Promise<SessionHeader[]>",description:"Lightweight listing from metadata, without a full-log parse.",parameters:[{name:"signal",description:"optional cancellation for backend listing work."}],returns:"one header per materialized session."},{signature:"abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>",description:`List materialized sessions with cheap per-log change tokens.

Repeated observations of an unchanged log return the same revision. A successful mutating load repair changes the next listed revision. Revisions also distinguish independently backed stores so backend-local counters cannot compare equal across different persistence sources.`,parameters:[{name:"signal",description:"optional cancellation for backend snapshot-listing work."}],returns:"one header and opaque revision per materialized session without loading full logs."}]},{key:"sessionProjectionCache",summary:"The persisted projection cache service.",description:"The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus two mandatory points — `turn/end` and session disposal (the live-to-cold moment) — and serves the cold-read ladder: cached row, persistence `readFrom` tail, registry `restore`, durable write-back. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write or cold read.",methods:[{signature:"cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined",description:"The zero-I/O listing read: whole values viewed straight from the stored rows (version-matching keys only), each cut carried with its watermark so a client value store can seed under its higher-seq-wins rule — as stale as the last durable checkpoint but never wrong, and never from an unrelated log (the caller's header is the identity witness). Fresher paths (the history tail baseline, coldSnapshot) supersede these values whenever a session is actually opened.",parameters:[{name:"meta",description:"the listed session's header (identity witness; no log read)."}],returns:"the cut (`asOfSeq` = lowest served-row watermark), or `undefined` when no usable row exists for this lifecycle."},{signature:"async write(session: Session): Promise<void>",description:"Durably checkpoint one live session NOW (both mandatory points call this; tests and carriers may too). The registry cut is snapshotted at this boundary (states are live references), then the whole record is replaced. NOT fail-soft — callers on the fail-soft paths contain it.",parameters:[{name:"session",description:"the live session to checkpoint."}],returns:"resolution after durability and event emission."},{signature:"async coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot>",description:"Cold-read one persisted session's projections with zero full-log load: cached rows + a persistence `readFrom` tail from the registry's restore floor, refolded by the registry and written back (fail-soft) so the next cold read starts closer. A cache row invalidated by a shrunk log (crash-repair truncation) triggers one full re-read from seq 0 — the ladder's slow rung, still no crash. Rejects when the session has no persisted log (`not found` from the persistence seam).",parameters:[{name:"id",description:"the persisted session to read."},{name:"signal",description:"optional cancellation for the persistence reads."}],returns:"the snapshot cut at the stored log end."}]},{key:"sessionProjections",summary:"`ctx.sessionProjections`: the projection unit table and its drive.",description:"`ctx.sessionProjections`: the projection unit table and its drive. The service subscribes to `session/event` once; every committed event passes every registered unit's `apply` (eager drive), and a changed state reference in a client-visible unit notifies the change feed with the schema-validated view. Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch (event or read). Registration is an effect (disposer rides the calling fiber): an unloaded domain plugin's key disappears from snapshots and clients read it as capability absence. Domain plugins register under `ctx.inject(['sessionProjections'], …)` so headless assemblies without the registry stay unaffected. Registrants sharing a key share one unit and are counted: the same tool package mounted in N agent presets registers N times, and the key survives until the last one unloads.",methods:[{signature:"register< K extends keyof SessionProjectionMap, S extends SessionProjectionStateMap[K], >( definition: Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: NonNullable<ProjectionDefinition<K, S>['wire']> }, ): () => void",description:"Register one domain's unit. The registration is an effect on the calling context's fiber: disposing the fiber (or calling the returned disposer) removes the key — and the unit's cached cells — from subsequent drives and snapshots.",parameters:[{name:"definition",description:"key, state schema, pure unit functions, and stateVersion."}],returns:"the exact disposer that unregisters this unit."},{signature:"register< K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>, S extends SessionProjectionStateMap[K], >( definition: Omit<ProjectionDefinition<K, S>, 'wire'>, ): () => void",description:"Register one host-only unit. Its state is omitted from client snapshots and always checkpointed like every other unit.",parameters:[{name:"definition",description:"key, state schema, pure unit functions, and stateVersion."}],returns:"the exact disposer that unregisters this unit."},{signature:"onChanged(listener: ProjectionChangeListener): () => void",description:"Subscribe to the change feed. The registration is an effect on the calling context's fiber.",parameters:[{name:"listener",description:"called once per client-visible unit whose state reference changed, per committed event."}],returns:"the exact disposer that unsubscribes."},{signature:"stateOf<K extends keyof SessionProjectionStateMap>( session: Session, key: K, ): SessionProjectionStateMap[K] | undefined",description:"Read one unit's current host state without computing unrelated views. The returned value is live; callers must not mutate it.",parameters:[{name:"session",description:"the session whose state is read."},{name:"key",description:"the registered unit key."}],returns:"current state, or `undefined` when the key is not registered."},{signature:"snapshot(session: Session): ProjectionSnapshot",description:"One consistent cut over every registered client-visible unit for one session, read from the watermark cache (missing cells fold lazily over the in-memory log). Fully synchronous — every value and `asOfSeq` reflect the same log position. Each value passes its unit's `viewSchema` before leaving.",parameters:[{name:"session",description:"the session whose projection values are read."}],returns:"the snapshot; `values` is empty when no client-visible unit is registered."},{signature:"checkpoint(session: Session): ProjectionCheckpoint",description:"State-level checkpoint of every persisted unit for one session, read from the watermark cache (missing cells fold lazily over the in-memory log). This is the write side of the persisted projection cache: the returned rows are the `(key → {ver, seq, val})` part of the durable `(sessionId, key, ver, seq, val)` rows. Every `val` is a DETACHED structured clone — never the live cell reference: the watermark cache is this registry's authoritative mutable state, and a caller reaching the live reference could corrupt every subsequent snapshot and frame through it (plain JSON by the unit contract, so the clone is total).",parameters:[{name:"session",description:"the session whose unit states are checkpointed."}],returns:"one row per registered key."},{signature:"restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined",description:"The stored seq a restore tail read over `checkpoint` must start at: one event BELOW the lowest usable watermark (a row is usable when its `ver` matches the live unit's `stateVersion`; an absent or mismatched row pulls the floor to `0` — that key must refold the full log). The one-below anchor is load-bearing: the tail then proves how far the stored log still extends, so restore can detect a log that shrank below a row's watermark (crash-repair truncation) instead of serving the stale row as current — an empty tail read from the anchor yields an end below every watermark and the restore rejects for a full re-read.",parameters:[{name:"checkpoint",description:"persisted rows for one session (possibly stale or empty)."}],returns:"the seq to hand the persistence `readFrom`, or `undefined` when no unit is registered (no read needed — {@link restore} would serve empty values regardless)."},{signature:"viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap>",description:"View a checkpoint's rows without any log read: for every registered client-visible unit whose row's `ver` matches, serve the schema-validated `view` of the schema-validated stored state; mismatched, malformed, or absent rows leave their key absent (a cold or listing consumer treats it as not-yet-available and a fuller read path refolds it). The zero-I/O rung of the read ladder — values are as stale as their rows, never wrong.",parameters:[{name:"checkpoint",description:"persisted rows for one session (possibly stale or empty)."}],returns:"whole values per key with a usable row; empty when none."},{signature:"restore( checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number, ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }",description:"Cold read: fold every persisted unit over a stored log suffix, seeding each from its checkpoint row when usable — the one read recipe (cached state + forward tail replay + `view`) applied without a live `Session`. Call with the events returned by a persistence `readFrom(id, restoreFloor(checkpoint))` and that same floor as `baseSeq`; the floor's one-below anchor makes the supplied end honest, so a shrunk log is detected here. A row is usable iff its `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq` (`seq >= baseSeq - 1`), and it does not claim events past the supplied end (`seq <= endSeq`); an unusable row is discarded and its key refolds from `init` — which is only sound over the full log, so a discarded row with `baseSeq > 0` throws (the caller re-reads from seq 0, e.g. after a crash-repair truncation shrank the log below a row's watermark).",parameters:[{name:"checkpoint",description:"persisted rows for one session (possibly stale or empty)."},{name:"events",description:"the stored events with `seq >= baseSeq`, in seq order."},{name:"baseSeq",description:"the seq `events` starts at (its first event's seq when non-empty)."}],returns:"the snapshot cut at the supplied log end (`asOfSeq` is the last supplied event's seq, `baseSeq - 1` for an empty tail) plus the refreshed checkpoint rows at that cut, ready for a durable write-back."}]},{key:"sessionQuery",summary:"Unified live-preferred session query service.",description:"Unified live-preferred session query service.\n\nExact reads, filters, and traces are backend-independent concrete behavior. A backend implements full-text observation, reconciliation, ranking, cursor generations, and query execution on the same `ctx.sessionQuery` service.",methods:[{signature:"abstract searchSessions( request: SessionSearchRequest, exec?: SessionSearchExecContext, ): Promise<SessionSearchPage<SessionSearchHit>>",description:"Search the live-preferred logical corpus and group by session.",parameters:[{name:"request",description:"query text, metadata filters, page size, and cursor."},{name:"exec",description:"optional cancellation control."}],returns:"session hits ranked by their strongest matching event."},{signature:"abstract searchEvents( request: SessionEventSearchRequest, exec?: SessionSearchExecContext, ): Promise<SessionEventSearchPage>",description:"Search events within one live-preferred logical session.",parameters:[{name:"request",description:"target session, query text, filters, page size, and cursor."},{name:"exec",description:"optional cancellation control."}],returns:"matching event hits and their target header from one indexed generation."},{signature:"listSessions(signal?: AbortSignal): Promise<SessionRecord[]>",description:"List the complete logical corpus using live-preferred records.",parameters:[{name:"signal",description:"optional cancellation for persistence listing."}],returns:"deterministic newest-first cloned session records."},{signature:"async readSession(sessionId: SessionId): Promise<SessionLogSnapshot>",description:"Read and replay-validate one complete logical session log without making it live.",parameters:[{name:"sessionId",description:"live or persisted session id to read."}],returns:"cloned header and complete raw event log from one observation.",throws:["when persistence, header compatibility, or replay validation fails."]},{signature:"async filterSessions( filters: readonly SessionResultFilter[], signal?: AbortSignal, ): Promise<SessionRecord[]>",description:"Filter the complete logical corpus with provider-independent predicates.",parameters:[{name:"filters",description:"ANDed session metadata and availability clauses."},{name:"signal",description:"optional cancellation for persistence listing."}],returns:"matching cloned records in deterministic newest-first order."},{signature:"async readTitle( sessionId: SessionId, signal?: AbortSignal, ): Promise<SessionTitleSnapshot | undefined>",description:"Fold the latest log-backed title from one live-preferred logical session.",parameters:[{name:"sessionId",description:"live or persisted session id to read."},{name:"signal",description:"optional cancellation for source resolution and title folding."}],returns:"latest title snapshot, or `undefined` when the log has no title event."},{signature:"async readTitleSnapshot( sessionId: SessionId, signal?: AbortSignal, ): Promise<SessionTitleObservation>",description:"Fold the latest title and return its source header from one corpus observation.",parameters:[{name:"sessionId",description:"live or persisted session id to read."},{name:"signal",description:"optional cancellation for source resolution and title folding."}],returns:"cloned source header and optional latest title snapshot."},{signature:"async readTitleSnapshots( sessionIds: readonly SessionId[], signal?: AbortSignal, ): Promise<SessionTitleObservationResult[]>",description:`Fold titles for unique sessions from one cancellable corpus observation.

Results preserve first-occurrence input order. Operational failures stay isolated per session, while cancellation rejects the complete operation.`,parameters:[{name:"sessionIds",description:"live or persisted session ids to observe."},{name:"signal",description:"optional cancellation shared by all source reads."}],returns:"one fulfilled or rejected result per unique requested id."},{signature:"async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>",description:"List lightweight raw-log event records for one logical session.",parameters:[{name:"sessionId",description:"live-preferred session id to read."}],returns:"event records in ascending seq order."},{signature:"async filterEvents( sessionId: SessionId, filters: readonly SessionEventResultFilter[], ): Promise<SessionEventSearchDocument[]>",description:"Scan first-party semantic event documents with provider-independent filters.",parameters:[{name:"sessionId",description:"live-preferred session id to scan."},{name:"filters",description:"ANDed metadata and literal-text predicates."}],returns:"matching semantic documents in ascending seq order."},{signature:"async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>",description:"Read one session's complete current model surface from one corpus observation.",parameters:[{name:"sessionId",description:"live-preferred session id to read."}],returns:"cloned header, current surface, and the last sequence number included in the raw-log capture.",throws:["when source resolution fails or the session surface is invalid."]},{signature:"async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace>",description:"Trace known ancestry and descendants from one corpus observation.",parameters:[{name:"sessionId",description:"logical session id to trace."},{name:"signal",description:"optional cancellation for persistence listing."}],returns:"a complete lineage or the first parent that could not be resolved.",throws:["when corpus resolution fails, the target is absent, or its known ancestry cycles."]},{signature:"async traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation>",description:"Trace one event's direct positional replacements and cited source events.",parameters:[{name:"request",description:"target session id and event seq."},{name:"signal",description:"optional cancellation for persisted source resolution."}],returns:"source header, direct links, and the target's positional replacement chain.",throws:["when source resolution fails, the target is absent, or surface/source-event validation fails."]},{signature:"async readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>",description:"Read one full event plus a bounded raw-log context window.",parameters:[{name:"request",description:"target session/seq and context sizes."},{name:"signal",description:"optional cancellation for persisted source resolution."}],returns:"cloned target and neighboring events."}]},{key:"sessionReferenceResolver",summary:"Exact-read consumer that prepares immutable cross-session message context.",description:"Exact-read consumer that prepares immutable cross-session message context.",methods:[{signature:"async listCandidates( agent: Agent, query: string = '', limit: number = this.config.candidateLimit, signal?: AbortSignal, ): Promise<SessionReferenceCandidate[]>",description:"List reference candidates, ranked by working-directory affinity.",parameters:[{name:"agent",description:"target agent; self is excluded and its cwd drives ranking."},{name:"query",description:"optional case-insensitive session-id/cwd/title substring."},{name:"limit",description:"optional positive result cap."},{name:"signal",description:"optional cancellation boundary for host autocomplete teardown."}],returns:"candidates labeled by latest title or, when absent, session id."},{signature:"@Remote('candidates') async remoteExportCandidates( agent: Agent, query: string, signal: AbortSignal, ): Promise<SessionReferenceMentionCandidate[]>",description:"Remote face of listCandidates: the configured candidate limit applies, and every candidate carries the canonical mention a host inserts into the prompt draft.",parameters:[{name:"agent",description:"target agent; self is excluded and its cwd drives ranking."},{name:"query",description:"optional case-insensitive session-id/cwd/title substring."},{name:"signal",description:"caller cancellation."}],returns:"mention-carrying candidates in rank order."},{signature:"async prepare( agent: Agent, content: ContentBlock[], references: SessionReferenceInput[], signal?: AbortSignal, ): Promise<PreparedReferencedMessage>",description:"Snapshot all references for one accepted direct message and return one aggregated durable context.",parameters:[{name:"agent",description:"target agent; references to it are rejected."},{name:"content",description:"already host-normalized readable message content."},{name:"references",description:"structured source sessions in mention order."},{name:"signal",description:"optional cancellation boundary for the active turn."}],returns:"detached content and optional referenced-session context."}]},{key:"sessions",summary:"In-memory session store (`ctx.sessions`).",description:"In-memory session store (`ctx.sessions`).\n\nPersistence is intentionally not implemented here — persistence plugins subscribe to `session/event` and flush on `session/flush` / dispose.",methods:[{signature:"create(id?: SessionId, options?: CreateSessionOptions): Session",description:"Create a session owned by the calling fiber: disposing that fiber stops event notification and removes the session from the store. `options.seed` populates the session with a copy of those events (replay/fork); `options.meta` attaches creation metadata (validated absolute `cwd`, seed and parent lineage, and delegation depth) as the immutable SessionHeader (the store fills `version`/`id`/`createdAt`).\n\nFor an agent whose session must be torn down IN ORDER with its loop (so the loop's final events are published before the store attachment ends), do NOT use this — fold the session lifecycle into the agent's own effect via prepare + enter + announce (see `dsh-agent-loop`'s creation transaction).",parameters:[{name:"id",description:"the session id; omitted, the store mints `session-<n>`."},{name:"options",description:"seed events and/or creation metadata for the header."}],returns:"the live session, already entered and announced.",throws:["if a session with `id` already exists, metadata is not a plain lossless-JSON record with valid scalar fields, or `meta.cwd` is a non-absolute path (storage backends key directories off it)."]},{signature:"prepare(id?: SessionId, options?: PrepareSessionOptions): Session",description:"Build a session WITHOUT entering it into the store — validate the id/cwd and construct the Session (with its immutable SessionHeader). Pairs with enter + announce: a caller that owns a composite `ctx.effect` (the agent factory) folds the session lifecycle into that ONE effect so a fiber unload tears the session + agent down as a single ORDERED chain rather than as racing sibling effects — which would remove the publication hooks before the driver's closing events commit, dropping them.",parameters:[{name:"id",description:"the session id; omitted, the store mints `session-<n>`."},{name:"options",description:"seed events and/or creation metadata for the header. With `seedSource: 'persistence'`, metadata and events must be fresh detached graphs whose ownership transfers to this call: they are validated and frozen in place through {@link Session.fromRestore}, so the caller must retain no mutable aliases."}],returns:"the constructed session, NOT yet in the store.",throws:["if a session with `id` already exists, metadata is not a plain lossless-JSON record with valid scalar fields, or `meta.cwd` is a non-absolute path."]},{signature:"enter(session: Session): () => void",description:"Enter a prepared session into the store: install the module-private append publication hooks and add it to the store. Returns the DETACH disposer (hooks + store removal). Does NOT emit `session/created` — the caller yields this disposer inside its effect and THEN calls announce, so a throwing `session/created` listener rolls the attach back instead of leaking it.\n\nRe-checks the id for a duplicate: `prepare` and `enter` are public cross-package primitives and a caller may interleave arbitrary work (or another create) between them, so a stale prepared session must NOT overwrite a live store entry of the same id — its detach disposer would later delete the REAL session. The create convenience and the agent factory call the two back-to-back so they never trip this, but the public API cannot assume that.",parameters:[{name:"session",description:"a {@link prepare}d session not yet in the store."}],returns:"the detach disposer (publication hooks + store removal). When called from a synchronous `session/created` listener, removal and disposal wait until that creation dispatch unwinds.",throws:["if a session with this id is already in the store."]},{signature:"announce(session: Session): void",description:"Emit `session/created` exactly once for an entered session (with the carrier enter captured). Separate from enter so the caller can yield the detach disposer first (rollback safety — see enter).",parameters:[{name:"session",description:"the entered session to announce to listeners."}],throws:["if the session is not live or its announcement already began, including a reentrant call from a creation listener."]},{signature:"async flush(session: Session): Promise<boolean>",description:"Dispatch the awaited `session/flush` durability checkpoint for `session`, with the carrier captured at enter. THE flush entry point: the store owns the carrier, so callers (the checkpoint policy's per-request barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers that flush themselves before reading storage) must come through here rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner, one spelling, and the scoped-dispatch invariant can pin it.",parameters:[{name:"session",description:"the session whose buffered events must reach durable storage."}],returns:"whether at least one durability listener participated, after every listener has settled successfully.",throws:["the first registered listener failure after every listener settles."]},{signature:"get(id: SessionId): Session | undefined",description:"Look up a live session.",parameters:[{name:"id",description:"the session id to look up."}],returns:"the session, or undefined when no live session has that id."},{signature:"list(): Session[]",description:"All live sessions, in creation order.",parameters:[],returns:"a fresh array; mutating it does not affect the store."},{signature:"fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session",description:"Create a live child session from a stable prefix of a live source. `boundary` is an inclusive source event seq; omitted means the source's current last event. The selected slice may end with a between-turn event but must not end inside an open turn.",parameters:[{name:"source",description:"Live source session object or id."},{name:"boundary",description:"Inclusive source event seq to fork through; omitted means the source's current last event, and omitted on an empty source forks an empty child."},{name:"childSessionId",description:"Optional child session id; omitted delegates to `SessionStore`'s id policy."}],returns:"The created live child session."}]},{key:"sessionTelemetry",summary:"Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the `telemetry` key throws on a duplicate, cordis' standard behavior.",description:"Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the `telemetry` key throws on a duplicate, cordis' standard behavior. A backend composes a SessionTelemetryCoordinator in its constructor to install the capture side.",methods:[{signature:"abstract readonly sharing: SessionTelemetrySharingStatus",description:'Deployment-selected session-sharing policy, disclosed for acknowledgement surfaces that report whether recorded feedback leaves the process. Every backend must disclose its policy; a consumer renders "not configured" only when no telemetry service is mounted. The seam owns this vocabulary so the disclosure is backend-independent.',parameters:[]},{signature:"abstract emit(record: SessionTelemetryRecord): void",description:"See SessionTelemetrySink.emit — that declaration is the contract's one home.",parameters:[{name:"record",description:"the logical record to report; owned by the backend after the call."}]},{signature:"flush?(): void",description:"See SessionTelemetrySink.flush.",parameters:[]},{signature:"abstract shutdown(): Promise<void>",description:"See SessionTelemetrySink.shutdown.",parameters:[],returns:"resolves when the backend's pipeline has quiesced."}]},{key:"sessionTitle",summary:"Log-backed title fold plus asynchronous fallback generation.",description:"Log-backed title fold plus asynchronous fallback generation.",methods:[{signature:"get(session: Session): SessionTitleSnapshot | undefined",description:"Read the latest folded title from one live or replayed session.",parameters:[{name:"session",description:"session whose log is the title source of truth."}],returns:"latest title snapshot, or `undefined` before eligible input."},{signature:"rename(session: Session, title: string): SessionTitleSnapshot",description:"Accept an explicit user title. Appends a `session/title` event with the `user` source, which pins the title: in-flight automatic generation is superseded and later user messages schedule none (an explicit SessionTitleService.refresh remains the deliberate unpin).",parameters:[{name:"session",description:"exact live session to rename."},{name:"title",description:"raw user input; normalized before acceptance."}],returns:"the accepted title snapshot.",throws:["{SessionTitleInvalidError} when the title normalizes to empty.","{Error} when the session is not live or the service is disposed."]},{signature:"async refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>",description:"Explicitly retry the registered provider, or materialize the built-in fallback when no provider is registered.",parameters:[{name:"session",description:"exact live session to refresh."},{name:"signal",description:"optional caller cancellation."}],returns:"latest accepted title, or `undefined` when no eligible text exists."},{signature:"register(provider: SessionTitleProvider): () => Promise<void>",description:"Register the sole optional title provider. Disposal aborts its pending and active work before another provider may register.",parameters:[{name:"provider",description:"provider identity, cadence, and generation function."}],returns:"exact Cordis effect disposer, which settles after active calls quiesce."}]},{key:"settings",summary:"Abstract settings service.",description:"Abstract settings service. Providers implement raw-document storage (`load`/`persist`) and push external changes through Settings.publish; the base class owns namespace registration, resolution, validation, change detection, and the `settings/updated` commit event.",methods:[{signature:"abstract readonly writable: boolean",description:"Whether update may persist through this provider.",parameters:[]},{signature:"prepareDocument(): Promise<string | undefined>",description:"Prepare the provider's user-editable document for a native editor. File providers may materialize an absent document before returning its path; non-file providers return undefined.",parameters:[],returns:"the absolute local document path, or undefined for non-file storage."},{signature:"register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>",description:"Register a namespace schema and receive its owner scope. The registration is an effect on the calling plugin's fiber: disposing that fiber removes the namespace and its observers. An invalid stored section fails the registration itself — the earliest point where the schema can judge it.",parameters:[{name:"ns",description:"unique namespace; duplicate registration fails loud."},{name:"schema",description:"schemastery schema resolving this namespace's value."},{name:"options",description:"composition `base` layer and effect timing."}],returns:"the owner scope for reads, observation, and updates."},{signature:"describe(options?: SettingsDescribeOptions): SettingsDescriptor[]",description:"Describe every registered namespace for configuration surfaces, including the composition `base` and raw user layers so a form can mark which fields the user overrode (presence in `user`) and what a reset returns to.",parameters:[{name:"options",description:"redaction switch; wire surfaces must redact."}],returns:"one descriptor per registered namespace, in registration order."},{signature:"get(ns: SettingsNamespace): unknown",description:"Read one registered namespace's resolved value.",parameters:[{name:"ns",description:"the namespace to read."}],returns:"the resolved value, or `undefined` while unregistered."},{signature:"async update(ns: SettingsNamespace, patch: object, expectedRevision?: number): Promise<void>",description:"Merge a patch into one registered namespace's user layer, validate the resolved candidate, persist through the provider, then commit and emit. A validation failure rejects before anything is persisted. Writes to one namespace are serialized: concurrent updates apply in call order, each merging over the previous write's committed section.",parameters:[{name:"ns",description:"the registered namespace to update."},{name:"patch",description:"plain-object patch over the user section."},{name:"expectedRevision",description:"the descriptor `revision` the caller read; a namespace that moved past it rejects with {@link SettingsConflictError}."}]},{signature:"async replace(ns: SettingsNamespace, section: object, expectedRevision?: number): Promise<void>",description:"Replace one registered namespace's user section wholesale, validate, persist, then commit and emit. Keys absent from `section` fall back to the composition `base` and schema defaults — this is the removal/reset path a merge-only patch cannot express (`replace({})` re-inherits everything).",parameters:[{name:"ns",description:"the registered namespace to replace."},{name:"section",description:"the complete next user section."},{name:"expectedRevision",description:"the descriptor `revision` the caller read; a namespace that moved past it rejects with {@link SettingsConflictError}."}]},{signature:"async mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>",description:"Apply path-addressed edits to one registered namespace's user section, validate, persist, then commit and emit. The ops are applied to the section as it stands when the write reaches the front of the queue, so a caller never has to restate fields it did not touch — and, crucially, cannot delete fields it never saw. This is the write path for any caller holding a redacted view; `replace` remains the wholesale reset.",parameters:[{name:"ns",description:"the registered namespace to edit."},{name:"ops",description:"ordered path edits; later ops observe earlier ones."},{name:"expectedRevision",description:"the descriptor `revision` the caller read; a namespace that moved past it rejects with {@link SettingsConflictError}."}]}]},{key:"shell",summary:"Abstract bash execution service.",description:"Abstract bash execution service. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.shell` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).\n\nImplementations must honor these semantics:\n\n- run rejects only for infrastructure failures. Nonzero exits, timeout kills, and abort kills resolve with a ShellRunResult.\n- start returns immediately; no timeout applies to background processes. `done` settles at process close and never rejects; spawn failures settle as `killed` with the error on stderr.\n- ShellProcess.readOutput is incremental: consecutive reads never repeat output. Lossy reads report truncation and available spill files.\n- A still-running background process is stopped and awaited when its owning composition tears down. With the subprocess seam that boundary is `ctx.subprocess` disposal, so a background process survives an executor-only reload.",methods:[{signature:"abstract resolve(request: ShellExecRequest): ShellExecSpec",description:"Apply implementation-owned defaults and caps to a request before execution.",parameters:[{name:"request",description:"the caller's request; omitted fields get this implementation's defaults, capped fields are clamped."}],returns:"the fully-specified spec to hand to {@link run}/{@link start}."},{signature:"abstract run(spec: ShellExecSpec): Promise<ShellRunResult>",description:"Run a command in the foreground; resolves when it finishes.",parameters:[{name:"spec",description:"a resolved spec from {@link resolve}, never a raw request."}],returns:"the outcome; nonzero exits, timeout kills, and abort kills resolve with a descriptive result rather than reject."},{signature:"abstract start(spec: ShellExecSpec): ShellProcess",description:"Start a background process and return its handle immediately.",parameters:[{name:"spec",description:"a resolved spec from {@link resolve}, never a raw request."}],returns:"the live process handle (reads, kill, quiescence promise)."}]},{key:"shellEnv",summary:"Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables.",description:"Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables. The namespace is rebuilt for every model shell call: ambient `DSH_*` values are discarded by the executor, then the registry's current snapshot is injected. Built-in shell facts remain owned by the registry itself while plugins can register additional, enumerable facts with effect-scoped disposal.",methods:[{signature:"register(contributor: BashEnvContributor): () => void",description:"Register one environment contributor. Names and keys are unique; built-in keys are reserved. Registration is disposed with the calling plugin fiber.",parameters:[{name:"contributor",description:"declared key ownership and per-execution resolver."}],returns:"the disposer that unregisters the contribution."},{signature:"collect(execution: ToolExecution): DshEnvironment",description:"Build the trusted `DSH_*` snapshot for one shell tool execution.",parameters:[{name:"execution",description:"the current tool execution."}],returns:"an immutable environment overlay containing built-ins and current contributions."},{signature:"list(): BashEnvVariableInfo[]",description:"Enumerate plugin-contributed variables without executing their resolvers.",parameters:[],returns:"declarations sorted by environment variable name."}]},{key:"skills",summary:"Layered registry of skill providers, the host+per-scope shape the tools registry established.",description:"Layered registry of skill providers, the host+per-scope shape the tools registry established. A registration files into the layer of its calling context's scope (scopeOf): host rows and repository plugins land in the global layer, while a plugin mounted by an agent preset's standing composition lands in that preset's layer. A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer. It exposes sorted invocation-neutral summaries and loads full skill bodies on demand.",methods:[{signature:"registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void",description:"Register a borrowed same-process provider synchronously during plugin apply, into the calling context's layer: a scoped context (an agent preset's standing mount) registers for that scope alone, an unscoped context registers globally. Duplicate names within one layer and reserved names throw; remote initialization belongs in `list()`. Fiber disposal unregisters the provider and invalidates catalog caches.",parameters:[{name:"create",description:"synchronous factory receiving this registration's lifecycle and invalidation control."}],returns:"the exact Cordis effect disposer that unregisters this provider; composite effects may yield it directly to preserve teardown ordering."},{signature:"register(skill: SkillRegistration): () => void",description:"Register a borrowed readonly runtime skill into the calling context's layer. Project entries outrank runtime entries, which outrank user entries, within one layer. Same-name runtime entries in one layer are first-wins; a duplicate logs a warning and receives a no-op disposer so it cannot remove the winner.",parameters:[{name:"skill",description:"the skill definition input; omitted invocation and provider fields receive defaults."}],returns:"the exact Cordis effect disposer, preserving composite teardown order and invalidating caches."},{signature:"async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>",description:"List invocation-neutral skill summaries for a workspace. Consumers apply model or user invocation policy at their operational boundary. Lookup options and provider candidates are readonly same-process values borrowed throughout discovery.",parameters:[{name:"options",description:"view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery."}],returns:"all sorted winning summaries."},{signature:"async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>",description:"Observe the current invocation-neutral catalog and whether discovery completed within a stable revision. Incomplete observations are never cached, allowing consumers to retain last-good state and retry on their next request boundary.",parameters:[{name:"options",description:"view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery."}],returns:"sorted summaries plus discovery-completeness state."},{signature:"async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>",description:"Load and validate the winning candidate, passing its opaque discovery locator back to the provider. Cancellation is rechecked after selection, including cache hits, and raced against loading so an uncooperative provider cannot hang the caller.",parameters:[{name:"name",description:"kebab-case skill name."},{name:"options",description:"view options; `scope` selects the viewing agent's layers, `cwd` selects workspace-sensitive skills, and `signal` cancels work."}],returns:"the full skill, including body content, or `undefined`."}]},{key:"spillStore",summary:"Abstract spill storage service.",description:"Abstract spill storage service. Subclass, implement saveText, and load the subclass as a plugin — it registers as `ctx.spillStore` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).\n\nSemantics every implementation must honor:\n\n- saveText persists the FULL `content` verbatim and returns an opaque locator, exact byte length, and model-facing retrieval guidance.\n- Storage is scoped by the request's SaveTextSpill.owner session; the backend chooses a private (not world-readable) location and a collision-free name derived from — never equal to — the caller's `suggestedName`.\n- `saveText` REJECTS on a real storage failure (permissions, ENOSPC, backend unavailable); the caller decides how to degrade (the spill policy treats a rejection as best-effort and keeps the inline result).",methods:[{signature:"abstract saveText(input: SaveTextSpill): Promise<SpillRef>",description:"Persist `input.content` to a session-scoped spill artifact.",parameters:[{name:"input",description:"the owner, caller-supplied source fields, suggested name, and full text to save."}],returns:"the saved artifact's {@link SpillRef}; rejects on a storage failure."}]},{key:"storage",summary:"The storage hub service.",description:"The storage hub service. Backends register under `backend`; data forms mount under their `StorageForms` key and are reached as `ctx.storage.<form>`.",methods:[{signature:"readonly backend: BackendRegistry = new BackendRegistry()",description:"Named backend table; multiple backends stay mounted side by side.",parameters:[]},{signature:"mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void",description:"Mount a data-form facility on the hub. Mounting is an effect: the returned disposer unmounts the form.",parameters:[{name:"form",description:"Form key declared in {@link StorageForms}."},{name:"facility",description:"The facility instance to expose."}],returns:"the disposer that unmounts the form."},{signature:"form<K extends keyof StorageForms>(form: K): StorageForms[K]",description:"Resolve a mounted data form.",parameters:[{name:"form",description:"Form key declared in {@link StorageForms}."}],returns:"the mounted facility."}]},{key:"storageDomain",summary:"The mounted domain facility.",description:"The mounted domain facility. Opens declared domains over routed backends; one facility instance owns the open-domain table and enforces single-open per domain name.",methods:[{signature:"async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>",description:"Open one declared domain. Steps, each failing the whole call: reject a name that is already open (`already-open`); resolve the backend route (`backend-not-found` passes through from the hub); require its `kv` facet (`facet-unsupported`); open the unit projected from the spec (backend `version-mismatch`/`malformed-medium` pass through); load and validate every stored record against the spec's zod schemas (`invalid-record` with the offending table and key); construct the domain.\n\nLifecycle: the CALLER owns the returned handle and closes it via `Domain.close()` (typically as its own `ctx.effect` disposer) — the facility does not tie the domain to any consumer fiber. Domains still open when the facility unmounts are closed by the plugin disposer.",parameters:[{name:"spec",description:"The domain declaration, typically from `defineDomain`."}],returns:"the opened domain handle, typed by the spec."},{signature:"get(name: string): DomainImpl | undefined",description:"Look up an open domain by name, untyped. Diagnostic surface (the package invariant cross-checks change events against live domain state); typed consumers hold the handle returned by open.",parameters:[{name:"name",description:"Domain name."}],returns:"the open domain runtime, or `undefined` when not open."},{signature:"async closeAll(): Promise<void>",description:"Close every domain still open on this facility. The unmount path for consumers that never called `Domain.close()` themselves; closing is idempotent, so double-closing an already-closed domain is harmless.",parameters:[],returns:"resolution after every unit is released."}]},{key:"subagents",summary:"Named provider registry with one-shot runs, durable discovery, and continuable-child operations.",description:"Named provider registry with one-shot runs, durable discovery, and continuable-child operations.",methods:[{signature:"async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>",description:"Establish one durable continuable child and deliver its initial prompt. Resolves when the child's inbox accepts that prompt, without waiting for the turn to start or for the message to reach the Session log; any earlier failure rejects with no ids and rolls back the child entirely.",parameters:[{name:"spec",description:"provider, delegation request, and caller cancellation."}],returns:"the durable child id and the accepted prompt's message id.",throws:["when continuation services are unavailable or materialization fails."]},{signature:"async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>",description:"Deliver one later message to a continuable child as its next FIFO turn. A resident child's Agent inbox accepts it directly (waking a `waiting` Activation), while an absent one is cold-resumed from its persisted Session. The Agent inbox is the only queue, so every accepted message has one observable order.",parameters:[{name:"parent",description:"the exact live direct parent authorizing this delivery."},{name:"childId",description:"durable child session id."},{name:"content",description:"user-role content to deliver."},{name:"options",description:"the message source fields and caller cancellation, which stops the operation only before inbox acceptance."}],returns:"the accepted message's inbox id.",throws:["when continuation services are unavailable, parent authority is rejected, or the message was not admitted."]},{signature:"interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void",description:"Interrupt one live continuable child's current turn under a human parent address or an exact live ancestor Agent. Fire-and-return: the cancel signal is issued before this returns, but the target may keep running until it observes the signal. Unclaimed pending inbox work, the Activation, and published descendants are preserved; claimed work is not requeued. Once the interrupted driver is idle, a waking send resumes the parked FIFO queue. An absent target — including a one-shot or unknown id — is an accepted no-op, as is a manager-less composition, which cannot own a live Activation.",parameters:[{name:"targetSessionId",description:"the durable child session id to interrupt."},{name:"authority",description:"the human parent address or exact live ancestor Agent."}],throws:["{SubagentError} `UNAUTHORIZED` when the authority does not own the live target."]},{signature:"async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>",description:"Deliver selected content from one live continuable child to its durable direct parent. The child is the authority credential; callers cannot name a recipient. Reporting does not conclude the child's turn or Activation.",parameters:[{name:"child",description:"exact live reporting child."},{name:"content",description:"selected model-facing content."},{name:"options",description:"parent scheduling and pre-acceptance cancellation."}],returns:"the stable identity of the parent-accepted message.",throws:["when continuation services are unavailable, sender authorization fails, or the direct parent is not live."]},{signature:"registerContinuableSetup(contribution: ContinuableSetupContribution): () => void",description:"Compose one deployment capability into every continuable child's unpublished creation context on fresh creation and cold resume. Grants wait for the next Activation; removing the contribution revokes every resident installation immediately.",parameters:[{name:"contribution",description:"synchronous child-scope installer."}],returns:"the exact Cordis effect disposer."},{signature:"async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>",description:"Close continuable admission below exact live parent Agents, stop only their visible descendant Activations synchronously, then await admitted scoped materializations and release those forests child-first. The scoped cutoff lasts until each exact parent leaves the registry; unrelated parent trees remain live.",parameters:[{name:"parents",description:"exact host-owned parent Agents entering teardown."}],returns:"once every retained descendant Activation released its `AgentHandle`.",throws:["an aggregate error after all branches settle when any failed."]},{signature:"async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>",description:"Release selected resident continuable direct children of one exact live parent. Other children of the same parent remain admitted and resident. Absent targets and a manager-less composition are accepted no-ops.",parameters:[{name:"parent",description:"exact live direct parent authorizing the selected release."},{name:"childIds",description:"durable direct-child ids to release when resident."}],returns:"once every selected Activation released its `AgentHandle`.",throws:["{SubagentError} `UNAUTHORIZED` when a resident target belongs to a different parent or the supplied parent identity is stale."]},{signature:"listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>",description:"Enumerate the parent's direct session-backed subagents without loading or resuming an Agent and without any query service: the listing merges the live session store with optional session persistence (live-preferred) and serves each child's durable mode/label from the registered `subagent` projection unit down a three-rung ladder — the registry's watermark snapshot for a live child; for a cold one, a durable projection-cache row when the optional cache serves an own-suffix identity (its `seq` gate proves the value postdates the fork seed, where a child's own descriptor is immutable once appended), else one persistence inspection folded through the registry. The projection fold is the single classification authority; per-child diagnostics relay a fold that served no identity or a failed inspection, never a list-time descriptor parse. Absent persistence, enumeration is live-only (a cold child cannot be resumed then either, so its absence is capability absence, not an error). This service consults no Agent registrations, Activations, or providers.\n\nEvery persistence read receives `signal`, and the listing rechecks cancellation around each of those awaits. Read rejections that settle after an abort become a stable `SubagentError` with code `CANCELLED`.",parameters:[{name:"parentSessionId",description:"parent session whose direct children are listed."},{name:"signal",description:"caller-owned cancellation forwarded to persistence reads and observed around every read await."}],returns:"children and per-child diagnostics ordered by `createdAt`, then id.",throws:["{@link SubagentError} when the projection registry or the session store is not mounted, or the caller cancels the listing."]},{signature:"listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>",description:"Enumerate the root's complete session-backed subagent tree in stable pre-order from one live-preferred corpus, without loading or resuming an Agent. Ordinary sessions and one-shot children remain traversal nodes so continuable descendants below them are discovered; each returned entry adds its durable `parentId` and root-relative `depth`. Identity resolution, diagnostics, optional persistence, and cancellation follow the same projection-backed contract as listChildren.",parameters:[{name:"rootSessionId",description:"session whose complete descendant tree is listed."},{name:"signal",description:"caller-owned cancellation forwarded to persistence reads and observed around every read await."}],returns:"children and per-candidate diagnostics with tree position, in stable pre-order.",throws:["{@link SubagentError} under the same conditions as {@link listChildren}."]},{signature:"registerProvider(provider: SubagentProvider): () => void",description:"Register a provider under its name. Registration is effect-scoped and HMR safe; removing a provider blocks new starts but does not revoke runs that were already returned to their holders.",parameters:[{name:"provider",description:"the trusted provider implementation."}],returns:"the exact Cordis effect disposer."},{signature:"getProvider(name: string): SubagentProvider | undefined",description:"Look up a provider by name.",parameters:[{name:"name",description:"the provider name."}],returns:"the provider, or undefined when absent."},{signature:"list(): string[]",description:"List registered provider names in insertion order.",parameters:[],returns:"the registered names."},{signature:"async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>",description:"Establish a published child on the named provider. Capability and semantic checks run before delegation. Provider ownership lasts until its promise fulfills; a rejection therefore has no run for the caller to dispose and emits no run lifecycle events. Post-publication turn and infrastructure failures settle through the returned run.",parameters:[{name:"name",description:"the provider to use."},{name:"request",description:"child label, prompt, parent, signal, and optional capabilities."}],returns:"the published holder-owned run."}]},{key:"subprocess",summary:"Abstract subprocess service.",description:`Abstract subprocess service. Subclass, implement spawn, and load the subclass as a plugin — it registers as \`ctx.subprocess\` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Executable paths belong to one execution world shared with the mounted filesystem provider.
- spawn returns immediately with a live handle; \`done\` resolves at process close with exit facts and rejects only for spawn-level failures.
- Collect-mode readers are offset-based and non-consuming, so independent readers never consume one another's output; lossy reads report truncation and the spill file holding the complete stream when one exists. Piped streams are handed to the caller raw and never buffered here.
- SubprocessHandle.terminate (and the spec's abort signal) escalates SIGTERM→grace→SIGKILL — the only termination verb — tree-scoped on every platform. SubprocessHandle.waitForExit observes whole-tree liveness, so a consumer-owned teardown ladder can hold each tier on real quiescence.
- Disposal of the service terminates all still-running managed processes and awaits their exit.
- spawnTerminal owns terminal allocation, text transport, foreground groups, signalling, and whole-session quiescence behind one awaited termination method; readiness and persistent-shell policy stay in the PTY consumer. Its output stream ends after queued terminal output when the top-level process exits.`,methods:[{signature:"abstract resolveExecutable( command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal, ): Promise<string>",description:"Resolve one configured executable in this provider's execution world. Absolute paths are verified; bare names use the provider's scrubbed PATH plus explicit environment overrides. Relative paths containing separators are rejected: the resolution base is undefined, so providers fail loud instead of guessing.",parameters:[{name:"command",description:"absolute executable path or bare PATH name."},{name:"env",description:"explicit environment entries used for lookup."},{name:"signal",description:"aborts remote or local lookup."}],returns:"a canonical executable path."},{signature:"abstract spawn(spec: SubprocessSpawnSpec): SubprocessHandle",description:"Start one managed child process from a fully-specified spec; this seam applies no defaults.",parameters:[{name:"spec",description:"argv, directory, stdio dispositions, grace, cancellation, and environment."}],returns:"the live process handle (streams/readers, signalling, outcome promise)."},{signature:"abstract spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>",description:"Allocate a real terminal and start one owned process session. This is the only non-pipe process primitive: implementations own terminal byte I/O, foreground groups, signals, and complete session-tree cleanup.",parameters:[{name:"spec",description:"fully specified argv, cwd, environment, dimensions, grace, and allocation cancellation."}],returns:"the live terminal handle after allocation succeeds."}]},{key:"systemPrompt",summary:"Registry service for the prompt inputs assembled before each model step.",description:"Registry service for the prompt inputs assembled before each model step.",methods:[{signature:"section(section: PromptSection): () => void",description:"Register an ordered prompt section in the calling context's scope. A scoped section shadows a global section with the same name; duplicates within one layer and non-finite orders throw. Registration and disposal emit `system-prompt/change`.",parameters:[{name:"section",description:"the section to register."}],returns:"the exact Cordis effect disposer."},{signature:"context(context: PromptContext): () => void",description:"Register ordered dynamic context in the calling context's scope. Scoped entries shadow global entries with the same name.",parameters:[{name:"context",description:"the context contribution to register."}],returns:"the exact Cordis effect disposer."},{signature:"suppressRuntimeContext(): () => void",description:"Suppress every dynamic runtime-context contribution in the calling context's scope without changing the services that own or enforce those facts. Multiple suppressors remain independently disposable.",parameters:[],returns:"the exact Cordis effect disposer."},{signature:"tools(provider: (context: AssembleContext) => ToolProviderResult): () => void",description:"Register a tool-schema provider in the calling context's scope. Global and matching scoped providers both contribute; returning the reserved TOOL_ORDER_REST name makes assembly fail.",parameters:[{name:"provider",description:"evaluated for each assembly with its context."}],returns:"the exact Cordis effect disposer."},{signature:"variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void",description:"Register a prompt variable in the calling context's scope. Scoped values shadow globals; invalid or duplicate names throw. A provider may return `undefined`, but rendering a section that references that value then fails.",parameters:[{name:"name",description:"the `[a-z][a-z0-9_]*` reference name."},{name:"provider",description:"evaluated for each assembly."}],returns:"the exact Cordis effect disposer."},{signature:"async assemble(context: AssembleContext = {}): Promise<PromptAssembly>",description:"Assemble global and scoped providers, detach tool parameters, apply canonical ordering, then run the assembly waterfall. Scoped sections and variables shadow globals. The returned waterfall value is authoritative except that an effective complete section is restored afterwards as the sole prompt section.",parameters:[{name:"context",description:"the optional scope and plugin-defined assembly fields."}],returns:"the post-waterfall assembly with any complete prompt enforced."}]},{key:"terminals",summary:"In-process registry for replaceable PTY backends and exact-Agent sessions.",description:"In-process registry for replaceable PTY backends and exact-Agent sessions.",methods:[{signature:"registerBackend(backend: TerminalBackend): () => void",description:"Register one backend type for this effect scope.",parameters:[{name:"backend",description:"provider with a non-empty unique type."}],returns:"disposer that removes exactly this contribution."},{signature:"listBackends(): string[]",description:"List registered backend types in registration order.",parameters:[],returns:"fresh backend type names."},{signature:"async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>",description:"Create and publish one owner-scoped session after backend setup succeeds.",parameters:[{name:"owner",description:"exact registered Agent that owns access and cleanup."},{name:"request",description:"backend type plus optional owner-local name and cwd."},{name:"signal",description:"cancellation of unpublished setup."}],returns:"published identity, metadata, status, and MOTD."},{signature:"hasOwnerActivity(owner: Agent): boolean",description:"Test whether an exact owner has a published session or unpublished spawn.",parameters:[{name:"owner",description:"exact live owner to inspect."}],returns:"true across the entire spawn-to-close interval, with no publication gap."},{signature:"startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation",description:"Start one exclusive interactive send.",parameters:[{name:"owner",description:"exact session owner."},{name:"id",description:"target PTY identity."},{name:"request",description:"explicit text, submit behavior, and cancellation."}],returns:"live operation handle for foreground await or task registration."},{signature:"read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult",description:"Read one bounded scrollback page from an owned session.",parameters:[{name:"owner",description:"exact session owner."},{name:"id",description:"target PTY identity."},{name:"request",description:"optional newest-relative offset and line count."}],returns:"bounded retained text and pagination metadata."},{signature:"signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>",description:"Deliver an allowed signal through an owned backend session.",parameters:[{name:"owner",description:"exact session owner."},{name:"id",description:"target PTY identity."},{name:"signal",description:"allowed POSIX signal name."}],returns:"delivered foreground process-group identity."},{signature:"async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>",description:"Close one owned session and remove it only after quiescent backend cleanup.",parameters:[{name:"owner",description:"exact session owner."},{name:"id",description:"target PTY identity."},{name:"reason",description:"diagnostic cleanup reason."}],returns:"true for a newly closed session, false when the same close is already in flight."},{signature:"list(owner: Agent): TerminalSessionSnapshot[]",description:"List fresh snapshots for exactly one owner.",parameters:[{name:"owner",description:"exact owner whose sessions are visible."}],returns:"owner-visible snapshots in publication order."}]},{key:"timer",summary:"Disposable timer helpers mixed into Cordis contexts.",description:"Disposable timer helpers mixed into Cordis contexts.",methods:[{signature:"timeout(callback: () => void, delay: number): () => void",description:"Run a callback once and return its disposer.",parameters:[]},{signature:"timeout(delay: number): Promise<void>",description:"Resolve after a delay; disposal rejects the pending promise.",parameters:[]},{signature:"interval(callback: () => void, delay: number): () => void",description:"Run a callback repeatedly and return its disposer.",parameters:[]},{signature:"interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>",description:"Return an async iterator of timer ticks.",parameters:[]},{signature:"throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing?: boolean): F & { dispose: () => void }",description:"Return a throttled function whose timer is disposed with the current fiber.",parameters:[]},{signature:"debounce<F extends (...args: any[]) => void>(callback: F, delay: number): F & { dispose: () => void }",description:"Return a debounced function whose timer is disposed with the current fiber.",parameters:[]}]},{key:"tokenMeter",summary:"Replay owner for one service-wide estimator and isolated per-session folds.",description:"Replay owner for one service-wide estimator and isolated per-session folds.",methods:[{signature:"measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement",description:"Measure current request pressure and surface through the durable tail.\n\nProvider usage is reused only when the latest successful call's canonical request envelope matches `requestHeader` and its total is no lower than that call's full heuristic anchor; otherwise the complete envelope and surface are heuristically repriced.\n\n`requestHeader` affects request pressure only; surface fields always describe the current session surface. Every call clones those positional nodes, so measurement is O(surface).",parameters:[{name:"session",description:"session to replay through its current durable tail."},{name:"requestHeader",description:"optional effective request envelope replacing the latest logged header."}],returns:"a detached deeply immutable pressure and surface measurement."},{signature:"estimateMessage(message: Message): number",description:"Heuristically price one model-visible message (instance face of the pure `estimateMessage` export from `estimate.ts`).",parameters:[{name:"message",description:"message to price without mutation."}],returns:"content and role-framing tokens under the fixed service heuristic."}]},{key:"toolResultPruner",summary:"Deterministic head/middle/tail pruning for current tool-result surface nodes.",description:"Deterministic head/middle/tail pruning for current tool-result surface nodes.",methods:[{signature:"readonly config: ResolvedConfig",description:"Resolved and immutable character budgets.",parameters:[]},{signature:"measureContent(blocks: readonly ContentBlock[]): number",description:"Measure text content in Unicode code points; non-text blocks cost zero.",parameters:[{name:"blocks",description:"tool-result content to measure."}],returns:"total Unicode code points across text blocks."},{signature:"pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null",description:"Replace an over-budget text middle while retaining rich-block order. Text slicing is by Unicode code point, not UTF-16 code unit, so a retained boundary cannot split a surrogate pair. Grapheme clusters may still split.",parameters:[{name:"blocks",description:"original tool-result content."}],returns:"pruned content, or `null` when the text is within budget."},{signature:"pruneSession(session: Session): PruneResult",description:"Prune every over-budget tool result from one stable current-surface snapshot. Each replacement preserves the complete event data except for `content`, cites the shadowed node so replay can recover the replacement input, and is immediately preceded by a `compaction/prune` shadow-price event pricing the shadowed node through the injected token meter, so pure consumers can subtract it without per-node state.",parameters:[{name:"session",description:"session whose current surface is rewritten."}],returns:"landed replacements and aggregate Unicode-code-point savings.",throws:["when the session rejects a replacement; replacements committed earlier in the pass remain durable."]}]},{key:"tools",summary:"Tool registry and execution pipeline.",description:"Tool registry and execution pipeline. Scoped registrations shadow globals; one visibility resolver feeds presentation, lookup, and dispatch.",methods:[{signature:"presentAs(mode: ToolPresentationMode): () => void",description:"Present the calling scope's tools in `mode` instead of the deployment default. Nearest scope on the chain wins, so a preset's standing declaration covers every agent joined under it.\n\nScoped only, and one declaration per scope: this is how an agent preset composes Code Mode agents beside native ones in the same process, and a process-global override would be the `mode` config field instead.",parameters:[{name:"mode",description:"the presentation the covered agents' models see."}],returns:"the exact disposer that restores the deployment default."},{signature:"register(definition: ToolDefinition): () => void",description:"Register globally or in the calling agent scope. Scoped tools shadow globals; duplicates within one layer and the reserved `run_code` name fail.",parameters:[{name:"definition",description:"tool schema, execution, and optional finalization/presentation callbacks."}],returns:"the exact disposer that unregisters the tool."},{signature:"restrict(filter: ToolRestriction): () => void",description:"Restrict global tools for the calling agent scope. Empty filters, unknown names, scope-local names, and reserved transport names fail. Restrictions intersect; scoped registrations remain visible.",parameters:[{name:"filter",description:"global-tool mask: `allow` (keep only) and/or `deny` (remove)."}],returns:"the exact disposer that lifts this restriction."},{signature:"guard(guard: ToolGuard): () => void",description:"Register a monotonic guard after the extensible `tools/pre-execute` waterfall. A plain-context guard applies globally; one registered through `agent.ctx` applies only to that agent. Any matching guard may deny by returning a reason, while no guard can force-allow a call another guard denied. The exact effect disposer is returned for ordered ownership and HMR cleanup.",parameters:[{name:"guard",description:"synchronous check; a returned string denies the execution."}],returns:"the exact disposer that unregisters the guard."},{signature:"get(name: string, scope?: ScopeKey): ToolDefinition | undefined",description:"Look up a tool as one scope sees it (scoped shadows global; a restricted-away global reads as absent). Presenters pass the calling agent so the rendered card matches the definition that actually executed.",parameters:[{name:"name",description:"the tool name as registered."},{name:"scope",description:"the viewing scope (the agent); omitted = the global view."}],returns:"the definition the scope resolves, or undefined when none is visible."},{signature:"schemas(scope?: ScopeKey): ToolSchema[]",description:"Project visible definitions onto the allowlisted model-facing schema fields, excluding execution and presentation callbacks.",parameters:[{name:"scope",description:"the viewing scope (the agent); omitted = the global view."}],returns:"one deep-cloned schema per visible tool."},{signature:"executionMode(exec: ToolExecutionInput): ToolExecutionMode",description:"Classify a pending call through the caller's visible tool definition. Only an exact `true` is parallel; unknown, hidden, undeclared, invalid, or throwing classifiers are exclusive.",parameters:[{name:"exec",description:"call name, parsed arguments, and optional agent scope."}],returns:"the fail-closed scheduling mode."},{signature:"async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>",description:"Execute through pre-policy, guards, around-dispatch, post-policy, definition-owned content finalization, and final notification. Tool and listener failures resolve as materialized error results; an invisible tool reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen snapshot final observers receive. Cancellation arriving after entry and before final result materialization skips a not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a successful started outcome with `ABORTED`; already-started work is still drained and may retain a tool-owned structured error.",parameters:[{name:"exec",description:"the typed same-process call input. The registry assigns its correlation token before policy begins."}],returns:"the materialized final result."}]},{key:"typert",summary:"Registry of generated schemas, package reflection, invocations, and Remote dependency providers.",description:"Registry of generated schemas, package reflection, invocations, and Remote dependency providers.",methods:[{signature:"register(contribution: TypertContribution): TypertDisposer",description:"Register one generated contribution atomically for the calling fiber. Duplicate package-face identities, schemas, invocation ids, or endpoints reject the whole batch.",parameters:[{name:"contribution",description:"generated schemas, reflection, and Host invocations."}],returns:"the exact effect disposer that removes this contribution."},{signature:"get(key: string): TypertSchemaRecord | undefined",description:"Look up one schema by `<package>#<name>`.",parameters:[{name:"key",description:"global schema key."}],returns:"the live schema record, or `undefined` when absent."},{signature:"resolve(key: string): TypertSchemaRecord",description:"Resolve one required schema.",parameters:[{name:"key",description:"global schema key."}],returns:"the live schema record.",throws:["when the key is malformed, the package face is absent, or the schema is not contributed."]},{signature:"list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[]",description:"Enumerate live schemas in registration order.",parameters:[{name:"filter",description:"optional package and face restriction."}],returns:"matching schema records."},{signature:"getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined",description:"Look up generated reflection for one package face.",parameters:[{name:"packageName",description:"exact npm package name."},{name:"face",description:"face to query; defaults to the host runtime."}],returns:"the live package record, or `undefined` when absent."},{signature:"listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[]",description:"Enumerate generated package reflection in registration order.",parameters:[{name:"filter",description:"optional package and face restriction."}],returns:"matching package records."},{signature:"toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema",description:"Project a live Zod schema to JSON Schema without caching the result.",parameters:[{name:"key",description:"global schema key."},{name:"params",description:"Zod projection parameters."}],returns:"a fresh JSON Schema document."}]},{key:"typertGateway",summary:"Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers.",description:"Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers.",methods:[{signature:"async invoke(request: InvokeRemoteRequest): Promise<unknown>",description:"Invoke one live Remote method through strict generated reflection or SRC markers.",parameters:[{name:"request",description:"decoded endpoint and exact named wire arguments."}],returns:"the validated business result.",throws:["{@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity."]}]},{key:"userQuestions",summary:"`ctx.userQuestions`: one active UI provider plus an `ask()` API.",description:"`ctx.userQuestions`: one active UI provider plus an `ask()` API.",methods:[{signature:"registerProvider(provider: UserQuestionProvider): () => void",description:"Register the UI provider. Only one provider may be active in a context.",parameters:[{name:"provider",description:"UI-side implementation that collects answers."}],returns:"Disposer that unregisters this provider."},{signature:"async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>",description:`Ask the active UI provider and wait for the user's answer.

When a caller supplies an agent, human interaction is valid only for the exact live runtime root. Runtime ownership, not durable session lineage, decides this boundary: an owned child has no human answerer and would block forever, while a lineage-bearing session resumed as a new runtime root may ask normally.`,parameters:[{name:"request",description:"Questions, owner agent, and abort signal."}],returns:"The answer chosen or typed by the human.",throws:["{UserQuestionError} code `CALLER_NOT_LIVE` when a supplied agent is not the registry's exact live instance, or `DELEGATED_CALLER` when that live agent is owned by another agent."]}]},{key:"web",summary:"The web access service.",description:"The web access service. Registered as `ctx.web` (one instance per context).\n\nSelection semantics (resolved at execution time, never order-dependent):\n\n- A configured id that is registered and `available()` → that provider.\n- A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.\n- A configured id registered but unavailable → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.\n- No id configured, exactly one registered usable provider → that provider.\n- No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.\n- No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.",methods:[{signature:"registerSearchProvider(provider: WebSearchProvider): () => void",description:"Register a search provider. Throws WebError `WEB_DUPLICATE_PROVIDER` if its id is already registered for search. Returns a disposer; disposed with the calling fiber.",parameters:[{name:"provider",description:"the provider; its `id` is the registry key."}],returns:"the disposer that unregisters the provider."},{signature:"registerFetchProvider(provider: WebFetchProvider): () => void",description:"Register a fetch provider. Throws WebError `WEB_DUPLICATE_PROVIDER` if its id is already registered for fetch. Returns a disposer; disposed with the calling fiber.",parameters:[{name:"provider",description:"the provider; its `id` is the registry key."}],returns:"the disposer that unregisters the provider."},{signature:"async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>",description:"Run one search through the selected provider. Resolves the provider at call time with the selection rules above; throws WebError when the capability cannot run. The seam enforces `request.maxResults` on the result: if the provider over-returns, `sources[]` is truncated and `truncated` set.",parameters:[{name:"request",description:"the query and optional result limit."},{name:"signal",description:"optional cancellation signal forwarded to the provider."}],returns:"the provider's results, capped to `request.maxResults`."},{signature:"async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>",description:"Retrieve one URL through the selected provider. Resolves the provider at call time with the selection rules above; throws WebError when the capability cannot run. A non-2xx response is a result, not a throw.",parameters:[{name:"request",description:"the URL plus retrieval options."},{name:"signal",description:"optional cancellation signal forwarded to the provider."}],returns:"the retrieval outcome; non-2xx responses resolve descriptively."}]},{key:"webServer",summary:"The browser HTTP carrier service.",description:"The browser HTTP carrier service. Activation listens immediately. Route registration order does not affect requests because configured named routes must be distinct, and the fallback handler answers anything not yet claimed during startup with 404 until its owner registers. A listen failure rejects initialization, and the boot process reports the failed fiber.",methods:[{signature:"register(route: WebRoute): () => void",description:"Register a named route. Duplicate (kind, path) throws — route patterns are a composition-level contract, so a collision is a misconfiguration.",parameters:[{name:"route",description:"kind, path, and the owning handler."}],returns:"the disposer removing the route."},{signature:"registerUpgrade(route: WebUpgradeRoute): () => void",description:"Register an exact-path HTTP upgrade route. Duplicate paths throw because one socket can have only one protocol owner.",parameters:[{name:"route",description:"pathname and handler owning negotiation plus socket use."}],returns:"the disposer removing the route."},{signature:"registerFallback(handler: WebRoute['handler']): () => void",description:"Claim the fallback seat: the handler answering every request no named route matches (the SPA dist server in the shipped Web composition). One owner only — a second registration throws, because two fallbacks cannot compose.",parameters:[{name:"handler",description:"owns the full response lifecycle of unmatched requests."}],returns:"the disposer releasing the seat."},{signature:"tapIndex(transform: (html: string) => string): () => void",description:"Register a raw-HTML index transform, the escape hatch for markup no IndexInjection row expresses: renderIndex applies taps in registration order after rendering the structured rows.",parameters:[{name:"transform",description:"pure html-to-html function."}],returns:"the disposer removing the transform."},{signature:"applyIndexTaps(html: string): string",description:"Run an index.html body through the registered taps in registration order — called by the fallback owner on every index response it renders.",parameters:[{name:"html",description:"the raw index.html body."}],returns:"the transformed body."},{signature:"collectIndexInjections(): IndexInjection[]",description:"Gather the structured injection table: one `webserver/index-inject` emit, every subscriber pushes its current rows. Fresh per call, so subscribers read live state (module graph, theme preference) at emit time.",parameters:[],returns:"rows in subscriber activation order."},{signature:"renderIndex(html: string): string",description:"Render one index.html body: the structured injection table first, then the raw `tapIndex` transforms over the result.",parameters:[{name:"html",description:"the raw index.html body."}],returns:"the transformed body."}]},{key:"workflowEngine",summary:"Workflow Service Definition contract.",description:"Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, cancellation and disposal are bounded, and disposal waits for child cleanup within that bound. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.",methods:[{signature:"abstract start(request: WorkflowStartRequest): WorkflowRun",description:"Parse and execute a workflow script.",parameters:[{name:"request",description:"the script, its `args`, the parent agent, and an optional cancel signal."}],returns:"the live run; its `result` resolves when the script settles."}]},{key:"workspaceRegistry",summary:"Durable workspace registry.",description:"Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.",methods:[{signature:"async create(path: string, title?: string): Promise<Workspace>",description:"Create or reuse a workspace for an existing directory. The path is canonicalized through `fs.realpath`; a nonexistent path rejects with the original error and a non-directory rejects. Repeated calls for the same canonical path return the existing entity without changing its title. A newly created workspace is prepended to the durable registry order. Different canonical paths may share a display title.",parameters:[{name:"path",description:"Existing directory to own, in any path spelling."},{name:"title",description:"Display title used only when a new record is created."}],returns:"the existing or newly durable workspace."},{signature:"get(id: WorkspaceId): Workspace | undefined",description:"Look up a workspace by id.",parameters:[{name:"id",description:"Workspace id."}],returns:"the workspace, or `undefined` when unknown."},{signature:"list(): Workspace[]",description:"Synchronous workspace projection in durable registry order. Every entity's `sessionIds` getter is already filtered by the startup/live canonical-cwd header index; this method performs no persistence reads.",parameters:[],returns:"a fresh ordered array of workspace entities."},{signature:"delete(id: WorkspaceId): Promise<boolean>",description:"Delete one workspace registration while retaining its directory and every session log. The durable order is updated before the table deletion; a failed table write restores the prior order and keeps the entity published. Unknown ids are an idempotent no-op for domain callers.",parameters:[{name:"id",description:"Workspace registration to remove."}],returns:"`true` when a record was deleted, `false` when it was unknown."},{signature:"insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>",description:"Move one workspace within the durable display order, DOM-insertBefore-like. With an anchor it lands before that workspace; without one it appends.",parameters:[{name:"id",description:"Workspace to move."},{name:"beforeId",description:"Workspace anchor; omitted appends."}],returns:"the complete committed workspace order."},{signature:"archiveSession(sessionId: SessionId): Promise<void>",description:"Archive one session durably. The session must exist (live or in session persistence); its workspace accounting — or lack of one — is irrelevant. An already archived id resolves without writing.",parameters:[{name:"sessionId",description:"The session to archive."}],returns:"resolution after durability."},{signature:"async resolveByPath(path: string): Promise<Workspace | undefined>",description:"Resolve by canonical directory path without creating or mutating a workspace. A missing path rejects during `realpath`; an existing unowned directory returns `undefined`.",parameters:[{name:"path",description:"Existing directory path in any spelling."}],returns:"the workspace owning the canonical path, when one exists."}]}],x=[{name:"agent-loop/config-start-failed",mode:"emit",signature:"'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void",summary:"A declarative agent entry failed before it could publish a live agent.",description:"A declarative agent entry failed before it could publish a live agent. Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever. Normal factory teardown suppresses failures from the cancelled startup attempt.",parameters:[{name:"payload",description:".error - persistence, setup, or publication failure."}]},{name:"agent-preset/selected",mode:"emit",signature:"'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void",summary:"One session committed a different agent preset to its durable log.",description:"One session committed a different agent preset to its durable log. Consumers invalidate only state derived from that session's composition.",parameters:[{name:"sessionId",description:"the session whose composition changed."},{name:"agentPreset",description:"the preset recorded by the committed selection."}]},{name:"agent/created",mode:"emit",signature:"'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void",summary:"A fully configured agent and live session were published.",description:"A fully configured agent and live session were published. Setup is composition-only; `agent/session-start` is the first startup-driving extension point. Synchronous listener failure vetoes publication, while returned-promise rejection is reported. Detach requested during dispatch waits until every creation listener has observed the stable entry.",parameters:[{name:"payload",description:".agent - the newly registered agent with its live session and completed setup. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/disposed",mode:"emit",signature:"'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void",summary:"An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment.",description:"An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment. Custom registry users own their driver-ordering contract.",parameters:[{name:"payload",description:".agent - the exact agent removed from the registry. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/error",mode:"emit",signature:"'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void",summary:"A step or turn errored.",description:"A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record.",parameters:[{name:"payload",description:".error - the failure, verbatim. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/inbox/claimed",mode:"emit",signature:"'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void",summary:"One message left the inbox inside its open turn.",description:"One message left the inbox inside its open turn. If the proposed step is rejected, the claimed message ends here: it is neither discarded nor re-emitted as a user/message, and the turn closes without a step.",parameters:[{name:"payload",description:".turn - the owning turn. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/inbox/discarded",mode:"emit",signature:"'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void",summary:"One message was discarded from the live inbox.",description:"One message was discarded from the live inbox.",parameters:[{name:"payload",description:".message - the discarded message. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/inbox/inserted",mode:"emit",signature:"'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void",summary:"One message entered the live inbox.",description:"One message entered the live inbox.",parameters:[{name:"payload",description:".message - the inserted message. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/pre-step",mode:"waterfall",signature:"'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>",summary:"Reject a proposed step or replace the messages that enter it.",description:"Reject a proposed step or replace the messages that enter it. Calling `next()` preserves the current messages.",parameters:[{name:"payload",description:".signal - the current turn's cancellation signal. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/request",mode:"waterfall",signature:"'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>",summary:"Replace the frozen call configuration.",description:"Replace the frozen call configuration. `await next()` yields the config the machine would use (agent options on the first request, the logged header afterwards); return a replacement to switch. Model-visible content must use logged channels; this waterfall cannot mutate messages.",parameters:[{name:"payload",description:".signal - the current turn's explicit abort signal. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/request-error",mode:"waterfall",signature:"'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>",summary:"Handle one failed model-request attempt before the loop retries or closes its step.",description:"Handle one failed model-request attempt before the loop retries or closes its step. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery, or calls `next()` to delegate. The default `undefined` leaves the failure terminal.",parameters:[{name:"payload",description:".signal - the turn abort signal. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/session-start",mode:"emit",signature:"'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void",summary:"The session lifecycle began, once before the first turn.",description:"The session lifecycle began, once before the first turn. Use `agent.inject()` to seed model-facing context. This is a notification, not a veto; disposal requested by a lifecycle owner is rechecked before the driver starts.",parameters:[{name:"payload",description:".source - why the session started (fresh startup, resume, …). Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/status",mode:"emit",signature:"'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void",summary:"Agent status changed (`idle` ⇄ `running`).",description:"Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously after reserving cancellation; `idle` means no driver remains scheduled or active.",parameters:[{name:"payload",description:".status - the status just entered (the transition's destination). Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"agent/turn-stopping",mode:"serial",signature:"'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void",summary:"The turn is about to close: the model owes no response (no live tool calls, no fresh steering).",description:"The turn is about to close: the model owes no response (no live tool calls, no fresh steering). Awaited before the boundary commits — a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. Data decides, so listener order cannot change the outcome. The inverse control (stop a tool loop early) is data too: a tool result carrying `concludesTurn` ends the turn at its step. The conclusion never short-circuits already-submitted next-step work: same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.",parameters:[{name:"payload",description:".signal - the current turn's explicit abort signal. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent."}]},{name:"approval/request",mode:"waterfall",signature:"'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>",summary:"Ask composed answerers for one decision.",description:"Ask composed answerers for one decision. Return an outcome to claim the request or call `next()`; failure yields the fail-closed default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.",parameters:[{name:"req",description:"the pending decision (agent, tool identity, reason, signal)."}]},{name:"authorization/settled",mode:"emit",signature:"'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void",summary:"One authorization attempt has finished and released its key.",description:"One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.",parameters:[{name:"key",description:"the credential record the finished attempt was authorizing."},{name:"settlement",description:"how it ended, including the `failed` case its caller sees as a thrown error."}]},{name:"commands/change",mode:"emit",signature:"'commands/change'(): void",summary:"A command was registered or unregistered.",description:"A command was registered or unregistered. This is an unfiltered registry notification because a global or scoped change may affect any UI view. Observer failures are contained and cannot veto the registry mutation.",parameters:[]},{name:"cordis/dynamic-package",mode:"emit",signature:"'cordis/dynamic-package'(pkg: DynamicCordisPackage): void",summary:"One exact Plugin/Package activation is now live in the Host.",description:"One exact Plugin/Package activation is now live in the Host.",parameters:[{name:"pkg",description:"stable plugin, immutable package, run identity, and label."}]},{name:"cordis/dynamic-retract",mode:"emit",signature:"'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void",summary:"One exact activation was withdrawn.",description:"One exact activation was withdrawn.",parameters:[{name:"retracted",description:"plugin, package, and run identity."}]},{name:"cordis/inspect-query",mode:"emit",signature:"'cordis/inspect-query'(request: CordisInspectQueryRequest): void",summary:"Request a live read-only query from the Client inspect registry.",description:"Request a live read-only query from the Client inspect registry.",parameters:[{name:"request",description:"correlation, Session, provider, method, and JSON input."}]},{name:"cordis/inspect-query-resolved",mode:"emit",signature:"'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void",summary:"Notify every Client that an inspect query has settled or been cancelled.",description:"Notify every Client that an inspect query has settled or been cancelled.",parameters:[{name:"resolved",description:"exact query identity that is no longer answerable."}]},{name:"cordis/request-run",mode:"emit",signature:"'cordis/request-run'(request: DynamicCordisRunRequest): void",summary:"A Client-bearing activation needs a browser page, and may require a user decision.",description:"A Client-bearing activation needs a browser page, and may require a user decision.",parameters:[{name:"request",description:"correlation identity, owner, target version, mode, and approval requirement."}]},{name:"cordis/request-run-resolved",mode:"emit",signature:"'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void",summary:"A pending Client activation request left the answerable state.",description:"A pending Client activation request left the answerable state.",parameters:[{name:"resolved",description:"request identity and outcome."}]},{name:"credentials/record-updated",mode:"emit",signature:"'credentials/record-updated'(key: CredentialKey): void",summary:"Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage.",description:"Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.",parameters:[{name:"key",description:"the record whose stored value changed."}]},{name:"credentials/reference-updated",mode:"emit",signature:"'credentials/reference-updated'(ref: CredentialRef): void",summary:"Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage.",description:"Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.",parameters:[{name:"ref",description:"the reference whose stored value changed."}]},{name:"domain/changed",mode:"emit",signature:"'domain/changed'(change: DomainChanged): void",summary:"A domain record or the global singleton changed, emitted once per write strictly after the backend acknowledged durability.",description:"A domain record or the global singleton changed, emitted once per write strictly after the backend acknowledged durability. Events of one domain arrive in its write-chain order.",parameters:[{name:"change",description:"domain, table (`''` for global), key (`''` for global), operation discriminant, and on `put` the new snapshot."}]},{name:"fs/edit-intent",mode:"waterfall",signature:"'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>",summary:"Single-slot decision for the next FileSystem.editText.",description:"Single-slot decision for the next FileSystem.editText. Calling `next()` yields an unconditional edit; the first returned guard wins.",parameters:[{name:"target",description:"the resolved target about to be edited."},{name:"actor",description:"the opaque tool-execution context the decider keys off."}]},{name:"fs/observed",mode:"emit",signature:"'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void",summary:"Record an authoritative positive or negative observation.",description:"Record an authoritative positive or negative observation. Listeners must be synchronous recorders: throws fail the tool call and returned promises are not awaited.",parameters:[{name:"target",description:"the target whose presence or absence was observed."},{name:"observation",description:"present with its version, or confirmed absent."},{name:"actor",description:"the observing tool-execution context; undefined records nothing useful."}]},{name:"fs/write-intent",mode:"waterfall",signature:"'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>",summary:"Single-slot decision for the next FileSystem.writeText.",description:"Single-slot decision for the next FileSystem.writeText. Calling `next()` yields the bare provider's unconditional write; the first listener that returns an intent owns the decision rather than composing with peers.",parameters:[{name:"target",description:"the resolved target about to be written."},{name:"actor",description:"the opaque tool-execution context the decider keys off."}]},{name:"goal/changed",mode:"emit",signature:"'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void",summary:"Goal mutation accepted by one live agent.",description:"Goal mutation accepted by one live agent. The matching `goal/change` session event has already committed. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.",parameters:[{name:"payload",description:".change - fresh current projection or clear tombstone."}]},{name:"llm/adapters-updated",mode:"emit",signature:"'llm/adapters-updated'(): void",summary:"The provider topology changed: an adapter registered or unregistered routes, or the configurable-provider directory gained or lost entries.",description:"The provider topology changed: an adapter registered or unregistered routes, or the configurable-provider directory gained or lost entries. This payload-free registry notification fires at each commit point (including registration disposal); consumers re-read `listProviders()`, `listModels()`, or `listConfigurableProviders()` for the new state. Observer failures are contained and cannot veto the registry mutation.",parameters:[]},{name:"llm/stream",mode:"waterfall",signature:"'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>",summary:"Waterfall around every streaming model call (retry, replay, routing).",description:"Waterfall around every streaming model call (retry, replay, routing). Bound to the LlmRuntime; call `next()` to reach the resolved adapter's stream, or yield your own chunks to short-circuit.",parameters:[{name:"options",description:"the full request. A LOOP-built request carries the process-local {@link markAgentLoopRequest} identity and arrives deep-frozen (mutation throws): its content is a pure function of the session log (the reconstructability Agent Note), so listeners read it, never rewrite it. Hand-built calls do not carry that marker; their messages already obey the immutable creation contract."}]},{name:"session-telemetry/record",mode:"waterfall",signature:"'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord",summary:"Transform one outbound record before it reaches the backend.",description:"Transform one outbound record before it reaches the backend. This waterfall is the Service Definition's redaction extension point. It ships NO rules of its own: the innermost `next()` passes the record through unchanged, and with no listener mounted records reach the backend as captured, so exported data is exactly as clean as the rules a deployment mounts. Listeners stack by transforming `next()`'s return value; returning without `next()` replaces everything beneath. Dispatched synchronously on the capture hot path inside the coordinator's containment: a throwing listener withholds that one record (fail-closed) and never reaches the agent loop. Live capture dispatches at append time; on-demand capture dispatches while reading the canonical log. Redaction applies to the exported copy only; the canonical session log is never rewritten.",parameters:[{name:"record",description:"the candidate record, already the coordinator's own deep copy; listeners return a (possibly new) record and must not mutate it."}]},{name:"session/created",mode:"emit",signature:"'session/created'(this: Scoped<Session>, session: Session): void",summary:"Creation announcement during session publication.",description:"Creation announcement during session publication. A synchronous throw vetoes and rolls back with a paired disposal; detach requested during dispatch is deferred. A returned-promise rejection is logged but cannot retroactively veto this synchronous boundary. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only sessions entered through that agent's context.",parameters:[{name:"session",description:"the session just entered and announced."}]},{name:"session/disposed",mode:"emit",signature:"'session/disposed'(this: Scoped<Session>, session: Session): void",summary:"Emitted once when an announced session leaves the store, including publication rollback, but never for an entry whose creation announcement did not begin.",description:"Emitted once when an announced session leaves the store, including publication rollback, but never for an entry whose creation announcement did not begin. Listener failures are logged and contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.",parameters:[{name:"session",description:"the session that is no longer live in the store."}]},{name:"session/event",mode:"emit",signature:"'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void",summary:"Post-commit, fire-and-forget append feed.",description:"Post-commit, fire-and-forget append feed. The listener snapshot resolves before the log push, but callbacks run after it; observer failures are logged and contained without making the committed append fail. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only events from sessions entered through that agent's context.",parameters:[{name:"session",description:"the session whose log grew."},{name:"event",description:"the appended event, exactly as recorded."}]},{name:"session/flush",mode:"parallel",signature:"'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void",summary:"Awaited parallel durability checkpoint: every listener runs and the caller awaits all of them, with no waterfall veto.",description:"Awaited parallel durability checkpoint: every listener runs and the caller awaits all of them, with no waterfall veto. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.",parameters:[{name:"session",description:"the session whose buffered events must reach durable storage."}]},{name:"settings/document-updated",mode:"emit",signature:"'settings/document-updated'(ns: SettingsNamespace, revision: number): void",summary:"One registered namespace's RAW user section changed, whether or not the resolved value did.",description:"One registered namespace's RAW user section changed, whether or not the resolved value did. `settings/updated` is the consumer-facing event and stays deep-equal-gated; this one exists for configuration surfaces, which must learn that a field went from inherited to overridden (same resolved value, different meaning) and that their held revision is stale. Listener containment matches `settings/updated`.",parameters:[{name:"ns",description:"the namespace whose stored section changed."},{name:"revision",description:"the namespace's new revision."}]},{name:"settings/updated",mode:"emit",signature:"'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void",summary:"Committed change to one registered namespace's resolved value.",description:"Committed change to one registered namespace's resolved value. Emitted after the provider persisted (for `update`) or published (`provider`) the change; never emitted when the resolved value is deep-equal. Listener failures are contained and logged — a sync throw and an async rejection alike — except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.",parameters:[{name:"ns",description:"the namespace whose resolved value changed."},{name:"next",description:"the new resolved value."},{name:"prev",description:"the previous resolved value."},{name:"source",description:"whether the change entered through `update()` or the provider."}]},{name:"skills/change",mode:"emit",signature:"'skills/change'(): void",summary:"A skill provider, runtime contribution, or provider-backed catalog may have changed.",description:"A skill provider, runtime contribution, or provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers refetch the catalog for their own lookup options. Listener failures are contained and cannot veto the registry mutation.",parameters:[]},{name:"subagent/end",mode:"emit",signature:"'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void",summary:"A published child settled.",description:"A published child settled. Scope-filtered dispatch uses the same delegating parent carrier as `subagent/start`, so the lifecycle pair reaches the same scoped audience.",parameters:[{name:"info",description:"the run identity and terminal outcome."}]},{name:"subagent/provider-added",mode:"emit",signature:"'subagent/provider-added'(provider: SubagentProvider): void",summary:"A provider became resolvable in the registry.",description:"A provider became resolvable in the registry.",parameters:[{name:"provider",description:"the registered provider."}]},{name:"subagent/provider-removed",mode:"emit",signature:"'subagent/provider-removed'(name: string): void",summary:"A provider left the registry.",description:"A provider left the registry. Accepted runs remain holder-owned.",parameters:[{name:"name",description:"the provider name that no longer resolves."}]},{name:"subagent/start",mode:"emit",signature:"'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void",summary:"A provider established a published child.",description:"A provider established a published child. For in-process providers, `ctx.agents.get(info.id)` resolves during this notification. Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations. Paired with `subagent/end`.",parameters:[{name:"info",description:"the provider and published child identity."}]},{name:"system-prompt/assemble",mode:"waterfall",signature:"'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>",summary:"Expert waterfall over the assembled sections, contexts, tools, and variables.",description:"Expert waterfall over the assembled sections, contexts, tools, and variables. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners receive only that scope's assemblies. The returned value is authoritative. A supplied signal controls only this explicit assembly request and must not be retained to control later turns. A registered complete section is restored after this waterfall, so listeners cannot add to or replace that scope's system prompt.",parameters:[{name:"assembly",description:"the mutable assembly built from registered providers."},{name:"context",description:"the caller's per-assembly context."}]},{name:"system-prompt/change",mode:"emit",signature:"'system-prompt/change'(): void",summary:"Emitted when any prompt provider changes.",description:"Emitted when any prompt provider changes. This registry notification is unfiltered because a global change affects every scope.",parameters:[]},{name:"tools/change",mode:"emit",signature:"'tools/change'(): void",summary:"A tool was registered or unregistered, or a scoped restriction changed (the available tool set changed — possibly for one scope only).",description:"A tool was registered or unregistered, or a scoped restriction changed (the available tool set changed — possibly for one scope only). An UNFILTERED registry-subject notification, deliberately not scope-filtered dispatch: a global change concerns every agent's next assembly, so a scoped listener subscribing here sees every change, not just its own scope's.",parameters:[]},{name:"tools/code-dispatch-log",mode:"waterfall",signature:"'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>",summary:"Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome before the bridge appends its `tool/code-dispatch` event.",description:"Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome before the bridge appends its `tool/code-dispatch` event. `next()` keeps the content unchanged; a listener may return replacement blocks (e.g. the spill policy's preview + locator for an oversized text result). Only the logged copy is affected — the program already received the complete value, and the model sees neither. A throwing listener is contained: the bridge falls back to logging the original settled content. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.",parameters:[{name:"dispatch",description:"the parent execution, sub-call identity, and the settled content to log."}]},{name:"tools/execute",mode:"waterfall",signature:"'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>",summary:"Around-dispatch waterfall for timeout, retry, or metrics.",description:"Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns a normalized result; wrappers may change only `exec.signal`, while call identity remains immutable. The registry re-fuses the original caller signal before the body, so replacement cannot detach caller cancellation; wrappers must still restore their signal and reach quiescence. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.",parameters:[{name:"exec",description:"the allowed call about to dispatch (name, parsed arguments, caller agent, signal)."}]},{name:"tools/post-execute",mode:"waterfall",signature:"'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>",summary:"Accept, replace, enrich, or block a normalized dispatch result.",description:"Accept, replace, enrich, or block a normalized dispatch result. `next()` accepts it unchanged; thrown tools still reach this waterfall as errors. Async listeners must observe `exec.signal`; after they settle, caller cancellation replaces only a successful accepted outcome with the code selected by whether the tool body was invoked. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.",parameters:[{name:"exec",description:"the call that just ran (name, parsed arguments, caller agent)."},{name:"result",description:"the dispatch outcome a listener may accept, replace, or block."}]},{name:"tools/pre-execute",mode:"waterfall",signature:"'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>",summary:"Allow, deny, or ask before dispatch.",description:"Allow, deny, or ask before dispatch. `next()` delegates to allow; missing approval support turns `ask` into denial. Async gates must observe `exec.signal`; the registry rechecks cancellation after they settle but never abandons their promise. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.",parameters:[{name:"exec",description:"the pending call (name, parsed arguments, caller agent)."}]},{name:"tools/result",mode:"emit",signature:"'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined",summary:"Observe the frozen, lossless-JSON final outcome.",description:"Observe the frozen, lossless-JSON final outcome. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.",parameters:[{name:"exec",description:"the execution object that traversed the pipeline."},{name:"result",description:"a deep-frozen snapshot of the final returned result."}]},{name:"webserver/index-inject",mode:"emit",signature:"'webserver/index-inject'(table: IndexInjection[]): void",summary:"Collect the structured index injection table.",description:"Collect the structured index injection table. Emitted on every index render and every worker boot-payload request; listeners push their current rows, so a row's data is read fresh at emit time.",parameters:[{name:"table",description:"Mutable row table; listeners append in activation order."}]},{name:"workflow/agent-end",mode:"emit",signature:"'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void",summary:"One `agent()` call settled (clean result, child failure, or run cancellation).",description:"One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path (a worker killed past its grace) the end is engine-synthesized with outcome `'cancelled'`.",parameters:[{name:"info",description:"the run's identity snapshot."},{name:"agent",description:"the call identity plus its outcome."}]},{name:"workflow/agent-start",mode:"emit",signature:"'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void",summary:"One `agent()` call established a published child run.",description:"One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.",parameters:[{name:"info",description:"the run's identity snapshot."},{name:"agent",description:"the call's sequence number, label, phase, and child id."}]},{name:"workflow/end",mode:"emit",signature:"'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void",summary:"A workflow run settled (any stop reason).",description:"A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].",parameters:[{name:"info",description:"the run's identity snapshot."},{name:"result",description:"the outcome data (stop reason, error, agent count) — deliberately WITHOUT the result value (see {@link WorkflowResultInfo})."}]},{name:"workflow/log",mode:"emit",signature:"'workflow/log'(info: WorkflowRunInfo, message: string): void",summary:"The script emitted a narration line (a `log(message)` call).",description:"The script emitted a narration line (a `log(message)` call).",parameters:[{name:"info",description:"the run's identity snapshot."},{name:"message",description:"the logged message, verbatim."}]},{name:"workflow/phase",mode:"emit",signature:"'workflow/phase'(info: WorkflowRunInfo, title: string): void",summary:"The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.",description:"The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.",parameters:[{name:"info",description:"the run's identity snapshot."},{name:"title",description:"the phase title, verbatim."}]},{name:"workflow/start",mode:"emit",signature:"'workflow/start'(info: WorkflowRunInfo): void",summary:"A workflow run started — the script's meta block validated, the body about to execute.",description:"A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].",parameters:[{name:"info",description:"the run's identity snapshot (id + meta)."}]}],v=[{name:"AdapterRegistrationHandle",declaration:`export interface AdapterRegistrationHandle {
    (): void;
    replace(providers: string[]): void;
}`},{name:"Agent",declaration:`export interface Agent {
    readonly id: SessionId;
    readonly options: AgentOptions;
    readonly session: Session;
    readonly inbox: Inbox;
    readonly status: AgentStatus;
    readonly ctx: Context;
    cancel(cause: AgentCancelCause, options?: CancelOptions): void;
    whenIdle(): Promise<void>;
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
    followup(message: UserMessage): void;
    steer(message: UserMessage): void;
    inject(message: UserMessage): void;
}`},{name:"AgentCancelCause",declaration:`export type AgentCancelCause = {
    readonly kind: 'user';
} | {
    readonly kind: 'parent';
} | {
    readonly kind: 'hook';
    readonly reason: string;
} | {
    readonly kind: 'disposed';
};`},{name:"AgentFactory",declaration:`export interface AgentFactory {
    createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>;
    resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>;
}`},{name:"AgentHandle",declaration:`export interface AgentHandle {
    agent: Agent;
    dispose(): Promise<void>;
}`},{name:"AgentOptions",declaration:`export interface AgentOptions {
    provider?: string;
    model?: string;
    maxTokens?: number;
}`},{name:"AgentPreset",declaration:`export interface AgentPreset {
    readonly id: string;
    readonly trust: PresetTrust;
    readonly path: string;
    readonly name?: string;
    readonly description?: string;
    readonly order?: number;
    readonly broken?: string;
}`},{name:"AgentSetup",declaration:"export type AgentSetup = (agentCtx: Context) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void;"},{name:"AgentSetupCommit",declaration:`export interface AgentSetupCommit {
    commit(): void;
}`},{name:"AgentStatus",declaration:"export type AgentStatus = 'idle' | 'running';"},{name:"ApiKeyRecord",declaration:`export interface ApiKeyRecord {
    readonly kind: 'api-key';
    readonly key?: string;
    readonly env?: Readonly<Record<string, string>>;
}`},{name:"ApprovalOutcome",declaration:"export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';"},{name:"ApprovalPolicy",declaration:"export type ApprovalPolicy = 'ask' | 'never';"},{name:"ApprovalRequest",declaration:`export interface ApprovalRequest {
    readonly agent: Agent;
    readonly toolName: string;
    readonly callId?: CallId;
    readonly reason?: string;
    readonly signal?: AbortSignal;
}`},{name:"ApprovalService",declaration:`export class ApprovalService extends Service {
    static Config: z<Config>;
    constructor(ctx: Context, public config: Config);
    setPolicy(agent: Agent, policy: ApprovalPolicy): void;
    async request(req: ApprovalRequest): Promise<ApprovalOutcome>;
    overrideOf(session: Session): ApprovalPolicy | undefined;
}`},{name:"AskUserQuestionAnswer",declaration:`export interface AskUserQuestionAnswer {
    answers: AskUserQuestionAnswerItem[];
}`},{name:"AskUserQuestionAnswerItem",declaration:`export interface AskUserQuestionAnswerItem {
    id: string;
    selected: string[];
    custom?: string;
}`},{name:"AskUserQuestionIntent",declaration:`export type AskUserQuestionIntent = {
    kind: 'plan-review';
    approve: string;
};`},{name:"AskUserQuestionItem",declaration:`export interface AskUserQuestionItem {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: AskUserQuestionOption[];
    multiSelect?: boolean;
    intent?: AskUserQuestionIntent;
}`},{name:"AskUserQuestionOption",declaration:`export interface AskUserQuestionOption {
    label: string;
    description?: string;
}`},{name:"AskUserQuestionRequest",declaration:`export interface AskUserQuestionRequest {
    questions: AskUserQuestionItem[];
    agent?: Agent;
    signal?: AbortSignal;
}`},{name:"AssembleContext",declaration:`export interface AssembleContext {
    scope?: ScopeKey;
    signal?: AbortSignal;
}`},{name:"AssembledContext",declaration:`export interface AssembledContext {
    name: string;
    text: string;
}`},{name:"AssembledSection",declaration:`export interface AssembledSection {
    name: string;
    text: string;
}`},{name:"AssistantMessage",declaration:`export interface AssistantMessage extends Message {
    readonly role: 'assistant';
    readonly source: ModelMessageSource;
}`},{name:"AssistantProvenance",declaration:`export interface AssistantProvenance {
    provider: string;
    model: string;
    replayState?: unknown;
}`},{name:"AttachmentId",declaration:"export type AttachmentId = Branded<'AttachmentId'>;"},{name:"AuthorizationEntry",declaration:`export interface AuthorizationEntry {
    key: CredentialKey;
    label: string;
    methods: readonly AuthorizationMethod[];
    inFlight: boolean;
}`},{name:"AuthorizationFlow",declaration:`export interface AuthorizationFlow {
    readonly key: CredentialKey;
    readonly label: string;
    readonly methods: readonly [
        AuthorizationMethod,
        ...AuthorizationMethod[]
    ];
    run(session: AuthorizationSession): Promise<void>;
}`},{name:"AuthorizationInteraction",declaration:`export interface AuthorizationInteraction {
    notify(notice: AuthorizationNotice): void;
    prompt(prompt: AuthorizationPrompt): Promise<string>;
}`},{name:"AuthorizationMethod",declaration:`export interface AuthorizationMethod {
    id: string;
    label: string;
}`},{name:"AuthorizationNotice",declaration:`export interface AuthorizationNotice {
    message: string;
    url?: string;
    code?: string;
}`},{name:"AuthorizationOutcome",declaration:`export interface AuthorizationOutcome {
    status: AuthorizationStatus;
}`},{name:"AuthorizationPrompt",declaration:`export type AuthorizationPrompt = {
    signal?: AbortSignal;
} & ({
    kind: 'text';
    message: string;
    placeholder?: string;
} | {
    kind: 'secret';
    message: string;
    placeholder?: string;
} | {
    kind: 'select';
    message: string;
    options: readonly AuthorizationPromptOption[];
});`},{name:"AuthorizationPromptOption",declaration:`export interface AuthorizationPromptOption {
    id: string;
    label: string;
    description?: string;
}`},{name:"AuthorizationRequest",declaration:`export interface AuthorizationRequest {
    key: CredentialKey;
    method?: string;
    interaction: AuthorizationInteraction;
    signal?: AbortSignal;
}`},{name:"AuthorizationSession",declaration:`export interface AuthorizationSession {
    readonly method: string;
    readonly signal: AbortSignal;
    notify(notice: AuthorizationNotice): void;
    prompt(prompt: AuthorizationPrompt): Promise<string>;
}`},{name:"AuthorizationSettlement",declaration:"export type AuthorizationSettlement = AuthorizationStatus | 'failed';"},{name:"AuthorizationStatus",declaration:"export type AuthorizationStatus = 'authorized' | 'cancelled';"},{name:"BackendRegistry",declaration:`export class BackendRegistry {
    register(name: string, backend: StorageBackend): () => void;
    get(name: string): StorageBackend;
    names(): string[];
}`},{name:"BashEnvContributor",declaration:`export interface BashEnvContributor {
    name: string;
    variables: Readonly<Record<DshEnvironmentKey, BashEnvVariable>>;
    resolve(execution: ToolExecution): Readonly<Partial<Record<DshEnvironmentKey, string>>>;
}`},{name:"BashEnvVariable",declaration:`export interface BashEnvVariable {
    description: string;
}`},{name:"BashEnvVariableInfo",declaration:`export interface BashEnvVariableInfo extends BashEnvVariable {
    contributor: string;
    key: DshEnvironmentKey;
}`},{name:"Branded",declaration:`export type Branded<B extends string> = string & {
    readonly [BRAND]: B;
};`},{name:"CancelOptions",declaration:`export interface CancelOptions {
    keepInbox?: boolean | undefined;
}`},{name:"ClientResponse",declaration:`export interface ClientResponse {
    type: 'client-response';
    rpcId: RpcId;
    result: RpcResult<unknown>;
}`},{name:"CodeBindingErrorClass",declaration:`export interface CodeBindingErrorClass {
    name: string;
    memberNameProperty: string;
}`},{name:"CodeBindingFunction",declaration:"export type CodeBindingFunction = (args: unknown) => Promise<CodeJsonValue>;"},{name:"CodeBindingNamespace",declaration:`export interface CodeBindingNamespace {
    global: string;
    functions: Record<string, CodeBindingFunction>;
    errorClass?: CodeBindingErrorClass;
}`},{name:"CodeDispatchLog",declaration:`export interface CodeDispatchLog {
    readonly exec: ToolExecution;
    readonly agent?: Agent;
    readonly subCallId: CallId;
    readonly name: string;
    readonly isError: boolean;
    readonly content: ContentBlock[];
}`},{name:"CodeJsonValue",declaration:`export type CodeJsonValue = null | boolean | number | string | CodeJsonValue[] | {
    [key: string]: CodeJsonValue;
};`},{name:"CodeRunFailure",declaration:`export interface CodeRunFailure {
    kind: 'exception' | 'timeout' | 'abort' | 'worker-exit' | 'invalid-output' | 'output-limit';
    message: string;
}`},{name:"CodeRunRequest",declaration:`export interface CodeRunRequest {
    program: string;
    bindings: CodeBindingNamespace[];
    signal?: AbortSignal;
}`},{name:"CodeRunResult",declaration:`export interface CodeRunResult {
    value?: CodeJsonValue;
    logs: string[];
    error?: CodeRunFailure;
}`},{name:"CollectedOutput",declaration:`export interface CollectedOutput {
    text: string;
    truncated: boolean;
    spillPath?: string;
}`},{name:"CommandDefinition",declaration:`export interface CommandDefinition {
    readonly name: string;
    readonly description: string;
    readonly input?: CommandInputDescriptor;
    readonly recordInput?: boolean;
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}`},{name:"CommandDescriptor",declaration:`export interface CommandDescriptor {
    readonly name: string;
    readonly description: string;
    readonly input?: CommandInputDescriptor;
}`},{name:"CommandExecution",declaration:`export interface CommandExecution {
    readonly commandId: CommandId;
    readonly result: CommandResult;
}`},{name:"CommandId",declaration:"export type CommandId = Branded<'CommandId'>;"},{name:"CommandInputDescriptor",declaration:`export interface CommandInputDescriptor {
    readonly hint: string;
    readonly images?: boolean;
}`},{name:"CommandInvocation",declaration:`export interface CommandInvocation {
    readonly commandId: CommandId;
    readonly agent: Agent;
    readonly rawInput: string;
    readonly attachments: readonly ImageBlock[];
    readonly signal: AbortSignal;
}`},{name:"CommandResult",declaration:`export type CommandResult = {
    readonly kind: 'success';
    readonly text?: string;
    readonly sourceEventSeq?: number;
} | {
    readonly kind: 'error';
    readonly text: string;
};`},{name:"CompactionAgentContext",declaration:`export interface CompactionAgentContext {
    session: Session;
    options: {
        provider?: string;
        model?: string;
    };
}`},{name:"CompactionId",declaration:"export type CompactionId = Branded<'CompactionId'>;"},{name:"CompactionResult",declaration:`export interface CompactionResult {
    compactionId: CompactionId;
    sourceCommandId?: CommandId;
    startSeq: number;
    summarySeq: number;
    endSeq: number;
    summary: ContentBlock[];
    shadowedRange: {
        start: number;
        end: number;
    };
    shadowedSeqs: number[];
    shadowedTokenCount: number;
}`},{name:"CompactionTrigger",declaration:"export type CompactionTrigger = 'pressure' | 'context-overflow';"},{name:"ConfinedArgv",declaration:`export interface ConfinedArgv {
    argv: string[];
    enforcement: SandboxEnforcement;
    denialSignatures: readonly string[];
    runnerFailureRules: readonly RunnerFailureRule[];
}`},{name:"ConfinedSandboxMode",declaration:"export type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>;"},{name:"ContentBlockMap",declaration:`export interface ContentBlockMap {
    'text': TextBlock;
    'reasoning': ReasoningBlock;
    'image': ImageBlock;
    'tool-call': ToolCallBlock;
    'tool-result': ToolResultBlock;
}`},{name:"ContentBlockType",declaration:"export type ContentBlockType = keyof ContentBlockMap;"},{name:"ContextFormed",declaration:`export type ContextFormed = {
    readonly form?: never;
} | {
    readonly form: 'instructions';
} | {
    readonly form: 'catalog';
} | {
    readonly form: 'snapshot';
    readonly sections: readonly ContextSnapshotSection[];
} | {
    readonly form: 'notice';
    readonly summary: string;
} | {
    readonly form: 'relay';
} | {
    readonly form: 'recall';
};`},{name:"ContextSnapshotSection",declaration:`export interface ContextSnapshotSection {
    readonly name: string;
    readonly text: string;
}`},{name:"ContinuableCreateRequest",declaration:`export interface ContinuableCreateRequest {
    readonly sessionId: SessionId;
    readonly parent: Agent;
    readonly signal: AbortSignal;
}`},{name:"ContinuableCreateSpec",declaration:`export interface ContinuableCreateSpec {
    readonly seed?: readonly SessionEvent[];
}`},{name:"ContinuableSetupContribution",declaration:"export type ContinuableSetupContribution = (childCtx: Context) => () => void;"},{name:"ContinuableStart",declaration:`export interface ContinuableStart {
    readonly childId: SessionId;
    readonly messageId: MessageId;
}`},{name:"ContinuableStartSpec",declaration:`export interface ContinuableStartSpec {
    readonly provider: string;
    readonly label: string;
    readonly childId?: SessionId;
    readonly request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>;
    readonly signal: AbortSignal;
}`},{name:"ContinuableSubagentDescriptorData",declaration:`export interface ContinuableSubagentDescriptorData extends SubagentDescriptorBase {
    readonly mode: 'continuable';
    readonly label: string;
    readonly agentProvider?: string;
    readonly agentModel?: string;
    readonly persona?: string;
    readonly toolFilter?: ToolRestriction;
}`},{name:"CordisDynamicPackageId",declaration:"export type CordisDynamicPackageId = Branded<'CordisDynamicPackageId'>;"},{name:"CordisDynamicPluginId",declaration:"export type CordisDynamicPluginId = Branded<'CordisDynamicPluginId'>;"},{name:"CordisDynamicPluginRunId",declaration:"export type CordisDynamicPluginRunId = Branded<'CordisDynamicPluginRunId'>;"},{name:"CordisDynamicRunMode",declaration:"export type CordisDynamicRunMode = 'run' | 'update';"},{name:"CordisInspectQueryRequest",declaration:`export interface CordisInspectQueryRequest {
    requestId: CordisInspectRequestId;
    agentId: SessionId;
    provider: string;
    method: string;
    input?: JsonValue;
}`},{name:"CordisInspectQueryResolved",declaration:`export interface CordisInspectQueryResolved {
    requestId: CordisInspectRequestId;
}`},{name:"CordisInspectRequestId",declaration:"export type CordisInspectRequestId = Branded<'CordisInspectRequestId'>;"},{name:"CreateAgentOptions",declaration:`export interface CreateAgentOptions {
    readonly sessionId: SessionId;
    readonly meta?: {
        readonly cwd?: string;
        readonly parentSession?: SessionId;
        readonly seedLength?: number;
        readonly origin?: 'subagent';
        readonly delegationDepth?: number;
        readonly agentPreset?: string;
    };
    readonly seed?: readonly SessionEvent[];
    readonly agentOptions?: AgentOptions;
    readonly signal?: AbortSignal;
    readonly setup?: AgentSetup;
}`},{name:"CreateGoalRequest",declaration:`export interface CreateGoalRequest {
    readonly objective: string;
    readonly maxGoalRounds?: number;
}`},{name:"CreateGoalResult",declaration:`export interface CreateGoalResult {
    readonly ref: GoalRef;
}`},{name:"CreateSessionOptions",declaration:`export interface CreateSessionOptions {
    readonly seed?: readonly SessionEvent[];
    readonly meta?: {
        readonly cwd?: string;
        readonly parentSession?: SessionId;
        readonly createdAt?: number;
        readonly seedLength?: number;
        readonly origin?: 'subagent';
        readonly delegationDepth?: number;
        readonly agentPreset?: string;
    };
}`},{name:"CreateTeamTaskRequest",declaration:`export interface CreateTeamTaskRequest {
    readonly subject: string;
    readonly description: string;
    readonly blockedBy?: readonly TeamTaskId[];
    readonly writeScopes?: readonly string[];
}`},{name:"CredentialInfo",declaration:`export interface CredentialInfo {
    configured: boolean;
    source?: string;
    writable: boolean;
}`},{name:"CredentialKey",declaration:"export type CredentialKey = Branded<'CredentialKey'>;"},{name:"CredentialRecord",declaration:"export type CredentialRecord = ApiKeyRecord | GrantRecord;"},{name:"CredentialRecordEntry",declaration:`export interface CredentialRecordEntry {
    key: CredentialKey;
    kind: CredentialRecord['kind'];
}`},{name:"CredentialRecordInfo",declaration:`export interface CredentialRecordInfo {
    configured: boolean;
    kind?: CredentialRecord['kind'];
    writable: boolean;
}`},{name:"CredentialRef",declaration:"export type CredentialRef = Branded<'CredentialRef'>;"},{name:"DiffCallView",declaration:`export interface DiffCallView {
    card: 'diff';
    title: string;
    diffs: FileDiff[];
    locations?: FileLocation[];
}`},{name:"DiffResultView",declaration:`export interface DiffResultView {
    card: 'diff';
    title?: string;
    diffs: FileDiff[];
}`},{name:"DirectoryPickerBrowseCapability",declaration:`export interface DirectoryPickerBrowseCapability {
    kind: 'browse';
    list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>;
    createDirectory(path: string, name: string): Promise<string>;
}`},{name:"DirectoryPickerCapabilities",declaration:`export interface DirectoryPickerCapabilities {
    native: DirectoryPickerNativeCapability;
    browse: DirectoryPickerBrowseCapability;
}`},{name:"DirectoryPickerCapability",declaration:"export type DirectoryPickerCapability = DirectoryPickerCapabilities[keyof DirectoryPickerCapabilities];"},{name:"DirectoryPickerNativeCapability",declaration:`export interface DirectoryPickerNativeCapability {
    kind: 'native';
    pick(signal: AbortSignal): Promise<string | null>;
}`},{name:"DirectoryRegistrationHandle",declaration:`export interface DirectoryRegistrationHandle {
    (): void;
    replace(entries: readonly LlmConfigurableProvider[]): void;
}`},{name:"Domain",declaration:`export interface Domain<S extends DomainSpec> {
    readonly name: string;
    readonly global: DomainGlobalHandleOf<S>;
    table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>;
    close(): Promise<void>;
}`},{name:"DomainChanged",declaration:"export type DomainChanged = DomainChangedPut | DomainChangedDeleted;"},{name:"DomainChangedBase",declaration:`export interface DomainChangedBase {
    readonly domain: string;
    readonly table: string;
    readonly key: string;
}`},{name:"DomainChangedDeleted",declaration:`export interface DomainChangedDeleted extends DomainChangedBase {
    readonly operation: 'deleted';
    readonly value?: never;
}`},{name:"DomainChangedPut",declaration:`export interface DomainChangedPut extends DomainChangedBase {
    readonly operation: 'put';
    readonly value: unknown;
}`},{name:"DomainGlobal",declaration:`export interface DomainGlobal<G> {
    get(): G;
    set(value: G): Promise<void>;
}`},{name:"DomainGlobalHandleOf",declaration:`export type DomainGlobalHandleOf<S extends DomainSpec> = S extends {
    readonly global: DomainGlobalSpec<infer G>;
} ? DomainGlobal<G> : never;`},{name:"DomainGlobalSpec",declaration:`export interface DomainGlobalSpec<G> {
    readonly schema: ZodType<G>;
    readonly initial: G;
}`},{name:"DomainImpl",declaration:`export class DomainImpl {
    readonly name: string;
    constructor(private readonly ctx: Context, spec: DomainSpec, private readonly unit: KvUnit, records: Map<string, Map<string, unknown>>, globalValue: unknown, private readonly onClosed: () => void);
    get global(): DomainGlobal<unknown>;
    table(name: string): KvTable<string, unknown>;
    close(): Promise<void>;
}`},{name:"DomainSpec",declaration:`export interface DomainSpec {
    readonly name: string;
    readonly version: number;
    readonly global?: DomainGlobalSpec<unknown>;
    readonly tables: Record<string, DomainTableSpec>;
}`},{name:"DomainTableSpec",declaration:`export interface DomainTableSpec<K extends string = string, V = unknown> {
    readonly valueSchema: ZodType<V>;
    readonly __key?: K;
}`},{name:"DownloadsApi",declaration:`export interface DownloadsApi {
    sessionLog(request: {
        sessionId: SessionId;
        includeDescendants?: boolean;
    }, signal: AbortSignal): Promise<Response>;
}`},{name:"DshEnvironment",declaration:"export type DshEnvironment = Readonly<Record<DshEnvironmentKey, string>>;"},{name:"DshEnvironmentKey",declaration:"export type DshEnvironmentKey = `${typeof DSH_ENV_PREFIX}${string}`;"},{name:"DynamicCordisPackage",declaration:`export interface DynamicCordisPackage {
    pluginId: CordisDynamicPluginId;
    packageId: CordisDynamicPackageId;
    pluginRunId: CordisDynamicPluginRunId;
    name: string;
}`},{name:"DynamicCordisRequestResolved",declaration:`export interface DynamicCordisRequestResolved {
    requestId: ApprovalRequestId;
    outcome: RequestRunOutcome;
}`},{name:"DynamicCordisRetracted",declaration:`export interface DynamicCordisRetracted {
    pluginId: CordisDynamicPluginId;
    packageId: CordisDynamicPackageId;
    pluginRunId: CordisDynamicPluginRunId;
}`},{name:"DynamicCordisRunRequest",declaration:`export interface DynamicCordisRunRequest {
    requestId: ApprovalRequestId;
    agentId: SessionId;
    pluginId: CordisDynamicPluginId;
    packageId: CordisDynamicPackageId;
    mode: CordisDynamicRunMode;
    name: string;
    purpose: string;
    requiresApproval: boolean;
}`},{name:"EditGoalRequest",declaration:`export interface EditGoalRequest {
    readonly objective?: string;
    readonly maxGoalRounds?: number;
}`},{name:"EncodedImageAttachment",declaration:`export interface EncodedImageAttachment {
    mediaType: ImageMediaType;
    data: string;
    name?: string;
}`},{name:"EpochHeader",declaration:`export interface EpochHeader {
    config: LlmCallConfig;
    adapterDefaults?: LlmCallConfigAdapterDefaults;
    system?: string;
    tools?: ToolSchema[];
}`},{name:"FileDiff",declaration:`export interface FileDiff {
    path: string;
    oldText: string | null;
    newText: string;
}`},{name:"FileLocation",declaration:`export interface FileLocation {
    path: string;
    line?: number;
}`},{name:"FileReferenceCandidate",declaration:`export interface FileReferenceCandidate {
    path: string;
    kind: 'file' | 'directory';
}`},{name:"FinishReason",declaration:"export type FinishReason = FinishReasonMap[keyof FinishReasonMap];"},{name:"FinishReasonMap",declaration:`export interface FinishReasonMap {
    'stop': {
        kind: 'stop';
    };
    'tool-calls': {
        kind: 'tool-calls';
    };
    'max-tokens': {
        kind: 'max-tokens';
    };
    'aborted': {
        kind: 'aborted';
        failure: LlmFailure;
    };
    'error': {
        kind: 'error';
        failure: LlmFailure;
    };
}`},{name:"FsDirEntry",declaration:`export interface FsDirEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    target: FsTarget;
    version?: FsVersion;
    size?: number;
}`},{name:"FsEditOutcome",declaration:`export interface FsEditOutcome {
    version: FsVersion;
    before: string;
    after: string;
}`},{name:"FsEditRequest",declaration:`export interface FsEditRequest {
    oldString: string;
    newString: string;
    replaceAll: boolean;
}`},{name:"FsInfo",declaration:`export interface FsInfo {
    version: FsVersion;
    type: 'file' | 'directory' | 'other';
    size?: number;
}`},{name:"FsObservation",declaration:`export type FsObservation = {
    readonly kind: 'present';
    readonly version: FsVersion;
} | {
    readonly kind: 'absent';
};`},{name:"FsPathInfo",declaration:`export interface FsPathInfo {
    version: FsVersion;
    type: 'file' | 'directory' | 'symlink' | 'other';
    size?: number;
}`},{name:"FsTarget",declaration:`export interface FsTarget {
    targetKey: FsTargetKey;
    displayPath: string;
}`},{name:"FsTargetKey",declaration:"export type FsTargetKey = Branded<'FsTargetKey'>;"},{name:"FsVersion",declaration:"export type FsVersion = Branded<'FsVersion'>;"},{name:"FsWriteIntent",declaration:`export type FsWriteIntent = {
    kind: 'createIfAbsent';
} | {
    kind: 'replaceIfVersion';
    version: FsVersion;
};`},{name:"FsWriteOutcome",declaration:`export interface FsWriteOutcome {
    operation: 'create' | 'update';
    version: FsVersion;
    before: string | null;
    after: string;
}`},{name:"GenerateOptions",declaration:`export interface GenerateOptions {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    messages: Message[];
    system?: string;
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
    signal?: AbortSignal;
    sessionId?: Branded<'SessionId'>;
    purpose?: 'compaction' | 'session-title';
}`},{name:"GenericCallView",declaration:`export interface GenericCallView {
    card: 'generic';
    title: string;
    kind?: ToolCallKind;
    rawInput?: unknown;
    content?: ContentBlock[];
    locations?: FileLocation[];
}`},{name:"GenericResultView",declaration:`export interface GenericResultView {
    card: 'generic';
    title?: string;
    content?: ContentBlock[];
}`},{name:"GoalActivation",declaration:"export type GoalActivation = 'armed' | 'disarmed';"},{name:"GoalBlockReason",declaration:`export interface GoalBlockReason {
    readonly code: string;
    readonly message: string;
}`},{name:"GoalChanged",declaration:`export interface GoalChanged {
    readonly operation: GoalOperation;
    readonly ref: GoalRef;
    readonly goal?: GoalView;
}`},{name:"GoalOperation",declaration:"export type GoalOperation = 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'block' | 'clear';"},{name:"GoalPhase",declaration:"export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete';"},{name:"GoalSnapshot",declaration:`export interface GoalSnapshot extends GoalRef {
    readonly objective: string;
    readonly phase: GoalPhase;
    readonly blockedReason?: GoalBlockReason;
    readonly maxGoalRounds: number;
}`},{name:"GoalView",declaration:`export interface GoalView extends GoalSnapshot {
    readonly roundsStarted: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly activation: GoalActivation;
}`},{name:"GrantRecord",declaration:`export interface GrantRecord {
    readonly kind: 'grant';
    readonly payload: unknown;
}`},{name:"ImageAttachmentLimits",declaration:`export interface ImageAttachmentLimits {
    maxImageBytes: number;
    maxImagesPerMessage: number;
    maxMessageImageBytes: number;
    maxImagePixels: number;
    maxImageDimension: number;
    mediaTypes: readonly ImageMediaType[];
}`},{name:"ImageAttachmentRef",declaration:`export interface ImageAttachmentRef {
    attachmentId: AttachmentId;
    mediaType: ImageMediaType;
    bytes: number;
    width: number;
    height: number;
    name?: string;
    originalDimensions?: {
        width: number;
        height: number;
    };
}`},{name:"ImageBlock",declaration:`export interface ImageBlock {
    type: 'image';
    attachment: ImageAttachmentRef;
}`},{name:"ImageMediaType",declaration:"export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';"},{name:"ImageRequestPolicy",declaration:`export interface ImageRequestPolicy {
    maxPixels: number;
    maxBytes: number;
}`},{name:"ImageVariantId",declaration:"export type ImageVariantId = Branded<'ImageVariantId'>;"},{name:"Inbox",declaration:`export class Inbox {
    constructor(private readonly session: Session, private readonly notifications: InboxNotifications);
    get nextTurn(): readonly UserMessage[];
    get nextStep(): readonly UserMessage[];
    get hasPending(): boolean;
    clear(): void;
    claim(target: InboxTarget, turn: number): UserMessage[];
    append(target: InboxTarget, message: UserMessage): void;
    prepend(target: InboxTarget, message: UserMessage): void;
    replace(messageId: MessageId, newMessage: UserMessage): boolean;
    remove(messageId: MessageId): boolean;
    splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[];
}`},{name:"InboxNotifications",declaration:`export interface InboxNotifications {
    inserted(message: UserMessage): void;
    discarded(message: UserMessage): void;
    claimed(message: UserMessage, turn: number): void;
}`},{name:"InboxTarget",declaration:"export type InboxTarget = 'next-turn' | 'next-step';"},{name:"IndexInjection",declaration:`export type IndexInjection = {
    kind: 'global';
    name: string;
    value: unknown;
} | {
    kind: 'script';
    placement: IndexInjectionPlacement;
    text: string;
} | {
    kind: 'script-src';
    placement: IndexInjectionPlacement;
    src: string;
} | {
    kind: 'style';
    text: string;
} | {
    kind: 'html';
    placement: IndexInjectionPlacement;
    html: string;
};`},{name:"IndexInjectionPlacement",declaration:"export type IndexInjectionPlacement = 'head' | 'body';"},{name:"InvariantFailure",declaration:"export type InvariantFailure = (message: string) => never;"},{name:"InvariantInstaller",declaration:`export interface InvariantInstaller {
    (ctx: Context, fail: InvariantFailure): void | Promise<void>;
    readonly inject?: Inject;
}`},{name:"InvocationDescriptor",declaration:`export interface InvocationDescriptor {
    readonly id: string;
    readonly service: string;
    readonly namespace: string;
    readonly method: string;
    readonly implementation?: string;
    readonly invocation: {
        readonly kind: 'direct';
    } | {
        readonly kind: 'context';
        readonly context: string;
        readonly wire: string;
        readonly codec: TypertCodec;
    };
    readonly scope?: {
        readonly context: string;
        readonly wire: string;
    };
    readonly parameters: readonly InvocationParameterDescriptor[];
    readonly cancellation?: {
        readonly parameter: 'signal';
    };
    readonly result: TypertCodec;
    readonly sourceLocation?: InvocationSourceLocation;
}`},{name:"InvocationParameterDescriptor",declaration:`export interface InvocationParameterDescriptor {
    readonly name: string;
    readonly wire: string;
    readonly source: 'json' | 'lookup';
    readonly lookup?: string;
    readonly codec: TypertCodec;
    readonly acceptsUndefined?: true;
}`},{name:"InvocationSourceLocation",declaration:`export interface InvocationSourceLocation {
    readonly file: string;
    readonly line: number;
    readonly column: number;
}`},{name:"InvokeRemoteRequest",declaration:`export interface InvokeRemoteRequest {
    readonly namespace: string;
    readonly method: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly signal?: AbortSignal;
}`},{name:"JobDoneListener",declaration:"export type JobDoneListener = (snapshot: JobSnapshot, owner: Agent | undefined) => void | PromiseLike<void>;"},{name:"JobHooks",declaration:`export interface JobHooks {
    cancel(reason?: string): void;
    done: Promise<JobOutcome>;
    readOutput?(): string;
}`},{name:"JobId",declaration:"export type JobId = Branded<'JobId'>;"},{name:"JobKind",declaration:"export type JobKind = JobKindMap[keyof JobKindMap];"},{name:"JobKindMap",declaration:`export interface JobKindMap {
    bash: 'bash';
    subagent: 'subagent';
}`},{name:"JobOutcome",declaration:`export interface JobOutcome {
    status: 'completed' | 'killed' | 'failed';
    detail?: string;
    output?: string;
}`},{name:"JobRead",declaration:`export interface JobRead {
    text: string;
    snapshot: JobSnapshot;
}`},{name:"JobsChangedListener",declaration:"export type JobsChangedListener = (owner: Agent | undefined) => void;"},{name:"JobSnapshot",declaration:`export interface JobSnapshot {
    id: JobId;
    kind: JobKind;
    label: string;
    outputLimitBytes?: number;
    ownerSession?: SessionId;
    status: JobStatus;
    detail?: string;
    startedAt: number;
    finishedAt?: number;
    reported: boolean;
}`},{name:"JobStart",declaration:`export interface JobStart {
    kind: JobKind;
    label: string;
    outputLimitBytes?: number;
    owner?: Agent;
    run(): JobHooks;
}`},{name:"JobStatus",declaration:"export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';"},{name:"JsonSchemaNode",declaration:`export interface JsonSchemaNode {
    type?: JsonSchemaType;
    oneOf?: JsonSchemaNode[];
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchemaNode;
    enum?: JsonSchemaScalar[];
    const?: JsonSchemaScalar;
    description?: string;
    title?: string;
    default?: JsonValue;
    examples?: JsonValue;
}`},{name:"JsonSchemaScalar",declaration:"export type JsonSchemaScalar = string | number | boolean | null;"},{name:"JsonSchemaType",declaration:"export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';"},{name:"JsonValue",declaration:`export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};`},{name:"KnobState",declaration:`export interface KnobState {
    preset: string | null;
    sandbox: SandboxMode | null;
    approval: ApprovalPolicy | null;
}`},{name:"KvFacet",declaration:`export interface KvFacet {
    open(descriptor: KvUnitDescriptor): Promise<KvUnit>;
}`},{name:"KvTable",declaration:`export interface KvTable<K extends string, V> {
    get(key: K): V | undefined;
    entries(): IterableIterator<[
        K,
        V
    ]>;
    keys(): IterableIterator<K>;
    readonly size: number;
    put(key: K, value: V): Promise<void>;
    delete(key: K): Promise<boolean>;
    update(key: K, fn: (current: V) => V): Promise<V>;
}`},{name:"KvUnit",declaration:`export interface KvUnit {
    loadAll(): Promise<{
        tables: Record<string, Record<string, unknown>>;
        global: unknown;
    }>;
    putRecord(table: string, key: string, value: unknown): Promise<void>;
    deleteRecord(table: string, key: string): Promise<void>;
    setGlobal(value: unknown): Promise<void>;
    close(): Promise<void>;
}`},{name:"KvUnitDescriptor",declaration:`export interface KvUnitDescriptor {
    readonly name: string;
    readonly version: number;
    readonly tables: readonly string[];
    readonly hasGlobal: boolean;
}`},{name:"LlmAdapter",declaration:`export abstract class LlmAdapter {
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
    listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}`},{name:"LlmCallConfig",declaration:`export interface LlmCallConfig {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
}`},{name:"LlmCallConfigAdapterDefaults",declaration:`export interface LlmCallConfigAdapterDefaults {
    reasoningEffort?: true;
    maxTokens?: true;
}`},{name:"LlmConfigurableProvider",declaration:`export interface LlmConfigurableProvider {
    provider: string;
    displayName: string;
    settingsNs: string;
    settingsPath: readonly string[];
    declared?: boolean;
}`},{name:"LlmDiscoveredModel",declaration:`export interface LlmDiscoveredModel {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
}`},{name:"LlmFailure",declaration:`export interface LlmFailure {
    readonly message: string;
    readonly code: string;
    readonly status?: number;
    readonly providerRetryAfterMs?: number;
    readonly requestId?: ProviderRequestId;
}`},{name:"LlmModelContext",declaration:`export interface LlmModelContext {
    contextWindow: number;
}`},{name:"LlmModelDiscoveryRequest",declaration:`export interface LlmModelDiscoveryRequest {
    provider?: string;
    baseURL?: string;
    api?: string;
    apiKey?: string;
    signal?: AbortSignal;
}`},{name:"LlmModelInfo",declaration:`export interface LlmModelInfo {
    provider: string;
    id: string;
    name: string;
    description?: string;
    inputModalities?: readonly ModelModality[];
}`},{name:"LlmModelReasoningInfo",declaration:`export interface LlmModelReasoningInfo {
    efforts: readonly LlmReasoningEffortInfo[];
    defaultEffort?: ReasoningEffortId;
}`},{name:"LlmProviderInfo",declaration:`export interface LlmProviderInfo {
    id: string;
    name: string;
}`},{name:"LlmReasoningEffortInfo",declaration:`export interface LlmReasoningEffortInfo {
    id: ReasoningEffortId;
    name: string;
    description?: string;
}`},{name:"LlmResolvedModelInfo",declaration:`export interface LlmResolvedModelInfo extends LlmModelInfo {
    context?: LlmModelContext;
    defaultMaxTokens?: number;
    reasoning?: LlmModelReasoningInfo;
}`},{name:"LlmRuntime",declaration:`export class LlmRuntime extends Service {
    constructor(ctx: Context);
    registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;
    listProviders(): LlmProviderInfo[];
    registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle;
    listConfigurableProviders(): LlmConfigurableProvider[];
    registerModelDiscovery(settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>): () => void;
    async discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<LlmDiscoveredModel[]>;
    providerRetryPolicy(provider: string): ResolvedRetryPolicy;
    async listModels(provider: string): Promise<LlmModelInfo[]>;
    async resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>;
    async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}`},{name:"LspHover",declaration:`export interface LspHover {
    readonly contents: string;
    readonly range?: LspRange;
}`},{name:"LspLocation",declaration:`export interface LspLocation {
    readonly uri: string;
    readonly range: LspRange;
}`},{name:"LspOperation",declaration:"export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover';"},{name:"LspPosition",declaration:`export interface LspPosition {
    readonly line: number;
    readonly character: number;
}`},{name:"LspProvider",declaration:`export interface LspProvider {
    readonly id: LspProviderId;
    readonly extensionToLanguage: Readonly<Record<string, string>>;
    query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>;
}`},{name:"LspProviderId",declaration:"export type LspProviderId = Branded<'LspProviderId'>;"},{name:"LspProviderQuery",declaration:`export interface LspProviderQuery extends LspQueryRequest {
    readonly languageId: string;
}`},{name:"LspQueryRequest",declaration:`export interface LspQueryRequest {
    readonly operation: LspOperation;
    readonly filePath: string;
    readonly position: LspPosition;
    readonly workspaceRoot: string;
}`},{name:"LspQueryResult",declaration:`export type LspQueryResult = {
    readonly kind: 'locations';
    readonly locations: readonly LspLocation[];
    readonly resolvedWorkspaceUri: string;
} | {
    readonly kind: 'hover';
    readonly hover: LspHover | null;
};`},{name:"LspRange",declaration:`export interface LspRange {
    readonly start: LspPosition;
    readonly end: LspPosition;
}`},{name:"ManualCompactAgentContext",declaration:`export interface ManualCompactAgentContext extends CompactionAgentContext {
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}`},{name:"Message",declaration:`export interface Message {
    readonly id: MessageId;
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: ContentBlock[];
    readonly source: MessageSource;
}`},{name:"MessageFeedbackDeleteRequest",declaration:`export interface MessageFeedbackDeleteRequest {
    readonly sessionId: SessionId;
    readonly messageId: MessageId;
    readonly ifVersion: MessageFeedbackVersion;
}`},{name:"MessageFeedbackDeleteResult",declaration:"export type MessageFeedbackDeleteResult = MessageFeedbackSuccess<MessageFeedbackDeleteValue> | MessageFeedbackRejected<MessageFeedbackSessionNotFound | MessageFeedbackVersionConflict>;"},{name:"MessageFeedbackDeleteValue",declaration:`export interface MessageFeedbackDeleteValue {
    readonly absent: true;
}`},{name:"MessageFeedbackFailure",declaration:"export type MessageFeedbackFailure = MessageFeedbackSessionNotFound | MessageFeedbackTargetNotFound | MessageFeedbackVersionConflict | MessageFeedbackNoteBlank | MessageFeedbackNoteTooLarge;"},{name:"MessageFeedbackItem",declaration:`export interface MessageFeedbackItem {
    readonly messageId: MessageId;
    readonly rating: MessageFeedbackRating;
    readonly note?: string;
    readonly version: MessageFeedbackVersion;
    readonly createdAt: number;
    readonly updatedAt: number;
}`},{name:"MessageFeedbackListRequest",declaration:`export interface MessageFeedbackListRequest {
    readonly sessionId: SessionId;
}`},{name:"MessageFeedbackListResult",declaration:"export type MessageFeedbackListResult = MessageFeedbackSuccess<MessageFeedbackListValue> | MessageFeedbackRejected<MessageFeedbackSessionNotFound>;"},{name:"MessageFeedbackListValue",declaration:`export interface MessageFeedbackListValue {
    readonly items: readonly MessageFeedbackItem[];
}`},{name:"MessageFeedbackNoteBlank",declaration:`export interface MessageFeedbackNoteBlank {
    readonly code: 'note-blank';
}`},{name:"MessageFeedbackNoteTooLarge",declaration:`export interface MessageFeedbackNoteTooLarge {
    readonly code: 'note-too-large';
    readonly maxBytes: number;
    readonly actualBytes: number;
}`},{name:"MessageFeedbackPutRequest",declaration:`export interface MessageFeedbackPutRequest {
    readonly sessionId: SessionId;
    readonly messageId: MessageId;
    readonly rating: MessageFeedbackRating;
    readonly note?: string;
    readonly ifVersion: MessageFeedbackVersion | null;
}`},{name:"MessageFeedbackPutResult",declaration:"export type MessageFeedbackPutResult = MessageFeedbackSuccess<MessageFeedbackItem> | MessageFeedbackRejected<MessageFeedbackSessionNotFound | MessageFeedbackTargetNotFound | MessageFeedbackVersionConflict | MessageFeedbackNoteBlank | MessageFeedbackNoteTooLarge>;"},{name:"MessageFeedbackRating",declaration:"export type MessageFeedbackRating = 'positive' | 'negative';"},{name:"MessageFeedbackRejected",declaration:`export interface MessageFeedbackRejected<E extends MessageFeedbackFailure> {
    readonly ok: false;
    readonly error: E;
}`},{name:"MessageFeedbackSessionNotFound",declaration:`export interface MessageFeedbackSessionNotFound {
    readonly code: 'session-not-found';
    readonly sessionId: SessionId;
}`},{name:"MessageFeedbackSuccess",declaration:`export interface MessageFeedbackSuccess<T> {
    readonly ok: true;
    readonly value: T;
}`},{name:"MessageFeedbackTargetNotFound",declaration:`export interface MessageFeedbackTargetNotFound {
    readonly code: 'target-not-found';
    readonly sessionId: SessionId;
    readonly messageId: MessageId;
}`},{name:"MessageFeedbackVersion",declaration:"export type MessageFeedbackVersion = Branded<'MessageFeedbackVersion'>;"},{name:"MessageFeedbackVersionConflict",declaration:`export interface MessageFeedbackVersionConflict {
    readonly code: 'version-conflict';
    readonly current: MessageFeedbackItem | null;
}`},{name:"MessageId",declaration:"export type MessageId = Branded<'MessageId'>;"},{name:"MessageSource",declaration:"export type MessageSource = MessageSourceMap[keyof MessageSourceMap];"},{name:"MessageSourceMap",declaration:`export interface MessageSourceMap {
    user: {
        kind: 'user';
    };
    plugin: {
        kind: 'plugin';
        plugin: string;
    } & ContextFormed;
    model: ModelMessageSource;
    tool: ToolMessageSource;
}`},{name:"ModelMessageSource",declaration:`export interface ModelMessageSource extends AssistantProvenance {
    kind: 'model';
}`},{name:"ModelModality",declaration:"export type ModelModality = ModelModalityMap[keyof ModelModalityMap];"},{name:"ModelModalityMap",declaration:`export interface ModelModalityMap {
    text: 'text';
    image: 'image';
}`},{name:"ObjectJsonSchema",declaration:`export type ObjectJsonSchema = JsonSchemaNode & {
    type: 'object';
};`},{name:"OneShotSubagentDescriptorData",declaration:`export interface OneShotSubagentDescriptorData extends SubagentDescriptorBase {
    readonly mode: 'one-shot';
    readonly label?: string;
}`},{name:"PermissionSelect",declaration:`export interface PermissionSelect {
    options: PresetOption[];
    currentValue: string;
}`},{name:"PostToolDecision",declaration:`export type PostToolDecision = {
    kind: 'accept';
    content?: ContentBlock[];
    value?: never;
    additionalContexts?: UserMessage[];
} | {
    kind: 'accept';
    value: JsonValue;
    content?: never;
    additionalContexts?: UserMessage[];
} | {
    kind: 'block';
    feedback: ContentBlock[];
    additionalContexts?: UserMessage[];
};`},{name:"PreparedAdapterCall",declaration:`export interface PreparedAdapterCall {
    readonly model: LlmResolvedModelInfo;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}`},{name:"PreparedLlmCall",declaration:`export interface PreparedLlmCall {
    readonly config: LlmCallConfig;
    readonly retryPolicy: ResolvedRetryPolicy;
    readonly context?: LlmModelContext;
    readonly inputModalities?: readonly ModelModality[];
    readonly adapterDefaults: LlmCallConfigAdapterDefaults;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}`},{name:"PreparedReferencedMessage",declaration:`export interface PreparedReferencedMessage {
    content: ContentBlock[];
    additionalContext?: UserMessage;
}`},{name:"PrepareSessionOptions",declaration:`export type PrepareSessionOptions = (CreateSessionOptions & {
    readonly seedSource?: undefined;
}) | RestoredSessionOptions;`},{name:"PresetOption",declaration:`export interface PresetOption {
    value: string;
    name: string;
    description?: string;
}`},{name:"PresetSpec",declaration:`export interface PresetSpec {
    sandbox: SandboxMode;
    approval: ApprovalPolicy;
    name?: string;
    description?: string;
}`},{name:"PresetTrust",declaration:"export type PresetTrust = 'system' | 'user';"},{name:"PreStepDecision",declaration:`export type PreStepDecision = {
    kind: 'reject';
} | {
    kind: 'enter';
    messages: UserMessage[];
};`},{name:"PreToolDecision",declaration:`export type PreToolDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
} | {
    kind: 'ask';
    reason?: string;
};`},{name:"ProjectionChangeListener",declaration:"export type ProjectionChangeListener = (session: Session, key: Extract<keyof SessionProjectionMap, string>, value: unknown, seq: number) => void;"},{name:"ProjectionCheckpoint",declaration:"export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>;"},{name:"ProjectionCheckpointRow",declaration:`export interface ProjectionCheckpointRow {
    ver: number;
    seq: number;
    val: unknown;
}`},{name:"ProjectionDefinition",declaration:`export interface ProjectionDefinition<K extends keyof SessionProjectionStateMap, S extends SessionProjectionStateMap[K] = SessionProjectionStateMap[K]> {
    key: K;
    stateSchema: ZodType<S>;
    init(): NoInfer<S>;
    apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>;
    wire?: K extends keyof SessionProjectionMap ? {
        viewSchema: ZodType<SessionProjectionMap[K]>;
        view(state: NoInfer<S>): SessionProjectionMap[K];
    } : never;
    stateVersion: number;
}`},{name:"ProjectionSnapshot",declaration:`export interface ProjectionSnapshot {
    asOfSeq: number;
    values: Partial<SessionProjectionMap>;
}`},{name:"PromptAssembly",declaration:`export interface PromptAssembly {
    sections: AssembledSection[];
    contexts: AssembledContext[];
    tools: ToolSchema[];
    variables: Record<string, string | undefined>;
}`},{name:"PromptContext",declaration:`export interface PromptContext {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: AssembleContext) => string);
}`},{name:"PromptSection",declaration:`export interface PromptSection {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: AssembleContext) => string);
    readonly complete?: boolean;
}`},{name:"ProviderRequestId",declaration:"export type ProviderRequestId = Branded<'ProviderRequestId'>;"},{name:"PrunedEntry",declaration:`export interface PrunedEntry {
    readonly originalSeq: number;
    readonly replacementSeq: number;
    readonly callId: CallId;
    readonly charsBefore: number;
    readonly charsAfter: number;
}`},{name:"PruneResult",declaration:`export interface PruneResult {
    readonly pruned: readonly PrunedEntry[];
    readonly charsRemoved: number;
}`},{name:"ReadFileLine",declaration:`export interface ReadFileLine {
    number: number;
    text: string;
}`},{name:"ReadResultView",declaration:`export interface ReadResultView {
    card: 'read';
    title?: string;
    path: string;
    offset: number;
    lines: ReadFileLine[];
    totalLines: number;
    lang?: string;
    content?: ContentBlock[];
}`},{name:"ReasoningBlock",declaration:`export interface ReasoningBlock {
    type: 'reasoning';
    text: string;
}`},{name:"ReasoningEffortId",declaration:"export type ReasoningEffortId = Branded<'ReasoningEffortId'>;"},{name:"RedactedSecret",declaration:`export interface RedactedSecret {
    path: string[];
    set: boolean;
}`},{name:"ReplayEnvelope",declaration:`export interface ReplayEnvelope {
    response: unknown;
    blocks?: readonly unknown[];
}`},{name:"RequestContext",declaration:`export interface RequestContext {
    provider: string;
    model: string;
    contextWindow?: number;
}`},{name:"RequestErrorAction",declaration:`export type RequestErrorAction = {
    kind: 'retry';
} | undefined;`},{name:"RequestHeaderReason",declaration:"export type RequestHeaderReason = 'initial' | 'resume' | 'change';"},{name:"RequestImageAttachment",declaration:`export interface RequestImageAttachment {
    variantId: ImageVariantId;
    attachment: ImageAttachmentRef;
    data: Uint8Array;
    mediaType: ImageMediaType;
    bytes: number;
    width: number;
    height: number;
    depth: 'uchar';
    space: 'srgb';
    hasAlpha: boolean;
}`},{name:"RequestRunOutcome",declaration:"export type RequestRunOutcome = 'approved' | 'completed' | 'rejected' | 'cancelled' | 'failed';"},{name:"ResolvedAlwaysRetryPolicy",declaration:`export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
    readonly mode: 'always';
}`},{name:"ResolvedCredential",declaration:`export interface ResolvedCredential {
    value: string;
    source: string;
}`},{name:"ResolvedNormalRetryPolicy",declaration:`export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
    readonly mode: 'normal';
    readonly maxRetries: number;
    readonly retryableCodes: readonly string[];
}`},{name:"ResolvedRetryBackoff",declaration:`export interface ResolvedRetryBackoff {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterRatio: number;
}`},{name:"ResolvedRetryPolicy",declaration:"export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy;"},{name:"ResolvedSubagentStartRequest",declaration:`export interface ResolvedSubagentStartRequest extends SubagentStartRequest {
    readonly descriptor: SubagentDescriptorData;
}`},{name:"RestoredSessionOptions",declaration:`export interface RestoredSessionOptions {
    readonly seed: SessionEvent[];
    readonly meta: SessionHeader;
    readonly seedSource: 'persistence';
}`},{name:"ResumeAgentOptions",declaration:`export interface ResumeAgentOptions {
    readonly resumeSessionId: SessionId;
    readonly agentOptions?: AgentOptions;
    readonly signal?: AbortSignal;
    readonly setup?: AgentSetup;
}`},{name:"RpcError",declaration:`export type RpcError = {
    [C in RpcErrorCode]: {
        code: C;
        message: string;
        details: RpcErrorDetailsMap[C];
    };
}[RpcErrorCode];`},{name:"RpcErrorCode",declaration:"export type RpcErrorCode = keyof RpcErrorDetailsMap;"},{name:"RpcErrorDetailsMap",declaration:`export interface RpcErrorDetailsMap {
    'bad-request': {
        issues: ZodIssue[];
    };
    'cancelled': {};
    'session-not-found': {
        sessionId: SessionId;
    };
    'model-unavailable': {
        provider: string;
        model: string;
    };
    'session-conflict': {
        sessionId: SessionId;
        requestedCwd: string;
        existingCwd?: string;
    };
    'invalid-time-zone': {
        value: string;
    };
    'workspace-attach-failed': {
        sessionId: SessionId;
        workspaceId: string;
    };
    'workspace-not-found': {
        workspaceId: string;
    };
    'workspace-invalid-path': {
        path: string;
    };
    'workspace-name-conflict': {
        name: string;
    };
    'workspace-move-invalid': {
        workspaceId: string;
        sessionId: SessionId;
        beforeSessionId?: SessionId;
    };
    'directory-unreadable': {
        path: string;
    };
    'directory-exists': {
        path: string;
    };
    'directory-create-failed': {
        path: string;
    };
    'directory-picker-unavailable': {
        capability: string;
    };
    'agent-preset-read-only': {
        agentPreset: string;
        reason: string;
    };
    'agent-preset-locked': {
        sessionId: SessionId;
        agentPreset: string;
    };
    'agent-preset-conflict': {
        sessionId: SessionId;
        requestedPreset: string;
        existingPreset?: string;
    };
    'agent-preset-not-found': {
        agentPreset: string;
      /* …truncated — full shape in source */`},{name:"RpcId",declaration:"export type RpcId = Branded<'rpc-id'>;"},{name:"RpcReceipt",declaration:`export type RpcReceipt = {
    accepted: true;
} | {
    accepted: false;
    reason: 'not-pending' | 'bad-response';
};`},{name:"RpcResult",declaration:`export type RpcResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: RpcError;
};`},{name:"RunnerFailureRule",declaration:`export interface RunnerFailureRule {
    allowedExitCodes?: readonly number[];
    fatalSignatures: readonly string[];
    informationalLines?: readonly string[];
}`},{name:"SandboxEnforcement",declaration:"export type SandboxEnforcement = 'full' | 'partial';"},{name:"SandboxExecutionPolicy",declaration:`export interface SandboxExecutionPolicy {
    mode: SandboxMode;
    workspaceRoot: string;
    sessionId?: SessionId;
}`},{name:"SandboxMode",declaration:"export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';"},{name:"SandboxPolicy",declaration:`export interface SandboxPolicy extends SandboxExecutionPolicy {
    mode: ConfinedSandboxMode;
}`},{name:"SandboxPolicyRequest",declaration:`export interface SandboxPolicyRequest {
    session?: Session;
    mode?: SandboxMode;
}`},{name:"SaveImageAttachment",declaration:`export interface SaveImageAttachment {
    data: Uint8Array;
    mediaType: ImageMediaType;
    name?: string;
}`},{name:"SaveTextSpill",declaration:`export interface SaveTextSpill {
    owner: SpillOwner;
    source: SpillSource;
    suggestedName: string;
    content: string;
}`},{name:"ScheduledToolDispatch",declaration:`export type ScheduledToolDispatch = {
    kind: 'post-result';
    result: ToolExecutionResult;
} | {
    kind: 'final-result';
    result: ToolExecutionResult;
};`},{name:"ScheduledToolPreparation",declaration:`export type ScheduledToolPreparation = {
    kind: 'dispatch';
    exec: ToolRunContext;
} | {
    kind: 'post-result';
    exec: ToolRunContext;
    result: ToolExecutionResult;
} | {
    kind: 'final-result';
    exec: ToolRunContext;
    result: ToolExecutionResult;
};`},{name:"Scoped",declaration:`export type Scoped<T extends object> = object & {
    readonly [ScopedBrand]: T;
};`},{name:"ScopeKey",declaration:"export type ScopeKey = object;"},{name:"SearchFileMatches",declaration:`export interface SearchFileMatches {
    path: string;
    matches: SearchLineMatch[];
}`},{name:"SearchLineMatch",declaration:`export interface SearchLineMatch {
    lineNumber: number;
    line: string;
}`},{name:"SearchMatchesResultView",declaration:`export interface SearchMatchesResultView {
    card: 'search';
    shape: 'matches';
    title?: string;
    files: SearchFileMatches[];
    truncated: boolean;
    total: number;
}`},{name:"SearchPathsResultView",declaration:`export interface SearchPathsResultView {
    card: 'search';
    shape: 'paths';
    title?: string;
    paths: string[];
    truncated: boolean;
    total: number;
}`},{name:"SearchResultView",declaration:"export type SearchResultView = SearchMatchesResultView | SearchPathsResultView;"},{name:"SendTeamMessageRequest",declaration:`export interface SendTeamMessageRequest {
    readonly target: string;
    readonly content: ContentBlock[];
    readonly delivery: 'quiet' | 'wakeup';
    readonly signal: AbortSignal;
}`},{name:"SendTeamMessageResult",declaration:`export interface SendTeamMessageResult {
    readonly messageId: TeamMessageId;
    readonly status: 'accepted' | 'queued';
}`},{name:"ServerResponse",declaration:`export interface ServerResponse {
    type: 'server-response';
    rpcId: RpcId;
    result: RpcResult<unknown>;
}`},{name:"SessionAvailability",declaration:"export type SessionAvailability = 'live' | 'persisted';"},{name:"SessionEvent",declaration:`export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    [K in SessionEventType]: {
        type: K;
        seq: number;
        time: number;
        data: SessionEventMap[K];
        ignorable?: true;
    } & (K extends SurfaceEventType ? {
        sourceEventSeqs?: number[];
        surfaceOp?: SurfaceOp;
    } : object);
}[T];`},{name:"SessionEventMap",declaration:`export interface SessionEventMap {
    'turn/start': {
        turn: number;
    };
    'turn/end': {
        turn: number;
        reason: TurnEndReason;
    };
    'step/start': {
        turn: number;
        step: number;
    };
    'step/end': {
        turn: number;
        step: number;
    };
    'user/message': UserMessage;
    'assistant/chunk': {
        turn: number;
        step: number;
        chunk: StreamChunk;
    };
    'assistant/message': {
        turn: number;
        step: number;
        message: AssistantMessage;
        usage?: TokenUsage;
        interrupted?: true;
    };
    'tool/call': {
        turn: number;
        step: number;
        callId: CallId;
        name: string;
        arguments: string;
    };
    'tool/result': {
        turn: number;
        step: number;
        message: ToolResultMessage;
        error?: {
            name: string;
            code: string;
        };
        meta?: JsonValue;
    };
    'todo/write': {
        todos: TodoItem[];
    };
    'request/header': {
        header: EpochHeader;
        reason: RequestHeaderReason;
    };
    'request/context': RequestContext;
    'session/end-seed': Record<string, never>;
}`},{name:"SessionEventMetadataFilter",declaration:`export type SessionEventMetadataFilter = Exclude<SessionEventResultFilter, {
    kind: 'text';
}>;`},{name:"SessionEventReadRequest",declaration:`export interface SessionEventReadRequest {
    sessionId: SessionId;
    seq: number;
    before?: number;
    after?: number;
}`},{name:"SessionEventRecord",declaration:`export interface SessionEventRecord {
    sessionId: SessionId;
    seq: number;
    type: SessionEventType;
    time: number;
    surface: SessionEventSurface;
}`},{name:"SessionEventResultFilter",declaration:`export type SessionEventResultFilter = ({
    kind: 'seq';
} & SessionResultRange) | ({
    kind: 'time';
} & SessionResultRange) | {
    kind: 'type';
    values: readonly SessionEventType[];
} | {
    kind: 'surface';
    values: readonly SessionEventSurface[];
} | {
    kind: 'text';
    text: string;
};`},{name:"SessionEventSearchDocument",declaration:`export interface SessionEventSearchDocument extends SessionEventRecord {
    text: string;
}`},{name:"SessionEventSearchHit",declaration:`export interface SessionEventSearchHit extends SessionEventRecord {
    snippet: string;
}`},{name:"SessionEventSearchPage",declaration:`export interface SessionEventSearchPage extends SessionSearchPage<SessionEventSearchHit> {
    session: SessionHeader;
}`},{name:"SessionEventSearchRequest",declaration:`export interface SessionEventSearchRequest {
    sessionId: SessionId;
    query: string;
    filters?: readonly SessionEventMetadataFilter[];
    limit?: number;
    cursor?: SessionSearchCursor;
}`},{name:"SessionEventSurface",declaration:"export type SessionEventSurface = 'current' | 'shadowed' | 'log-only';"},{name:"SessionEventTrace",declaration:`export interface SessionEventTrace {
    target: SessionEventRecord;
    replacedBy?: number;
    replacementChain: number[];
    replacedEventSeqs: number[];
    sourceEventSeqs: number[];
    derivedEventSeqs: number[];
}`},{name:"SessionEventTraceObservation",declaration:`export interface SessionEventTraceObservation extends SessionEventTrace {
    session: SessionHeader;
}`},{name:"SessionEventTraceRequest",declaration:`export interface SessionEventTraceRequest {
    sessionId: SessionId;
    seq: number;
}`},{name:"SessionEventType",declaration:"export type SessionEventType = keyof SessionEventMap;"},{name:"SessionEventWindow",declaration:`export interface SessionEventWindow {
    session: SessionHeader;
    target: SessionEvent;
    events: SessionEvent[];
    startSeq: number;
    endSeq: number;
}`},{name:"SessionForkSource",declaration:"export type SessionForkSource = Session | SessionId;"},{name:"SessionHeader",declaration:`export interface SessionHeader {
    readonly version: number;
    readonly id: SessionId;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly parentSession?: SessionId;
    readonly seedLength?: number;
    readonly origin?: 'subagent';
    readonly delegationDepth?: number;
    readonly agentPreset?: string;
}`},{name:"SessionId",declaration:"export type SessionId = Branded<'SessionId'>;"},{name:"SessionInspection",declaration:`export interface SessionInspection {
    readonly meta: SessionHeader;
    readonly events: readonly SessionEvent[];
}`},{name:"SessionLineageNode",declaration:`export interface SessionLineageNode {
    session: SessionRecord;
    descendants: SessionLineageNode[];
}`},{name:"SessionLineageTrace",declaration:`export type SessionLineageTrace = {
    target: SessionRecord;
    ancestors: SessionRecord[];
    descendants: SessionLineageNode[];
} & ({
    complete: true;
    root: SessionRecord;
} | {
    complete: false;
    unresolvedParentId: SessionId;
});`},{name:"SessionLocation",declaration:`export interface SessionLocation {
    readonly kind: string;
    readonly path: string;
}`},{name:"SessionLogSnapshot",declaration:`export interface SessionLogSnapshot {
    session: SessionHeader;
    events: SessionEvent[];
}`},{name:"SessionPersistenceRevision",declaration:"export type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>;"},{name:"SessionPersistenceSnapshot",declaration:`export interface SessionPersistenceSnapshot {
    header: SessionHeader;
    revision: SessionPersistenceRevision;
}`},{name:"SessionPreparation",declaration:`export class SessionPreparation implements Disposable {
    readonly session: Session;
    static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
    [Symbol.dispose](): void;
}`},{name:"SessionPreparationOptions",declaration:`export interface SessionPreparationOptions {
    readonly release?: () => void;
}`},{name:"SessionProjectionMap",declaration:`export interface SessionProjectionMap {
}`},{name:"SessionProjectionStateMap",declaration:`export interface SessionProjectionStateMap {
}`},{name:"SessionRawArtifact",declaration:`export interface SessionRawArtifact {
    readonly meta: SessionHeader;
    readonly filename: string;
    readonly content: string;
}`},{name:"SessionRecord",declaration:`export interface SessionRecord {
    header: SessionHeader;
    live: boolean;
    persisted: boolean;
}`},{name:"SessionReferenceCandidate",declaration:`export interface SessionReferenceCandidate {
    sessionId: SessionId;
    label: string;
    cwd?: string;
    createdAt: number;
}`},{name:"SessionReferenceInput",declaration:`export interface SessionReferenceInput {
    sessionId: SessionId;
    label?: string;
}`},{name:"SessionReferenceMentionCandidate",declaration:`export interface SessionReferenceMentionCandidate extends SessionReferenceCandidate {
    mention: string;
}`},{name:"SessionResultFilter",declaration:`export type SessionResultFilter = {
    kind: 'id';
    values: readonly SessionId[];
} | {
    kind: 'cwd';
    values: readonly (string | null)[];
} | ({
    kind: 'created-at';
} & SessionResultRange) | {
    kind: 'parent';
    values: readonly (SessionId | null)[];
} | {
    kind: 'availability';
    values: readonly SessionAvailability[];
};`},{name:"SessionResultRange",declaration:`export interface SessionResultRange {
    from?: number;
    to?: number;
}`},{name:"SessionSearchCursor",declaration:"export type SessionSearchCursor = Branded<'SessionSearchCursor'>;"},{name:"SessionSearchExecContext",declaration:`export interface SessionSearchExecContext {
    signal?: AbortSignal;
}`},{name:"SessionSearchHit",declaration:`export interface SessionSearchHit extends SessionRecord {
    bestMatch: SessionEventSearchHit;
}`},{name:"SessionSearchPage",declaration:`export interface SessionSearchPage<T> {
    items: readonly T[];
    nextCursor?: SessionSearchCursor;
}`},{name:"SessionSearchRequest",declaration:`export interface SessionSearchRequest {
    query: string;
    sessionFilters?: readonly SessionResultFilter[];
    eventFilters?: readonly SessionEventMetadataFilter[];
    limit?: number;
    cursor?: SessionSearchCursor;
}`},{name:"SessionStartSource",declaration:"export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';"},{name:"SessionSurfaceSnapshot",declaration:`export interface SessionSurfaceSnapshot {
    session: SessionHeader;
    capturedThroughSeq: number | null;
    events: SurfaceEvent[];
}`},{name:"SessionTelemetryRecord",declaration:`export interface SessionTelemetryRecord {
    channel: 'ledger' | 'ops';
    time: number;
    severity: SessionTelemetrySeverity;
    attributes: Record<string, string | number>;
    body: unknown;
}`},{name:"SessionTelemetrySeverity",declaration:"export type SessionTelemetrySeverity = 'info' | 'warn' | 'error';"},{name:"SessionTelemetrySharingStatus",declaration:"export type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled';"},{name:"SessionTitleAutomaticMode",declaration:"export type SessionTitleAutomaticMode = 'first-prompt' | 'all-prompts';"},{name:"SessionTitleEventData",declaration:`export interface SessionTitleEventData {
    readonly title: string;
    readonly messageSeqs: number[];
    readonly source: SessionTitleSource;
}`},{name:"SessionTitleModelProvenance",declaration:`export interface SessionTitleModelProvenance {
    readonly provider: string;
    readonly model: string;
}`},{name:"SessionTitleObservation",declaration:`export interface SessionTitleObservation {
    session: SessionHeader;
    title?: SessionTitleSnapshot;
}`},{name:"SessionTitleObservationResult",declaration:`export type SessionTitleObservationResult = {
    sessionId: SessionId;
    status: 'fulfilled';
    value: SessionTitleObservation;
} | {
    sessionId: SessionId;
    status: 'rejected';
    reason: unknown;
};`},{name:"SessionTitleProvider",declaration:`export interface SessionTitleProvider {
    readonly id: SessionTitleProviderId;
    readonly automatic: SessionTitleAutomaticMode;
    generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>;
}`},{name:"SessionTitleProviderId",declaration:"export type SessionTitleProviderId = Branded<'SessionTitleProviderId'>;"},{name:"SessionTitleProviderRequest",declaration:`export interface SessionTitleProviderRequest {
    readonly session: Session;
    readonly messages: readonly SessionTitleUserMessage[];
    readonly route?: SessionTitleModelProvenance;
    readonly signal: AbortSignal;
}`},{name:"SessionTitleProviderResult",declaration:`export interface SessionTitleProviderResult {
    readonly title: string;
    readonly messageSeqs: readonly number[];
    readonly model?: SessionTitleModelProvenance;
}`},{name:"SessionTitleSnapshot",declaration:`export interface SessionTitleSnapshot extends SessionTitleEventData {
    readonly eventSeq: number;
    readonly updatedAt: number;
}`},{name:"SessionTitleSource",declaration:`export type SessionTitleSource = {
    readonly kind: 'fallback';
} | {
    readonly kind: 'provider';
    readonly provider: SessionTitleProviderId;
    readonly model?: SessionTitleModelProvenance;
} | {
    readonly kind: 'user';
};`},{name:"SessionTitleUserMessage",declaration:`export interface SessionTitleUserMessage {
    readonly seq: number;
    readonly text: string;
}`},{name:"SettingsApplies",declaration:"export type SettingsApplies = 'live' | 'restart';"},{name:"SettingsDescribeOptions",declaration:`export interface SettingsDescribeOptions {
    redactSecrets?: boolean;
}`},{name:"SettingsDescriptor",declaration:`export interface SettingsDescriptor {
    ns: SettingsNamespace;
    schema: unknown;
    value: unknown;
    revision: number;
    base?: unknown;
    user?: unknown;
    applies: SettingsApplies;
    secrets?: RedactedSecret[];
}`},{name:"SettingsNamespace",declaration:"export type SettingsNamespace = Branded<'SettingsNamespace'>;"},{name:"SettingsPathOp",declaration:`export type SettingsPathOp = {
    op: 'set';
    path: readonly string[];
    value: unknown;
} | {
    op: 'unset';
    path: readonly string[];
};`},{name:"SettingsRegisterOptions",declaration:`export interface SettingsRegisterOptions<T> {
    base?: Partial<T>;
    applies?: SettingsApplies;
    validate?: (value: T) => void;
}`},{name:"SettingsUpdateSource",declaration:"export type SettingsUpdateSource = 'update' | 'provider';"},{name:"ShellExecRequest",declaration:`export interface ShellExecRequest {
    command: string;
    workdir?: string | undefined;
    timeoutMs?: number | undefined;
    stdoutMaxBytes?: number | undefined;
    signal?: AbortSignal | undefined;
    stdin?: string | undefined;
    env?: Record<string, string> | undefined;
    dshEnv?: DshEnvironment | undefined;
    sandboxPolicy?: SandboxExecutionPolicy | undefined;
}`},{name:"ShellExecSpec",declaration:`export interface ShellExecSpec {
    command: string;
    workdir: string;
    timeoutMs: number;
    stdoutMaxBytes: number;
    signal?: AbortSignal | undefined;
    stdin?: string | undefined;
    env?: Record<string, string> | undefined;
    dshEnv?: DshEnvironment | undefined;
    sandboxPolicy: SandboxExecutionPolicy | undefined;
}`},{name:"ShellProcess",declaration:`export interface ShellProcess {
    status: ShellProcessStatus;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    readonly done: Promise<void>;
    sandbox?: ShellSandboxInfo;
    readOutput(): ShellProcessRead;
    kill(): boolean;
}`},{name:"ShellProcessRead",declaration:`export interface ShellProcessRead {
    delta: string;
    lossy: boolean;
    stdoutSpillPath?: string;
    stderrSpillPath?: string;
}`},{name:"ShellProcessStatus",declaration:"export type ShellProcessStatus = 'running' | 'completed' | 'killed';"},{name:"ShellRunResult",declaration:`export interface ShellRunResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    aborted: boolean;
    timeoutMs: number;
    stdout: CollectedOutput;
    stderr: CollectedOutput;
    sandbox?: ShellSandboxInfo;
}`},{name:"ShellSandboxInfo",declaration:`export interface ShellSandboxInfo {
    mode: SandboxMode;
    denied: boolean;
    enforcement?: SandboxEnforcement;
    runnerFailed?: boolean;
}`},{name:"SkillCandidate",declaration:`export interface SkillCandidate extends SkillSummary {
    readonly rank: number;
    readonly locator: unknown;
    readonly path?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}`},{name:"SkillCatalogSnapshot",declaration:`export interface SkillCatalogSnapshot {
    readonly skills: SkillSummary[];
    readonly complete: boolean;
}`},{name:"SkillDefinition",declaration:`export interface SkillDefinition extends SkillSummary {
    readonly content: string;
    readonly path?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}`},{name:"SkillInvocationPolicy",declaration:`export interface SkillInvocationPolicy {
    readonly modelInvocable: boolean;
    readonly userInvocable: boolean;
}`},{name:"SkillLookupOptions",declaration:`export interface SkillLookupOptions {
    readonly cwd?: string | undefined;
    readonly signal?: AbortSignal | undefined;
}`},{name:"SkillProvider",declaration:`export interface SkillProvider {
    readonly name: string;
    readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>;
    readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>;
}`},{name:"SkillProviderControl",declaration:`export interface SkillProviderControl {
    readonly signal: AbortSignal;
    readonly invalidate: () => void;
}`},{name:"SkillProviderObservation",declaration:`export interface SkillProviderObservation {
    readonly candidates: readonly SkillCandidate[];
    readonly complete: boolean;
}`},{name:"SkillRegistration",declaration:`export type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
    readonly invocation?: SkillInvocationPolicy;
    readonly provider?: string;
};`},{name:"SkillResourceBase",declaration:`export type SkillResourceBase = {
    readonly kind: 'directory';
    readonly path: string;
} | {
    readonly kind: 'url';
    readonly url: string;
} | {
    readonly kind: 'opaque';
    readonly description: string;
};`},{name:"SkillSource",declaration:"export type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {});"},{name:"SkillSummary",declaration:`export interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly invocation: SkillInvocationPolicy;
    readonly source: SkillSource;
    readonly provider: string;
    readonly resourceBase?: SkillResourceBase;
}`},{name:"SkillViewOptions",declaration:`export interface SkillViewOptions extends SkillLookupOptions {
    readonly scope?: ScopeKey | undefined;
}`},{name:"SpawnTeammateRequest",declaration:`export interface SpawnTeammateRequest {
    readonly name: string;
    readonly description: string;
    readonly prompt: ContentBlock[];
    readonly context: 'fresh' | 'fork';
    readonly provider: string;
    readonly signal: AbortSignal;
}`},{name:"SpawnTeammateResult",declaration:`export interface SpawnTeammateResult {
    readonly member: TeamMemberView;
}`},{name:"SpillLocator",declaration:"export type SpillLocator = Branded<'SpillLocator'>;"},{name:"SpillOwner",declaration:`export interface SpillOwner {
    sessionId: SessionId;
}`},{name:"SpillRef",declaration:`export interface SpillRef {
    locator: SpillLocator;
    bytes: number;
    retrievalHint: string;
}`},{name:"SpillSource",declaration:`export interface SpillSource {
    toolName: string;
    callId: CallId;
    label: string;
}`},{name:"StorageBackend",declaration:`export interface StorageBackend {
    readonly kv?: KvFacet;
    close(): Promise<void>;
}`},{name:"StorageForms",declaration:`export interface StorageForms {
}`},{name:"StoredImageAttachment",declaration:`export interface StoredImageAttachment {
    ref: ImageAttachmentRef;
    data: Uint8Array;
}`},{name:"StreamChunk",declaration:`export type StreamChunk = {
    type: 'block-start';
    index: number;
    blockType: ContentBlockType;
} | {
    type: 'text-delta';
    index: number;
    text: string;
} | {
    type: 'reasoning-delta';
    index: number;
    text: string;
} | {
    type: 'tool-call-delta';
    index: number;
    id: CallId;
    name?: string;
    argumentsDelta: string;
} | {
    type: 'block-end';
    index: number;
    block: ContentBlock;
} | {
    type: 'usage';
    usage: TokenUsage;
} | {
    type: 'finish';
    reason: FinishReason;
    replayState?: ReplayEnvelope;
};`},{name:"SubagentCapabilities",declaration:`export interface SubagentCapabilities {
    readonly outputSchema: boolean;
    readonly depthLimit: boolean;
    readonly toolFilter: boolean;
    readonly persona: boolean;
}`},{name:"SubagentDescendantListEntry",declaration:`export type SubagentDescendantListEntry = SubagentListEntry & {
    readonly parentId: SessionId;
    readonly depth: number;
};`},{name:"SubagentDescriptorData",declaration:"export type SubagentDescriptorData = OneShotSubagentDescriptorData | ContinuableSubagentDescriptorData;"},{name:"SubagentFollowupOptions",declaration:`export interface SubagentFollowupOptions {
    readonly source: MessageSource;
    readonly signal: AbortSignal;
}`},{name:"SubagentInterruptAuthority",declaration:`export type SubagentInterruptAuthority = {
    readonly kind: 'user';
    readonly parentSessionId: SessionId;
} | {
    readonly kind: 'ancestor';
    readonly agent: Agent;
};`},{name:"SubagentProvider",declaration:`export interface SubagentProvider {
    readonly name: string;
    readonly capabilities: SubagentCapabilities;
    readonly inheritsParentContext: boolean;
    start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>;
    prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>;
}`},{name:"SubagentReportDelivery",declaration:"export type SubagentReportDelivery = 'quiet' | 'next-step';"},{name:"SubagentReportOptions",declaration:`export interface SubagentReportOptions {
    readonly delivery: SubagentReportDelivery;
    readonly signal: AbortSignal;
}`},{name:"SubagentResult",declaration:`export interface SubagentResult {
    readonly output: ContentBlock[];
    readonly structured?: unknown;
    readonly diagnostic?: string;
    readonly stopReason: SubagentStopReason;
}`},{name:"SubagentRun",declaration:`export interface SubagentRun {
    readonly id: SessionId;
    readonly localAgent: Agent | undefined;
    readonly result: Promise<SubagentResult>;
    dispose(): Promise<void>;
}`},{name:"SubagentRunEndInfo",declaration:`export interface SubagentRunEndInfo {
    readonly runId: SubagentRunId;
    readonly provider: string;
    readonly id: SessionId;
    readonly local: boolean;
    readonly stopReason: SubagentResult['stopReason'];
    readonly lastAssistantMessage?: ContentBlock[];
}`},{name:"SubagentRunId",declaration:"export type SubagentRunId = Branded<'SubagentRunId'>;"},{name:"SubagentRunInfo",declaration:`export interface SubagentRunInfo {
    readonly runId: SubagentRunId;
    readonly provider: string;
    readonly id: SessionId;
    readonly local: boolean;
}`},{name:"SubagentRuntime",declaration:`export class SubagentRuntime extends Service {
    constructor(ctx: Context);
    async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>;
    async followup(parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions): Promise<MessageId>;
    interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void;
    async reportFrom(child: Agent, content: ContentBlock[], options: SubagentReportOptions): Promise<MessageId>;
    registerContinuableSetup(contribution: ContinuableSetupContribution): () => void;
    async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>;
    async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>;
    listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>;
    listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>;
    registerProvider(provider: SubagentProvider): () => void;
    getProvider(name: string): SubagentProvider | undefined;
    list(): string[];
    async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
}`},{name:"SubagentStartRequest",declaration:`export interface SubagentStartRequest {
    readonly label?: string;
    readonly prompt: ContentBlock[];
    readonly parent: Agent;
    readonly signal: AbortSignal;
    readonly agentOptions?: AgentOptions;
    readonly outputSchema?: ObjectJsonSchema;
    readonly maxDepth?: number;
    readonly toolFilter?: ToolRestriction;
    readonly persona?: string;
}`},{name:"SubagentStopReason",declaration:"export type SubagentStopReason = SubagentStopReasonMap[keyof SubagentStopReasonMap];"},{name:"SubagentStopReasonMap",declaration:`export interface SubagentStopReasonMap {
    completed: 'completed';
    aborted: 'aborted';
    error: 'error';
    'max-tokens': 'max-tokens';
    refusal: 'refusal';
}`},{name:"SubprocessCollect",declaration:`export interface SubprocessCollect {
    maxBytes: number;
    spill?: {
        maxBytes: number;
    };
}`},{name:"SubprocessCollectedOutputs",declaration:`export interface SubprocessCollectedOutputs {
    readonly stdout?: SubprocessOutputReader;
    readonly stderr?: SubprocessOutputReader;
}`},{name:"SubprocessHandle",declaration:`export interface SubprocessHandle {
    readonly pid: number;
    readonly stdin: Writable | undefined;
    readonly stdout: Readable | undefined;
    readonly stderr: Readable | undefined;
    readonly collected: SubprocessCollectedOutputs;
    readonly done: Promise<SubprocessOutcome>;
    terminate(): void;
    waitForExit(signal?: AbortSignal): Promise<boolean>;
}`},{name:"SubprocessOutcome",declaration:`export interface SubprocessOutcome {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
}`},{name:"SubprocessOutputMode",declaration:"export type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect;"},{name:"SubprocessOutputRead",declaration:`export interface SubprocessOutputRead {
    text: string;
    nextOffset: number;
    lossy: boolean;
    spillPath?: string;
}`},{name:"SubprocessOutputReader",declaration:`export interface SubprocessOutputReader {
    readFrom(fromByte: number): SubprocessOutputRead;
}`},{name:"SubprocessSpawnSpec",declaration:`export interface SubprocessSpawnSpec {
    argv: readonly string[];
    cwd: string;
    stdio: SubprocessStdio;
    graceMs: number;
    signal?: AbortSignal | undefined;
    env?: NodeJS.ProcessEnv | undefined;
}`},{name:"SubprocessStdinMode",declaration:`export type SubprocessStdinMode = 'ignore' | 'pipe' | {
    readonly data: string;
};`},{name:"SubprocessStdio",declaration:`export interface SubprocessStdio {
    stdin: SubprocessStdinMode;
    stdout: SubprocessOutputMode;
    stderr: SubprocessOutputMode;
}`},{name:"SubprocessTerminalForeground",declaration:`export interface SubprocessTerminalForeground {
    processGroupId: number;
    inputWaiting: boolean;
}`},{name:"SubprocessTerminalHandle",declaration:`export interface SubprocessTerminalHandle {
    readonly pid: number;
    readonly output: Readable;
    readonly done: Promise<SubprocessOutcome>;
    write(data: string): Promise<void>;
    inspectForeground(): Promise<SubprocessTerminalForeground | undefined>;
    signalForeground(signal: SubprocessTerminalSignal): Promise<number>;
    terminate(): Promise<void>;
}`},{name:"SubprocessTerminalSignal",declaration:"export type SubprocessTerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP';"},{name:"SubprocessTerminalSpawnSpec",declaration:`export interface SubprocessTerminalSpawnSpec {
    argv: readonly string[];
    cwd: string;
    env?: Record<string, string> | undefined;
    rows: number;
    cols: number;
    graceMs: number;
    signal?: AbortSignal | undefined;
}`},{name:"SurfaceEvent",declaration:`export type SurfaceEvent = SessionEvent<SurfaceEventType> & {
    surfaceOp: SurfaceOp;
};`},{name:"SurfaceEventType",declaration:"export type SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result';"},{name:"SurfaceOp",declaration:`export type SurfaceOp = 'append' | {
    op: 'replace';
    start: number;
    end: number;
};`},{name:"SystemPrompt",declaration:`export class SystemPrompt extends Service {
    static Config: z<Config>;
    constructor(ctx: Context, config: Config);
    section(section: PromptSection): () => void;
    context(context: PromptContext): () => void;
    suppressRuntimeContext(): () => void;
    tools(provider: (context: AssembleContext) => ToolProviderResult): () => void;
    variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void;
    async assemble(context: AssembleContext = {}): Promise<PromptAssembly>;
}`},{name:"TableKeyOf",declaration:"export type TableKeyOf<S extends DomainSpec, N extends keyof S['tables']> = S['tables'][N] extends DomainTableSpec<infer K> ? K : never;"},{name:"TableValueOf",declaration:"export type TableValueOf<S extends DomainSpec, N extends keyof S['tables']> = S['tables'][N] extends DomainTableSpec<string, infer V> ? V : never;"},{name:"TeamId",declaration:"export type TeamId = Branded<'TeamId'>;"},{name:"TeamMembership",declaration:`export interface TeamMembership {
    readonly root: Agent;
    readonly id: TeamId;
    readonly role: 'lead' | 'teammate';
    readonly name: string;
}`},{name:"TeamMemberView",declaration:`export interface TeamMemberView {
    readonly id: SessionId;
    readonly name: string;
    readonly role: 'lead' | 'teammate';
    readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed';
    readonly description?: string;
    readonly provider?: string;
    readonly context?: 'fresh' | 'fork';
    readonly model?: string;
    readonly diagnostics: string[];
}`},{name:"TeamMessageId",declaration:"export type TeamMessageId = Branded<'TeamMessageId'>;"},{name:"TeamTaskAction",declaration:"export type TeamTaskAction = 'claim' | 'release' | 'edit' | 'set_dependencies' | 'complete' | 'reopen' | 'reassign' | 'delete';"},{name:"TeamTaskId",declaration:"export type TeamTaskId = Branded<'TeamTaskId'>;"},{name:"TeamTaskStatus",declaration:"export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';"},{name:"TeamTaskView",declaration:`export interface TeamTaskView {
    readonly id: TeamTaskId;
    readonly revision: number;
    readonly subject: string;
    readonly description: string;
    readonly status: TeamTaskStatus;
    readonly blockedBy: TeamTaskId[];
    readonly writeScopes: string[];
    readonly ownerName?: string;
    readonly ready: boolean;
    readonly writeScopeWarnings: string[];
}`},{name:"TeamWaitResult",declaration:`export interface TeamWaitResult {
    readonly timedOut: boolean;
}`},{name:"TerminalBackend",declaration:`export interface TerminalBackend {
    readonly type: string;
    spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>;
}`},{name:"TerminalBackendSession",declaration:`export interface TerminalBackendSession {
    readonly motd: string;
    readonly pid?: number;
    startSend(request: TerminalSendRequest): TerminalSendOperation;
    read(request: TerminalReadRequest): TerminalReadResult;
    signal(signal: TerminalSignal): Promise<TerminalSignalResult>;
    status(): TerminalSessionStatus;
    close(reason: string): Promise<void>;
}`},{name:"TerminalBackendSpawnSpec",declaration:`export interface TerminalBackendSpawnSpec extends TerminalSpawnRequest {
    sessionId: TerminalSessionIdValue;
    owner: Agent;
    signal?: AbortSignal;
}`},{name:"TerminalCallView",declaration:`export interface TerminalCallView {
    card: 'terminal';
    title: string;
    description?: string;
    cwd?: string;
}`},{name:"TerminalReadRequest",declaration:`export interface TerminalReadRequest {
    offset?: number;
    count?: number;
}`},{name:"TerminalReadResult",declaration:`export interface TerminalReadResult {
    text: string;
    totalLines: number;
    lineBegin: number;
    lineEnd: number;
    truncated: boolean;
}`},{name:"TerminalResultView",declaration:`export interface TerminalResultView {
    card: 'terminal';
    title?: string;
    output?: string;
    exitCode?: number;
    signal?: string;
}`},{name:"TerminalSendOperation",declaration:`export interface TerminalSendOperation {
    done: Promise<TerminalSendResult>;
    readOutput(): TerminalSendRead;
    cancel(): boolean;
}`},{name:"TerminalSendRead",declaration:`export interface TerminalSendRead {
    delta: string;
    truncated: boolean;
}`},{name:"TerminalSendRequest",declaration:`export interface TerminalSendRequest {
    text: string;
    submit: boolean;
    signal?: AbortSignal;
}`},{name:"TerminalSendResult",declaration:`export interface TerminalSendResult {
    viewport: string;
    waitReason: TerminalWaitReason;
    sessionStatus: TerminalSessionStatus;
    truncated: boolean;
}`},{name:"TerminalSessionId",declaration:"export type TerminalSessionId = TerminalSessionIdValue;"},{name:"TerminalSessionIdValue",declaration:"export type TerminalSessionIdValue = Branded<'TerminalSessionId'>;"},{name:"TerminalSessionSnapshot",declaration:`export interface TerminalSessionSnapshot {
    sessionId: TerminalSessionIdValue;
    name?: string;
    type: string;
    pid?: number;
    status: TerminalSessionStatus;
}`},{name:"TerminalSessionStatus",declaration:`export type TerminalSessionStatus = {
    kind: 'running';
} | {
    kind: 'exited';
    exitCode: number | null;
    signal: NodeJS.Signals | null;
};`},{name:"TerminalSignal",declaration:"export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP';"},{name:"TerminalSignalResult",declaration:`export interface TerminalSignalResult {
    delivered: true;
    targetPgid: number;
}`},{name:"TerminalSpawnRequest",declaration:`export interface TerminalSpawnRequest {
    type: string;
    name?: string;
    cwd?: string;
}`},{name:"TerminalSpawnResult",declaration:`export interface TerminalSpawnResult extends TerminalSessionSnapshot {
    motd: string;
}`},{name:"TerminalWaitReason",declaration:"export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit';"},{name:"TodoItem",declaration:`export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}`},{name:"TokenMeasurement",declaration:`export interface TokenMeasurement {
    readonly logRevision: number;
    readonly baseline: TokenMeasurementBaseline;
    readonly surfaceDeltaTokens: number;
    readonly totalTokens: number;
    readonly surfaceTokens: number;
    readonly nodes: readonly TokenSurfaceNode[];
}`},{name:"TokenMeasurementBaseline",declaration:`export type TokenMeasurementBaseline = {
    readonly kind: 'none';
    readonly tokens: 0;
} | {
    readonly kind: 'estimated';
    readonly tokens: number;
} | {
    readonly kind: 'usage';
    readonly tokens: number;
    readonly usage: Readonly<TokenUsage>;
};`},{name:"TokenSurfaceNode",declaration:`export interface TokenSurfaceNode {
    readonly seq: number;
    readonly tokens: number;
}`},{name:"TokenUsage",declaration:`export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}`},{name:"ToolCallKind",declaration:"export type ToolCallKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';"},{name:"ToolCallView",declaration:"export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView;"},{name:"ToolDefinition",declaration:`export interface ToolDefinition extends ToolSchema {
    readonly output: ToolOutputDefinition;
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    timeoutMs?: number;
    isConcurrencySafe?(args: unknown): boolean;
    presentCall?(args: unknown): ToolCallView | undefined;
    presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined;
}`},{name:"ToolDispatchExecution",declaration:`export interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
    signal: AbortSignal;
}`},{name:"ToolErrorInfo",declaration:`export interface ToolErrorInfo {
    name: string;
    code: string;
}`},{name:"ToolExecution",declaration:`export interface ToolExecution extends ToolExecutionInput {
    readonly rootCallId: CallId;
    readonly token: ToolExecutionToken;
}`},{name:"ToolExecutionFailure",declaration:`export interface ToolExecutionFailure {
    readonly isError: true;
    readonly error: ToolFailure;
    readonly value?: never;
    readonly content: ContentBlock[];
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: never;
}`},{name:"ToolExecutionInput",declaration:`export interface ToolExecutionInput {
    readonly callId: CallId;
    readonly rootCallId?: CallId;
    readonly name: string;
    readonly arguments: unknown;
    readonly agent?: Agent;
    readonly parent?: ToolExecutionToken;
    readonly signal: AbortSignal;
}`},{name:"ToolExecutionMode",declaration:`export type ToolExecutionMode = {
    kind: 'parallel';
} | {
    kind: 'exclusive';
};`},{name:"ToolExecutionResult",declaration:"export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;"},{name:"ToolExecutionSuccess",declaration:`export interface ToolExecutionSuccess {
    readonly isError: false;
    readonly value: JsonValue;
    readonly content: ContentBlock[];
    readonly error?: never;
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: true;
}`},{name:"ToolExecutionToken",declaration:`export type ToolExecutionToken = symbol & {
    readonly [toolExecutionTokenBrand]: true;
};`},{name:"ToolFailure",declaration:`export interface ToolFailure {
    message: string;
    info?: ToolErrorInfo;
}`},{name:"ToolGuard",declaration:"export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;"},{name:"ToolMessageSource",declaration:`export interface ToolMessageSource {
    kind: 'tool';
    callId: CallId;
}`},{name:"ToolOutputDefinition",declaration:`export interface ToolOutputDefinition {
    readonly schema: JsonSchemaNode;
    render(args: unknown, value: JsonValue): ContentBlock[];
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}`},{name:"ToolPresentationMode",declaration:"export type ToolPresentationMode = 'native' | 'code' | 'both';"},{name:"ToolProviderResult",declaration:`export interface ToolProviderResult {
    readonly schemas: readonly ToolSchema[];
    readonly knownNames?: readonly string[];
}`},{name:"ToolRestriction",declaration:`export interface ToolRestriction {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
}`},{name:"ToolResult",declaration:`export interface ToolResult {
    content: ContentBlock[];
    isError: boolean;
    meta?: JsonValue;
}`},{name:"ToolResultBlock",declaration:`export interface ToolResultBlock {
    type: 'tool-result';
    toolCallId: CallId;
    content: ContentBlock[];
    isError?: boolean;
}`},{name:"ToolResultMessage",declaration:`export interface ToolResultMessage extends Message {
    readonly role: 'user';
    readonly content: [
        ToolResultBlock
    ];
    readonly source: ToolMessageSource;
}`},{name:"ToolResultView",declaration:"export type ToolResultView = GenericResultView | TerminalResultView | DiffResultView | SearchResultView | ReadResultView | WebResultView;"},{name:"ToolRunContext",declaration:`export interface ToolRunContext extends ToolExecution {
    deferContext(context: UserMessage): void;
    concludeTurn(): void;
}`},{name:"ToolRuntime",declaration:`export class ToolRuntime extends Service {
    static inject;
    static Config: z<Config>;
    readonly [TOOL_RUNTIME_SCHEDULER]: ToolRuntimeScheduler;
    constructor(ctx: Context, config: Config = {});
    presentAs(mode: ToolPresentationMode): () => void;
    register(definition: ToolDefinition): () => void;
    restrict(filter: ToolRestriction): () => void;
    guard(guard: ToolGuard): () => void;
    get(name: string, scope?: ScopeKey): ToolDefinition | undefined;
    schemas(scope?: ScopeKey): ToolSchema[];
    executionMode(exec: ToolExecutionInput): ToolExecutionMode;
    async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>;
}`},{name:"ToolRuntimeScheduler",declaration:`export interface ToolRuntimeScheduler {
    prepare(exec: ToolExecutionInput): Promise<ScheduledToolPreparation>;
    dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch>;
    finalize(exec: ToolRunContext, result: ToolExecutionResult): Promise<ToolExecutionResult>;
    finish(exec: ToolRunContext, result: ToolExecutionResult): ToolExecutionResult;
}`},{name:"ToolSchema",declaration:`export interface ToolSchema {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}`},{name:"TurnEndCancelCause",declaration:`export type TurnEndCancelCause = AgentCancelCause | {
    readonly kind: 'legacy';
};`},{name:"TurnEndReason",declaration:"export type TurnEndReason = TurnEndReasonMap[keyof TurnEndReasonMap];"},{name:"TurnEndReasonMap",declaration:`export interface TurnEndReasonMap {
    completed: {
        kind: 'completed';
    };
    aborted: {
        kind: 'aborted';
        reason: TurnEndCancelCause;
    };
    blocked: {
        kind: 'blocked';
    };
    error: {
        kind: 'error';
        error: LlmFailure;
    };
    'max-tokens': {
        kind: 'max-tokens';
    };
    interrupted: {
        kind: 'interrupted';
    };
}`},{name:"TypertCodec",declaration:`export type TypertCodec = {
    readonly mode: 'strict';
    readonly typeSymbol: string;
    readonly schema: TypertSchema;
} | {
    readonly mode: 'src-json';
};`},{name:"TypertContribution",declaration:`export interface TypertContribution {
    readonly package: string;
    readonly face: TypertFace;
    readonly schemas: readonly TypertSchema[];
    readonly model: TypertPackageModel;
    readonly invocations: readonly InvocationDescriptor[];
}`},{name:"TypertDisposer",declaration:"export type TypertDisposer = () => Promise<void>;"},{name:"TypertDocTag",declaration:`export interface TypertDocTag {
    readonly name: string;
    readonly argument?: string;
    readonly comment?: string;
    readonly text: string;
}`},{name:"TypertDocumentation",declaration:`export interface TypertDocumentation {
    readonly description?: string;
    readonly summary?: string;
    readonly tags: readonly TypertDocTag[];
    readonly jsDoc?: string;
}`},{name:"TypertEventModel",declaration:`export interface TypertEventModel extends TypertDocumentation {
    readonly name: string;
    readonly mode?: string;
    readonly signature: string;
}`},{name:"TypertMemberModel",declaration:`export interface TypertMemberModel {
    readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index';
    readonly name: string;
    readonly signature: string;
    readonly summary?: string;
    readonly jsDoc?: string;
}`},{name:"TypertObjectModel",declaration:`export interface TypertObjectModel extends TypertDocumentation {
    readonly name: string;
    readonly exportName: string;
    readonly members: readonly TypertMemberModel[];
    readonly types: readonly TypertTypeModel[];
}`},{name:"TypertPackageFilter",declaration:`export interface TypertPackageFilter {
    readonly package?: string;
    readonly face?: TypertFace;
}`},{name:"TypertPackageModel",declaration:`export interface TypertPackageModel {
    readonly services: readonly TypertServiceModel[];
    readonly events: readonly TypertEventModel[];
    readonly objects: readonly TypertObjectModel[];
}`},{name:"TypertPackageRecord",declaration:`export interface TypertPackageRecord {
    readonly package: string;
    readonly face: TypertFace;
    readonly key: string;
    readonly model: TypertPackageModel;
}`},{name:"TypertSchemaFilter",declaration:`export interface TypertSchemaFilter {
    readonly package?: string;
    readonly face?: TypertFace;
}`},{name:"TypertSchemaRecord",declaration:`export interface TypertSchemaRecord extends TypertSchema {
    readonly package: string;
    readonly face: TypertFace;
    readonly key: string;
}`},{name:"TypertServiceModel",declaration:`export interface TypertServiceModel extends TypertDocumentation {
    readonly key: string;
    readonly exportName: string;
    readonly members: readonly TypertMemberModel[];
    readonly types: readonly TypertTypeModel[];
}`},{name:"TypertTypeModel",declaration:`export interface TypertTypeModel {
    readonly name: string;
    readonly declaration: string;
}`},{name:"UpdateTeamTaskRequest",declaration:`export interface UpdateTeamTaskRequest {
    readonly taskId: TeamTaskId;
    readonly expectedRevision: number;
    readonly action: TeamTaskAction;
    readonly subject?: string;
    readonly description?: string;
    readonly blockedBy?: readonly TeamTaskId[];
    readonly writeScopes?: readonly string[];
    readonly owner?: string;
}`},{name:"UserMessage",declaration:`export interface UserMessage extends Message {
    readonly role: 'user';
}`},{name:"UserQuestionProvider",declaration:`export interface UserQuestionProvider {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
}`},{name:"WebBootEntry",declaration:`export interface WebBootEntry {
    id: string;
    url: string;
    rev: string;
    inject?: string[];
    immediately?: boolean;
    external?: string[];
}`},{name:"WebBootGraph",declaration:`export interface WebBootGraph {
    rev: string;
    entries: WebBootEntry[];
}`},{name:"WebFetchBody",declaration:`export type WebFetchBody = {
    readonly kind: 'html';
    readonly content: string;
} | {
    readonly kind: 'text';
    readonly content: string;
};`},{name:"WebFetchProvider",declaration:`export interface WebFetchProvider {
    readonly id: string;
    available(): boolean;
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}`},{name:"WebFetchRequest",declaration:`export interface WebFetchRequest {
    readonly url: string;
}`},{name:"WebFetchResult",declaration:`export interface WebFetchResult {
    readonly url: string;
    readonly statusCode: number;
    readonly body: WebFetchBody;
    readonly truncated: boolean;
}`},{name:"WebFetchResultView",declaration:`export interface WebFetchResultView {
    card: 'web';
    kind: 'fetch';
    title?: string;
    url: string;
    statusCode: number;
    truncated: boolean;
}`},{name:"WebResultView",declaration:"export type WebResultView = WebSearchResultView | WebFetchResultView;"},{name:"WebRoute",declaration:`export interface WebRoute {
    kind: WebRouteKind;
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}`},{name:"WebRouteKind",declaration:"export type WebRouteKind = 'exact' | 'prefix';"},{name:"WebSearchProvider",declaration:`export interface WebSearchProvider {
    readonly id: string;
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}`},{name:"WebSearchRequest",declaration:`export interface WebSearchRequest {
    readonly query: string;
    readonly maxResults?: number;
}`},{name:"WebSearchResult",declaration:`export interface WebSearchResult {
    readonly content?: string;
    readonly sources: readonly WebSearchSource[];
    readonly truncated: boolean;
}`},{name:"WebSearchResultView",declaration:`export interface WebSearchResultView {
    card: 'web';
    kind: 'search';
    title?: string;
    sources: WebSource[];
    answer?: string;
    truncated: boolean;
}`},{name:"WebSearchSource",declaration:`export interface WebSearchSource {
    readonly url: string;
    readonly title?: string;
    readonly snippet?: string;
    readonly publishedAt?: string;
}`},{name:"WebSource",declaration:`export interface WebSource {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}`},{name:"WebUpgradeRoute",declaration:`export interface WebUpgradeRoute {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}`},{name:"WorkflowAgentEndInfo",declaration:`export interface WorkflowAgentEndInfo extends WorkflowAgentInfo {
    outcome: WorkflowAgentOutcome;
}`},{name:"WorkflowAgentInfo",declaration:`export interface WorkflowAgentInfo {
    seq: number;
    label: string;
    phase?: string;
    childId: SessionId;
}`},{name:"WorkflowAgentOutcome",declaration:"export type WorkflowAgentOutcome = 'completed' | 'failed' | 'cancelled';"},{name:"WorkflowMeta",declaration:`export interface WorkflowMeta {
    name: string;
    description: string;
    whenToUse?: string;
    phases?: WorkflowPhase[];
}`},{name:"WorkflowPhase",declaration:`export interface WorkflowPhase {
    title: string;
    detail?: string;
    provider?: string;
    model?: string;
}`},{name:"WorkflowResult",declaration:`export interface WorkflowResult {
    value: unknown;
    stopReason: WorkflowStopReason;
    error?: string;
    agentsStarted: number;
}`},{name:"WorkflowResultInfo",declaration:`export interface WorkflowResultInfo {
    stopReason: WorkflowStopReason;
    error?: string;
    agentsStarted: number;
}`},{name:"WorkflowRun",declaration:`export interface WorkflowRun {
    readonly id: WorkflowRunId;
    readonly meta: WorkflowMeta;
    readonly result: Promise<WorkflowResult>;
    cancel(reason?: string): void;
    dispose(): Promise<void>;
}`},{name:"WorkflowRunId",declaration:"export type WorkflowRunId = Branded<'WorkflowRunId'>;"},{name:"WorkflowRunInfo",declaration:`export interface WorkflowRunInfo {
    id: WorkflowRunId;
    meta: WorkflowMeta;
}`},{name:"WorkflowStartRequest",declaration:`export interface WorkflowStartRequest {
    script: string;
    meta: WorkflowMeta;
    args?: unknown;
    subagentProvider?: string;
    maxTotalAgents?: number;
    parent: Agent;
    signal?: AbortSignal;
}`},{name:"WorkflowStopReason",declaration:"export type WorkflowStopReason = 'completed' | 'cancelled' | 'error';"}];function k(e){const n=new Set;let t=[...e];for(;t.length>0;){const r=[];for(const o of v){if(n.has(o.name))continue;const i=new RegExp(`\b${o.name}\b`);t.some(a=>i.test(a))&&(n.add(o.name),r.push(o.declaration))}t=r}return v.filter(r=>n.has(r.name))}function O(e){return/^[A-Za-z_$][\w$]*$/.test(e)?`ctx.${e}`:`ctx[${JSON.stringify(e)}]`}function F(e,n=D){if(e===void 0)return{mode:"catalog",services:n.map(r=>({key:r.key,description:r.summary,methods:r.methods.map(o=>({signature:o.signature}))}))};const t=n.find(r=>r.key===e);if(t===void 0)throw new Error(`no catalogued Service named "${e}"`);return{mode:"service",service:{key:t.key,description:t.description,access:{optional:{expression:`ctx.get(${JSON.stringify(t.key)})`,requiresUndefinedCheck:!0},hardDependency:{inject:[t.key],expression:O(t.key)}},methods:t.methods},referencedTypes:k(t.methods.map(r=>r.signature))}}function L(e,n=x){if(e===void 0)return{mode:"catalog",events:n.map(r=>({name:r.name,description:r.summary,mode:r.mode,signature:r.signature}))};const t=n.find(r=>r.name===e);if(t===void 0)throw new Error(`no catalogued Event named "${e}"`);return{mode:"event",event:{name:t.name,description:t.description,mode:t.mode,signature:t.signature,parameters:t.parameters},referencedTypes:k([t.signature])}}function j(e){const n=e.reflect.store;return Object.getOwnPropertySymbols(n).map(t=>n[t]).filter(t=>t!==void 0)}function B(e,n){let t=e;for(;;){if(t===n)return!0;const r=t.parent.fiber;if(r===t)return!1;t=r}}function R(e,n){return j(e).filter(t=>B(t.fiber,n)).map(t=>t.name).sort()}function y(e,n){return Object.keys(n.inject).filter(t=>e.get(t)===void 0)}function N(){return{card:"generic",kind:"read",title:"List Cordis Inspect Providers"}}function W(e){return{card:"generic",kind:"read",title:`Query Cordis ${e.platform} ${e.provider}.${e.method}`}}function U(e){return{card:"generic",kind:"read",title:`Inspect ${e.pluginId===void 0?"dynamic Cordis Plugins":e.packageId===void 0?e.pluginId:`${e.pluginId}/${e.packageId}`}`}}function V(e){const n=e.plugin.kind==="new"?`new ${e.plugin.idPrefix}-*`:e.plugin.pluginId;return{card:"generic",kind:"execute",title:`Register Cordis Plugin "${e.name}" for ${n}: ${e.purpose}`,rawInput:e.code}}function z(e){return{card:"generic",kind:"delete",title:`Remove Cordis Plugin ${e.pluginId}`}}function H(e){return{card:"generic",kind:"execute",title:`${e.mode==="update"?"Update":"Run"} Cordis Plugin ${e.pluginId} · ${e.packageId}`}}function _(e){return{card:"generic",kind:"execute",title:`Stop Cordis Plugin ${e.pluginId}`}}const G=`# Dynamic Cordis Plugins

Dynamic Cordis plugins temporarily extend the current DSH process. A Plugin uses apply(ctx) to consume Services, listen to Events, provide Services, register model Tools, or register browser UI in Slots.

- Plugin and Package definitions exist only in the current process. define itself does not modify repository source, configuration, or disk, and definitions do not survive a process restart.
- The restricted execution environment prevents accidental misuse; it is not a security boundary for malicious code. Services obtained by dynamic code connect to the real runtime.

## Make the user-facing plan clear first

- Dynamic Cordis Plugins are one available implementation mechanism, not the default for every request. Consider whether one could help only when the user intends to design or create something, or when a temporary interface could materially aid the current work. The presence of these instructions or Tools, and discussion of Cordis itself, do not make a request a dynamic-Plugin task.
- When Cordis is a plausible fit, infer the intended work target and lifetime from the request and conversation. Use it only when the outcome belongs to the current running harness and should be delivered as a temporary runtime extension. If that distinction is materially ambiguous, ask at most one concise question about the intended result or lifetime. Otherwise proceed with the matching workflow; do not require the user to know or choose Cordis as an implementation mechanism.
- Once a dynamic Plugin is appropriate, decide whether the task creates a new Plugin or modifies the Plugin named by the user with @pluginId. Proceed directly when the goal is clear; do not ask for repeated confirmation.
- Choose Host, Client, or both from the requested outcome. Do not propose a Client/browser UI when the task does not need visible page behavior, and do not avoid Client when the requested outcome is visual, interactive, or depends on page state. Host versus Client is an implementation choice; do not make the user choose it.
- When a design direction or a potentially useful interface would materially affect the result, ask at most one concise outcome or creative-preference question and offer a few candidate directions. Otherwise proceed directly; do not conduct a multi-round interview or a complex questionnaire.
- cordis_define only defines and presents code; it does not run it. After definition, explain the pluginId and packageId returned by the Host and whether the next step is a run or update.
- cordis_run may require user approval. When it returns awaiting-approval, explain that the user must allow or reject it in the UI. Do not wait, retry, or claim that it is running.
- When it returns starting, explain that the request has entered the asynchronous flow and the Client is still activating. starting does not mean success. Wait for the system to report the final result through steering context.
- Do not request approval again after the user rejects it. After a technical failure, fix the same Plugin from its diagnostics; do not silently create a replacement Plugin.

## Recommended workflow and Tools

Before creating, modifying, or repairing a Plugin, load the cordis-plugin-development Skill. The Skill provides requirement navigation, capability composition, complete examples, and troubleshooting. Treat Inspect Provider results as the source of truth for exact APIs.

1. cordis_inspect_list: discover the current Host and Client Providers and their read-only query methods.
2. cordis_inspect_query: use the returned platform, provider, method, and schema to query exact Service, Event, Builtin, Slot, Theme token, or Tool information.
3. cordis_inspect_self: inspect the current Session's Plugins, Packages, version pointers, source, and diagnostics. Source is returned only when both pluginId and packageId are specified.
4. cordis_define: create the first Package for a new Plugin or append an immutable Package to an existing Plugin. It defines code but does not run it.
5. cordis_run: activate an exact Package. Use run for the first activation, restarting current, or rollback; use update to switch versions.
6. cordis_stop: remove the current Run and pending approval request while retaining definitions, grants, and version pointers.
7. cordis_undefine: permanently stop and delete a Plugin and all of its Packages. Use it only after confirming that the user no longer needs them.

- Inspect and Catalog data only confirm capabilities, names, signatures, types, and registration protocols before code is written; they do not replace business APIs.
- Query Service.listService and Event.listEvents without input to choose from their compact signature directories, then query the exact service or event before using it. Exact queries return the structured contract and only its referenced types.
- At runtime, a Plugin must call real Services or listen to real Events. Do not cache, display, or depend on Inspect results as business data.

## Identity, versions, and approval

- pluginId identifies a Plugin that can be modified over time. For a new Plugin, submit only a semantic idPrefix of 3–6 lowercase English letters; the Host allocates the final ID.
- packageId identifies one immutable Host/Client source version under a Plugin. To change code, define a new Package; never overwrite an old version.
- pluginRunId identifies one activation attempt and connects its approval, Host/Client loading, private RPC, Run card, and errors.
- currentPackageId is the most recent fully successful Package. Stopping, starting an update, or failing an update does not clear it.
- nextPackageId is the target awaiting approval, being attempted, awaiting Client activation, or most recently failed.
- A single check mark authorizes only the current Package; double check marks authorize future versions of the same Plugin. A grant remains in effect after a technical failure.
- An update stops the old Run before starting the target Package. Failure does not automatically restart the old version; retry next with update or roll back to current with run.

When the user enters @pluginId, the system injects identity, the default base Package, version pointers, and runtime status, but not source code:

1. Call cordis_inspect_self(pluginId, packageId) to read the target source.
2. Use cordis_define in existing mode to append a Package to the same Plugin.
3. Call cordis_run in run or update mode according to the version relationship.

Never silently create another Plugin for @pluginId. If the reference is unavailable because it was removed, belongs to another Session, or was lost on process restart, tell the user directly.

## High-frequency errors that must be avoided

### Services: ctx.get and inject

- Read an optional Service with ctx.get('serviceName') by default and handle undefined.
- Declare inject: ['serviceName'] on the returned Plugin object only when the Service is a hard dependency and the Plugin must enter waiting until Cordis reactivates it after the Service appears.
- Read ctx.serviceName only after declaring that Service in inject. Never access an undeclared Service as a ctx property.

\`\`\`js
return {
  inject: ['requiredService'],
  apply(ctx) {
    ctx.requiredService.someMethod()
    const optionalService = ctx.get('optionalService')
    if (optionalService !== undefined) optionalService.someMethod()
  },
}
\`\`\`

### Code: use plain JavaScript only

- Host and Client code is not transformed by TypeScript, JSX, or a bundler.
- Do not use TypeScript types, as, decorators, import, require, or JSX.
- Client React code must use React.createElement(...); never write <Component />.
- Do not assume that process, Buffer, window, document, fetch, native timers, or any other global is available. Query the corresponding platform's Builtins and Services first.

### Data: do not serialize live data

- Services, Events, Slots, Sessions, and their derived Cordis/DSH objects are internal live data, not ordinary JSON that can be dumped.
- Do not apply JSON.stringify, structuredClone, recursive enumeration, full copying, or whole-object display to live data.
- Read only the leaf fields required by the task, then construct the smallest owned data object without Host references.

### Lifecycle: every side effect must be reversible

- Services, Events, Tools, handlers, timers, Slots, styles, and theme overrides must all belong to the current Fiber.
- Use ctx.effect(), ctx.on(), or official APIs that return a disposer so stop, update, or undefine removes every side effect.
- The cordis-plugin-development Skill contains complete timer, Waterfall, Slot, theme, Tool, RPC, and React examples and troubleshooting guidance.

## Host and Client

- Host runs in the DSH Node.js process and is appropriate for files, networking, commands, Agent/Session access, Host Events, Services, model Tools, and JSON methods callable by the Client.
- Client runs in the browser page and is appropriate for themes, layout, current page state, Tool cards, and Slot UI.
- Host and Client communicate through Package-private JSON methods: Host uses harness.handle(method, handler), and Client uses host.call(method, args). The direction is Client→Host, and only lossless JSON may cross it.
- Client UI must be registered in a queried Slot; apply() cannot directly return a React Element. Query Slots.listSubTree without root to choose from the compact purpose/topology tree, then query the exact root for its full registration contract and props before writing code.
- See the Skill and Inspect Providers for Run-specific panels and exact Slot registration patterns.

## Asynchronous results and recovery

- Do not wait inside a Tool for approval or browser work that can happen only after the current turn ends.
- Asynchronous success, rejection, and runtime errors update Run state and notify you through steering context.
- After a technical failure, use cordis_inspect_self to read the exact Package source and its message/stack. Define a corrected Package under the same Plugin and retry autonomously.
- Use the cordis-plugin-development Skill for other failure causes, repair procedures, and complete extension patterns.`,T={type:"object",properties:{},additionalProperties:!1},I={description:"JSON data owned by this inspect provider."},J=P("service","Exact Service key. Omit it for the compact Service and method-signature directory."),K=P("event","Exact Event name. Omit it for the compact Event and listener-signature directory."),Q={description:"Compact Service directory, or one exact Service contract with only its referenced type declarations."},$={description:"Compact Event directory, or one exact Event contract with only its referenced type declarations."},Y=x.filter(e=>!e.name.startsWith("cordis/"));function Z(e){return[h("Service","Progressive Host Service discovery: compact capability/signature directory, then one exact coding contract.","listService",n=>F(w(n,"service")),J,Q),h("Event","Progressive Host Event discovery: compact listener directory, then one exact event contract.","listEvents",n=>L(w(n,"event"),Y),K,$),h("Builtin","Plain-JavaScript symbols available to a dynamic Host half.","listBuiltins",()=>({builtins:E,referencedTypes:[]})),{manifest:{id:"Tool",description:"Tools visible to the requesting Agent, including scoped and dynamic registrations.",methods:[{name:"listTools",description:"Return every Tool schema currently callable by this Agent.",inputSchema:T,outputSchema:I}]},query(n,t,r){if(n!=="listTools")throw new Error(`unknown Tool inspect method "${n}"`);return Promise.resolve({tools:e.tools.schemas(r.agent)})}}]}function h(e,n,t,r,o=T,i=I){return{manifest:{id:e,description:n,methods:[{name:t,description:n,inputSchema:o,outputSchema:i}]},async query(a,d){if(a!==t)throw new Error(`unknown ${e} inspect method "${a}"`);return await r(d)}}}function P(e,n){return{type:"object",properties:{[e]:{type:"string",description:n}},additionalProperties:!1}}function w(e,n){if(e==null||Array.isArray(e)||typeof e!="object")return;const t=e[n];return typeof t=="string"?t:void 0}const X="tool-cordis",le=["tools","systemPrompt","dynamicCordisRunner","cordisInspect"];function u(e){if(e.agent===void 0)throw new Error("Cordis dynamic tools require an Agent-backed session");return e.agent}function ce(e){e.systemPrompt.section({name:"tool:cordis",order:115,text:G});for(const n of Z(e))e.effect(()=>e.cordisInspect.register(n),`tool-cordis: inspect ${n.manifest.id}`);e.tools.register(c({name:"cordis_inspect_list",description:"List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest manifests synchronized from the Client. Each entry includes its platform, purpose, read-only methods, and input/output schemas. Call this Tool before creating or modifying a Package, then select the provider and method for cordis_inspect_query from its result. Do not guess names or treat an Inspect method as a business Service that Plugin code can call.",parameters:{},output:{schema:{type:"json"},render:(n,t)=>[{type:"text",text:JSON.stringify(t,null,2)}]},execute(n,t){return Promise.resolve({providers:e.cordisInspect.list()})},presentCall:N})),e.tools.register(c({name:"cordis_inspect_query",description:"Run a read-only query explicitly declared by an Inspect Provider. platform, provider, and method must come from cordis_inspect_list, and input must satisfy that method's schema. Use this Tool before cordis_define to read exact Service methods, Event modes, Builtin signatures, Tool schemas, theme tokens, or live Slot trees and props. Host queries run locally. A Client query waits for the first valid page response and remains pending until a page answers or the Tool is cancelled. This Tool cannot invoke business Service methods or modify the runtime. For Service.listService and Event.listEvents, query without input to navigate the compact signature directory, then query the exact service or event for its structured contract and referenced types. For Slots.listSubTree, query without root to navigate the compact tree, then query the exact root for its complete registration contract and props.",parameters:{platform:{type:"string",required:!0,enum:["host","client"],description:"Runtime platform that owns the Provider."},provider:{type:"string",required:!0,description:"Exact Provider ID returned by cordis_inspect_list."},method:{type:"string",required:!0,description:"Exact method name declared by the Provider manifest."},input:{type:"json",description:"Optional query input; it must satisfy the method input schema."}},output:{schema:{type:"json"},render:(n,t)=>[{type:"text",text:JSON.stringify(t,null,2)}]},async execute(n,t){const r=await e.cordisInspect.query(n.platform,n.provider,n.method,n.input,u(t),t.signal);return{platform:n.platform,provider:n.provider,method:n.method,data:r}},presentCall:W})),e.tools.register(c({name:"cordis_inspect_self",description:"Inspect dynamic Cordis objects owned by the current Session at increasing levels of detail. With no IDs, list only Plugin summaries. With pluginId alone, return version pointers, the latest Run, and every Package summary. Only pluginId plus packageId returns that immutable Package's Host/Client source and runtime diagnostics. packageId cannot be supplied alone. Query an exact Package before handling @pluginId, repairing an asynchronous failure, or defining an updated version. This Tool is read-only: it neither executes code nor changes version pointers.",parameters:{pluginId:{type:"string",description:"Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."},packageId:{type:"string",description:"Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."}},output:{schema:{type:"json"},render:(n,t)=>[{type:"text",text:JSON.stringify(t,null,2)}]},execute(n,t){const r=u(t);if(n.packageId!==void 0&&n.pluginId===void 0)throw new Error("cordis_inspect_self packageId requires pluginId");if(n.pluginId===void 0)return Promise.resolve({mode:"plugins",plugins:e.dynamicCordisRunner.listPlugins(r).map(i=>f(i))});const o=p(n.pluginId);if(n.packageId===void 0){const i=e.dynamicCordisRunner.inspectPlugin(r,o);return Promise.resolve({mode:"plugin",...f(i),packages:i.packages.map(a=>({...a,packageId:String(a.packageId),isCurrent:a.packageId===i.currentPackageId,isNext:a.packageId===i.nextPackageId}))})}return Promise.resolve(ee(e,r,o,b(n.packageId)))},presentCall:U})),e.tools.register(c({name:"cordis_define",description:'Define an immutable Cordis Package. For a new Plugin, use kind:"new" and provide only a semantic prefix of 3–6 lowercase English letters; the Host returns the final pluginId and packageId. To modify an existing Plugin, use kind:"existing" with its exact pluginId to append a Package without overwriting older versions. Provide at least one of code.host and code.client. Each value is a plain JavaScript function body that returns a Cordis Plugin; no TypeScript, JSX, or import transformation occurs. Query Inspect before depending on a Service, Event, Builtin, Slot, or token. Define only validates parameters and syntax and records source: it does not request approval, execute apply, or change currentPackageId. On success, call cordis_run with the returned IDs.',parameters:{plugin:{required:!0,oneOf:[{type:"object",additionalProperties:!1,properties:{kind:{type:"string",const:"new",required:!0},idPrefix:{type:"string",required:!0,description:"Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."}}},{type:"object",additionalProperties:!1,properties:{kind:{type:"string",const:"existing",required:!0},pluginId:{type:"string",required:!0,description:"Exact ID of an existing Plugin; the new Package is appended to that instance."}}}]},name:{type:"string",required:!0,description:"Short, readable Package name."},purpose:{type:"string",required:!0,description:"One-sentence, user-facing description of the Package purpose."},code:{type:"object",additionalProperties:!1,required:!0,properties:{host:{type:"string",description:"Plain JavaScript function body that returns the Host-half Cordis Plugin."},client:{type:"string",description:"Plain JavaScript function body that returns the browser Client-half Cordis Plugin."}}}},output:{schema:{type:"object",additionalProperties:!1,properties:{pluginId:{type:"string",required:!0},packageId:{type:"string",required:!0},name:{type:"string",required:!0},purpose:{type:"string",required:!0},hasHostHalf:{type:"boolean",required:!0},hasClientHalf:{type:"boolean",required:!0}}},render:(n,t)=>[{type:"text",text:`Defined ${t.pluginId}/${t.packageId} (${t.name}); it is not running yet. Use cordis_run to activate this Package.`}],presentationMeta:(n,t)=>({pluginId:t.pluginId,packageId:t.packageId})},execute(n,t){const r=n.plugin.kind==="new"?{kind:"new",idPrefix:n.plugin.idPrefix}:{kind:"existing",pluginId:p(n.plugin.pluginId)},o=e.dynamicCordisRunner.define({sessionId:u(t).id,plugin:r,name:n.name,purpose:n.purpose,code:{...n.code.host===void 0?{}:{host:n.code.host},...n.code.client===void 0?{}:{client:n.code.client}}});return Promise.resolve({...o,pluginId:String(o.pluginId),packageId:String(o.packageId)})},presentCall:V})),e.tools.register(c({name:"cordis_run",description:'Activate one exact Package of a dynamic Plugin. Use mode:"run" for the first activation, restarting currentPackageId, or rollback. When current exists, use mode:"update" to switch to a different Package, even if the Plugin is currently stopped. An unauthorized Client Package creates an approval request and returns awaiting-approval; an authorized Package returns starting and continues asynchronously in the browser. Neither result waits for the final outcome inside the Tool. currentPackageId changes only after complete success; on failure, the old current and target next remain. Asynchronous success, rejection, or technical failure is reported through state and steering. After a technical failure, read diagnostics with cordis_inspect_self, correct the same Plugin, and retry autonomously. Do not request approval again after the user rejects it.',parameters:{pluginId:{type:"string",required:!0,description:"Stable Plugin ID returned by cordis_define."},packageId:{type:"string",required:!0,description:"Exact immutable Package ID to activate under that Plugin."},mode:{type:"string",required:!0,enum:["run","update"],description:"Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package."}},output:{schema:{type:"json"},render:(n,t)=>{const r=S(t),o=m(r,"pluginId"),i=m(r,"packageId"),a=m(r,"pluginRunId");return[{type:"text",text:r.status==="awaiting-approval"?`${o}/${i} is awaiting user approval (${a}).`:r.status==="starting"?`${o}/${i} is starting asynchronously (${a}).`:`${o}/${i} is running (${a}).`}]},presentationMeta:(n,t)=>{const r=S(t);return{pluginId:m(r,"pluginId"),packageId:m(r,"packageId"),pluginRunId:m(r,"pluginRunId")}}},async execute(n,t){const r=u(t),o=p(n.pluginId),i=b(n.packageId),a=await e.dynamicCordisRunner.run(r,o,i,n.mode,t.signal);if(!a.ok)throw new Error(a.message);if(a.status!=="running")return{status:a.status,pluginId:n.pluginId,packageId:n.packageId,pluginRunId:String(a.pluginRunId),mode:a.mode,...a.currentPackageId===void 0?{}:{currentPackageId:String(a.currentPackageId)},nextPackageId:String(a.nextPackageId)};const d=e.dynamicCordisRunner.snapshot(r).find(l=>l.pluginId===o),s=d?.activeRun?.pluginRunId===a.pluginRunId?d.activeRun.fiber:void 0;return{status:"running",pluginId:n.pluginId,packageId:n.packageId,pluginRunId:String(a.pluginRunId),currentPackageId:String(a.currentPackageId),...a.nextPackageId===void 0?{}:{nextPackageId:String(a.nextPackageId)},host:{status:s===void 0?"absent":y(e,s).length===0?"running":"waiting",provides:s===void 0?[]:R(e,s),waitingFor:s===void 0?[]:y(e,s)},client:{status:a.clientWaitingFor===void 0?"absent":a.clientWaitingFor.length===0?"running":"waiting",waitingFor:[...a.clientWaitingFor??[]]}}},presentCall:H})),e.tools.register(c({name:"cordis_stop",description:"Stop the current Run of a dynamic Plugin and cancel unfinished approval or activation requests. Retain the Plugin, every immutable Package, grants, currentPackageId, and nextPackageId so it can later run or update directly. Stopping an already stopped Plugin succeeds idempotently. Use this Tool to disable effects temporarily; use cordis_undefine for permanent removal.",parameters:{pluginId:{type:"string",required:!0,description:"Stable dynamic Plugin ID to stop."}},output:{schema:{type:"object",additionalProperties:!1,properties:{pluginId:{type:"string",required:!0}}},render:(n,t)=>[{type:"text",text:`Dynamic Plugin ${t.pluginId} is stopped; its definition and versions remain.`}]},async execute(n,t){const r=await e.dynamicCordisRunner.stop(u(t),p(n.pluginId));if(!r.ok&&r.reason!=="not-running")throw new Error(r.message);return{pluginId:n.pluginId}},presentCall:_})),e.tools.register(c({name:"cordis_undefine",description:'Permanently remove a dynamic Plugin owned by the current Session. If it is running or awaiting approval, first stop it and cancel the request, then delete every Package, grant, and version pointer. After this returns, its pluginId, packageIds, @ reference, and Package business views are invalid; historical cards retain only a "Plugin removed" record. Do not call this Tool when versions must remain available for restart or rollback; use cordis_stop instead.',parameters:{pluginId:{type:"string",required:!0,description:"Stable dynamic Plugin ID to remove permanently."}},output:{schema:{type:"object",additionalProperties:!1,properties:{pluginId:{type:"string",required:!0},wasRunning:{type:"boolean",required:!0}}},render:(n,t)=>[{type:"text",text:`Removed dynamic Plugin ${t.pluginId} and all of its Packages.`}]},async execute(n,t){const r=await e.dynamicCordisRunner.undefine(u(t),p(n.pluginId));if(!r.ok)throw new Error(r.message);return{pluginId:n.pluginId,wasRunning:r.wasRunning}},presentCall:z})),e.on("agent/pre-step",async({agent:n,messages:t,signal:r},o)=>{const i=await o();if(i.kind==="reject")return i;const a=ne(t);if(a.length===0)return i;r.throwIfAborted();const d=a.map(s=>{const l=e.dynamicCordisRunner.reference(n,p(s));return M({content:[{type:"text",text:l===void 0?re(s):te(l)}],source:{kind:"plugin",plugin:X,form:"instructions"}})});return{kind:"enter",messages:[...i.messages,...d]}})}function S(e){if(typeof e!="object"||e===null||Array.isArray(e))throw new Error("expected a JSON object");return e}function m(e,n){const t=e[n];if(typeof t!="string")throw new Error(`expected JSON string field "${n}"`);return t}function f(e){const n=e.latestRun,t=C(e);return{pluginId:String(e.pluginId),name:e.name,packageCount:e.packages?.length??1,state:t,...e.currentPackageId===void 0?{}:{currentPackageId:String(e.currentPackageId)},...e.nextPackageId===void 0?{}:{nextPackageId:String(e.nextPackageId)},...e.activeRun===void 0?{}:{activeRun:{pluginRunId:String(e.activeRun.pluginRunId),packageId:String(e.activeRun.packageId)}},...n?.status!=="awaiting-approval"?{}:{pendingApproval:{pluginRunId:String(n.pluginRunId),packageId:String(n.packageId),mode:n.mode}}}}function C(e){const n=e.latestRun?.status;return n==="awaiting-approval"?"awaiting-approval":n==="client-pending"||n==="starting-host"?"client-pending":n==="failed"||n==="rejected"||n==="cancelled"?"failed":n==="waiting"?"waiting":n==="running"||e.activeRun!==void 0?"running":e.currentPackageId===void 0?"defined":"stopped"}function ee(e,n,t,r){const o=e.dynamicCordisRunner.inspectPackage(n,t,r),i=e.dynamicCordisRunner.snapshot(n).find(g=>g.pluginId===t),a=i?.packages.find(g=>g.packageId===r),d=i?.activeRun?.packageId===r?i.activeRun:void 0,s=o.latestRun?.packageId===r?o.latestRun:void 0,l=d?.fiber===void 0?[...s?.host.waitingFor??[]]:y(e,d.fiber),A=a?.hasHostHalf!==!0?"absent":s?.host.status??(d===void 0?"stopped":l.length===0?"running":"waiting"),q=a?.hasClientHalf!==!0?"absent":s?.client.status??"stopped";return{mode:"package",plugin:f(o),packageId:String(r),name:o.name,purpose:o.purpose,code:o.code,runtime:{state:C(o),host:{status:A,provides:d?.fiber===void 0?[]:R(e,d.fiber),waitingFor:l,handlers:d?.handlers??[],...s?.host.error===void 0?{}:{error:s.host.error}},client:{status:q,waitingFor:[...s?.client.waitingFor??[]],...s?.client.error===void 0?{}:{error:s.client.error},...d?.renderFailure===void 0?{}:{renderFailure:d.renderFailure}}}}}function ne(e){const n=new Set,t=/(?:^|\s)@([a-z]{3,6}-\d+)(?=\s|$)/g;for(const r of e){if(r.source.kind!=="user")continue;const o=r.content.flatMap(i=>i.type==="text"?[i.text]:[]).join(`
`);for(const i of o.matchAll(t))i[1]!==void 0&&n.add(i[1])}return[...n]}function te(e){const n=e.currentPackageId===void 0?"run":"update";return["<cordis_dynamic_plugin_context>",JSON.stringify(e,null,2),"",`The user explicitly referenced @${e.pluginId}. Use Package ${e.packageId} as the base for this modification.`,`Before modifying it, call cordis_inspect_self with pluginId="${e.pluginId}" and packageId="${e.packageId}" to read the exact metadata and source.`,`Use cordis_define with plugin.kind="existing" and the original pluginId="${e.pluginId}" to append an immutable Package.`,`Do not create a new Plugin for this request. After cordis_define succeeds, call cordis_run mode="${n}" with the returned packageId.`,"</cordis_dynamic_plugin_context>"].join(`
`)}function re(e){return["<cordis_dynamic_plugin_context>",`The user explicitly referenced @${e}, but this Plugin is unavailable in the current Session.`,"It may have been removed, belong to another Session, or have been lost when the DSH process restarted.","Do not claim that it was updated or silently create a replacement Plugin. Tell the user that the reference is currently unavailable.","</cordis_dynamic_plugin_context>"].join(`
`)}export{ce as apply,le as inject,X as name};
