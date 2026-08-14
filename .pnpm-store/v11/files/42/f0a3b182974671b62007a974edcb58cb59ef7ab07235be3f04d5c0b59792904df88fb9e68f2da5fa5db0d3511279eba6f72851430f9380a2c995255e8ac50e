window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-conversation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_ui_attachment = require("@deepseek-ai/dsh-client-ui-attachment");
		//#region lib/types/client/stores.js
		/**
		* Per-session chat store shared by conversation and details registrations.
		* The plugin creates its handle at apply time so identity follows the fiber.
		*/
		/**
		* Declares the per-session chat state and write surface.
		* @returns the store handle.
		*/
		function createChatStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					selection: null,
					draft: "",
					view: null,
					inspect: null
				}),
				persist: "dsh.conversation.chat",
				actions: {
					select: (d, target) => {
						d.selection = target;
					},
					setDraft: (d, text) => {
						d.draft = text;
					},
					setView: (d, view) => {
						d.view = view;
					},
					setInspect: (d, target) => {
						d.inspect = target;
					}
				}
			});
		}
		//#endregion
		//#region lib/types/client/service.js
		/**
		* Scope-addressed conversation send, cancel, and history orchestration.
		*
		* Scope addressing rides the cordis Service tracker: property access through
		* `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
		* read the session tag with `scopeOf`. Mutable state must remain reachable
		* through one property read; assignment through the tracker proxy and `#`
		* private fields bypass that rebinding.
		*/
		/** Create one browser-only draft descriptor; only its id enters input state. */
		function browserDraftAttachment(file) {
			return {
				kind: "image",
				id: crypto.randomUUID(),
				previewUrl: URL.createObjectURL(file),
				file
			};
		}
		/** Unsupported browser-declared image type, localized by the UI boundary. */
		var UnsupportedImageMediaTypeError = class extends Error {
			/** Browser-declared MIME value, possibly empty. */
			mediaType;
			/** @param mediaType - Browser-declared MIME value, possibly empty. */
			constructor(mediaType) {
				super(`unsupported image media type: ${mediaType || "(empty)"}`);
				this.name = "UnsupportedImageMediaTypeError";
				this.mediaType = mediaType;
			}
		};
		/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
		var ConversationController = class extends _deepseek_ai_cordis.Service {
			/** The per-session input machine registry (SessionInputResolver face). */
			input;
			/** The per-session composer-block registry. */
			blocks;
			draftAttachments = /* @__PURE__ */ new Map();
			imageUrls = /* @__PURE__ */ new Map();
			imageGenerations = /* @__PURE__ */ new Map();
			createdImageUrls = /* @__PURE__ */ new Set();
			disposed = false;
			/**
			* @param ctx - owning root context (the plugin apply context; the service
			* registers itself and follows that fiber's lifetime).
			* @param config - carries the SessionInputResolver and composer-block registry
			* constructed by the plugin apply (the same instances the slot inject
			* factories close over).
			*/
			constructor(ctx, config) {
				super(ctx, "conversation");
				this.input = config.input;
				this.blocks = config.blocks;
				ctx.effect(() => () => {
					this.disposed = true;
					for (const url of this.createdImageUrls) revokePreview(url);
					this.createdImageUrls.clear();
					this.draftAttachments.clear();
					this.imageUrls.clear();
					this.imageGenerations.clear();
				}, "conversation attachment URL cache");
			}
			/**
			* Send a prompt into the scoped session. Business failures also land in the
			* session snapshot's promptError (object-layer state); the rejection here
			* exists for caller choreography (the composer restores the draft on it).
			* @param text - prompt text, sent verbatim as one text block.
			*/
			async send(text) {
				const result = await this.scopedSession("send").prompt([{
					type: "text",
					text
				}], "queue");
				if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`);
			}
			/**
			* Submit ordered draft images with text through one host admission.
			* @param session - target session.
			* @param text - serialized prompt text.
			* @param imageIds - ordered draft-local attachment ids.
			* @param mode - queue or steer delivery selected by composer policy.
			*/
			async sendSession(session, text, imageIds, mode) {
				const attachments = this.draftImages(imageIds);
				if (attachments.length !== imageIds.length) throw new Error("conversation.sendSession: one or more draft images are no longer available");
				const content = [...await this.serializeImages(attachments.map((attachment) => attachment.file)), ...text === "" ? [] : [{
					type: "text",
					text
				}]];
				const result = await session.prompt(content, mode);
				if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`);
				this.releaseDraftImages(attachments);
			}
			/**
			* Create runtime-only draft images and their object URLs.
			* @param files - browser files to register after MIME validation.
			* @returns ordered draft descriptors.
			*/
			createDraftImages(files) {
				for (const file of files) imageMediaType(file.type);
				return files.map((file) => {
					const attachment = browserDraftAttachment(file);
					this.draftAttachments.set(attachment.id, attachment);
					this.createdImageUrls.add(attachment.previewUrl);
					return attachment;
				});
			}
			/**
			* Resolve ordered input-state ids to runtime-owned draft images.
			* @param ids - draft attachment ids.
			* @returns descriptors that remain live, in requested order.
			*/
			draftImages(ids) {
				const attachments = [];
				for (const id of ids) {
					const attachment = this.draftAttachments.get(id);
					if (attachment !== void 0) attachments.push(attachment);
				}
				return attachments;
			}
			/**
			* Release one browser-owned draft image and preview URL.
			* @param id - draft attachment id.
			*/
			releaseDraftImage(id) {
				const attachment = this.draftAttachments.get(id);
				if (attachment === void 0) return;
				this.draftAttachments.delete(id);
				this.createdImageUrls.delete(attachment.previewUrl);
				revokePreview(attachment.previewUrl);
			}
			/**
			* Release a set of browser-owned draft images.
			* @param attachments - descriptors to release.
			*/
			releaseDraftImages(attachments) {
				for (const attachment of attachments) this.releaseDraftImage(attachment.id);
			}
			/**
			* Resolve and cache one session-authorized historical image URL.
			* @param sessionId - owning session authorization scope.
			* @param attachment - durable image reference.
			* @returns browser URL valid until its rendered session is released.
			*/
			resolveImage(sessionId, attachment) {
				if (this.disposed) return Promise.reject(/* @__PURE__ */ new Error("conversation.resolveImage: service is disposed"));
				const key = `${sessionId}:${attachment.attachmentId}`;
				const cached = this.imageUrls.get(key);
				if (cached !== void 0) return cached.pending;
				const generation = this.imageGenerations.get(sessionId) ?? 0;
				const session = this.requireSessions().binding(sessionId)?.session;
				if (session === void 0) return Promise.reject(/* @__PURE__ */ new Error(`conversation.resolveImage: unknown session "${sessionId}"`));
				const pending = session.readAttachment(attachment.attachmentId).then((result) => {
					if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
					if (this.disposed) throw new Error("conversation.resolveImage: service was disposed before loading completed");
					if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) throw new Error("historical image scope was released before loading completed");
					if (typeof URL.createObjectURL !== "function") return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`;
					const bytes = Uint8Array.from(result.value.data);
					const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }));
					this.createdImageUrls.add(url);
					return url;
				}).catch((error) => {
					if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key);
					throw error;
				});
				this.imageUrls.set(key, {
					sessionId,
					generation,
					pending
				});
				return pending;
			}
			/**
			* Release every historical image URL owned by one rendered session.
			* @param sessionId - rendered session scope.
			*/
			releaseSessionImages(sessionId) {
				this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1);
				for (const [key, entry] of this.imageUrls) {
					if (entry.sessionId !== sessionId) continue;
					this.imageUrls.delete(key);
					entry.pending.then((url) => {
						if (!this.createdImageUrls.delete(url)) return;
						revokePreview(url);
					}, () => {});
				}
			}
			/** Apply one operation to a pending queue occurrence. */
			async updateQueue(itemId, action) {
				const result = await this.scopedSession("updateQueue").updateQueue(itemId, action);
				if (!result.ok) {
					if (action.kind === "steer" && (result.error.code === "steer-unavailable" || result.error.code === "queue-item-not-found")) return;
					throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`);
				}
			}
			/** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
			async cancel() {
				const result = await this.scopedSession("cancel").cancel();
				if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`);
			}
			/** Pull one older history page for the scoped Session. */
			async loadOlder() {
				await this.scopedSession("loadOlder").loadOlder();
			}
			/** Resolve the caller scope's session face or throw on root contexts. */
			scopedSession(op) {
				const id = this.scopeId(op);
				const binding = this.requireSessions().binding(id);
				if (binding === void 0) throw new Error(`conversation.${op}: session "${id}" resolved no binding`);
				return binding.session;
			}
			/** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
			scopeId(op) {
				const id = this.requireSessions().scopeOf(this.ctx);
				if (id === void 0) throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`);
				return id;
			}
			requireSessions() {
				const sessions = this.ctx.get("sessions");
				if (sessions === void 0) throw new Error("conversation: sessions service unavailable");
				return sessions;
			}
			/** Convert browser files to canonical base64 prompt parts. */
			serializeImages(images) {
				return Promise.all(images.map(async (file) => ({
					type: "image",
					mediaType: imageMediaType(file.type),
					data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
					...file.name === "" ? {} : { name: file.name }
				})));
			}
		};
		function imageMediaType(value) {
			switch (value) {
				case "image/png":
				case "image/jpeg":
				case "image/webp":
				case "image/gif": return value;
				default: throw new UnsupportedImageMediaTypeError(value);
			}
		}
		function bytesToBase64(data) {
			let binary = "";
			const chunk = 32768;
			for (let offset = 0; offset < data.length; offset += chunk) binary += String.fromCharCode(...data.subarray(offset, offset + chunk));
			return btoa(binary);
		}
		function revokePreview(url) {
			if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		}
		//#endregion
		//#region lib/types/client/input/blocks.js
		/**
		* Composer blocks: the one way another plugin stops a session's input.
		*
		* The composer cannot read the plugins that would know — the dependency runs
		* ui-model-selection → ui-conversation, never back — so a blocker pushes here and the
		* bar reads its own session's store. A block carries the localized reason it
		* exists, because the plugin that raised it owns that copy; the composer only
		* knows how to render an inert textarea with a placeholder, exactly as it
		* already does for a session with no workspace.
		*
		* This is an affordance, not enforcement: the Host refuses a prompt it cannot
		* route regardless of what any client disables.
		*/
		/** The per-session composer-block registry (one instance per plugin fiber). */
		var ComposerBlockRegistry = class {
			stores = /* @__PURE__ */ new Map();
			/** @inheritdoc */
			set(sessionId, block) {
				const store = this.storeFor(sessionId);
				if (store.getSnapshot()?.reason === block?.reason) return;
				store.set(block);
			}
			/** @inheritdoc */
			storeFor(sessionId) {
				const existing = this.stores.get(sessionId);
				if (existing !== void 0) return existing;
				const created = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(void 0);
				this.stores.set(sessionId, created);
				return created;
			}
			/** @inheritdoc */
			forget(sessionId) {
				this.stores.delete(sessionId);
			}
		};
		//#endregion
		//#region lib/types/client/queue/store.js
		/**
		* Project a session's transient inbox rows as a bare observable (subscribe/getSnapshot).
		* The wiring layer overlays this onto InputState.queue; the runtime
		* QueuedMessage and the input-contract QueuedMessage are structurally
		* identical.
		* @param session - the resident session face.
		* @returns the queue read face (snapshot reference stable while the queue is unchanged).
		*/
		function queueReadFaceOf(session) {
			return {
				getSnapshot: () => session.getSnapshot().queue,
				subscribe: (fn) => session.subscribe(fn)
			};
		}
		/** The machine never writes the queue; the wiring layer overlays the queue store's projection. */
		const EMPTY_QUEUE$1 = [];
		/** Undo ring depth (bounded self-managed transaction log). */
		const LOG_LIMIT = 100;
		/** Exhaustiveness backstop for the closed InputEvent / guard unions. */
		function unreachable(value) {
			throw new Error(`unreachable input event: ${JSON.stringify(value)}`);
		}
		/**
		* Strip the claim token off a draft to yield submit args. Leading whitespace
		* (incl. newlines — leading-trigger trim) is tolerated; a bare `/name`
		* missing the token's trailing separator yields empty args. Exactly one
		* separator char is consumed; the remainder — newlines included — stays
		* verbatim (`/goal x\ny` → `x\ny`).
		*/
		function argsAfter(draft, token) {
			const s = draft.trimStart();
			if (s.startsWith(token)) return s.slice(token.length);
			const base = token.trimEnd();
			if (s.startsWith(base)) {
				const rest = s.slice(base.length);
				return /^\s/.test(rest) ? rest.slice(1) : rest;
			}
			return "";
		}
		/**
		* Prefix/suffix common-scan recovering the edit range between two drafts
		* (used when the wiring layer cannot supply one from the DOM event).
		*/
		function diffEdit(prev, next) {
			let p = 0;
			const maxCommon = Math.min(prev.length, next.length);
			while (p < maxCommon && prev[p] === next[p]) p += 1;
			let s = 0;
			const maxSuffix = maxCommon - p;
			while (s < maxSuffix && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s += 1;
			return {
				start: p,
				end: prev.length - s,
				insertedLength: next.length - s - p
			};
		}
		/**
		* Pure input machine, one instance per session (per-session isolation is by
		* construction). The machine constructs one AbortController per SubmitAttempt
		* at enter time and aborts it itself on release; the shell never aborts, it
		* only observes attempt.signal on its adjudicate/submit promises. Stale
		* attempts (any adjudicated / adjudication-failed / submit-settled whose seq
		* is not the in-flight one) are dropped: same state, zero effects.
		*/
		var InputMachine = class {
			draft = "";
			draftRev = 0;
			phase = "plain";
			claim;
			occurrences = [];
			occurrenceSeq = 0;
			seq = 0;
			inflight;
			log = [];
			redoStack = [];
			/** Open single-char typing run: the next contiguous char within the window coalesces. */
			typingRun;
			paste;
			pasteSeq = 0;
			mergeWindowMs;
			now;
			constructor(options = {}) {
				this.mergeWindowMs = options.mergeWindowMs ?? 1e3;
				this.now = options.now ?? (() => 0);
			}
			/** Read-only snapshot of the machine state (queue always empty at this tier). */
			get state() {
				const c = this.claim;
				return {
					draft: this.draft,
					imageIds: [],
					draftRev: this.draftRev,
					phase: this.phase,
					...c ? { claim: {
						token: c.token,
						...c.hint !== void 0 ? { hint: c.hint } : {}
					} } : {},
					occurrences: this.occurrences,
					...this.paste !== void 0 ? { paste: this.paste } : {},
					queue: EMPTY_QUEUE$1
				};
			}
			/**
			* Feed one event through the machine.
			* @param ev - Input event; the single write path for all input state.
			* @returns Effects for the shell to execute in order; empty on no-ops, locks, and dropped stale events.
			*/
			dispatch(ev) {
				switch (ev.type) {
					case "draft-changed": return this.onDraftChanged(ev.draft, ev.editRange);
					case "begin-command": return this.onBeginCommand(ev.claim, ev.span);
					case "insert-ref": return this.onInsertRef(ev.reference, ev.span);
					case "consume-token": return this.onConsumeToken(ev.guard);
					case "set-invalid": return this.onSetInvalid(ev.invalidIds);
					case "undo": return this.onUndo();
					case "redo": return this.onRedo();
					case "paste-begin": return this.onPasteBegin(ev.text, ev.selection, ev.components, ev.generation);
					case "paste-upgrade": return this.onPasteUpgrade(ev.attemptId, ev.span, ev.reference);
					case "invalidate-paste":
						this.paste = void 0;
						return [];
					case "enter": return this.onEnter(ev.mode);
					case "adjudicated": return this.onAdjudicated(ev.attempt, ev.outcome);
					case "adjudication-failed": return this.onAdjudicationFailed(ev.attempt, ev.message);
					case "submit-settled": return this.onSubmitSettled(ev);
					case "send-committed": return this.onSendCommitted();
					case "release": return this.onRelease();
					default: return unreachable(ev);
				}
			}
			/** Adopt a new draft: bump the revision (the span-CAS invalidation point). */
			adopt(draft) {
				this.draft = draft;
				this.draftRev += 1;
			}
			/** Push one undo unit (before-state), trim the ring, and cut the redo chain. */
			pushTxn(selectionBefore) {
				this.log.push({
					draftBefore: this.draft,
					occurrencesBefore: this.occurrences,
					...selectionBefore !== void 0 ? { selectionBefore } : {}
				});
				if (this.log.length > LOG_LIMIT) this.log.shift();
				this.redoStack = [];
			}
			/**
			* Reconcile the occurrence table with one edit (old-draft coordinates):
			* entries past the range shift by the length delta; entries whose
			* placeholder sits inside the replaced range go away whole (a
			* deletion/replacement intersecting a placeholder acts on the whole chip).
			*/
			reconcile(range) {
				const delta = range.insertedLength - (range.end - range.start);
				const kept = [];
				for (const o of this.occurrences) if (o.offset < range.start) kept.push(o);
				else if (o.offset >= range.end) kept.push(delta === 0 ? o : {
					...o,
					offset: o.offset + delta
				});
				this.occurrences = kept;
			}
			/** Claimed integrity watch: any mutation that breaks the token prefix releases the claim. */
			watchClaim() {
				if (this.phase === "claimed" && this.claim !== void 0 && !this.draft.startsWith(this.claim.token)) {
					this.phase = "plain";
					this.claim = void 0;
				}
			}
			/** Mint one occurrence at a draft offset. */
			mint(reference, offset) {
				this.occurrenceSeq += 1;
				return {
					occurrenceId: this.occurrenceSeq,
					source: reference.source,
					ref: reference.ref,
					offset,
					label: reference.label,
					clipboardText: reference.clipboardText
				};
			}
			/** Splice minted entries into the offset-sorted table. */
			withMinted(minted) {
				if (minted.length === 0) return;
				this.occurrences = [...this.occurrences, ...minted].sort((a, b) => a.offset - b.offset);
			}
			onDraftChanged(draft, editRange) {
				if (draft === this.draft) return [];
				const range = editRange ?? diffEdit(this.draft, draft);
				const typing = range.start === range.end && range.insertedLength === 1;
				const at = this.now();
				const run = this.typingRun;
				if (!(typing && run !== void 0 && run.end === range.start && at - run.at <= this.mergeWindowMs)) this.pushTxn({
					start: range.start,
					end: range.end
				});
				this.typingRun = typing ? {
					end: range.start + 1,
					at
				} : void 0;
				this.reconcile(range);
				this.adopt(draft);
				this.watchClaim();
				this.paste = void 0;
				return [];
			}
			/** Span CAS: revision equality (content identity follows) plus bounds sanity. */
			casOk(span) {
				return span.draftRev === this.draftRev && span.start >= 0 && span.start <= span.end && span.end <= this.draft.length;
			}
			onBeginCommand(claim, span) {
				if (this.phase !== "plain" && this.phase !== "claimed") return [];
				if (!this.casOk(span) || this.draft.slice(0, span.start).trim() !== "") return [];
				this.pushTxn();
				this.typingRun = void 0;
				this.reconcile({
					start: 0,
					end: span.end,
					insertedLength: claim.token.length
				});
				this.adopt(claim.token + this.draft.slice(span.end));
				this.claim = claim;
				this.phase = "claimed";
				this.paste = void 0;
				return [];
			}
			onInsertRef(reference, span) {
				if (this.phase !== "plain" && this.phase !== "claimed") return [];
				if (!this.casOk(span)) return [];
				this.replaceSpanWithChip(reference, span);
				this.paste = void 0;
				return [];
			}
			/**
			* Shared chip-insertion transaction: replace [span) with one placeholder
			* occurrence (insert-ref and paste-upgrade both land here). A separating
			* space follows the chip unless one is already next.
			* @returns the inserted length (placeholder plus optional gap).
			*/
			replaceSpanWithChip(reference, span) {
				this.pushTxn();
				this.typingRun = void 0;
				const tail = this.draft.slice(span.end);
				const inserted = "￼" + (tail.length === 0 || tail[0] !== " " ? " " : "");
				this.reconcile({
					start: span.start,
					end: span.end,
					insertedLength: inserted.length
				});
				this.withMinted([this.mint(reference, span.start)]);
				this.adopt(this.draft.slice(0, span.start) + inserted + tail);
				this.watchClaim();
				return inserted.length;
			}
			/**
			* Guarded token deletion after business success (popup settle / menu-pick
			* execute). No effect signals success: the caller reads the draftRev
			* advance off the published state (same currency as the other bail verbs).
			*/
			onConsumeToken(guard) {
				if (this.phase !== "plain" && this.phase !== "claimed") return [];
				switch (guard.kind) {
					case "span": {
						const span = guard.span;
						if (!this.casOk(span) || span.start === span.end) return [];
						this.pushTxn();
						this.typingRun = void 0;
						this.reconcile({
							start: span.start,
							end: span.end,
							insertedLength: 0
						});
						this.adopt(this.draft.slice(0, span.start) + this.draft.slice(span.end));
						this.watchClaim();
						this.paste = void 0;
						return [];
					}
					case "bare-token":
						if (guard.token === "" || this.draft.trim() !== guard.token) return [];
						this.pushTxn();
						this.typingRun = void 0;
						this.occurrences = [];
						this.adopt("");
						this.watchClaim();
						this.paste = void 0;
						return [];
					default: return unreachable(guard);
				}
			}
			/**
			* Owner-resolution style bits: exactly the listed occurrences render
			* invalid. Not a transaction — the draft, revision, and undo log are
			* untouched (invalidation never deletes or rewrites chips).
			*/
			onSetInvalid(invalidIds) {
				const ids = new Set(invalidIds);
				if (!this.occurrences.some((o) => o.invalid === true !== ids.has(o.occurrenceId))) return [];
				this.occurrences = this.occurrences.map((o) => {
					const invalid = ids.has(o.occurrenceId);
					if (o.invalid === true === invalid) return o;
					const { invalid: _drop, ...rest } = o;
					return invalid ? {
						...rest,
						invalid: true
					} : rest;
				});
				return [];
			}
			onUndo() {
				const entry = this.log.pop();
				if (entry === void 0) return [];
				this.redoStack.push({
					draftBefore: this.draft,
					occurrencesBefore: this.occurrences
				});
				this.occurrences = entry.occurrencesBefore;
				this.adopt(entry.draftBefore);
				this.watchClaim();
				this.typingRun = void 0;
				this.paste = void 0;
				return [];
			}
			onRedo() {
				const entry = this.redoStack.pop();
				if (entry === void 0) return [];
				this.log.push({
					draftBefore: this.draft,
					occurrencesBefore: this.occurrences
				});
				if (this.log.length > LOG_LIMIT) this.log.shift();
				this.occurrences = entry.occurrencesBefore;
				this.adopt(entry.draftBefore);
				this.watchClaim();
				this.typingRun = void 0;
				this.paste = void 0;
				return [];
			}
			/**
			* Paste as one transaction: the text (U+FFFC-sanitized) replaces the
			* selection; hot-snapshot sync matches componentize inside the SAME
			* transaction (one undo returns to pre-paste); a match attempt opens for
			* the async remainder while the phase still accepts reference mutations.
			*/
			onPasteBegin(rawText, selection, components = [], generation = 0) {
				const { start, end } = selection;
				if (start < 0 || start > end || end > this.draft.length) return [];
				const text = rawText.split("￼").join("");
				this.pushTxn(selection);
				this.typingRun = void 0;
				const sorted = [...components].sort((a, b) => a.start - b.start);
				const minted = [];
				let inserted = "";
				let cursor = 0;
				for (const c of sorted) {
					inserted += text.slice(cursor, c.start);
					minted.push(this.mint(c.reference, start + inserted.length));
					inserted += "￼";
					cursor = c.end;
				}
				inserted += text.slice(cursor);
				this.reconcile({
					start,
					end,
					insertedLength: inserted.length
				});
				this.withMinted(minted);
				this.adopt(this.draft.slice(0, start) + inserted + this.draft.slice(end));
				this.watchClaim();
				if (this.phase === "plain" || this.phase === "claimed") {
					this.pasteSeq += 1;
					this.paste = {
						attemptId: this.pasteSeq,
						insertedRange: {
							start,
							end: start + inserted.length
						},
						generation
					};
				} else this.paste = void 0;
				return [];
			}
			/**
			* Async match landed: upgrade one pasted token to a chip as an INDEPENDENT
			* transaction (undo #1 → the token text, undo #2 → pre-paste). The attempt
			* stays current — later tokens re-CAS against the advanced draftRev.
			*/
			onPasteUpgrade(attemptId, span, reference) {
				const attempt = this.paste;
				if (attempt === void 0 || attempt.attemptId !== attemptId) return [];
				if (this.phase !== "plain" && this.phase !== "claimed") return [];
				if (!this.casOk(span) || span.start === span.end) return [];
				const insertedLength = this.replaceSpanWithChip(reference, span);
				this.paste = {
					...attempt,
					insertedRange: {
						start: attempt.insertedRange.start,
						end: attempt.insertedRange.end + insertedLength - (span.end - span.start)
					}
				};
				return [];
			}
			/** Mint the next SubmitAttempt and take the in-flight slot. */
			beginAttempt(mode) {
				const controller = new AbortController();
				this.seq += 1;
				const attempt = {
					seq: this.seq,
					signal: controller.signal,
					draftSnapshot: this.draft,
					mode
				};
				this.inflight = {
					attempt,
					controller
				};
				return attempt;
			}
			onEnter(mode) {
				if (this.phase === "adjudicating" || this.phase === "submitting") return [];
				if (this.phase === "claimed" && this.claim !== void 0) {
					const attempt = this.beginAttempt(mode);
					this.phase = "submitting";
					this.paste = void 0;
					return [{
						type: "begin-submit",
						attempt,
						claim: this.claim,
						args: argsAfter(this.draft, this.claim.token)
					}];
				}
				const trimmed = this.draft.trim();
				if (trimmed === "") return [];
				this.paste = void 0;
				if (trimmed.startsWith("/")) {
					const attempt = this.beginAttempt(mode);
					this.phase = "adjudicating";
					return [{
						type: "adjudicate",
						attempt,
						draft: this.draft
					}];
				}
				return [{
					type: "default-sink",
					draft: this.draft,
					mode
				}];
			}
			onAdjudicated(attempt, outcome) {
				const flight = this.inflight;
				if (this.phase !== "adjudicating" || flight === void 0 || flight.attempt.seq !== attempt.seq) return [];
				if (outcome !== void 0 && outcome !== "handled" && "claim" in outcome) {
					this.claim = outcome.claim;
					this.phase = "submitting";
					return [{
						type: "begin-submit",
						attempt,
						claim: outcome.claim,
						args: argsAfter(attempt.draftSnapshot, outcome.claim.token)
					}];
				}
				this.inflight = void 0;
				this.phase = "plain";
				return outcome === void 0 ? [{
					type: "default-sink",
					draft: attempt.draftSnapshot,
					mode: attempt.mode
				}] : [];
			}
			onAdjudicationFailed(attempt, message) {
				if (this.phase !== "adjudicating" || this.inflight?.attempt.seq !== attempt.seq) return [];
				this.inflight = void 0;
				this.phase = "plain";
				return [{
					type: "notice",
					level: "error",
					text: message
				}];
			}
			onSubmitSettled(ev) {
				const flight = this.inflight;
				if (this.phase !== "submitting" || flight === void 0 || flight.attempt.seq !== ev.attempt.seq) return [];
				this.inflight = void 0;
				if (ev.ok) {
					this.phase = "plain";
					this.claim = void 0;
					this.occurrences = [];
					this.adopt("");
					this.log = [];
					this.redoStack = [];
					this.typingRun = void 0;
					this.paste = void 0;
					return ev.outcome?.text !== void 0 ? [{
						type: "notice",
						level: ev.outcome.kind === "error" ? "error" : "info",
						text: ev.outcome.text
					}] : [];
				}
				const text = ev.message ?? ev.outcome?.text ?? "command failed";
				if (this.draft === flight.attempt.draftSnapshot && this.claim !== void 0 && this.draft.startsWith(this.claim.token)) {
					this.phase = "claimed";
					return [{
						type: "notice",
						level: "error",
						text
					}];
				}
				this.phase = "plain";
				this.claim = void 0;
				return [{
					type: "notice",
					level: "error",
					text
				}];
			}
			/** Ordinary send accepted: clear as a commit (no undo unit; sent content
			*  must not be resurrectable — same discipline as submit-settled success). */
			onSendCommitted() {
				this.claim = void 0;
				this.occurrences = [];
				this.adopt("");
				this.log = [];
				this.redoStack = [];
				this.typingRun = void 0;
				this.paste = void 0;
				return [];
			}
			onRelease() {
				if (this.inflight !== void 0) {
					this.inflight.controller.abort();
					this.inflight = void 0;
				}
				this.phase = "plain";
				this.claim = void 0;
				this.typingRun = void 0;
				this.paste = void 0;
				return [];
			}
		};
		//#endregion
		//#region lib/types/client/input/facade.js
		/** Guard tier from the machine phase. */
		function guardOf(phase) {
			switch (phase) {
				case "plain": return "plain";
				case "claimed": return "claimed";
				default: return "frozen";
			}
		}
		const EMPTY_QUEUE = [];
		/** No-pipeline lexicon: zero text-ref decorations. */
		const EMPTY_LEXICON$2 = /* @__PURE__ */ new Map();
		/**
		* The per-session input facade: scoped-event application verbs +
		* setDraft/submit + the published InputState store.
		*/
		var SessionInputShell = class {
			deps;
			/** Published machine state + queue overlay (the InputZone currency source). */
			state;
			/** Latest surfaced notice (null after clear); the wiring renders it beside the error strip. */
			notices = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(null);
			/** The public provide-channel action face (one stable identity per session). */
			actions = {
				setDraft: (text) => {
					this.setDraft(text);
				},
				addImages: (ids) => this.addImages(ids),
				removeImage: (id) => {
					this.removeImage(id);
				},
				pruneImages: (ids) => {
					this.pruneImages(ids);
				},
				submit: () => {
					this.submit("queue");
				}
			};
			core = new InputMachine({ now: () => Date.now() });
			noticeSeq = 0;
			lastDraft = "";
			imageIds = [];
			disposed = false;
			/** Draft persistence mirror (chat store write; receives the clipboard projection, never raw placeholders). */
			mirrorFn;
			constructor(deps) {
				this.deps = deps;
				this.state = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.compose());
				deps.queue?.subscribe(() => {
					this.publish();
				});
			}
			/**
			* Single draft write path (all mutation rides machine events).
			* @param text - the full next draft.
			* @param editRange - the DOM-observed edit shape, when the caller knows it
			* (narrows the machine's occurrence math; absent → diff scan).
			*/
			setDraft(text, editRange) {
				this.run(this.core.dispatch({
					type: "draft-changed",
					draft: text,
					...editRange !== void 0 ? { editRange } : {}
				}));
			}
			/** Append ordered image ids unless an admission transaction is locked. */
			addImages(ids) {
				if (this.snapshot.phase === "adjudicating" || this.snapshot.phase === "submitting") return false;
				if (ids.length === 0) return true;
				this.imageIds = [...this.imageIds, ...ids];
				this.publish();
				return true;
			}
			/** Remove one image id from this draft. */
			removeImage(id) {
				const next = this.imageIds.filter((candidate) => candidate !== id);
				if (next.length === this.imageIds.length) return;
				this.imageIds = next;
				this.publish();
			}
			/**
			* Keep only image ids that still resolve in the browser attachment registry.
			* @param available - live registry ids.
			*/
			pruneImages(available) {
				const keep = new Set(available);
				const next = this.imageIds.filter((id) => keep.has(id));
				if (next.length === this.imageIds.length) return;
				this.imageIds = next;
				this.publish();
			}
			/**
			* Restore a failed attempt before any images added after its admission.
			* @param ids - failed attempt image ids.
			*/
			restoreImages(ids) {
				const current = new Set(this.imageIds);
				this.imageIds = [...ids.filter((id) => !current.has(id)), ...this.imageIds];
				this.publish();
			}
			/**
			* Clear the draft as a successful-send commit: no undo unit is recorded and
			* the undo history is cut, so Ctrl/Cmd-Z cannot resurrect sent content
			* (the command path gets the same discipline from submit-settled success).
			* @param imageIds - admitted image ids to remove from this draft.
			*/
			commitSend(imageIds) {
				const submitted = new Set(imageIds);
				this.imageIds = this.imageIds.filter((id) => !submitted.has(id));
				this.run(this.core.dispatch({ type: "send-committed" }));
			}
			/** Undo the latest transaction (InputBar intercepts the platform chord). */
			undo() {
				this.run(this.core.dispatch({ type: "undo" }));
			}
			/** Redo the latest undone transaction. */
			redo() {
				this.run(this.core.dispatch({ type: "redo" }));
			}
			/**
			* Paste text over the selection in one transaction, with any hot-snapshot
			* sync matches componentized inside it.
			* @param text - pasted plain text.
			* @param selection - replaced selection in draft coordinates.
			* @param components - sync-matched reference components (disjoint, inside `text`).
			* @param generation - projection generation for late async-upgrade guards.
			*/
			pasteBegin(text, selection, components, generation) {
				this.run(this.core.dispatch({
					type: "paste-begin",
					text,
					selection,
					...components !== void 0 ? { components } : {},
					...generation !== void 0 ? { generation } : {}
				}));
			}
			/** End the live paste-match attempt (caret/selection ops and Slash updates the machine cannot see). */
			invalidatePaste() {
				this.run(this.core.dispatch({ type: "invalidate-paste" }));
			}
			/**
			* Enter adjudication + submit transaction + default sink. Effects fan out
			* from the machine; this method only feeds the event. Lock entry
			* (adjudicating/submitting) force-closes the transient layers: the popup
			* dismisses and the menu tracks frozen.
			*/
			submit(mode = "queue") {
				if (this.snapshot.draft.trim() === "" && this.imageIds.length > 0) {
					if (this.snapshot.phase === "plain") this.deps.defaultSink("", [...this.imageIds], mode);
					return;
				}
				this.run(this.core.dispatch({
					type: "enter",
					mode
				}));
				const phase = this.snapshot.phase;
				if (phase === "adjudicating" || phase === "submitting") {
					this.deps.popup?.()?.dismiss();
					this.deps.inputTriggers?.()?.track(this.snapshot.draft, 0, { tier: "frozen" }, this.snapshot.draftRev);
				}
			}
			/**
			* Feed a draft/caret change through trigger detection (guard derived from
			* the machine phase).
			* @param draft - live draft text.
			* @param caret - caret position in draft coordinates.
			*/
			track(draft, caret) {
				this.deps.inputTriggers?.()?.track(draft, caret, { tier: guardOf(this.snapshot.phase) }, this.snapshot.draftRev);
			}
			/**
			* Keyboard arbitration while the menu is open.
			* @param key - the intercepted key.
			* @param composing - IME composition guard state.
			* @returns the menu's verdict; 'pass' when no pipeline is mounted.
			*/
			arbitrate(key, composing) {
				return this.deps.inputTriggers?.()?.arbitrate(key, composing) ?? "pass";
			}
			/**
			* Steer every still-pending queued message into the running turn (the
			* empty-draft accelerated-Enter gesture). Execution belongs to the hub's
			* queue choreography; absent dep = the gesture falls back to the machine's
			* empty-draft no-op.
			*/
			steerQueue() {
				this.deps.steerQueue?.();
			}
			/**
			* Space adjudication over the controller's hot state.
			* @returns true = a claim/insert was applied — the caller preventDefaults.
			*/
			space() {
				const inputTriggers = this.deps.inputTriggers?.();
				if (inputTriggers === void 0) return false;
				const consumed = inputTriggers.onSpace();
				if (consumed) {
					const next = this.snapshot;
					inputTriggers.track(next.draft, next.draft.length, { tier: guardOf(next.phase) }, next.draftRev);
				}
				return consumed;
			}
			/** Dismiss the popupSelect shell (any interaction outside the box). */
			dismissPopup() {
				this.deps.popup?.()?.dismiss();
			}
			/**
			* Hot plain-text reference lexicon source for the decoration scan
			* (the plain-text-reference decision;
			* see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
			* delegates to the controller's aggregated store. Stable
			* identity per shell; without a pipeline the snapshot is the empty Map and
			* subscribers never fire.
			*/
			lexicon = {
				getSnapshot: () => this.deps.inputTriggers?.()?.lexicon.getSnapshot() ?? EMPTY_LEXICON$2,
				subscribe: (fn) => this.deps.inputTriggers?.()?.lexicon.subscribe(fn) ?? (() => {})
			};
			/**
			* Apply one command claim (scoped begin-command event listener body).
			* @param claim - the command claim from the pick path.
			* @param span - pick-time span snapshot.
			* @returns whether the machine accepted (phase + span CAS passed and the draft mutated).
			*/
			beginCommand(claim, span) {
				const before = this.core.state.draftRev;
				this.run(this.core.dispatch({
					type: "begin-command",
					claim,
					span
				}));
				return this.core.state.phase === "claimed" && this.core.state.draftRev !== before;
			}
			/**
			* Apply one reference insertion (scoped insert-reference event listener body).
			* @param ref - the reference insertion from the pick path.
			* @param span - pick-time span snapshot.
			* @returns whether the machine accepted.
			*/
			insertReference(ref, span) {
				const before = this.core.state.draftRev;
				this.run(this.core.dispatch({
					type: "insert-ref",
					reference: ref,
					span
				}));
				return this.core.state.draftRev !== before;
			}
			/**
			* Consume one command token after business success (scoped consume-token
			* event listener body). Span guard: revision CAS then splice; bare-token
			* guard: trimmed-draft equality then clear.
			* @param guard - exact span or bare-token guard.
			* @returns whether the token was consumed.
			*/
			consumeToken(guard) {
				const snapshot = this.core.state;
				if (guard.kind === "span") {
					if (guard.span.draftRev !== snapshot.draftRev) return false;
					const draft = snapshot.draft;
					this.setDraft(draft.slice(0, guard.span.start) + draft.slice(guard.span.end));
					return true;
				}
				if (snapshot.draft.trim() !== guard.token) return false;
				this.setDraft("");
				return true;
			}
			/**
			* Insert plain reference text over the pick-time span (scoped insert-text
			* event listener body; plain-text-reference decision, web-input-machine
			* note). Same CAS-then-splice shape as the
			* consume-token span branch: the machine sees an ordinary draft-changed
			* transaction (one undo step), no occurrence is minted — the chip look is
			* a scan-derived decoration, never state.
			* @param text - the plain reference text to splice in (e.g. `/name `).
			* @param span - pick-time span snapshot (draftRev CAS).
			* @returns whether the text was applied.
			*/
			insertText(text, span) {
				const snapshot = this.core.state;
				if (span.draftRev !== snapshot.draftRev) return false;
				const draft = snapshot.draft;
				this.setDraft(draft.slice(0, span.start) + text + draft.slice(span.end));
				return true;
			}
			/**
			* Surface a notice from outside the machine (detached command results).
			* @param level - severity tier.
			* @param text - notice body.
			*/
			notify(level, text) {
				this.noticeSeq += 1;
				this.notices.set({
					level,
					text,
					seq: this.noticeSeq
				});
			}
			/** Teardown: abort any in-flight attempt and stop accepting async settlements. */
			dispose() {
				this.disposed = true;
				this.run(this.core.dispatch({ type: "release" }));
			}
			/** Read the live machine state (guard derivation reads here). */
			get snapshot() {
				return this.state.getSnapshot();
			}
			/**
			* Bind the draft persistence mirror (chat store write). Adopt-on-bind: the
			* store draft may hold a persisted value from a previous mount; the caller
			* seeds it via setDraft BEFORE binding, and afterwards every machine-adopted
			* draft mirrors out.
			* @param write - store draft write.
			* @returns the unbind disposer.
			*/
			bindMirror(write) {
				this.mirrorFn = write;
				return () => {
					if (this.mirrorFn === write) this.mirrorFn = void 0;
				};
			}
			run(effects) {
				for (const fx of effects) this.execute(fx);
				this.publish();
			}
			execute(fx) {
				switch (fx.type) {
					case "notice":
						this.noticeSeq += 1;
						this.notices.set({
							level: fx.level,
							text: fx.text,
							seq: this.noticeSeq
						});
						return;
					case "adjudicate":
						this.adjudicate(fx.attempt, fx.draft);
						return;
					case "begin-submit":
						this.beginSubmit(fx.attempt, fx.claim, fx.args);
						return;
					case "default-sink":
						this.sinkSerialized(fx.draft, fx.mode);
						return;
					default: return;
				}
			}
			/**
			* Prompt serialization before the sink: expand each
			* placeholder to its owner's model form via the session controller's
			* codec routing. Owner missing / serialize failure / disposal blocks the
			* send — notice + draft and chips retained, never a silent downgrade to
			* the clipboard text. Chip-free drafts skip the async detour.
			*/
			sinkSerialized(draft, mode) {
				const imageIds = [...this.imageIds];
				const occurrences = this.core.state.occurrences;
				if (occurrences.length === 0) {
					this.deps.defaultSink(draft.trim(), imageIds, mode);
					return;
				}
				const inputTriggers = this.deps.inputTriggers?.();
				const controller = new AbortController();
				Promise.all(occurrences.map(async (o) => {
					if (inputTriggers === void 0) throw new Error(`no serializer for reference source "${o.source}"`);
					return {
						offset: o.offset,
						text: await inputTriggers.serializeReference(o.source, o.ref, controller.signal)
					};
				})).then((parts) => {
					if (this.disposed) return;
					let out = "";
					let cursor = 0;
					for (const part of parts) {
						out += draft.slice(cursor, part.offset) + part.text;
						cursor = part.offset + 1;
					}
					out += draft.slice(cursor);
					this.deps.defaultSink(out.trim(), imageIds, mode);
				}, (error) => {
					controller.abort();
					if (this.disposed) return;
					const message = error instanceof Error ? error.message : String(error);
					this.notify("error", message);
				});
			}
			/** Enter adjudication: poll the session controller; failure = notice + draft retained (never a silent downgrade). */
			adjudicate(attempt, draft) {
				const inputTriggers = this.deps.inputTriggers?.();
				if (inputTriggers === void 0) {
					this.run(this.core.dispatch({
						type: "adjudicated",
						attempt,
						outcome: void 0
					}));
					return;
				}
				inputTriggers.adjudicate(draft.trim(), attempt.signal).then((outcome) => {
					if (this.dead(attempt)) return;
					this.run(this.core.dispatch({
						type: "adjudicated",
						attempt,
						outcome
					}));
				}, (error) => {
					if (this.dead(attempt)) return;
					const message = error instanceof Error ? error.message : String(error);
					this.run(this.core.dispatch({
						type: "adjudication-failed",
						attempt,
						message
					}));
				});
			}
			/** The submit transaction: claim.submit against the session scope; ok maps from the outcome kind. */
			beginSubmit(attempt, claim, args) {
				Promise.resolve().then(() => claim.submit(args, this.deps.actx)).then((outcome) => {
					if (this.dead(attempt)) return;
					this.run(this.core.dispatch({
						type: "submit-settled",
						attempt,
						ok: outcome.kind === "success",
						outcome
					}));
				}, (error) => {
					if (this.dead(attempt)) return;
					const message = error instanceof Error ? error.message : String(error);
					this.run(this.core.dispatch({
						type: "submit-settled",
						attempt,
						ok: false,
						message
					}));
				});
			}
			/** Late-settlement guard: superseded attempts and disposed facades drop silently. */
			dead(attempt) {
				return this.disposed || attempt.signal.aborted;
			}
			compose() {
				return {
					...this.core.state,
					imageIds: this.imageIds,
					queue: this.deps.queue?.getSnapshot() ?? EMPTY_QUEUE
				};
			}
			publish() {
				const next = this.compose();
				this.state.set(next);
				if (next.draft !== this.lastDraft) {
					this.lastDraft = next.draft;
					this.mirrorFn?.(next.draft);
				}
			}
		};
		//#endregion
		//#region lib/types/client/input/hub.js
		/** Session-addressed input facade registry (SessionInputResolver face + composer-layer extras). */
		var InputHub = class {
			rootCtx;
			t;
			shells = /* @__PURE__ */ new Map();
			/**
			* @param ctx - client root context (services resolved lazily per call — boot order stays free).
			* @param t - conversation-namespace translate thunk (reads the active locale at call time).
			*/
			constructor(rootCtx, t) {
				this.rootCtx = rootCtx;
				this.t = t;
			}
			/**
			* Resolve the facade for one session-scope ctx (SessionInputResolver face).
			* @param actx - session-scope context.
			* @returns the resident per-session facade.
			*/
			for(actx) {
				const id = this.sessions().scopeOf(actx);
				if (id === void 0) throw new Error("conversation.input.for requires a session scope");
				return this.shell(id);
			}
			/**
			* Resident shell for one session binding — the provide-channel entry
			* (called during scope materialization, BEFORE the scope record is
			* queryable, hence binding-fed and hence the thunked slash/popup deps).
			* Wires the scoped event listeners + teardown into the session scope.
			* @param binding - session assembly handle.
			* @returns the shell.
			*/
			shellFor(binding) {
				const existing = this.shells.get(binding.sessionId);
				if (existing !== void 0) return existing;
				const { sessionId: id, session, ctx: actx } = binding;
				const shell = new SessionInputShell({
					actx,
					inputTriggers: () => this.controller(actx),
					popup: () => this.popup(actx),
					queue: queueReadFaceOf(session),
					defaultSink: (text, imageIds, mode) => {
						this.sink(session, text, imageIds, mode);
					},
					steerQueue: () => {
						this.steerQueue(session, shell);
					}
				});
				this.shells.set(id, shell);
				actx.effect(() => {
					const offs = [
						actx.on("slash/input-begin-command", (req) => shell.beginCommand(req.claim, req.span) ? true : void 0),
						actx.on("slash/input-insert-reference", (req) => shell.insertReference(req.reference, req.span) ? true : void 0),
						actx.on("slash/input-consume-token", (req) => shell.consumeToken(req.guard) ? true : void 0),
						actx.on("slash/input-insert-text", (req) => shell.insertText(req.text, req.span) ? true : void 0)
					];
					return () => {
						for (const off of offs) off();
						const drafts = shell.snapshot.imageIds;
						shell.dispose();
						this.shells.delete(id);
						const conversation = this.rootCtx.get("conversation");
						for (const imageId of drafts) conversation?.releaseDraftImage(imageId);
					};
				}, "conversation.input: session shell");
				return shell;
			}
			/**
			* Resident shell by session id (service-face path; the provide channel has
			* normally created it already — this covers direct id-addressed access).
			* @param id - session id.
			* @returns the shell.
			*/
			shell(id) {
				const existing = this.shells.get(id);
				if (existing !== void 0) return existing;
				const binding = this.sessions().binding(id);
				if (binding === void 0) throw new Error(`conversation.input: session "${id}" resolved no binding`);
				return this.shellFor(binding);
			}
			/**
			* The InputBar-exclusive keyboard command face: the shell
			* satisfies it structurally; package-internal — handed through the
			* composer-bar entry's inject, never across a plugin boundary.
			* @param id - session id.
			* @returns the shell as the keyboard face.
			*/
			keyboard(id) {
				return this.shell(id);
			}
			/**
			* Resolve the optional slash controller for composer chrome that launches
			* the shared candidate menu without typing a trigger.
			* @param id - session id.
			* @returns the resident controller, or undefined when ui-input-trigger is absent.
			*/
			inputTriggers(id) {
				const actx = this.sessions().scope(id);
				return actx === void 0 ? void 0 : this.controller(actx);
			}
			/**
			* Default sink: optimistic clear + prompt. The session is always a real
			* host entity (materialized when its workspace was picked), so there is
			* exactly one path; a failed first prompt is an ordinary prompt failure
			* (error strip via promptError, draft restored only while untouched).
			*/
			sink(session, text, imageIds, mode) {
				if (text === "" && imageIds.length === 0) return;
				const shell = this.shells.get(session.sessionId);
				shell?.commitSend(imageIds);
				this.conversation().sendSession(session, text, imageIds, mode).catch(() => {
					if (this.shells.get(session.sessionId) === shell) {
						shell?.restoreImages(imageIds);
						if (shell?.snapshot.draft === "") shell.setDraft(text);
						return;
					}
					const conversation = this.rootCtx.get("conversation");
					for (const id of imageIds) conversation?.releaseDraftImage(id);
				});
			}
			/**
			* Steer every still-pending queued message into the running turn, in FIFO
			* order — the same strict-steer operation as the queue dock's per-row
			* button. A turn closing mid-way (`steer-unavailable`) or a row already
			* claimed by the agent (`queue-item-not-found`) converges silently, while a
			* genuine failure surfaces as one composer notice. Repeated triggers
			* (e.g. two rapid empty-draft chords) rely on that `queue-item-not-found`
			* convergence: the snapshot may still list a row the host already steered,
			* and the duplicate strict steer is a silent no-op.
			* @param session - the addressed host session.
			* @param shell - the resident shell (notice outlet).
			*/
			async steerQueue(session, shell) {
				const queued = session.getSnapshot().queue.filter((item) => item.placement === "queued");
				if (queued.length === 0) return;
				for (const item of queued) {
					const result = await session.updateQueue(item.id, { kind: "steer" });
					if (result.ok) continue;
					if (result.error.code === "steer-unavailable" || result.error.code === "queue-item-not-found") return;
					shell.notify("error", this.t("queue.steerFailed"));
					return;
				}
			}
			controller(actx) {
				return this.rootCtx.get("inputTriggers")?.sessionOf(actx);
			}
			popup(actx) {
				return this.rootCtx.get("commandUi")?.popupFor(actx);
			}
			sessions() {
				const sessions = this.rootCtx.get("sessions");
				if (sessions === void 0) throw new Error("conversation.input: sessions service unavailable");
				return sessions;
			}
			conversation() {
				const conversation = this.rootCtx.get("conversation");
				if (conversation === void 0) throw new Error("conversation.input: conversation service unavailable");
				return conversation;
			}
		};
		//#endregion
		//#region ../../../vendor/cosmokit/src/misc.ts
		/** Return true when a value is `null` or `undefined`. */
		function isNullable(value) {
			return value === null || value === void 0;
		}
		/** Return true for non-array object values. */
		function isPlainObject(data) {
			return data && typeof data === "object" && !Array.isArray(data);
		}
		/** Filter object entries and return a new object. */
		function filterKeys(object, filter) {
			return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
		}
		/** Map object values while preserving the original key set. */
		function mapValues(object, transform) {
			return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
		}
		/** Pick selected keys from an object, optionally including `undefined` values. */
		function pick(source, keys, forced) {
			if (!keys) return { ...source };
			const result = {};
			for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
			return result;
		}
		//#endregion
		//#region ../../../vendor/cosmokit/src/types.ts
		/** Test values using `instanceof` with a `toStringTag` fallback. */
		function is(type, value) {
			if (arguments.length === 1) return (value) => is(type, value);
			return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
		}
		function isArrayBufferLike(value) {
			return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
		}
		function isArrayBufferSource(value) {
			return isArrayBufferLike(value) || ArrayBuffer.isView(value);
		}
		let Binary;
		(function(_Binary) {
			_Binary.is = isArrayBufferLike;
			_Binary.isSource = isArrayBufferSource;
			function fromSource(source) {
				if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
				else return source;
			}
			_Binary.fromSource = fromSource;
			function toBase64(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
				let binary = "";
				const bytes = new Uint8Array(source);
				for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
				return btoa(binary);
			}
			_Binary.toBase64 = toBase64;
			function fromBase64(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
				return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
			}
			_Binary.fromBase64 = fromBase64;
			function toHex(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
				return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
			}
			_Binary.toHex = toHex;
			function fromHex(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
				const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
				const buffer = [];
				for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
				return Uint8Array.from(buffer).buffer;
			}
			_Binary.fromHex = fromHex;
		})(Binary || (Binary = {}));
		Binary.fromBase64;
		Binary.toBase64;
		Binary.fromHex;
		Binary.toHex;
		/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
		function clone(source, refs = /* @__PURE__ */ new Map()) {
			if (!source || typeof source !== "object") return source;
			if (is("Date", source)) return new Date(source.valueOf());
			if (is("RegExp", source)) return new RegExp(source.source, source.flags);
			if (isArrayBufferLike(source)) return source.slice(0);
			if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
			const cached = refs.get(source);
			if (cached) return cached;
			if (Array.isArray(source)) {
				const result = [];
				refs.set(source, result);
				source.forEach((value, index) => {
					result[index] = Reflect.apply(clone, null, [value, refs]);
				});
				return result;
			}
			const result = Object.create(Object.getPrototypeOf(source));
			refs.set(source, result);
			for (const key of Reflect.ownKeys(source)) {
				const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
				if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
				Reflect.defineProperty(result, key, descriptor);
			}
			return result;
		}
		/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
		function deepEqual(a, b, strict) {
			if (a === b) return true;
			if (!strict && isNullable(a) && isNullable(b)) return true;
			if (typeof a !== typeof b) return false;
			if (typeof a !== "object") return false;
			if (!a || !b) return false;
			function check(test, then) {
				return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
			}
			return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? Object.keys({
				...a,
				...b
			}).every((key) => deepEqual(a[key], b[key], strict));
		}
		//#endregion
		//#region ../../../vendor/cosmokit/src/time.ts
		let Time;
		(function(_Time) {
			_Time.millisecond = 1;
			const second = _Time.second = 1e3;
			const minute = _Time.minute = second * 60;
			const hour = _Time.hour = minute * 60;
			const day = _Time.day = hour * 24;
			const week = _Time.week = day * 7;
			let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
			function setTimezoneOffset(offset) {
				timezoneOffset = offset;
			}
			_Time.setTimezoneOffset = setTimezoneOffset;
			function getTimezoneOffset() {
				return timezoneOffset;
			}
			_Time.getTimezoneOffset = getTimezoneOffset;
			function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
				if (typeof date === "number") date = new Date(date);
				if (offset === void 0) offset = timezoneOffset;
				return Math.floor((date.valueOf() / minute - offset) / 1440);
			}
			_Time.getDateNumber = getDateNumber;
			function fromDateNumber(value, offset) {
				const date = new Date(value * day);
				if (offset === void 0) offset = timezoneOffset;
				return new Date(+date + offset * minute);
			}
			_Time.fromDateNumber = fromDateNumber;
			const numeric = /\d+(?:\.\d+)?/.source;
			const timeRegExp = new RegExp(`^${[
				"w(?:eek(?:s)?)?",
				"d(?:ay(?:s)?)?",
				"h(?:our(?:s)?)?",
				"m(?:in(?:ute)?(?:s)?)?",
				"s(?:ec(?:ond)?(?:s)?)?"
			].map((unit) => `(${numeric}${unit})?`).join("")}$`);
			function parseTime(source) {
				const capture = timeRegExp.exec(source);
				if (!capture) return 0;
				return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
			}
			_Time.parseTime = parseTime;
			function parseDate(date) {
				const parsed = parseTime(date);
				if (parsed) date = Date.now() + parsed;
				else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
				else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
				return date ? new Date(date) : /* @__PURE__ */ new Date();
			}
			_Time.parseDate = parseDate;
			function format(ms) {
				const abs = Math.abs(ms);
				if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
				else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
				else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
				else if (abs >= second) return Math.round(ms / second) + "s";
				return ms + "ms";
			}
			_Time.format = format;
			function toDigits(source, length = 2) {
				return source.toString().padStart(length, "0");
			}
			_Time.toDigits = toDigits;
			function template(template, time = /* @__PURE__ */ new Date()) {
				return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
			}
			_Time.template = template;
		})(Time || (Time = {}));
		//#endregion
		//#region ../../../vendor/schemastery/src/index.ts
		const kSchema = Symbol.for("schemastery");
		const kValidationError = Symbol.for("ValidationError");
		globalThis.__schemastery_index__ ??= 0;
		globalThis.__schemastery_refs__ = void 0;
		var ValidationError = class extends TypeError {
			options;
			name = "ValidationError";
			constructor(message, options) {
				let prefix = "$";
				for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
				else if (typeof segment === "number") prefix += "[" + segment + "]";
				else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
				if (prefix.startsWith(".")) prefix = prefix.slice(1);
				super((prefix === "$" ? "" : `${prefix} `) + message);
				this.options = options;
			}
			static is(error) {
				return !!error?.[kValidationError];
			}
		};
		Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
		const Schema = function(options) {
			const schema = function(data, options = {}) {
				return Schema.resolve(data, schema, options)[0];
			};
			if (options.refs) {
				const refs = mapValues(options.refs, (options) => new Schema(options));
				const getRef = (uid) => refs[uid];
				for (const key in refs) {
					const options = refs[key];
					options.sKey = getRef(options.sKey);
					options.inner = getRef(options.inner);
					options.list = options.list && options.list.map(getRef);
					options.dict = options.dict && mapValues(options.dict, getRef);
				}
				return refs[options.uid];
			}
			Object.assign(schema, options);
			if (typeof schema.callback === "string") try {
				schema.callback = new Function("return " + schema.callback)();
			} catch {}
			Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
			Object.setPrototypeOf(schema, Schema.prototype);
			schema.meta ||= {};
			schema.toString = schema.toString.bind(schema);
			return schema;
		};
		Schema.prototype = Object.create(Function.prototype);
		Schema.prototype[kSchema] = true;
		Object.defineProperty(Schema.prototype, "~standard", { get() {
			return {
				version: 1,
				vendor: "schemastery",
				validate: (value) => {
					try {
						return { value: Schema.resolve(value, this, {})[0] };
					} catch (error) {
						if (ValidationError.is(error)) return { issues: [{
							message: error.message,
							path: error.options.path
						}] };
						throw error;
					}
				}
			};
		} });
		Schema.ValidationError = ValidationError;
		Schema.prototype.toJSON = function toJSON() {
			if (globalThis.__schemastery_refs__) {
				globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
				return this.uid;
			}
			globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
			globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
			const result = {
				uid: this.uid,
				refs: globalThis.__schemastery_refs__
			};
			globalThis.__schemastery_refs__ = void 0;
			return result;
		};
		Schema.prototype.set = function set(key, value) {
			this.dict[key] = value;
			return this;
		};
		Schema.prototype.push = function push(value) {
			this.list.push(value);
			return this;
		};
		function mergeDesc(original, messages) {
			const result = typeof original === "string" ? { "": original } : { ...original };
			for (const locale in messages) {
				const value = messages[locale];
				if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
				else if (typeof value === "string") result[locale] = value;
			}
			return result;
		}
		function getInner(value) {
			return value?.$value ?? value?.$inner;
		}
		function extractKeys(data) {
			return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
		}
		Schema.prototype.i18n = function i18n(messages) {
			const schema = Schema(this);
			const desc = mergeDesc(schema.meta.description, messages);
			if (Object.keys(desc).length) schema.meta.description = desc;
			if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
				return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
			});
			if (schema.list) schema.list = schema.list.map((inner, index) => {
				return inner.i18n(mapValues(messages, (data = {}) => {
					if (Array.isArray(getInner(data))) return getInner(data)[index];
					if (Array.isArray(data)) return data[index];
					return extractKeys(data);
				}));
			});
			if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
				if (getInner(data)) return getInner(data);
				return extractKeys(data);
			}));
			if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
			return schema;
		};
		Schema.prototype.extra = function extra(key, value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		};
		for (const key of [
			"required",
			"disabled",
			"collapse",
			"hidden",
			"loose"
		]) Object.assign(Schema.prototype, { [key](value = true) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		Schema.prototype.deprecated = function deprecated() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "deprecated",
				type: "danger"
			});
			return schema;
		};
		Schema.prototype.experimental = function experimental() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "experimental",
				type: "warning"
			});
			return schema;
		};
		Schema.prototype.pattern = function pattern(regexp) {
			const schema = Schema(this);
			const pattern = pick(regexp, ["source", "flags"]);
			schema.meta = {
				...schema.meta,
				pattern
			};
			return schema;
		};
		Schema.prototype.simplify = function simplify(value) {
			if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
			if (isNullable(value)) return value;
			if (this.type === "object" || this.type === "dict") {
				const result = {};
				for (const key in value) {
					const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
					if (this.type === "dict" || !isNullable(item)) result[key] = item;
				}
				if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
				return result;
			} else if (this.type === "array" || this.type === "tuple") {
				const result = [];
				value.forEach((value, index) => {
					const schema = this.type === "array" ? this.inner : this.list[index];
					const item = schema ? schema.simplify(value) : value;
					result.push(item);
				});
				return result;
			} else if (this.type === "intersect") {
				const result = {};
				for (const item of this.list) Object.assign(result, item.simplify(value));
				return result;
			} else if (this.type === "union") for (const schema of this.list) try {
				Schema.resolve(value, schema, {});
				return schema.simplify(value);
			} catch {}
			return value;
		};
		Schema.prototype.toString = function toString(inline) {
			return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
		};
		Schema.prototype.role = function role(role, extra) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				role,
				extra
			};
			return schema;
		};
		for (const key of [
			"default",
			"link",
			"comment",
			"description",
			"max",
			"min",
			"step"
		]) Object.assign(Schema.prototype, { [key](value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		const resolvers = {};
		Schema.extend = function extend(type, resolve) {
			resolvers[type] = resolve;
		};
		Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
			if (!schema) return [data];
			if (options.ignore?.(data, schema)) return [data];
			if (isNullable(data) && schema.type !== "lazy") {
				if (schema.meta.required) throw new ValidationError(`missing required value`, options);
				let current = schema;
				let fallback = schema.meta.default;
				while (current?.type === "intersect" && isNullable(fallback)) {
					current = current.list[0];
					fallback = current?.meta.default;
				}
				if (isNullable(fallback)) return [data];
				data = clone(fallback);
			}
			const callback = resolvers[schema.type];
			if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
			try {
				return callback(data, schema, options, strict);
			} catch (error) {
				if (!schema.meta.loose) throw error;
				return [schema.meta.default];
			}
		};
		Schema.from = function from(source) {
			if (isNullable(source)) return Schema.any();
			else if ([
				"string",
				"number",
				"boolean"
			].includes(typeof source)) return Schema.const(source).required();
			else if (source[kSchema]) return source;
			else if (typeof source === "function") switch (source) {
				case String: return Schema.string().required();
				case Number: return Schema.number().required();
				case Boolean: return Schema.boolean().required();
				case Function: return Schema.function().required();
				default: return Schema.is(source).required();
			}
			else throw new TypeError(`cannot infer schema from ${source}`);
		};
		Schema.lazy = function lazy(builder) {
			const toJSON = () => {
				if (!schema.inner[kSchema]) {
					schema.inner = schema.builder();
					schema.inner.meta = {
						...schema.meta,
						...schema.inner.meta
					};
				}
				return schema.inner.toJSON();
			};
			const schema = new Schema({
				type: "lazy",
				builder,
				inner: { toJSON }
			});
			return schema;
		};
		Schema.natural = function natural() {
			return Schema.number().step(1).min(0);
		};
		Schema.percent = function percent() {
			return Schema.number().step(.01).min(0).max(1).role("slider");
		};
		Schema.date = function date() {
			return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
				const date = new Date(value);
				if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
				return date;
			}, true)]);
		};
		Schema.regExp = function regExp(flag = "") {
			return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
				try {
					return new RegExp(value, flag);
				} catch (e) {
					throw new ValidationError(e.message, options);
				}
			}, true)]);
		};
		Schema.arrayBuffer = function arrayBuffer(encoding) {
			return Schema.union([
				Schema.is(ArrayBuffer),
				Schema.is(SharedArrayBuffer),
				Schema.transform(Schema.any(), (value, options) => {
					if (Binary.isSource(value)) return Binary.fromSource(value);
					throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
				}, true),
				...encoding ? [Schema.transform(Schema.string(), (value, options) => {
					try {
						return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
					} catch (e) {
						throw new ValidationError(e.message, options);
					}
				}, true)] : []
			]);
		};
		Schema.extend("lazy", (data, schema, options, strict) => {
			if (!schema.inner[kSchema]) {
				schema.inner = schema.builder();
				schema.inner.meta = {
					...schema.meta,
					...schema.inner.meta
				};
			}
			return Schema.resolve(data, schema.inner, options, strict);
		});
		Schema.extend("any", (data) => {
			return [data];
		});
		Schema.extend("never", (data, _, options) => {
			throw new ValidationError(`expected nullable but got ${data}`, options);
		});
		Schema.extend("const", (data, { value }, options) => {
			if (deepEqual(data, value)) return [value];
			throw new ValidationError(`expected ${value} but got ${data}`, options);
		});
		function checkWithinRange(data, meta, description, options, skipMin = false) {
			const { max = Infinity, min = -Infinity } = meta;
			if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
			if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
		}
		Schema.extend("string", (data, { meta }, options) => {
			if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
			if (meta.pattern) {
				const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
				if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
			}
			checkWithinRange(data.length, meta, "string length", options);
			return [data];
		});
		function decimalShift(data, digits) {
			const str = data.toString();
			if (str.includes("e")) return data * Math.pow(10, digits);
			const index = str.indexOf(".");
			if (index === -1) return data * Math.pow(10, digits);
			const frac = str.slice(index + 1);
			const integer = str.slice(0, index);
			if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
			return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
		}
		function isMultipleOf(data, min, step) {
			step = Math.abs(step);
			if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
			const index = step.toString().indexOf(".");
			const digits = step.toString().slice(index + 1).length;
			return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
		}
		Schema.extend("number", (data, { meta }, options) => {
			if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
			checkWithinRange(data, meta, "number", options);
			const { step } = meta;
			if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
			return [data];
		});
		Schema.extend("boolean", (data, _, options) => {
			if (typeof data === "boolean") return [data];
			throw new ValidationError(`expected boolean but got ${data}`, options);
		});
		Schema.extend("bitset", (data, { bits, meta }, options) => {
			let value = 0, keys = [];
			if (typeof data === "number") {
				value = data;
				for (const key in bits) if (data & bits[key]) keys.push(key);
			} else if (Array.isArray(data)) {
				keys = data;
				for (const key of keys) {
					if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
					if (key in bits) value |= bits[key];
				}
			} else throw new ValidationError(`expected number or array but got ${data}`, options);
			if (value === meta.default) return [value];
			return [value, keys];
		});
		Schema.extend("function", (data, _, options) => {
			if (typeof data === "function") return [data];
			throw new ValidationError(`expected function but got ${data}`, options);
		});
		Schema.extend("is", (data, { constructor }, options) => {
			if (typeof constructor === "function") {
				if (data instanceof constructor) return [data];
				throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
			} else {
				if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
				let prototype = Object.getPrototypeOf(data);
				while (prototype) {
					if (prototype.constructor?.name === constructor) return [data];
					prototype = Object.getPrototypeOf(prototype);
				}
				throw new ValidationError(`expected ${constructor} but got ${data}`, options);
			}
		});
		function property(data, key, schema, options) {
			try {
				const [value, adapted] = Schema.resolve(data[key], schema, {
					...options,
					path: [...options.path || [], key]
				});
				if (adapted !== void 0) data[key] = adapted;
				return value;
			} catch (e) {
				if (!options?.autofix) throw e;
				delete data[key];
				return schema.meta.default;
			}
		}
		Schema.extend("array", (data, { inner, meta }, options) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
			return [data.map((_, index) => property(data, index, inner, options))];
		});
		Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in data) {
				let rKey;
				try {
					rKey = Schema.resolve(key, sKey, options)[0];
				} catch (error) {
					if (strict) continue;
					throw error;
				}
				result[rKey] = property(data, key, inner, options);
				data[rKey] = data[key];
				if (key !== rKey) delete data[key];
			}
			return [result];
		});
		Schema.extend("tuple", (data, { list }, options, strict) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			const result = list.map((inner, index) => property(data, index, inner, options));
			if (strict) return [result];
			result.push(...data.slice(list.length));
			return [result];
		});
		function merge(result, data) {
			for (const key in data) {
				if (key in result) continue;
				result[key] = data[key];
			}
		}
		Schema.extend("object", (data, { dict }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in dict) {
				const value = property(data, key, dict[key], options);
				if (!isNullable(value) || key in data) result[key] = value;
			}
			if (!strict) merge(result, data);
			return [result];
		});
		Schema.extend("union", (data, { list, toString }, options, strict) => {
			const messages = [];
			for (const inner of list) try {
				return Schema.resolve(data, inner, options, strict);
			} catch (error) {
				messages.push(error);
			}
			throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		});
		Schema.extend("intersect", (data, { list, toString }, options, strict) => {
			if (!list.length) return [data];
			let result;
			for (const inner of list) {
				const value = Schema.resolve(data, inner, options, true)[0];
				if (isNullable(value)) continue;
				if (isNullable(result)) result = value;
				else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
				else if (typeof value === "object") merge(result ??= {}, value);
				else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
			}
			if (!strict && isPlainObject(data)) merge(result, data);
			return [result];
		});
		Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
			const [result, adapted = data] = Schema.resolve(data, inner, options, true);
			if (preserve) return [callback(result)];
			else return [callback(result), callback(adapted)];
		});
		const formatters = {};
		function defineMethod(name, keys, format) {
			formatters[name] = format;
			Object.assign(Schema, { [name](...args) {
				const schema = new Schema({ type: name });
				keys.forEach((key, index) => {
					switch (key) {
						case "sKey":
							schema.sKey = args[index] ?? Schema.string();
							break;
						case "inner":
							schema.inner = Schema.from(args[index]);
							break;
						case "list":
							schema.list = args[index].map(Schema.from);
							break;
						case "dict":
							schema.dict = mapValues(args[index], Schema.from);
							break;
						case "bits":
							schema.bits = {};
							for (const key in args[index]) {
								if (typeof args[index][key] !== "number") continue;
								schema.bits[key] = args[index][key];
							}
							break;
						case "callback": {
							const callback = schema.callback = args[index];
							callback["toJSON"] ||= () => callback.toString();
							break;
						}
						case "constructor": {
							const constructor = schema.constructor = args[index];
							if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
							break;
						}
						default: schema[key] = args[index];
					}
				});
				if (name === "object" || name === "dict") schema.meta.default = {};
				else if (name === "array" || name === "tuple") schema.meta.default = [];
				else if (name === "bitset") schema.meta.default = 0;
				return schema;
			} });
		}
		defineMethod("is", ["constructor"], ({ constructor }) => {
			if (typeof constructor === "function") return constructor.name;
			else return constructor;
		});
		defineMethod("any", [], () => "any");
		defineMethod("never", [], () => "never");
		defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
		defineMethod("string", [], () => "string");
		defineMethod("number", [], () => "number");
		defineMethod("boolean", [], () => "boolean");
		defineMethod("bitset", ["bits"], () => "bitset");
		defineMethod("function", [], () => "function");
		defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
		defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
		defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
		defineMethod("object", ["dict"], ({ dict }) => {
			if (Object.keys(dict).length === 0) return "{}";
			return `{ ${Object.entries(dict).map(([key, inner]) => {
				return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
			}).join(", ")} }`;
		});
		defineMethod("union", ["list"], ({ list }, inline) => {
			const result = list.map(({ toString: format }) => format()).join(" | ");
			return inline ? `(${result})` : result;
		});
		defineMethod("intersect", ["list"], ({ list }) => {
			return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
		});
		defineMethod("transform", [
			"inner",
			"callback",
			"preserve"
		], ({ inner }, isInner) => inner.toString(isInner));
		//#endregion
		//#region lib/types/submission-settings.js
		/** Busy-Enter preference stored in the Host user-settings document. */
		/** Settings namespace owned by the conversation plugin. */
		const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
		/** Field carrying the delivery mode for plain Enter while an agent is busy. */
		const BUSY_ENTER_FIELD = "busyEnter";
		/** Busy-Enter behaviors accepted at settings and input boundaries. */
		const BUSY_ENTER_BEHAVIORS = ["queue", "steer"];
		/** Default preserves Enter-as-Queue for running conversations. */
		const DEFAULT_BUSY_ENTER_BEHAVIOR = "queue";
		Schema.object({ [BUSY_ENTER_FIELD]: Schema.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR) });
		//#endregion
		//#region lib/types/client/input/submission-policy.js
		/**
		* Composer submission policy. It owns the live busy-Enter
		* preference and resolves keyboard gestures into queue/steer delivery modes;
		* Host and Agent keep the actual delivery-window authority.
		*/
		/**
		* Busy-Enter policy used by both the composer inject face and its Settings row.
		* Direct `steer` is intentionally best-effort: AgentLoop turns a closed-window
		* submission into the next waking Queue item.
		*/
		var ComposerSubmissionPolicy = class {
			/** Reactive preference source for the Settings row. */
			busyEnter = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(DEFAULT_BUSY_ENTER_BEHAVIOR);
			host;
			/**
			* @param host - durable preference scope owned by the providing plugin;
			* absent compositions stay process-local. The adoption subscription shares
			* the scope's plugin lifetime — a disposed scope never publishes again, so
			* the policy needs no release hook.
			*/
			constructor(host) {
				this.host = host;
				if (host !== void 0) {
					host.subscribe(() => {
						this.adopt(host);
					});
					this.adopt(host);
				}
			}
			/**
			* Resolve one keyboard gesture without changing state.
			* @param running - whether the addressed agent currently reports busy.
			* @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
			* @param steeringAvailable - whether this session transport supports steering.
			* @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
			*/
			resolve(running, gesture, steeringAvailable) {
				if (!running || !steeringAvailable) return "queue";
				const preferred = this.busyEnter.getSnapshot();
				if (gesture === "enter") return preferred;
				return preferred === "queue" ? "steer" : "queue";
			}
			/**
			* Change the plain-Enter behavior used during busy state; the live value
			* publishes before the durable write starts.
			* @param behavior - Queue or Steer.
			*/
			setBusyEnter(behavior) {
				if (this.busyEnter.getSnapshot() === behavior) return;
				this.busyEnter.set(behavior);
				this.host?.set(BUSY_ENTER_FIELD, behavior);
			}
			/**
			* Adopt the scope's accepted durable behavior without writing it back.
			* @param host - the constructor-narrowed scope driving this adoption.
			*/
			adopt(host) {
				const section = host.getSnapshot().value;
				if (section === void 0 || this.busyEnter.getSnapshot() === section.busyEnter) return;
				this.busyEnter.set(section.busyEnter);
			}
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region lib/types/client/input/decorations.js
		/** Token matcher: a trigger char at line start or after whitespace, then a word-ish name (never crosses \n). */
		const TEXT_REF_RE = /(^|\s)([/@])([\w-]+)/g;
		/**
		* Scan the draft for plain-text reference tokens against the hot lexicons.
		* Word-boundary discipline: the trigger must sit at the draft
		* start or after whitespace ('x/name' never matches); the name must be an
		* exact lexicon member.
		* @param draft - draft text.
		* @param lexicon - per-trigger name lists (a missing trigger scans nothing).
		* @returns matched ranges in draft order.
		*/
		function scanTextRefs(draft, lexicon) {
			if (lexicon.size === 0 || draft === "") return [];
			const out = [];
			TEXT_REF_RE.lastIndex = 0;
			let m;
			while ((m = TEXT_REF_RE.exec(draft)) !== null) {
				const trigger = m[2];
				const name = m[3] ?? "";
				if (lexicon.get(trigger)?.includes(name)) {
					const start = m.index + (m[1]?.length ?? 0);
					out.push({
						start,
						end: start + 1 + name.length,
						trigger
					});
				}
			}
			return out;
		}
		/** The empty lexicon (default: zero text-ref decorations, old call sites unchanged). */
		const EMPTY_LEXICON$1 = /* @__PURE__ */ new Map();
		/**
		* Derive the mirror-layer decorations from the input state.
		* @param state - published input state.
		* @param lexicon - optional per-trigger reference lexicons (plain-text-reference scan).
		* @returns token range, chip instructions, text-ref ranges, and the ghost hint.
		*/
		function deriveDecorations(state, lexicon = EMPTY_LEXICON$1) {
			const { draft, claim, phase, occurrences } = state;
			const claimActive = (phase === "claimed" || phase === "submitting") && claim !== void 0 && draft.startsWith(claim.token);
			const token = claimActive ? {
				start: 0,
				end: claim.token.length
			} : null;
			const chips = occurrences.map((o) => ({
				occurrenceId: o.occurrenceId,
				offset: o.offset,
				label: o.label,
				invalid: o.invalid === true
			}));
			const hint = claimActive && claim.hint !== void 0 && draft.slice(claim.token.length).trim() === "" ? claim.hint : null;
			return {
				token,
				chips,
				textRefs: scanTextRefs(draft, lexicon),
				hint
			};
		}
		//#endregion
		//#region lib/types/client/image-labels.js
		/** Bridges the `conversation` locale namespace to the zero-cordis attachment
		* atoms' label props (`@deepseek-ai/dsh-client-ui-attachment` reads no
		* application state; owners resolve every string). */
		/**
		* Byte count as user-facing megabytes (`10MB`, `2.5MB`).
		* @param bytes - the byte count.
		* @returns the rounded megabyte text.
		*/
		function imageSizeText(bytes) {
			const mb = bytes / (1024 * 1024);
			return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`;
		}
		/**
		* Product copy for a host attachment rejection (the `attachment-error`
		* `details.reason`). User-solvable reasons name the limit and the way out;
		* reasons the user cannot act on fold into one send-failed line carrying the
		* reason code for a bug report.
		* @param t - the conversation-namespace translate.
		* @param reason - the wire `details.reason` code.
		* @param limits - projected limits interpolated into count/size copy, when known.
		* @returns the banner text.
		*/
		function attachmentErrorText(t, reason, limits) {
			switch (reason) {
				case "MODEL_DOES_NOT_SUPPORT_IMAGES": return t("image.modelUnsupported");
				case "SUBAGENT_IMAGE_UNSUPPORTED": return t("image.subagentUnsupported");
				case "IMAGE_TOO_MANY_PIXELS": return t("image.tooManyPixels");
				case "INVALID_IMAGE":
				case "IMAGE_TYPE_MISMATCH": return t("image.unsupportedType");
				case "TOO_MANY_IMAGES":
					if (limits !== void 0) return t("image.tooMany", { count: limits.maxImagesPerMessage });
					break;
				case "IMAGE_TOO_LARGE":
					if (limits !== void 0) return t("image.fileTooLarge", { size: imageSizeText(limits.maxImageBytes) });
					break;
				case "IMAGES_TOO_LARGE":
					if (limits !== void 0) return t("image.totalTooLarge", { size: imageSizeText(limits.maxMessageImageBytes) });
					break;
				default: break;
			}
			return t("image.sendFailed", { reason });
		}
		/**
		* Resolve the original-image lightbox strings.
		* @param t - the conversation-namespace translate.
		* @returns the lightbox dialog and close-control labels.
		*/
		function lightboxLabels(t) {
			return {
				dialog: t("image.preview"),
				close: t("image.closePreview")
			};
		}
		/**
		* Resolve the chat-history image strings.
		* @param t - the conversation-namespace translate.
		* @returns the message-image labels including the forwarded lightbox strings.
		*/
		function messageImageLabels(t) {
			return {
				image: t("image.label"),
				open: t("image.openOriginal"),
				openNamed: (label) => t("image.openOriginalLabel", { label }),
				loading: t("image.loading"),
				loadFailed: t("image.loadFailed"),
				lightbox: lightboxLabels(t)
			};
		}
		/**
		* Resolve the full-page drop overlay strings.
		* @param t - the conversation-namespace translate.
		* @param accepting - whether drops are currently accepted.
		* @param limits - per-message limits for the desc line, when known.
		* @returns the overlay title, with the limits desc while accepting.
		*/
		function dropOverlayLabels(t, accepting, limits) {
			if (!accepting) return { title: t("image.dropBlocked") };
			return {
				title: t("image.dropTitle"),
				desc: limits === void 0 ? void 0 : t("image.dropDesc", {
					count: limits.count,
					size: limits.size
				})
			};
		}
		/**
		* Resolve the composer draft-image rail strings.
		* @param t - the conversation-namespace translate.
		* @returns the rail group, open-tooltip, and paging-arrow labels.
		*/
		function attachmentRailLabels(t) {
			return {
				group: t("image.pending"),
				open: t("image.openOriginal"),
				scrollLeft: t("image.scrollLeft"),
				scrollRight: t("image.scrollRight")
			};
		}
		//#endregion
		//#region lib/types/client/chat/message-chrome.js
		function pad2(n) {
			return String(n).padStart(2, "0");
		}
		/**
		* Local calendar-day epoch (ms at local midnight) for an instant.
		* @param ms - Unix epoch ms.
		* @returns Midnight of that local calendar day.
		*/
		function startOfLocalDay(ms) {
			const d = new Date(ms);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		/**
		* Delay until the next local midnight after `ms` (at least 1ms).
		* @param ms - Unix epoch ms.
		* @returns Milliseconds until the following local midnight.
		*/
		function msUntilNextLocalMidnight(ms) {
			const next = new Date(ms);
			next.setHours(24, 0, 0, 0);
			return Math.max(next.getTime() - ms, 1);
		}
		/**
		* Localized elapsed-time label shared by running and settled turn chrome.
		* @param ms - Elapsed duration in milliseconds (negatives clamp to zero).
		* @param t - Translate seat supplying the duration templates.
		* @returns Display string in whole seconds.
		*/
		function formatRunDuration(ms, t) {
			const total = Math.max(0, Math.floor(ms / 1e3));
			const minutes = Math.floor(total / 60);
			const seconds = total % 60;
			return minutes > 0 ? t("duration.minutes", {
				minutes,
				seconds: String(seconds).padStart(2, "0")
			}) : t("duration.seconds", { seconds });
		}
		/**
		* Sub-turn latency figure: one decimal under ten seconds, whole seconds
		* beyond. Unit-less so the locale template owns the second suffix.
		* @param ms - Latency in milliseconds (negatives clamp to zero).
		* @returns Display number in seconds without unit.
		*/
		function formatLatencySeconds(ms) {
			const s = Math.max(0, ms) / 1e3;
			return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s));
		}
		/**
		* Decode-throughput figure: whole tokens from ten up, one decimal below.
		* @param tps - Tokens per second.
		* @returns Display number without unit.
		*/
		function formatTokensPerSecond(tps) {
			const clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		/**
		* Compact local timestamp for message IconActions. Same calendar day →
		* `HH:mm`; earlier this year → the `clock.md` date template + clock; other
		* years → the `clock.ymd` template + clock. Pure: the date templates arrive
		* through the caller's locale seat.
		* @param time - Unix epoch ms from the source session event.
		* @param t - translate seat supplying the `clock.md` / `clock.ymd` templates.
		* @param now - Reference instant for the day/year cut (defaults to wall clock).
		* @returns Date-aware clock string (24-hour, zero-padded time).
		*/
		function formatMessageClock(time, t, now = Date.now()) {
			const d = new Date(time);
			const n = new Date(now);
			const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
			if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
			const params = {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			};
			return `${d.getFullYear() === n.getFullYear() ? t("clock.md", params) : t("clock.ymd", params)} ${clock}`;
		}
		//#endregion
		//#region lib/types/client/chat/turn-metrics.js
		function usageOutputTokens(usage) {
			if (typeof usage !== "object" || usage === null) return null;
			const value = usage.outputTokens;
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		}
		/**
		* Read one assistant node's TTFT, decode wall time, and output tokens.
		* @param node - A settled assistant node.
		* @returns Per-part readings with `null` for unrecorded values.
		*/
		function assistantStepReading(node) {
			const timing = node.timing;
			return {
				ttftMs: timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
				decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
				outputTokens: usageOutputTokens(node.usage)
			};
		}
		/**
		* Fold assistant nodes into per-turn footer metrics.
		*
		* TTFT is the turn's lowest-step request-dispatch-to-first-token reading, so
		* it is only meaningful when the turn's start is inside
		* the loaded window (the caller gates on `turnTimings`, which shares that
		* window). Throughput divides summed output tokens by summed decode wall time,
		* counting only steps that carry both.
		* @param nodes - Snapshot nodes of the loaded window.
		* @returns Turn number → available metrics; turns with none are absent.
		*/
		function deriveTurnMetrics(nodes) {
			const folds = /* @__PURE__ */ new Map();
			for (const node of nodes) {
				if (node.kind !== "assistant") continue;
				const reading = assistantStepReading(node);
				let fold = folds.get(node.turn);
				if (fold === void 0) {
					fold = {
						firstStep: node.step,
						firstStepTtftMs: reading.ttftMs,
						decodeMs: 0,
						outputTokens: 0,
						sampled: false
					};
					folds.set(node.turn, fold);
				} else if (node.step < fold.firstStep) {
					fold.firstStep = node.step;
					fold.firstStepTtftMs = reading.ttftMs;
				}
				if (reading.decodeMs !== null && reading.outputTokens !== null) {
					fold.decodeMs += reading.decodeMs;
					fold.outputTokens += reading.outputTokens;
					fold.sampled = true;
				}
			}
			const metrics = /* @__PURE__ */ new Map();
			for (const [turn, fold] of folds) {
				const entry = {};
				if (fold.firstStepTtftMs !== null) entry.ttftMs = fold.firstStepTtftMs;
				if (fold.sampled && fold.decodeMs > 0) entry.tokensPerSecond = fold.outputTokens / (fold.decodeMs / 1e3);
				if (entry.ttftMs !== void 0 || entry.tokensPerSecond !== void 0) metrics.set(turn, entry);
			}
			return metrics;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/StatsLine.module.css.mjs
		const css$20 = ".FJxK0a_root{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;margin:0 auto;font-size:12px;line-height:20px;display:block;overflow:hidden}.FJxK0a_sep{color:var(--dsw-alias-separator-primary);margin:0 10px}";
		const tagId$20 = "@deepseek-ai/dsh-client-ui-conversation/StatsLine.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$20) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$20;
			tag.textContent = css$20;
			document.head.appendChild(tag);
		}
		var StatsLine_module_css_default = {
			"sep": "FJxK0a_sep",
			"root": "FJxK0a_root"
		};
		//#endregion
		//#region lib/types/client/chat/StatsLine.js
		/**
		* Fold assistant and tool-result nodes into window-scoped display totals —
		* the FALLBACK for assemblies without the `sessionStats` projection.
		*
		* Every displayed figure rides that durable whole-log projection (and token
		* accounting rides `tokenUsage`) because the window is paged and compaction
		* rewrites it; this fold answers "what is on screen" only when no projection
		* value is served. Its field names deliberately mirror the projection's so
		* the two swap wholesale.
		* @param nodes - snapshot nodes.
		* @returns fallback counts and summed wall times.
		*/
		function deriveStats(nodes) {
			const turns = /* @__PURE__ */ new Set();
			let steps = 0;
			let llmMs = 0;
			let toolMs = 0;
			let ttftMs = 0;
			let ttftSteps = 0;
			let decodeMs = 0;
			let decodeTokens = 0;
			for (const node of nodes) {
				if (node.kind === "tool-result") {
					if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
					continue;
				}
				if (node.kind !== "assistant") continue;
				turns.add(node.turn);
				steps += 1;
				if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
				const reading = assistantStepReading(node);
				if (reading.ttftMs !== null) {
					ttftMs += reading.ttftMs;
					ttftSteps += 1;
				}
				if (reading.decodeMs !== null && reading.outputTokens !== null) {
					decodeMs += reading.decodeMs;
					decodeTokens += reading.outputTokens;
				}
			}
			return {
				turns: turns.size,
				steps,
				llmMs,
				toolMs,
				ttftMs,
				ttftSteps,
				decodeMs,
				decodeTokens
			};
		}
		/**
		* Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
		* @param n - token count.
		* @returns display string.
		*/
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return `${scaled(n / 1e3)}K`;
			return `${scaled(n / 1e6)}M`;
		}
		/**
		* Compact duration: 45.2s under a minute, 2m42s from there on.
		* @param ms - duration in milliseconds.
		* @returns display string.
		*/
		function formatDuration(ms) {
			const s = ms / 1e3;
			if (s < 60) return `${Math.round(s * 10) / 10}s`;
			const whole = Math.round(s);
			return `${Math.floor(whole / 60)}m${whole % 60}s`;
		}
		/**
		* Cache-hit share of prompt-side input over the whole durable log.
		* @param usage - the session's token-usage projection value.
		* @returns rounded integer percent, or null when no input was billed.
		*/
		function cacheHitPercent(usage) {
			const denominator = billedInputTokens(usage);
			return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100);
		}
		/**
		* Sum the three disjoint prompt-side billing buckets.
		* @param usage - the session's token-usage projection value.
		* @returns billed input tokens.
		*/
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
		}
		/**
		* Approximate context occupancy, using the TUI's integer rounding and upper
		* clamp. The numerator is `projectedTokens` — the provider sample carried
		* forward over the surface's movement since — so compaction shows immediately
		* instead of waiting for the next request to report usage; it falls back to the
		* bare sample only for a log whose projection predates that field. Numerator
		* and capacity remain independent last-wins projection fields, so this is a
		* reference figure rather than an exact measurement of one request (see the
		* token-meter README).
		* @param pressure - the session's context-pressure projection value.
		* @returns occupancy with its numerator and denominator, or null until both values are known.
		*/
		function contextOccupancy(pressure) {
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			if (usedTokens === void 0 || pressure?.contextWindow === void 0) return null;
			return {
				percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
				usedTokens,
				contextWindow: pressure.contextWindow
			};
		}
		const StatsLine = (0, react.memo)(function StatsLine({ useSession, useProjection, t }) {
			const settledNodes = useSession((s) => s.chat.legacy.nodes);
			const usage = useProjection("tokenUsage");
			const projected = useProjection("sessionStats");
			const stats = (0, react.useMemo)(() => projected ?? deriveStats(settledNodes), [projected, settledNodes]);
			const groups = [];
			if (stats.steps > 0) {
				groups.push(t("stats.counts", {
					turns: stats.turns,
					steps: stats.steps
				}));
				const durations = [];
				if (stats.llmMs > 0) durations.push(t("stats.llm", { duration: formatDuration(stats.llmMs) }));
				if (stats.toolMs > 0) durations.push(t("stats.toolCall", { duration: formatDuration(stats.toolMs) }));
				if (durations.length > 0) groups.push(durations.join(" · "));
				const speeds = [];
				if (stats.ttftSteps > 0) speeds.push(t("stats.ttftAverage", { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }));
				if (stats.decodeMs > 0) speeds.push(t("stats.tokensPerSecond", { throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }));
				if (speeds.length > 0) groups.push(speeds.join(" · "));
			}
			if (usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				const cacheHit = cacheHitPercent(usage);
				if (cacheHit !== null) groups.push(t("stats.cacheHit", { percent: cacheHit }));
				groups.push(t("stats.tokens", {
					input: formatTokens(billedInputTokens(usage)),
					output: formatTokens(usage.outputTokens)
				}));
			}
			const line = groups.join(" | ");
			const rootRef = (0, react.useRef)(null);
			const [truncated, setTruncated] = (0, react.useState)(false);
			(0, react.useLayoutEffect)(() => {
				const el = rootRef.current;
				if (el === null) return;
				const measure = () => {
					setTruncated(el.scrollWidth > el.clientWidth);
				};
				measure();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(measure);
				observer.observe(el);
				return () => {
					observer.disconnect();
				};
			}, [line]);
			if (groups.length === 0) return null;
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: line,
				side: "top",
				delayMs: 500,
				disabled: !truncated,
				children: (0, react_jsx_runtime.jsx)("div", {
					ref: rootRef,
					className: StatsLine_module_css_default.root,
					children: groups.map((group, i) => (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [i > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
						className: StatsLine_module_css_default.sep,
						"aria-hidden": true,
						children: "|"
					}), " "] }), (0, react_jsx_runtime.jsx)("span", { children: group })] }, group))
				})
			});
		});
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ContextMeter.module.css.mjs
		const css$19 = ".JObwrW_root{display:inline-flex;position:relative}.JObwrW_trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;display:grid}.JObwrW_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.JObwrW_track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}.JObwrW_fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}.JObwrW_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:264px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);cursor:default;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:absolute;bottom:calc(100% + 8px);right:0}.JObwrW_header{align-items:center;gap:6px;display:flex}.JObwrW_figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}.JObwrW_percent{color:var(--dsw-alias-label-primary);font-weight:500}.JObwrW_headline{color:var(--dsw-alias-label-tertiary)}.JObwrW_headline:empty{display:none}.JObwrW_bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:10px 0 12px;display:flex;overflow:hidden}.JObwrW_segment{background:var(--meter-tint,var(--dsw-alias-label-tertiary));border-radius:1px;flex:none;min-width:2px;height:100%}.JObwrW_swatch{background:var(--meter-tint);vertical-align:baseline;border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block}.JObwrW_colorSystem{--meter-tint:var(--dsw-static-neutral-bluish-400)}.JObwrW_colorTools{--meter-tint:#a78bfa}.JObwrW_colorMessages{--meter-tint:var(--dsw-static-blue-450)}.JObwrW_rows{margin:6px 0 0}.JObwrW_row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}.JObwrW_row dt{color:var(--dsw-alias-label-secondary)}.JObwrW_row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}";
		const tagId$19 = "@deepseek-ai/dsh-client-ui-conversation/ContextMeter.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$19) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$19;
			tag.textContent = css$19;
			document.head.appendChild(tag);
		}
		var ContextMeter_module_css_default = {
			"trigger": "JObwrW_trigger",
			"track": "JObwrW_track",
			"row": "JObwrW_row",
			"header": "JObwrW_header",
			"percent": "JObwrW_percent",
			"headline": "JObwrW_headline",
			"bar": "JObwrW_bar",
			"swatch": "JObwrW_swatch",
			"rows": "JObwrW_rows",
			"segment": "JObwrW_segment",
			"panel": "JObwrW_panel",
			"fill": "JObwrW_fill",
			"colorMessages": "JObwrW_colorMessages",
			"colorTools": "JObwrW_colorTools",
			"colorSystem": "JObwrW_colorSystem",
			"figures": "JObwrW_figures",
			"root": "JObwrW_root"
		};
		//#endregion
		//#region lib/types/client/skeleton/ContextMeter.js
		/** Composer context-occupancy meter: a ring beside the send button fed by the
		* `contextPressure` projection, with a click-open panel of the heuristic
		* `contextBreakdown` composition (system prompt, tools, conversation).
		* Renders nothing until a provider reports both pressure and a route
		* capacity. */
		/** Ring geometry: 14px viewBox, 2px stroke. */
		const RADIUS = 5.5;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
		/**
		* Marker the localized occupancy sentence is split on, so the panel headline
		* keeps the reading in its own tone while each locale still owns the word
		* order (`45% of context used` / `上下文已用 45%`).
		*/
		const READING_SLOT = "\0";
		/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
		const ROWS = [
			{
				key: "systemTokens",
				label: "context.system",
				color: ContextMeter_module_css_default.colorSystem
			},
			{
				key: "toolsTokens",
				label: "context.tools",
				color: ContextMeter_module_css_default.colorTools
			},
			{
				key: "messageTokens",
				label: "context.messages",
				color: ContextMeter_module_css_default.colorMessages
			}
		];
		function ContextMeter({ useProjection, t }) {
			const pressure = useProjection("contextPressure");
			const breakdown = useProjection("contextBreakdown");
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const context = contextOccupancy(pressure);
			const available = context !== null;
			(0, react.useEffect)(() => {
				if (!available && open) setOpen(false);
			}, [available, open]);
			(0, react.useEffect)(() => {
				if (!open || !available) return;
				const onPointerDown = (e) => {
					if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [available, open]);
			if (context === null) return null;
			const percent = context.percent;
			const reading = `${percent}%`;
			const [headBefore = "", headAfter = ""] = t("context.aria", { percent: READING_SLOT }).split(READING_SLOT).map((part) => part.trim());
			const breakdownTotal = breakdown === void 0 ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
			const segments = (breakdown === void 0 || breakdownTotal === 0 ? [{
				key: "total",
				color: void 0,
				width: percent
			}] : ROWS.map((row) => ({
				key: row.key,
				color: row.color,
				width: percent * breakdown[row.key] / breakdownTotal
			}))).filter((part) => part.width > 0);
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: ContextMeter_module_css_default.root,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("context.aria", { percent: reading }),
					side: "top",
					delayMs: 200,
					disabled: open,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ContextMeter_module_css_default.trigger,
						"aria-label": t("context.aria", { percent: reading }),
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						onClick: () => {
							setOpen(!open);
						},
						children: (0, react_jsx_runtime.jsxs)("svg", {
							viewBox: "0 0 14 14",
							width: "14",
							height: "14",
							"aria-hidden": true,
							children: [(0, react_jsx_runtime.jsx)("circle", {
								className: ContextMeter_module_css_default.track,
								cx: "7",
								cy: "7",
								r: RADIUS
							}), (0, react_jsx_runtime.jsx)("circle", {
								className: ContextMeter_module_css_default.fill,
								cx: "7",
								cy: "7",
								r: RADIUS,
								strokeDasharray: `${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`,
								transform: "rotate(-90 7 7)"
							})]
						})
					})
				}), open && (0, react_jsx_runtime.jsxs)("div", {
					className: ContextMeter_module_css_default.panel,
					role: "dialog",
					"aria-label": t("context.used"),
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: ContextMeter_module_css_default.header,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.headline,
									children: headBefore
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.percent,
									children: reading
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.headline,
									children: headAfter
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ContextMeter_module_css_default.figures,
									children: `~${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`
								})
							]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: ContextMeter_module_css_default.bar,
							children: segments.map((segment) => (0, react_jsx_runtime.jsx)("div", {
								className: segment.color === void 0 ? ContextMeter_module_css_default.segment : `${ContextMeter_module_css_default.segment} ${segment.color}`,
								style: { width: `${segment.width}%` }
							}, segment.key))
						}),
						breakdown !== void 0 && (0, react_jsx_runtime.jsx)("dl", {
							className: ContextMeter_module_css_default.rows,
							children: ROWS.map((row) => (0, react_jsx_runtime.jsxs)("div", {
								className: ContextMeter_module_css_default.row,
								children: [(0, react_jsx_runtime.jsxs)("dt", { children: [(0, react_jsx_runtime.jsx)("span", {
									className: `${ContextMeter_module_css_default.swatch} ${row.color}`,
									"aria-hidden": true
								}), t(row.label)] }), (0, react_jsx_runtime.jsx)("dd", { children: `~${formatTokens(breakdown[row.key])}` })]
							}, row.key))
						})
					]
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/PermissionSelect.module.css.mjs
		const css$18 = ".Sh0Q9G_trigger{min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.Sh0Q9G_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.Sh0Q9G_trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}.Sh0Q9G_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.Sh0Q9G_triggerIcon{flex:none;display:inline-flex}.Sh0Q9G_triggerIcon svg{width:14px;height:14px}.Sh0Q9G_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.Sh0Q9G_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s;display:inline-flex}@container (width<=460px){.Sh0Q9G_trigger:has(.Sh0Q9G_triggerIcon) .Sh0Q9G_triggerLabel{display:none}}.Sh0Q9G_chevronOpen{transform:rotate(180deg)}";
		const tagId$18 = "@deepseek-ai/dsh-client-ui-conversation/PermissionSelect.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$18) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$18;
			tag.textContent = css$18;
			document.head.appendChild(tag);
		}
		var PermissionSelect_module_css_default = {
			"chevronOpen": "Sh0Q9G_chevronOpen",
			"chevron": "Sh0Q9G_chevron",
			"triggerLabel": "Sh0Q9G_triggerLabel",
			"triggerIcon": "Sh0Q9G_triggerIcon",
			"trigger": "Sh0Q9G_trigger"
		};
		//#endregion
		//#region lib/types/client/skeleton/PermissionSelect.js
		const FULL_ACCESS = "danger-full-access";
		const shieldOutline = "M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z";
		const permissionGlyphs = {
			"read-only": (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [(0, react_jsx_runtime.jsx)("path", {
					d: shieldOutline,
					stroke: "currentColor",
					strokeWidth: "1.31831",
					strokeLinejoin: "round"
				}), (0, react_jsx_runtime.jsx)("path", {
					d: "M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z",
					fill: "currentColor"
				})]
			}),
			"workspace-write": (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [
					(0, react_jsx_runtime.jsx)("path", {
						d: "M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z",
						fill: "currentColor"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M11.3525 5.64688V6.85688H5V5.64688H11.3525Z",
						fill: "currentColor"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M9.5824 8.29376V9.50376H5V8.29376H9.5824Z",
						fill: "currentColor"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z",
						fill: "currentColor"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z",
						fill: "currentColor"
					})
				]
			}),
			[FULL_ACCESS]: (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [
					(0, react_jsx_runtime.jsx)("path", {
						d: shieldOutline,
						stroke: "currentColor",
						strokeWidth: "1.31831",
						strokeLinejoin: "round"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z",
						fill: "currentColor"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z",
						fill: "currentColor"
					})
				]
			})
		};
		/** Glyph for a permission option value; host-configured names outside the design set get none. */
		function permissionGlyph(value) {
			return permissionGlyphs[value];
		}
		/**
		* Display transform: kebab-case machine names render as title-case labels
		* (`workspace-write` → `Workspace Write`); non-kebab host-configured names
		* pass through. Full access intentionally overrides the machine-name
		* transform so both permission surfaces use the product label `Full access`;
		* the warning body remains locale-aware.
		*/
		function displayName(name) {
			if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
			return name.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
		}
		function optionLabel(option) {
			return option.value === FULL_ACCESS ? "Full access" : displayName(option.name);
		}
		function PermissionSelect({ value, locked, command, t }) {
			const [pick, setPick] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [confirmation, setConfirmation] = (0, react.useState)(null);
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!locked && value !== void 0) return;
				setOpen(false);
				setAcknowledged(false);
				setConfirmation(null);
			}, [locked, value]);
			if (value === void 0) return null;
			const currentValue = pick ?? value.currentValue;
			const current = value.options.find((option) => option.value === currentValue);
			const busy = pick !== null || confirmation !== null;
			const items = value.options.filter((o) => o.value !== "custom").map((option) => {
				const icon = permissionGlyph(option.value);
				return {
					id: option.value,
					label: optionLabel(option),
					...icon === void 0 ? {} : { icon }
				};
			});
			const submit = (id) => {
				setPick(id);
				command(`/permission ${id}`).catch(() => false).then(() => {
					setPick(null);
				});
			};
			const choose = (id) => {
				setOpen(false);
				if (id === value.currentValue) return;
				if (id === FULL_ACCESS) {
					setAcknowledged(false);
					setConfirmation(id);
					return;
				}
				submit(id);
			};
			const closeConfirmation = () => {
				setAcknowledged(false);
				setConfirmation(null);
			};
			const confirmFullAccess = () => {
				if (locked || !acknowledged || confirmation === null) return;
				const id = confirmation;
				closeConfirmation();
				submit(id);
			};
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				items,
				selectedId: currentValue,
				onSelect: choose,
				onClose: () => {
					setOpen(false);
				},
				side: "top",
				anchor: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: PermissionSelect_module_css_default.trigger,
					"aria-label": t("input.accessMode", { name: current === void 0 ? displayName(currentValue) : optionLabel(current) }),
					title: current?.description,
					disabled: locked || busy,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						permissionGlyph(currentValue) !== void 0 && (0, react_jsx_runtime.jsx)("span", {
							className: PermissionSelect_module_css_default.triggerIcon,
							"aria-hidden": true,
							children: permissionGlyph(currentValue)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: PermissionSelect_module_css_default.triggerLabel,
							children: current === void 0 ? displayName(currentValue) : optionLabel(current)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: clsx(PermissionSelect_module_css_default.chevron, open && PermissionSelect_module_css_default.chevronOpen),
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
						})
					]
				})
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.RiskConfirmation, {
				open: confirmation !== null,
				title: t("access.confirm.title"),
				description: t("access.confirm.description"),
				acknowledgeLabel: t("access.confirm.acknowledge"),
				cancelLabel: t("access.confirm.cancel"),
				confirmLabel: t("access.confirm.enable"),
				acknowledged,
				disabled: locked,
				onAcknowledgedChange: setAcknowledged,
				onCancel: closeConfirmation,
				onConfirm: confirmFullAccess
			})] });
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css.mjs
		const css$17 = "@font-face{font-family:DshChipCell;src:url(data:font/ttf;base64,AAEAAAAKAIAAAwAgT1MvMkT8SmIAAAEoAAAAYGNtYXAADQBPAAABkAAAADRnbHlmAAAAAAAAAcwAAAABaGVhZCwtPGoAAACsAAAANmhoZWEDIg7bAAAA5AAAACRobXR4EZQAAAAAAYgAAAAIbG9jYQAAAAAAAAHEAAAABm1heHAAAwACAAABCAAAACBuYW1lvljk2gAAAdAAAABscG9zdNNweNQAAAI8AAAALQABAAAAAQAAdia1tV8PPPUAAwPoAAAAAOaLfcUAAAAA5ot9xQAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAA+gAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwjKAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAPz8/PwAA//z//AMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAAB9AAAD6AAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAD//P//AAD//P//AAUAAQAAAAAAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQALAAAAAQAAAAAAAgAHAAsAAwABBAkAAQAWABIAAwABBAkAAgAOAChEc2hDaGlwQ2VsbFJlZ3VsYXIARABzAGgAQwBoAGkAcABDAGUAbABsAFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAABAgZvYmpyZXAAAAA=)format(\"truetype\")}.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 8px;flex-direction:column;align-items:center;display:flex}.uV2eYG_hero{padding:0 var(--dsh-composer-side-clearance)}.uV2eYG_notice{width:100%;max-width:var(--dsh-composer-card-max-width);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);border-radius:8px;margin-bottom:6px;padding:4px 8px;font-size:12px;line-height:18px}.uV2eYG_noticeError{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:22px;flex-direction:column;gap:12px;padding-top:10px;font-size:16px;line-height:24px;display:flex;position:relative}.uV2eYG_cardWorkspaceTrigger{cursor:pointer;border-color:#0000}.uV2eYG_cardWorkspaceTrigger:after{content:\"\";background:var(--dsw-alias-border-l4);pointer-events:none;border-radius:22px;transition:background-color .1s;position:absolute;inset:-1px;-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' fill='none' rx='22' ry='22' stroke='black' stroke-width='2' stroke-dasharray='4 4'/%3E%3C/svg%3E\");mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' fill='none' rx='22' ry='22' stroke='black' stroke-width='2' stroke-dasharray='4 4'/%3E%3C/svg%3E\")}.uV2eYG_cardWorkspaceTrigger :disabled{pointer-events:none}.uV2eYG_cardWorkspaceTrigger:hover:after{background:var(--dsw-alias-state-business-primary)}.uV2eYG_accessory{align-items:center;gap:8px;padding:10px 12px 0;display:flex}.uV2eYG_attachments{min-width:0;padding:4px 12px 0}.uV2eYG_overlayAnchor{height:0;position:absolute;inset:0 0 auto}.uV2eYG_scroll{max-height:var(--dsh-composer-text-max-height);overflow-y:auto}.uV2eYG_grow{position:relative}.uV2eYG_backdrop{color:var(--dsw-alias-label-primary);pointer-events:none;position:absolute;inset:0;overflow:hidden}.uV2eYG_hlToken{color:var(--dsw-alias-state-warn-label);background-color:#0000}.uV2eYG_hlSegment{color:#0000;background-color:#0000;border-radius:4px}.uV2eYG_hint{color:var(--dsw-alias-label-caption)}.uV2eYG_pending{background:var(--dsw-alias-state-business-primary);border-radius:50%;width:8px;height:8px;animation:1s ease-in-out infinite alternate uV2eYG_input-pending}@keyframes uV2eYG_input-pending{0%{opacity:.35}to{opacity:1}}.uV2eYG_input{resize:none;color:#0000;width:100%;height:100%;caret-color:var(--dsw-alias-state-business-primary);background:0 0;border:none;outline:none;position:absolute;inset:0;overflow:hidden}.uV2eYG_input,.uV2eYG_mirror,.uV2eYG_backdrop{box-sizing:border-box;font-family:\"DshChipCell\", var(--dsw-font-family);font-size:inherit;line-height:inherit;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;padding:4px 12px 0 16px}.uV2eYG_input::placeholder{color:var(--dsw-alias-label-caption);user-select:none}.uV2eYG_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}.uV2eYG_input[aria-haspopup=menu]{cursor:pointer}.uV2eYG_mirror{visibility:hidden;pointer-events:none}.uV2eYG_hero .uV2eYG_mirror{min-height:52px}.uV2eYG_row{justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}.uV2eYG_tools,.uV2eYG_modes,.uV2eYG_trailing{align-items:center;min-width:0;display:flex}.uV2eYG_tools{gap:16px}.uV2eYG_modes{gap:12px}.uV2eYG_trailing{flex:none;gap:12px}.uV2eYG_add{background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid}.uV2eYG_add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.uV2eYG_add:disabled{opacity:.5;cursor:default}.uV2eYG_select{max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;appearance:none;background-color:#0000;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-position:right 4px center;background-repeat:no-repeat;background-size:12px 12px;border:none;border-radius:8px;outline:none;padding:0 20px 0 8px;font-size:13px;font-weight:500;line-height:20px}.uV2eYG_select:hover:not(:disabled){background-color:var(--dsw-alias-interactive-bg-hover)}.uV2eYG_select:disabled{opacity:.5;cursor:default}.uV2eYG_primary{background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}.uV2eYG_primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}.uV2eYG_primary:disabled{opacity:.4;cursor:default}.uV2eYG_retry{color:inherit;cursor:pointer;background:0 0;border:1px solid;border-radius:4px;margin-left:8px;padding:1px 8px;font-size:12px}.uV2eYG_textRef{color:var(--dsw-alias-state-business-primary);-webkit-box-decoration-break:clone;box-decoration-break:clone;background-color:#0000}.uV2eYG_textRef:after{display:none}.uV2eYG_chip{background:#6187d838;border-radius:6px;position:relative}.uV2eYG_chip:before{content:\"￼\";color:#0000}.uV2eYG_chipLabel{width:calc(138.889% - 10px);color:var(--dsw-alias-label-primary);white-space:nowrap;justify-content:center;align-items:center;display:flex;position:absolute;top:50%;left:50%;overflow:hidden;transform:translate(-50%,-50%)scale(.72)}.uV2eYG_chipInvalid{opacity:.7;background:#d8616133;text-decoration:line-through}";
		const tagId$17 = "@deepseek-ai/dsh-client-ui-conversation/InputBar.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$17) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$17;
			tag.textContent = css$17;
			document.head.appendChild(tag);
		}
		var InputBar_module_css_default = {
			"overlayAnchor": "uV2eYG_overlayAnchor",
			"chip": "uV2eYG_chip",
			"accessory": "uV2eYG_accessory",
			"mirror": "uV2eYG_mirror",
			"card": "uV2eYG_card",
			"grow": "uV2eYG_grow",
			"root": "uV2eYG_root",
			"hlToken": "uV2eYG_hlToken",
			"input": "uV2eYG_input",
			"modes": "uV2eYG_modes",
			"trailing": "uV2eYG_trailing",
			"primary": "uV2eYG_primary",
			"textRef": "uV2eYG_textRef",
			"chipLabel": "uV2eYG_chipLabel",
			"notice": "uV2eYG_notice",
			"select": "uV2eYG_select",
			"hero": "uV2eYG_hero",
			"hlSegment": "uV2eYG_hlSegment",
			"add": "uV2eYG_add",
			"attachments": "uV2eYG_attachments",
			"cardWorkspaceTrigger": "uV2eYG_cardWorkspaceTrigger",
			"tools": "uV2eYG_tools",
			"scroll": "uV2eYG_scroll",
			"noticeError": "uV2eYG_noticeError",
			"hint": "uV2eYG_hint",
			"row": "uV2eYG_row",
			"chipInvalid": "uV2eYG_chipInvalid",
			"pending": "uV2eYG_pending",
			"backdrop": "uV2eYG_backdrop",
			"input-pending": "uV2eYG_input-pending",
			"retry": "uV2eYG_retry"
		};
		//#endregion
		//#region lib/types/client/skeleton/InputBar.js
		/** The default composer body: the 'conversation.composer.bar' slot entry.
		* Machine state arrives through the standard provide channel
		* (useInput + inputActions); the keyboard/DOM command face and stop arrive
		* through this entry's own inject, whose hooks compartment binds
		* useNotices/useLexicon; layout-phase inputs (variant, placeholder,
		* region-slot content) ride the owner props. Session facts
		* (running/removed/promptError) are self-selected via useSession. */
		/** Decoration product of the no-session state (no machine, empty draft). */
		const INERT_DECORATIONS = {
			token: null,
			chips: [],
			textRefs: [],
			hint: null
		};
		function InputBar({ useSession, useInput, inputActions, keyboard, addImages, removeImage, draftImages, resolveSubmitMode, toggleCommandMenu, stop, command, t, renderSlot, useNotices, useLexicon, useMenuLauncher, useProjection, sessionId, variant, disabled: inert = false, blocked, workspacePickerOpen = false, onRequestWorkspace, placeholder, accessory, overlay, leftItems, rightItems, footer }) {
			const input = useInput((s) => s);
			const notice = useNotices((s) => s);
			const lexicon = useLexicon((s) => s);
			const commandMenuOpen = useMenuLauncher((source) => source === "command");
			const promptError = useSession((s) => s.promptError) ?? null;
			const running = useSession((s) => s.running) ?? false;
			const subagent = useSession((s) => s.subagent) ?? null;
			const removed = useSession((s) => s.removed) ?? false;
			const planActive = useProjection("plan", (plan) => plan !== void 0 && (plan.pending ? !plan.active : plan.active));
			const hasGoal = useProjection("goal", (goal) => goal != null);
			const live = input !== void 0 && keyboard !== void 0 && inputActions !== void 0;
			const draft = input?.draft ?? "";
			const attachments = (0, react.useMemo)(() => input === void 0 || draftImages === void 0 ? [] : draftImages(input.imageIds), [draftImages, input?.imageIds]);
			const empty = draft.trim() === "" && attachments.length === 0;
			const [preview, setPreview] = (0, react.useState)(null);
			const [dragActive, setDragActive] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeq = (0, react.useRef)(0);
			const showToast = (0, react.useCallback)((text) => {
				toastSeq.current += 1;
				setToast({
					seq: toastSeq.current,
					text
				});
			}, []);
			const dismissToast = (0, react.useCallback)(() => {
				setToast(null);
			}, []);
			const imageLimits = useProjection("imageLimits");
			(0, react.useEffect)(() => {
				if (promptError === null) return;
				showToast(promptError.error.code === "attachment-error" ? attachmentErrorText(t, promptError.error.details.reason, imageLimits) : `${promptError.error.message} (${promptError.error.code})`);
			}, [
				promptError,
				showToast,
				t,
				imageLimits
			]);
			const inputRef = (0, react.useRef)(null);
			const cardRef = (0, react.useRef)(null);
			const dragDepthRef = (0, react.useRef)(0);
			const scrollRef = (0, react.useRef)(null);
			const mirrorRef = (0, react.useRef)(null);
			const composingRef = (0, react.useRef)(false);
			const onCompositionStart = () => {
				composingRef.current = true;
			};
			const onCompositionEnd = () => {
				setTimeout(() => {
					composingRef.current = false;
				}, 10);
			};
			const permissions = useProjection("permissions");
			const continuable = subagent?.address.mode === "continuable";
			const parentOffline = continuable && !subagent.parentAvailable;
			const disabled = removed || inert || !live || blocked !== void 0 || parentOffline;
			const locked = disabled;
			const modelSeatLocked = removed || inert || !live;
			const machineBusy = input?.phase === "adjudicating" || input?.phase === "submitting";
			const workspaceTrigger = inert && !removed && onRequestWorkspace !== void 0;
			const textareaDisabled = removed || locked && !workspaceTrigger;
			const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && subagent === null && input.queue.some((row) => row.placement === "queued");
			(0, react.useEffect)(() => {
				if (input === void 0 || inputActions === void 0) return;
				if (attachments.length !== input.imageIds.length) inputActions.pruneImages(attachments.map((attachment) => attachment.id));
			}, [
				attachments,
				input?.imageIds,
				inputActions
			]);
			(0, react.useEffect)(() => {
				if (preview !== null && !attachments.some((attachment) => attachment.id === preview.id)) setPreview(null);
			}, [attachments, preview]);
			const revealCaret = (caret) => {
				const scrollEl = scrollRef.current;
				const mirrorEl = mirrorRef.current;
				const text = mirrorEl?.firstChild;
				if (scrollEl === null || mirrorEl === null || !(text instanceof Text)) return;
				if (scrollEl.scrollHeight <= scrollEl.clientHeight) return;
				const at = Math.min(caret, text.data.length);
				const afterNewline = at > 0 && text.data[at - 1] === "\n";
				const range = document.createRange();
				range.setStart(text, afterNewline ? at - 1 : at);
				if (afterNewline) range.setEnd(text, at);
				else range.collapse(true);
				const line = afterNewline ? Number.parseFloat(getComputedStyle(mirrorEl).lineHeight) : 0;
				const rect = range.getBoundingClientRect();
				const box = scrollEl.getBoundingClientRect();
				if (rect.bottom + line > box.bottom) scrollEl.scrollTop += rect.bottom + line - box.bottom;
				else if (rect.top + line < box.top) scrollEl.scrollTop -= box.top - rect.top - line;
			};
			const revealSelectionFocus = (el) => {
				revealCaret((el.selectionDirection === "backward" ? el.selectionStart : el.selectionEnd) ?? el.value.length);
			};
			(0, react.useEffect)(() => {
				const el = inputRef.current;
				if (locked || el === null) return;
				el.focus({ preventScroll: true });
				revealSelectionFocus(el);
			}, [locked, sessionId]);
			(0, react.useEffect)(() => {
				const el = inputRef.current;
				if (locked || draft === "" || el === null) return;
				revealSelectionFocus(el);
			}, [draft !== ""]);
			const restoreCaret = (el, caret) => {
				requestAnimationFrame(() => {
					el.setSelectionRange(caret, caret);
					revealCaret(caret);
				});
			};
			(0, react.useEffect)(() => {
				const el = scrollRef.current;
				if (el === null) return;
				const onWheel = (e) => {
					const host = el.closest("[data-conversation-scroll]");
					if (!(host instanceof HTMLElement) || e.deltaY === 0) return;
					const atTop = el.scrollTop <= 0;
					const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
					if (e.deltaY < 0 && !atTop || e.deltaY > 0 && !atEnd) return;
					e.preventDefault();
					host.scrollTop += e.deltaY;
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					el.removeEventListener("wheel", onWheel);
				};
			}, []);
			const onKeyDown = (e) => {
				if (workspaceTrigger) {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onRequestWorkspace();
					}
					return;
				}
				if (keyboard === void 0 || inputActions === void 0) return;
				if (e.key === "Enter" && e.shiftKey) return;
				const composing = composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
				if (e.key === "ArrowUp" || e.key === "ArrowDown") {
					if (keyboard.arbitrate(e.key === "ArrowUp" ? "up" : "down", composing) === "consumed") e.preventDefault();
					return;
				}
				if (e.key === "Escape") {
					keyboard.dismissPopup();
					if (keyboard.arbitrate("escape", composing) === "consumed") e.preventDefault();
					return;
				}
				if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
					e.preventDefault();
					if (machineBusy || locked) return;
					if (e.key === "y" || e.shiftKey) keyboard.redo();
					else keyboard.undo();
					return;
				}
				if (e.key === " ") {
					if (composing) return;
					if (keyboard.space()) e.preventDefault();
					return;
				}
				if (e.key !== "Enter") return;
				if (composing) return;
				if (keyboard.arbitrate("enter", composing) !== "pass") {
					e.preventDefault();
					return;
				}
				e.preventDefault();
				if (e.repeat) return;
				if (locked || machineBusy) return;
				const accelerated = e.ctrlKey || e.metaKey;
				if (accelerated && canSteerQueue) {
					keyboard.steerQueue();
					return;
				}
				keyboard.submit(resolveSubmitMode(running, accelerated ? "accelerated" : "enter", subagent === null));
			};
			const onChange = (e) => {
				if (keyboard === void 0 || locked) return;
				if (machineBusy) return;
				const next = e.target.value;
				keyboard.setDraft(next);
				keyboard.track(next, e.target.selectionStart ?? next.length);
			};
			const selectionOf = (el) => ({
				start: el.selectionStart ?? 0,
				end: el.selectionEnd ?? el.selectionStart ?? 0
			});
			const onCopyOrCut = (e, cut) => {
				if (input === void 0 || keyboard === void 0) return;
				const el = e.currentTarget;
				const { start, end } = selectionOf(el);
				if (start === end) return;
				draft.slice(start, end);
				const touched = input.occurrences.filter((o) => o.offset >= start && o.offset < end);
				if (touched.length === 0 && !cut) return;
				e.preventDefault();
				let text = "";
				let cursor = start;
				for (const o of touched) {
					text += draft.slice(cursor, o.offset) + o.clipboardText;
					cursor = o.offset + 1;
				}
				text += draft.slice(cursor, end);
				e.clipboardData.setData("text/plain", text);
				if (cut && !machineBusy && !locked) {
					keyboard.setDraft(draft.slice(0, start) + draft.slice(end), {
						start,
						end,
						insertedLength: 0
					});
					restoreCaret(el, start);
				}
			};
			const onPaste = (e) => {
				if (keyboard === void 0) return;
				if (machineBusy || locked) return;
				const files = Array.from(e.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file) => file !== null);
				if (files.length > 0) intakeImages(files);
				const text = e.clipboardData.getData("text/plain");
				if (text === "") {
					if (files.length > 0) e.preventDefault();
					return;
				}
				e.preventDefault();
				const el = e.currentTarget;
				const sel = selectionOf(el);
				keyboard.pasteBegin(text, sel);
				const caret = sel.start + text.length;
				restoreCaret(el, caret);
				keyboard.track(keyboard.snapshot.draft, caret);
			};
			const intakeImages = (0, react.useCallback)((files) => {
				if (addImages === void 0 || files.length === 0) return;
				const rejected = (() => {
					if (imageLimits !== void 0) {
						if (files.some((file) => !imageLimits.mediaTypes.includes(file.type))) return addImages(files);
						if (attachments.length + files.length > imageLimits.maxImagesPerMessage) return t("image.tooMany", { count: imageLimits.maxImagesPerMessage });
						if (files.some((file) => file.size > imageLimits.maxImageBytes)) return t("image.fileTooLarge", { size: imageSizeText(imageLimits.maxImageBytes) });
						if (attachments.reduce((sum, attachment) => sum + attachment.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > imageLimits.maxMessageImageBytes) return t("image.totalTooLarge", { size: imageSizeText(imageLimits.maxMessageImageBytes) });
					}
					return addImages(files);
				})();
				if (rejected !== null) showToast(rejected);
			}, [
				addImages,
				attachments,
				imageLimits,
				showToast,
				t
			]);
			const canAcceptDrop = !locked && !machineBusy && addImages !== void 0;
			(0, react.useEffect)(() => {
				const hasFiles = (event) => event.dataTransfer?.types.includes("Files") ?? false;
				const reset = () => {
					dragDepthRef.current = 0;
					setDragActive(false);
				};
				const onDragEnter = (event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					dragDepthRef.current += 1;
					setDragActive(true);
				};
				const onDragOver = (event) => {
					if (!hasFiles(event) || event.dataTransfer === null) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = canAcceptDrop ? "copy" : "none";
				};
				const onDragLeave = (event) => {
					if (!hasFiles(event)) return;
					dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
					if (dragDepthRef.current === 0) setDragActive(false);
					const leavingViewport = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
					if ((event.target === document.documentElement || event.target === document.body) && leavingViewport) reset();
				};
				const onDrop = (event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					reset();
					if (!canAcceptDrop) return;
					intakeImages([...event.dataTransfer?.files ?? []]);
				};
				document.addEventListener("dragenter", onDragEnter);
				document.addEventListener("dragover", onDragOver);
				document.addEventListener("dragleave", onDragLeave);
				document.addEventListener("drop", onDrop);
				window.addEventListener("dragend", reset);
				return () => {
					document.removeEventListener("dragenter", onDragEnter);
					document.removeEventListener("dragover", onDragOver);
					document.removeEventListener("dragleave", onDragLeave);
					document.removeEventListener("drop", onDrop);
					window.removeEventListener("dragend", reset);
				};
			}, [canAcceptDrop, intakeImages]);
			const closePreview = (0, react.useCallback)(() => {
				setPreview(null);
			}, []);
			const railItems = (0, react.useMemo)(() => attachments.map((attachment) => ({
				id: attachment.id,
				previewUrl: attachment.previewUrl,
				alt: attachment.file.name || t("image.pending"),
				removeLabel: t("image.remove", { name: attachment.file.name }),
				attachment
			})), [attachments, t]);
			const onSelect = (e) => {
				if (keyboard !== void 0 && keyboard.snapshot.paste !== void 0) keyboard.invalidatePaste();
			};
			const keepFocus = (e) => {
				e.preventDefault();
				inputRef.current?.focus({ preventScroll: true });
			};
			const onToggleCommandMenu = () => {
				const el = inputRef.current;
				if (el !== null) toggleCommandMenu?.(selectionOf(el));
			};
			const primaryStops = running && subagent === null;
			const interruptible = running && continuable;
			const primaryLabel = primaryStops ? t("input.stop") : t("input.send");
			const onPrimary = () => {
				if (primaryStops) {
					stop?.();
					return;
				}
				if (inputActions === void 0) return;
				/* v8 ignore next -- defensive: the primary button is disabled while empty||disabled, so a click cannot reach the false arm. */
				if (!empty && !disabled && !machineBusy) inputActions.submit();
			};
			const accessSelect = command === void 0 ? null : (0, react_jsx_runtime.jsx)(PermissionSelect, {
				value: permissions,
				locked,
				command,
				t
			}, sessionId);
			const deco = input === void 0 ? INERT_DECORATIONS : deriveDecorations(input, lexicon);
			const backdrop = [];
			{
				let cursor = 0;
				const pushPlain = (upTo) => {
					if (upTo > cursor) backdrop.push(draft.slice(cursor, upTo));
					cursor = upTo;
				};
				if (deco.token !== null) {
					backdrop.push((0, react_jsx_runtime.jsx)("mark", {
						className: InputBar_module_css_default.hlToken,
						"data-decoration": "token",
						children: draft.slice(deco.token.start, deco.token.end)
					}, "token"));
					cursor = deco.token.end;
				}
				const boundaries = [...deco.chips.map((chip) => ({
					at: chip.offset,
					kind: "chip",
					chip
				})), ...deco.textRefs.map((ref) => ({
					at: ref.start,
					kind: "text-ref",
					ref
				}))].sort((a, b) => a.at - b.at);
				for (const b of boundaries) {
					if (b.at < cursor) continue;
					pushPlain(b.at);
					if (b.kind === "chip") {
						const chip = b.chip;
						backdrop.push((0, react_jsx_runtime.jsx)("span", {
							className: clsx(InputBar_module_css_default.chip, chip.invalid && InputBar_module_css_default.chipInvalid),
							"data-decoration": "chip",
							"data-occurrence": chip.occurrenceId,
							"data-invalid": chip.invalid || void 0,
							title: chip.label,
							children: (0, react_jsx_runtime.jsx)("span", {
								className: InputBar_module_css_default.chipLabel,
								children: chip.label
							})
						}, `chip-${chip.occurrenceId}`));
						cursor = chip.offset + 1;
					} else {
						backdrop.push((0, react_jsx_runtime.jsx)("mark", {
							className: InputBar_module_css_default.textRef,
							"data-decoration": "text-ref",
							children: draft.slice(b.ref.start, b.ref.end)
						}, `ref-${b.ref.start}`));
						cursor = b.ref.end;
					}
				}
				pushPlain(draft.length);
				if (deco.hint !== null) {
					const commandName = input?.claim?.token.slice(1).trim() ?? "";
					const hintKey = `hint.${commandName === "goal" && hasGoal ? "goal.active" : commandName}`;
					const translated = t(hintKey);
					const displayHint = translated !== hintKey ? translated : deco.hint;
					backdrop.push((0, react_jsx_runtime.jsx)("span", {
						className: InputBar_module_css_default.hint,
						"data-decoration": "hint",
						children: displayHint
					}, "hint"));
				}
			}
			return (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(InputBar_module_css_default.root, variant === "hero" && InputBar_module_css_default.hero),
				children: [
					dragActive && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_attachment.DropOverlay, {
						disabled: !canAcceptDrop,
						labels: dropOverlayLabels(t, canAcceptDrop, imageLimits === void 0 ? void 0 : {
							count: imageLimits.maxImagesPerMessage,
							size: imageSizeText(imageLimits.maxImageBytes)
						})
					}),
					toast !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {}),
						anchor: cardRef.current,
						onDone: dismissToast
					}, toast.seq),
					notice !== null && (0, react_jsx_runtime.jsx)("div", {
						className: clsx(InputBar_module_css_default.notice, notice.level === "error" && InputBar_module_css_default.noticeError),
						role: "status",
						children: notice.text
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						ref: cardRef,
						className: clsx(InputBar_module_css_default.card, workspaceTrigger && InputBar_module_css_default.cardWorkspaceTrigger),
						"data-composer-card": true,
						onClick: workspaceTrigger ? onRequestWorkspace : void 0,
						onPointerDown: workspaceTrigger ? (e) => {
							e.stopPropagation();
						} : void 0,
						children: [
							overlay !== void 0 && (0, react_jsx_runtime.jsx)("div", {
								className: InputBar_module_css_default.overlayAnchor,
								children: overlay
							}),
							accessory !== void 0 && (0, react_jsx_runtime.jsx)("div", {
								className: InputBar_module_css_default.accessory,
								children: accessory
							}),
							railItems.length > 0 && (0, react_jsx_runtime.jsx)("div", {
								className: InputBar_module_css_default.attachments,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_attachment.AttachmentRail, {
									items: railItems,
									labels: attachmentRailLabels(t),
									onOpen: (item) => {
										setPreview(item.attachment);
									},
									onRemove: (item) => {
										removeImage?.(item.attachment.id);
									}
								})
							}),
							(0, react_jsx_runtime.jsx)("div", {
								ref: scrollRef,
								className: InputBar_module_css_default.scroll,
								"data-input-scroll": true,
								children: (0, react_jsx_runtime.jsxs)("div", {
									className: InputBar_module_css_default.grow,
									children: [
										(0, react_jsx_runtime.jsx)("div", {
											"aria-hidden": true,
											className: InputBar_module_css_default.backdrop,
											"data-input-backdrop": true,
											children: backdrop
										}),
										(0, react_jsx_runtime.jsx)("textarea", {
											ref: inputRef,
											className: InputBar_module_css_default.input,
											value: draft,
											disabled: textareaDisabled,
											readOnly: machineBusy || workspaceTrigger,
											"aria-label": workspaceTrigger ? t("hero.chooseWorkspace") : void 0,
											"aria-haspopup": workspaceTrigger ? "menu" : void 0,
											"aria-expanded": workspaceTrigger ? workspacePickerOpen : void 0,
											"data-phase": input?.phase ?? "inert",
											placeholder: placeholder ?? (parentOffline ? t("placeholder.parentOffline") : disabled ? t("placeholder.unavailable") : canSteerQueue ? t("placeholder.steerQueue") : planActive ? t("placeholder.plan") : t("placeholder.default")),
											rows: 2,
											onChange,
											onKeyDown,
											onSelect,
											onCopy: (e) => {
												onCopyOrCut(e, false);
											},
											onCut: (e) => {
												onCopyOrCut(e, true);
											},
											onPaste,
											onCompositionStart,
											onCompositionEnd
										}),
										(0, react_jsx_runtime.jsx)("div", {
											ref: mirrorRef,
											"aria-hidden": true,
											className: InputBar_module_css_default.mirror,
											"data-input-mirror": true,
											children: `${draft}\n`
										})
									]
								})
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: InputBar_module_css_default.row,
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: InputBar_module_css_default.tools,
									children: [
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("input.commands"),
											side: "top",
											delayMs: 500,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: InputBar_module_css_default.add,
												"aria-label": t("input.commands"),
												"aria-haspopup": "listbox",
												"aria-expanded": commandMenuOpen,
												disabled: locked || toggleCommandMenu === void 0,
												onMouseDown: keepFocus,
												onClick: onToggleCommandMenu,
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 })
											})
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: InputBar_module_css_default.modes,
											children: [accessSelect, renderSlot("conversation.input.plan", { locked })]
										}),
										leftItems
									]
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: InputBar_module_css_default.trailing,
									children: [
										rightItems,
										renderSlot("conversation.input.model", { locked: modelSeatLocked }),
										(0, react_jsx_runtime.jsx)(ContextMeter, {
											useProjection,
											t
										}),
										interruptible && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("input.stop"),
											side: "top",
											delayMs: 500,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: InputBar_module_css_default.primary,
												"aria-label": t("input.stop"),
												disabled: stop === void 0,
												onMouseDown: keepFocus,
												onClick: stop,
												children: (0, react_jsx_runtime.jsx)("svg", {
													viewBox: "0 0 16 16",
													width: "16",
													height: "16",
													"aria-hidden": true,
													children: (0, react_jsx_runtime.jsx)("rect", {
														x: "3",
														y: "3",
														width: "10",
														height: "10",
														rx: "3",
														fill: "currentColor"
													})
												})
											})
										}),
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: primaryLabel,
											side: "top",
											delayMs: 500,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: InputBar_module_css_default.primary,
												"aria-label": primaryLabel,
												disabled: primaryStops ? stop === void 0 : empty || disabled || machineBusy,
												onMouseDown: keepFocus,
												onClick: onPrimary,
												children: primaryStops ? (0, react_jsx_runtime.jsx)("svg", {
													viewBox: "0 0 16 16",
													width: "16",
													height: "16",
													"aria-hidden": true,
													children: (0, react_jsx_runtime.jsx)("rect", {
														x: "3",
														y: "3",
														width: "10",
														height: "10",
														rx: "3",
														fill: "currentColor"
													})
												}) : (0, react_jsx_runtime.jsx)("svg", {
													viewBox: "0 0 16 16",
													width: "16",
													height: "16",
													"aria-hidden": true,
													children: (0, react_jsx_runtime.jsx)("path", {
														d: "M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z",
														fill: "currentColor"
													})
												})
											})
										})
									]
								})]
							})
						]
					}),
					preview !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_attachment.ImageLightbox, {
						src: preview.previewUrl,
						alt: preview.file.name || t("image.original"),
						labels: lightboxLabels(t),
						onClose: closePreview
					}),
					footer
				]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.module.css.mjs
		const css$16 = ".T1PP_q_row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}.T1PP_q_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.T1PP_q_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.T1PP_q_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.T1PP_q_selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}.T1PP_q_selector:hover{background:var(--dsw-alias-interactive-bg-hover)}.T1PP_q_chevron{flex:none}";
		const tagId$16 = "@deepseek-ai/dsh-client-ui-conversation/EnterBehaviorRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$16) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$16;
			tag.textContent = css$16;
			document.head.appendChild(tag);
		}
		var EnterBehaviorRow_module_css_default = {
			"row": "T1PP_q_row",
			"rowText": "T1PP_q_rowText",
			"chevron": "T1PP_q_chevron",
			"desc": "T1PP_q_desc",
			"selector": "T1PP_q_selector",
			"title": "T1PP_q_title"
		};
		//#endregion
		//#region lib/types/client/settings/EnterBehaviorRow.js
		/** General Settings row for the Composer's busy-state Enter preference. */
		const OPTIONS = [{
			id: "queue",
			label: "settings.enter.queue"
		}, {
			id: "steer",
			label: "settings.enter.steer"
		}];
		/**
		* Render the busy-state Enter behavior selector.
		* @param props - composed Settings slot props.
		* @returns the preference row.
		*/
		function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }) {
			const behavior = useBusyEnter((value) => value);
			const [open, setOpen] = (0, react.useState)(false);
			const selectedLabel = behavior === "queue" ? "settings.enter.queue" : "settings.enter.steer";
			return (0, react_jsx_runtime.jsxs)("div", {
				className: EnterBehaviorRow_module_css_default.row,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: EnterBehaviorRow_module_css_default.rowText,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: EnterBehaviorRow_module_css_default.title,
						children: t("settings.enter.title")
					}), (0, react_jsx_runtime.jsx)("div", {
						className: EnterBehaviorRow_module_css_default.desc,
						children: t("settings.enter.description")
					})]
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open,
					onClose: () => {
						setOpen(false);
					},
					items: OPTIONS.map((option) => ({
						id: option.id,
						label: t(option.label)
					})),
					selectedId: behavior,
					onSelect: (id) => {
						setOpen(false);
						setBusyEnter(id);
					},
					align: "end",
					portal: true,
					anchor: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: EnterBehaviorRow_module_css_default.selector,
						"aria-haspopup": "menu",
						"aria-expanded": open,
						onClick: () => {
							setOpen((value) => !value);
						},
						children: [t(selectedLabel), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: EnterBehaviorRow_module_css_default.chevron })]
					})
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/MessageItem.module.css.mjs
		const css$15 = ".gdEzaW_userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}.gdEzaW_userStack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}.gdEzaW_bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px}.gdEzaW_contextRow,.gdEzaW_compactionRow{padding:2px 0}.gdEzaW_compactionButton{width:100%;min-width:0;height:24px;color:inherit;font:inherit;text-align:left;background:0 0;border:none;border-radius:6px;align-items:center;padding:0;display:flex}.gdEzaW_compactionButton:not(:disabled){cursor:pointer}.gdEzaW_compactionButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}.gdEzaW_compactionLeading{width:16px;height:16px;color:var(--dsw-alias-label-secondary);flex:none;place-items:center;margin-right:6px;display:inline-grid}.gdEzaW_compactionContextIcon,.gdEzaW_compactionDisclosureIcon{grid-area:1/1;justify-content:center;align-items:center;display:inline-flex}.gdEzaW_compactionDisclosureIcon,.gdEzaW_compactionButton:not(:disabled):hover .gdEzaW_compactionContextIcon,.gdEzaW_compactionButton:not(:disabled):focus-visible .gdEzaW_compactionContextIcon{opacity:0}.gdEzaW_compactionButton:not(:disabled):hover .gdEzaW_compactionDisclosureIcon,.gdEzaW_compactionButton:not(:disabled):focus-visible .gdEzaW_compactionDisclosureIcon{opacity:1}.gdEzaW_compactionTitle{color:var(--dsw-alias-label-primary-dimmed);flex:none;font-size:14px;line-height:24px}.gdEzaW_compactionSep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.gdEzaW_compactionSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.gdEzaW_compactionBody{color:var(--dsw-alias-label-tertiary);padding:4px 0 4px 22px;font-size:14px;line-height:24px}.gdEzaW_retryRow{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.gdEzaW_retrySummary{width:fit-content;color:inherit;cursor:pointer;user-select:none;border-radius:3px;align-items:center;gap:7px;padding:2px 0;list-style:none;display:inline-flex}.gdEzaW_retrySummary::-webkit-details-marker{display:none}.gdEzaW_retrySummary:after{content:\"\";opacity:.8;border-bottom:1.5px solid;border-right:1.5px solid;width:6px;height:6px;transition:transform .12s;transform:rotate(-45deg)}.gdEzaW_retrySummary:hover{color:var(--dsw-alias-label-secondary)}.gdEzaW_retrySummary:focus-visible{outline:1.5px solid var(--dsw-alias-button-info-fill);outline-offset:2px}.gdEzaW_retryText{color:inherit}.gdEzaW_retryRow[data-active] .gdEzaW_retryText{background:linear-gradient(90deg, var(--dsw-alias-label-tertiary) 0%, var(--dsw-alias-label-tertiary) 40%, var(--dsw-alias-label-secondary) 50%, var(--dsw-alias-label-tertiary) 60%, var(--dsw-alias-label-tertiary) 100%);color:#0000;background-position:100%;background-size:200% 100%;background-clip:text;animation:1.6s ease-in-out infinite gdEzaW_retry-shimmer}.gdEzaW_retryRow[open] .gdEzaW_retrySummary:after{transform:rotate(45deg)}.gdEzaW_retryDetails{overflow-wrap:anywhere;gap:2px;margin-top:3px;padding-left:14px;font-size:12px;line-height:18px;display:grid}.gdEzaW_retryDetailLabel{color:var(--dsw-alias-label-secondary)}.gdEzaW_turnErrorRow{grid-template-columns:10px minmax(0,1fr) auto;align-items:start;gap:8px;padding:2px 0;font-size:13px;line-height:20px;display:grid}.gdEzaW_turnErrorDot{margin-top:5px}.gdEzaW_turnErrorCopy{overflow-wrap:anywhere;min-width:0}.gdEzaW_turnErrorTitle{color:var(--dsw-alias-state-error-primary);margin-right:6px;font-weight:600}.gdEzaW_turnErrorMessage{color:var(--dsw-alias-label-secondary)}.gdEzaW_turnErrorCode{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block-small)}.gdEzaW_maxTokensTitle{color:var(--dsw-alias-state-warn-primary);margin-right:6px;font-weight:600}@keyframes gdEzaW_retry-shimmer{0%{background-position:100%}to{background-position:0}}@media (prefers-reduced-motion:reduce){.gdEzaW_retryRow[data-active] .gdEzaW_retryText{color:inherit;background:0 0;animation:none}}.gdEzaW_refChip{color:var(--dsw-alias-label-primary);white-space:nowrap;vertical-align:baseline;background:#6187d838;border-radius:6px;margin:0 2px;padding:0 8px;font-size:.85em;line-height:1.6;display:inline-block}";
		const tagId$15 = "@deepseek-ai/dsh-client-ui-conversation/MessageItem.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$15) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$15;
			tag.textContent = css$15;
			document.head.appendChild(tag);
		}
		var MessageItem_module_css_default = {
			"turnErrorRow": "gdEzaW_turnErrorRow",
			"turnErrorCode": "gdEzaW_turnErrorCode",
			"retryRow": "gdEzaW_retryRow",
			"turnErrorMessage": "gdEzaW_turnErrorMessage",
			"compactionTitle": "gdEzaW_compactionTitle",
			"contextRow": "gdEzaW_contextRow",
			"compactionSep": "gdEzaW_compactionSep",
			"turnErrorCopy": "gdEzaW_turnErrorCopy",
			"turnErrorTitle": "gdEzaW_turnErrorTitle",
			"userRow": "gdEzaW_userRow",
			"maxTokensTitle": "gdEzaW_maxTokensTitle",
			"bubble": "gdEzaW_bubble",
			"turnErrorDot": "gdEzaW_turnErrorDot",
			"retry-shimmer": "gdEzaW_retry-shimmer",
			"refChip": "gdEzaW_refChip",
			"compactionDisclosureIcon": "gdEzaW_compactionDisclosureIcon",
			"compactionButton": "gdEzaW_compactionButton",
			"compactionBody": "gdEzaW_compactionBody",
			"retryText": "gdEzaW_retryText",
			"compactionSummary": "gdEzaW_compactionSummary",
			"compactionContextIcon": "gdEzaW_compactionContextIcon",
			"compactionRow": "gdEzaW_compactionRow",
			"retryDetails": "gdEzaW_retryDetails",
			"retrySummary": "gdEzaW_retrySummary",
			"userStack": "gdEzaW_userStack",
			"compactionLeading": "gdEzaW_compactionLeading",
			"retryDetailLabel": "gdEzaW_retryDetailLabel"
		};
		//#endregion
		//#region lib/types/client/chat/CompactionItem.js
		/**
		* The collapsed-by-default compaction marker.
		* @param props - the marker node off the snapshot cache.
		* @returns the marker row, with the summary disclosure when one is available.
		*/
		const CompactionItem = (0, react.memo)(function CompactionItem({ node, title, fallbackSummary, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const expandable = node.summary !== null;
			const open = expandable && expanded;
			const summary = node.shadowedItemCount !== null && node.shadowedTokenCount !== null ? t("message.compaction.completed", {
				items: node.shadowedItemCount,
				tokens: node.shadowedTokenCount
			}) : fallbackSummary ?? (expandable ? t("message.compaction.expand") : t("message.compaction.unavailable"));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MessageItem_module_css_default.compactionRow,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: MessageItem_module_css_default.compactionButton,
					disabled: !expandable,
					"aria-expanded": expandable ? open : void 0,
					onClick: () => {
						setExpanded((value) => !value);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							className: MessageItem_module_css_default.compactionLeading,
							"aria-hidden": true,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: MessageItem_module_css_default.compactionContextIcon,
								"data-compaction-icon": "context",
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, {})
							}), (0, react_jsx_runtime.jsx)("span", {
								className: MessageItem_module_css_default.compactionDisclosureIcon,
								"data-compaction-disclosure": open ? "expanded" : "collapsed",
								children: open ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {})
							})]
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.compactionTitle,
							children: title ?? t("message.compaction")
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.compactionSep,
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.compactionSummary,
							children: summary
						})
					]
				}), open && node.summary !== null && (0, react_jsx_runtime.jsx)("div", {
					className: MessageItem_module_css_default.compactionBody,
					children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: node.summary })
				})]
			});
		});
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/ContextBody.module.css.mjs
		const css$14 = ".NM4-hq_text{color:var(--dsw-alias-label-secondary);font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.NM4-hq_fields{border-top:1px solid var(--dsw-alias-line-secondary);flex-direction:column;gap:2px;margin:8px 0 0;padding-top:8px;display:flex}.NM4-hq_field{gap:8px;min-width:0;display:flex}.NM4-hq_fieldKey{min-width:96px;color:var(--dsw-alias-label-caption);flex:none}.NM4-hq_fieldValue{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:auto;margin:0}.NM4-hq_files{flex-wrap:wrap;gap:4px 12px;margin:0 0 8px;padding:0;list-style:none;display:flex}.NM4-hq_file{align-items:baseline;gap:6px;min-width:0;display:flex}.NM4-hq_filePath{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.NM4-hq_fileAction{color:var(--dsw-alias-label-caption)}.NM4-hq_catalogNotice{color:var(--dsw-alias-label-caption);margin:0 0 6px}.NM4-hq_entries{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}.NM4-hq_entry{gap:8px;min-width:0;display:flex}.NM4-hq_entryName{color:var(--dsw-alias-label-secondary);flex:none}.NM4-hq_entryDescription{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}.NM4-hq_sections{flex-direction:column;gap:8px;margin:0;display:flex}.NM4-hq_section{flex-direction:column;gap:2px;min-width:0;display:flex}.NM4-hq_sectionName{color:var(--dsw-alias-label-caption)}.NM4-hq_sectionText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.NM4-hq_relaySender{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;margin:0 0 6px}.NM4-hq_recalls{flex-direction:column;gap:2px;margin:0 0 8px;padding:0;list-style:none;display:flex}.NM4-hq_recall{gap:8px;min-width:0;display:flex}.NM4-hq_recallLabel{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.NM4-hq_recallCounts{color:var(--dsw-alias-label-caption);flex:none}";
		const tagId$14 = "@deepseek-ai/dsh-client-ui-conversation/ContextBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$14) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$14;
			tag.textContent = css$14;
			document.head.appendChild(tag);
		}
		var ContextBody_module_css_default = {
			"field": "NM4-hq_field",
			"entryDescription": "NM4-hq_entryDescription",
			"files": "NM4-hq_files",
			"sections": "NM4-hq_sections",
			"fieldKey": "NM4-hq_fieldKey",
			"catalogNotice": "NM4-hq_catalogNotice",
			"fields": "NM4-hq_fields",
			"entry": "NM4-hq_entry",
			"sectionName": "NM4-hq_sectionName",
			"sectionText": "NM4-hq_sectionText",
			"recall": "NM4-hq_recall",
			"relaySender": "NM4-hq_relaySender",
			"recallLabel": "NM4-hq_recallLabel",
			"filePath": "NM4-hq_filePath",
			"entries": "NM4-hq_entries",
			"entryName": "NM4-hq_entryName",
			"fileAction": "NM4-hq_fileAction",
			"file": "NM4-hq_file",
			"section": "NM4-hq_section",
			"text": "NM4-hq_text",
			"recalls": "NM4-hq_recalls",
			"recallCounts": "NM4-hq_recallCounts",
			"fieldValue": "NM4-hq_fieldValue"
		};
		//#endregion
		//#region lib/types/client/chat/ContextBody.js
		/** Model-facing text stays bounded at the disclosure, not at the producer. */
		const MAX_CHARS = 2e4;
		/** Rows a list body materializes before summarizing the remainder. */
		const MAX_ENTRIES = 200;
		/** One durable source narrowed to the readable-record shape; null for anything else. */
		function asRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/**
		* The content blocks as runs, IN THE ORDER the model received them.
		*
		* Adjacent text blocks join with no separator, matching how provider adapters
		* flatten them — inserting a line break would show the reader a line the model
		* never saw. An unknown block breaks the run and keeps its own fallback rather
		* than being hoisted past the text around it or vanishing; the block union is
		* merge-extensible, so a foreign log may interleave shapes this build does not
		* know.
		*/
		function contentRuns(content) {
			const runs = [];
			for (const block of content) {
				if (block.type !== "text") {
					runs.push({ block });
					continue;
				}
				const last = runs[runs.length - 1];
				if (last !== void 0 && "text" in last) last.text += block.text;
				else runs.push({ text: block.text });
			}
			return runs;
		}
		/** Only the blocks this UI version does not know, for bodies that replace the text. */
		function unknownBlocks(content) {
			return contentRuns(content).flatMap((run) => "block" in run ? [run.block] : []);
		}
		/** The model-facing text, truncated to the display bound. */
		function boundedText(text, t) {
			return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n${t("json.truncated", { total: text.length })}` : text;
		}
		/**
		* One source field rendered as a value row; nested shapes stay compact JSON.
		* Bounded on its own, because source fields are as unbounded as the text: an unknown
		* producer may record an arbitrarily large string or array.
		*/
		function fieldValue(value, t) {
			return boundedText(typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value), t);
		}
		/**
		* Source fields as a key/value list. `kind` is always omitted because the
		* row header already names the producer. `form` is omitted only when a
		* dedicated body rendered for it — then the presentation the reader is looking
		* at IS that value. On the opaque fallback the declaration is kept, because
		* that is the one place a form this version cannot present would otherwise
		* disappear from the UI entirely.
		*/
		function SourceFields({ source, formRendered, t }) {
			const record = asRecord(source);
			if (record === null) return null;
			const hidden = formRendered ? ["kind", "form"] : ["kind"];
			const rows = Object.entries(record).filter(([key]) => !hidden.includes(key));
			if (rows.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("dl", {
				className: ContextBody_module_css_default.fields,
				"data-context-fields": true,
				children: rows.map(([key, value]) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextBody_module_css_default.field,
					children: [(0, react_jsx_runtime.jsx)("dt", {
						className: ContextBody_module_css_default.fieldKey,
						children: key
					}), (0, react_jsx_runtime.jsx)("dd", {
						className: ContextBody_module_css_default.fieldValue,
						children: fieldValue(value, t)
					})]
				}, key))
			});
		}
		/**
		* Content blocks this UI version does not know, kept visible rather than
		* dropped: the block union is merge-extensible, so a newer or foreign log may
		* carry a shape this build has no presentation for.
		* @param props - The unrecognized blocks and the locale seat.
		* @returns One generic JSON block per unknown entry.
		*/
		function UnknownBlocks({ blocks, t }) {
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: blocks.map((block, index) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("message.unknownBlock"),
				payload: block,
				truncatedLabel: (total) => t("json.truncated", { total })
			}, index)) });
		}
		/**
		* The model-facing content of one context, shared by every form that shows it:
		* the text with its real line breaks, then any block this UI version does not
		* know, which keeps its own fallback rather than vanishing.
		* @param props - Durable content and the locale seat.
		* @returns The content blocks as the model received them.
		*/
		function ModelFacingContent({ content, t }) {
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: contentRuns(content).map((run, index) => "text" in run ? run.text !== "" && (0, react_jsx_runtime.jsx)("pre", {
				className: ContextBody_module_css_default.text,
				"data-context-text": true,
				children: boundedText(run.text, t)
			}, index) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("message.unknownBlock"),
				payload: run.block,
				truncatedLabel: (total) => t("json.truncated", { total })
			}, index)) });
		}
		/**
		* Default presentation: the model-facing text as text, with its real line
		* breaks, and the remaining source fields beneath it. This is what every form
		* this UI version does not recognize renders as.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The opaque context body.
		*/
		function OpaqueBody({ content, source, t }) {
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			}), (0, react_jsx_runtime.jsx)(SourceFields, {
				source,
				formRendered: false,
				t
			})] });
		}
		/**
		* Instruction changes read off the source, or null when the record is not a
		* usable instruction list.
		*
		* The read is all-or-nothing: silently dropping one unreadable entry would show
		* a confident, incomplete file list for a log this version cannot fully read.
		* Paths are deduplicated in first-seen order, matching how the header label is
		* derived from the same array.
		*/
		function instructionChanges(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["changes"];
			if (!Array.isArray(list)) return null;
			const changes = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of list) {
				const change = asRecord(entry);
				if (change === null) return null;
				const path = change["path"];
				if (typeof path !== "string" || path === "") return null;
				const action = change["action"];
				if (action !== "set" && action !== "replace" && action !== "remove") return null;
				const digest = change["digest"];
				if (seen.has(path)) continue;
				seen.add(path);
				changes.push({
					action,
					path,
					...typeof digest === "string" ? { digest } : {}
				});
			}
			return changes.length === 0 ? null : changes;
		}
		/**
		* Locale key for one reconciled file. The baseline loads a file; a later delta
		* distinguishes a newly reconciled path from a rewritten one, which `set` and
		* `replace` already separate at the producer.
		* @param action - the durable change action.
		* @param baseline - whether this context is the startup/resume baseline.
		* @returns the key naming what happened to that file.
		*/
		function instructionAction(action, baseline) {
			if (action === "remove") return "message.context.instructions.removed";
			if (baseline) return "message.context.instructions.loaded";
			return action === "set" ? "message.context.instructions.added" : "message.context.instructions.updated";
		}
		/**
		* `instructions` form: the files this context reconciled, then their text.
		*
		* The text keeps its `<system-reminder>` framing verbatim — the framing is part
		* of what the model read, so hiding it would misreport the request.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The instructions context body, or the opaque body when the change
		* list is unreadable.
		*/
		function InstructionsBody({ content, source, t }) {
			const changes = instructionChanges(source);
			if (changes === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const baseline = asRecord(source)?.["baseline"] === true;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("ul", {
				className: ContextBody_module_css_default.files,
				"data-context-files": true,
				children: changes.map((change) => (0, react_jsx_runtime.jsxs)("li", {
					className: ContextBody_module_css_default.file,
					title: change.digest,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ContextBody_module_css_default.filePath,
						children: change.path
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ContextBody_module_css_default.fileAction,
						children: t(instructionAction(change.action, baseline))
					})]
				}, change.path))
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/**
		* Catalog entries read off the source, or null when the record is not a usable
		* catalog. All-or-nothing for the same reason as the instruction list: this body
		* replaces the model-facing text, so a partial list would hide the only complete
		* account of what the model read.
		*/
		function catalogEntries(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["entries"];
			if (!Array.isArray(list)) return null;
			const entries = [];
			for (const item of list) {
				const entry = asRecord(item);
				if (entry === null) return null;
				const name = entry["name"];
				const description = entry["description"];
				if (typeof name !== "string" || name === "" || typeof description !== "string") return null;
				entries.push({
					name,
					description
				});
			}
			return entries;
		}
		/**
		* `catalog` form: the published entries as a list, read from the source rather
		* than re-parsed out of the model-facing prose.
		*
		* A catalog whose source carries no usable entries falls through to the opaque
		* body, so an older or hand-edited log still shows its text.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The catalog context body, or the opaque body when the entry list is
		* unreadable.
		*/
		function CatalogBody({ content, source, t }) {
			const entries = catalogEntries(source);
			if (entries === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const update = asRecord(source)?.["update"] === true;
			const shown = entries.slice(0, MAX_ENTRIES);
			const rest = unknownBlocks(content);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				update && (0, react_jsx_runtime.jsx)("p", {
					className: ContextBody_module_css_default.catalogNotice,
					"data-context-catalog-update": true,
					children: t("message.context.catalog.replaced")
				}),
				(0, react_jsx_runtime.jsx)("ul", {
					className: ContextBody_module_css_default.entries,
					"data-context-entries": true,
					children: shown.map((entry, index) => (0, react_jsx_runtime.jsxs)("li", {
						className: ContextBody_module_css_default.entry,
						children: [(0, react_jsx_runtime.jsx)("code", {
							className: ContextBody_module_css_default.entryName,
							children: entry.name
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.entryDescription,
							children: entry.description
						})]
					}, index))
				}),
				shown.length < entries.length && (0, react_jsx_runtime.jsx)("p", {
					className: ContextBody_module_css_default.catalogNotice,
					"data-context-entries-truncated": true,
					children: t("message.context.catalog.more", { count: entries.length - shown.length })
				}),
				(0, react_jsx_runtime.jsx)(UnknownBlocks, {
					blocks: rest,
					t
				})
			] });
		}
		/** Snapshot sections read off the source, or null when the record is unusable. */
		function snapshotSections(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["sections"];
			if (!Array.isArray(list)) return null;
			const sections = [];
			for (const item of list) {
				const section = asRecord(item);
				if (section === null) return null;
				const name = section["name"];
				const text = section["text"];
				if (typeof name !== "string" || name === "" || typeof text !== "string") return null;
				sections.push({
					name,
					text
				});
			}
			return sections.length === 0 ? null : sections;
		}
		/**
		* `snapshot` form: the named contributions this snapshot assembled, in order.
		*
		* The sections are the same bytes the model read, split at the boundaries the
		* producer assembled them on, so a reader sees which subsystem contributed
		* which state instead of one undifferentiated wall.
		*
		* One sentence of the model-facing text is NOT in any section: the producer's
		* framing line declaring that this snapshot supersedes earlier ones. Unlike the
		* `<system-reminder>` wrapper an instruction context carries — which wraps
		* content and cannot be separated from it — that line states the form's own
		* semantics, so the body states them as a caption instead of reprinting the
		* joined prose beside the sections it was split from.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The snapshot context body, or the opaque body when unreadable.
		*/
		function SnapshotBody({ content, source, t }) {
			const sections = snapshotSections(source);
			/* v8 ignore next -- contextBody reads the sections before choosing this body. */
			if (sections === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("p", {
				className: ContextBody_module_css_default.catalogNotice,
				"data-context-snapshot-supersedes": true,
				children: t("message.context.snapshot.supersedes")
			}), (0, react_jsx_runtime.jsx)("dl", {
				className: ContextBody_module_css_default.sections,
				"data-context-sections": true,
				children: sections.map((section, index) => (0, react_jsx_runtime.jsxs)("div", {
					className: ContextBody_module_css_default.section,
					children: [(0, react_jsx_runtime.jsx)("dt", {
						className: ContextBody_module_css_default.sectionName,
						children: section.name
					}), (0, react_jsx_runtime.jsx)("dd", {
						className: ContextBody_module_css_default.sectionText,
						children: boundedText(section.text, t)
					})]
				}, index))
			})] });
		}
		/**
		* `notice` form: what just happened, with the model-facing text beneath it.
		*
		* The one-line account also rides the collapsed row ({@link contextBody}), so a
		* notice is usually readable without expanding at all.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The notice context body.
		*/
		function NoticeBody({ content, t }) {
			return (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			});
		}
		/**
		* `relay` form: which agent sent this, then what it said.
		*
		* The sender is an opaque session id; it is shown as a field rather than a
		* label, because this client cannot resolve it to a title.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The relay context body.
		*/
		function RelayBody({ content, source, t }) {
			const sender = relaySender(source);
			/* v8 ignore next -- contextBody resolves the sender before choosing this body. */
			if (sender === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("p", {
				className: ContextBody_module_css_default.relaySender,
				"data-context-relay-sender": true,
				children: t("message.context.relay.from", { session: sender })
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** The sending agent's session id, or null when the record does not name one. */
		function relaySender(source) {
			const sender = asRecord(source)?.["senderSessionId"];
			return typeof sender === "string" && sender !== "" ? sender : null;
		}
		/** Recalled sessions read off the source, or null when the record is unusable. */
		function recalledSessions(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["references"];
			if (!Array.isArray(list)) return null;
			const sessions = [];
			for (const item of list) {
				const reference = asRecord(item);
				if (reference === null) return null;
				const label = reference["label"];
				const retained = reference["retainedMessages"];
				const omitted = reference["omittedMessages"];
				const truncated = reference["truncated"];
				if (typeof label !== "string" || label === "" || typeof retained !== "number" || typeof omitted !== "number" || typeof truncated !== "boolean") return null;
				sessions.push({
					label,
					retained,
					omitted,
					truncated
				});
			}
			return sessions.length === 0 ? null : sessions;
		}
		/**
		* `recall` form: which sessions this material came from and how much of each
		* survived the read, then the material itself.
		*
		* Completeness is the fact a reader needs first: recalled context is bounded on
		* the way in, so a card that hid the omitted count would overstate what the
		* model received.
		* @param props - Durable content, its source, and the locale seat.
		* @returns The recall context body, or the opaque body when unreadable.
		*/
		function RecallBody({ content, source, t }) {
			const sessions = recalledSessions(source);
			if (sessions === null) return (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("ul", {
				className: ContextBody_module_css_default.recalls,
				"data-context-recalls": true,
				children: sessions.map((session, index) => (0, react_jsx_runtime.jsxs)("li", {
					className: ContextBody_module_css_default.recall,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallLabel,
							children: session.label
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallCounts,
							children: t("message.context.recall.counts", {
								retained: session.retained,
								omitted: session.omitted
							})
						}),
						session.truncated && (0, react_jsx_runtime.jsx)("span", {
							className: ContextBody_module_css_default.recallCounts,
							children: t("message.context.recall.truncated")
						})
					]
				}, index))
			}), (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** The one-line account a `notice` puts on its collapsed row, when it records one. */
		function noticeSummary(source) {
			const summary = asRecord(source)?.["summary"];
			return typeof summary === "string" && summary !== "" ? summary : null;
		}
		/**
		* Choose the body for one context node.
		*
		* Returns the form the body actually rendered as, which is not always the
		* declared one: a declared form whose fields are unreadable falls back to
		* opaque, and the caller labels the row with what it really shows.
		* `summary` is the collapsed row's one-line account, which only a `notice`
		* records: its whole point is being readable without expanding.
		* @param form - the producer-declared form projected onto the node.
		* @param props - durable content, its source, and the locale seat.
		* @returns the rendered form (null for opaque), its collapsed summary, and its body.
		*/
		function contextBody(form, props) {
			const opaque = {
				rendered: null,
				summary: null,
				body: (0, react_jsx_runtime.jsx)(OpaqueBody, { ...props })
			};
			switch (form) {
				case "instructions": return instructionChanges(props.source) === null ? opaque : {
					rendered: "instructions",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(InstructionsBody, { ...props })
				};
				case "catalog": return catalogEntries(props.source) === null ? opaque : {
					rendered: "catalog",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(CatalogBody, { ...props })
				};
				case "snapshot": return snapshotSections(props.source) === null ? opaque : {
					rendered: "snapshot",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(SnapshotBody, { ...props })
				};
				case "notice": {
					const summary = noticeSummary(props.source);
					return summary === null ? opaque : {
						rendered: "notice",
						summary,
						body: (0, react_jsx_runtime.jsx)(NoticeBody, { ...props })
					};
				}
				case "relay": return relaySender(props.source) === null ? opaque : {
					rendered: "relay",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(RelayBody, { ...props })
				};
				case "recall": return recalledSessions(props.source) === null ? opaque : {
					rendered: "recall",
					summary: null,
					body: (0, react_jsx_runtime.jsx)(RecallBody, { ...props })
				};
				case null: return opaque;
				/* v8 ignore next 4 -- closed-union backstop; the compiler rejects a new
				KnownContextForm here rather than letting it degrade to opaque silently. */
				default: throw new Error(`unreachable context form: ${String(form)}`);
			}
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/ContextInjectionRow.module.css.mjs
		const css$13 = ".pC0e7a_root{min-width:0}.pC0e7a_root[data-open]{padding-bottom:4px}.pC0e7a_chevron{color:var(--dsw-alias-label-secondary)}.pC0e7a_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.pC0e7a_source{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:none;font-size:14px;line-height:24px;overflow:hidden}.pC0e7a_summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.pC0e7a_body{box-sizing:border-box;background:var(--dsw-alias-markdown-code-block);width:calc(100% - 22px);max-height:141px;color:var(--dsw-alias-label-tertiary);font:400 11px/16px var(--ds-font-family-code);border:none;border-radius:8px;margin:4px 0 0 22px;padding:10px 16px 12px 12px;overflow:auto}";
		const tagId$13 = "@deepseek-ai/dsh-client-ui-conversation/ContextInjectionRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$13) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$13;
			tag.textContent = css$13;
			document.head.appendChild(tag);
		}
		var ContextInjectionRow_module_css_default = {
			"source": "pC0e7a_source",
			"summary": "pC0e7a_summary",
			"body": "pC0e7a_body",
			"sep": "pC0e7a_sep",
			"chevron": "pC0e7a_chevron",
			"root": "pC0e7a_root"
		};
		//#endregion
		//#region lib/types/client/chat/ContextInjectionRow.js
		/**
		* Render logged context with the Tool calls disclosure chrome from Figma.
		*
		* The header names the role the context plays and, beside it, the producer the
		* durable source identifies, so a reader can tell an injected skill catalog
		* from a workspace instruction file or a recalled session without expanding.
		* The expanded body follows the producer-declared form; an absent or unknown
		* form renders the opaque body.
		* @param props - Durable content, its projected producer role/name and form, and the locale seat.
		* @returns A collapsed context row with a bounded, form-specific body.
		*/
		function ContextInjectionRow({ content, source, provenance, form, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const { rendered, summary, body } = contextBody(form, {
				content,
				source,
				t
			});
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				className: ContextInjectionRow_module_css_default.root,
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 }),
				chevronClassName: ContextInjectionRow_module_css_default.chevron,
				title: t(provenance.role === "recall" ? "message.contextRecall" : "message.contextInjection"),
				collapsedContent: provenance.label === null ? void 0 : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: ContextInjectionRow_module_css_default.sep,
						"aria-hidden": true
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ContextInjectionRow_module_css_default.source,
						"data-context-source": true,
						children: provenance.label
					}),
					summary !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
						className: ContextInjectionRow_module_css_default.sep,
						"aria-hidden": true
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ContextInjectionRow_module_css_default.summary,
						"data-context-summary": true,
						children: summary
					})] })
				] }),
				keepContentWhenOpen: true,
				open,
				expandable: true,
				expandOnRowClick: true,
				onToggle: () => {
					setOpen((value) => !value);
				},
				children: (0, react_jsx_runtime.jsx)("div", {
					className: ContextInjectionRow_module_css_default.body,
					"data-context-injection-body": true,
					"data-context-form": rendered ?? void 0,
					children: body
				})
			});
		}
		//#endregion
		//#region lib/types/client/chat/use-calendar-day.js
		/**
		* Local calendar-day epoch that advances at each local midnight.
		* @returns Midnight ms for the current local day; updates after the boundary.
		*/
		function useCalendarDay() {
			const [day, setDay] = (0, react.useState)(() => startOfLocalDay(Date.now()));
			(0, react.useEffect)(() => {
				let timer;
				const arm = () => {
					const now = Date.now();
					setDay(startOfLocalDay(now));
					timer = setTimeout(arm, msUntilNextLocalMidnight(now));
				};
				timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()));
				return () => {
					clearTimeout(timer);
				};
			}, []);
			return day;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/MessageIconActions.module.css.mjs
		const css$12 = ".p-xYUq_actions{align-items:center;gap:10px;height:28px;display:flex}.p-xYUq_timeStart{color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:12px;font-size:14px;line-height:24px}.p-xYUq_timeEnd{color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-left:12px;font-size:14px;line-height:24px}.p-xYUq_runTimeDot{margin:0 10px}@media (hover:hover){[data-time-hover-root] :is(.p-xYUq_timeStart,.p-xYUq_timeEnd){opacity:0;transition:opacity 80ms}[data-time-hover-root]:hover :is(.p-xYUq_timeStart,.p-xYUq_timeEnd),[data-time-hover-root]:focus-within :is(.p-xYUq_timeStart,.p-xYUq_timeEnd){opacity:1}}.p-xYUq_action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}.p-xYUq_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.p-xYUq_action[data-unavailable]{cursor:default;opacity:.4}.p-xYUq_action[data-unavailable]:hover{color:var(--dsw-alias-label-tertiary);background:0 0}.p-xYUq_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}";
		const tagId$12 = "@deepseek-ai/dsh-client-ui-conversation/MessageIconActions.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$12) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$12;
			tag.textContent = css$12;
			document.head.appendChild(tag);
		}
		var MessageIconActions_module_css_default = {
			"actions": "p-xYUq_actions",
			"timeStart": "p-xYUq_timeStart",
			"runTimeDot": "p-xYUq_runTimeDot",
			"visuallyHidden": "p-xYUq_visuallyHidden",
			"action": "p-xYUq_action",
			"timeEnd": "p-xYUq_timeEnd"
		};
		//#endregion
		//#region lib/types/client/chat/MessageIconActions.js
		/**
		* Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
		* @param props - Copy text, event time, clock side, branch callback, className.
		* @returns The actions row element.
		*/
		function MessageIconActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, className, extraActions, t }) {
			const day = useCalendarDay();
			const reasonId = (0, react.useId)();
			const [copied, setCopied] = (0, react.useState)(false);
			const copyPending = (0, react.useRef)(false);
			const copyTimer = (0, react.useRef)(null);
			const copyEpoch = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				copyEpoch.current += 1;
				copyPending.current = false;
				if (copyTimer.current !== null) clearTimeout(copyTimer.current);
			}, []);
			const onCopy = (0, react.useCallback)(() => {
				if (copied || copyPending.current) return;
				const epoch = copyEpoch.current;
				copyPending.current = true;
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text).then((ok) => {
					if (epoch !== copyEpoch.current) return;
					copyPending.current = false;
					if (!ok) return;
					setCopied(true);
					copyTimer.current = window.setTimeout(() => {
						copyTimer.current = null;
						setCopied(false);
					}, 1e3);
				});
			}, [copied, text]);
			const clockEl = time === void 0 ? null : (0, react_jsx_runtime.jsxs)("span", {
				className: clock === "start" ? MessageIconActions_module_css_default.timeStart : MessageIconActions_module_css_default.timeEnd,
				children: [
					formatMessageClock(time, t, day),
					runMs !== void 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageIconActions_module_css_default.runTimeDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("message.ranFor", { duration: formatRunDuration(runMs, t) })
					] }),
					ttftMs !== void 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageIconActions_module_css_default.runTimeDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("message.ttft", { seconds: formatLatencySeconds(ttftMs) })
					] }),
					tokensPerSecond !== void 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageIconActions_module_css_default.runTimeDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("message.tokensPerSecond", { tps: formatTokensPerSecond(tokensPerSecond) })
					] })
				]
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				className: className === void 0 ? MessageIconActions_module_css_default.actions : `${MessageIconActions_module_css_default.actions} ${className}`,
				children: [
					clock === "start" ? clockEl : null,
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: copied ? t("copied") : t("copy"),
						side: "bottom",
						children: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageIconActions_module_css_default.action,
							"aria-label": copied ? t("copied") : t("copy"),
							onClick: onCopy,
							children: copied ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, {})
						})
					}),
					extraActions,
					onBranch !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: branchUnavailable ? t("message.branchUnavailable") : t("message.branch"),
						side: "bottom",
						children: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MessageIconActions_module_css_default.action,
							"aria-label": t("message.branch"),
							"aria-disabled": branchUnavailable || void 0,
							"aria-describedby": branchUnavailable ? reasonId : void 0,
							"data-unavailable": branchUnavailable || void 0,
							onClick: branchUnavailable ? void 0 : onBranch,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
						})
					}),
					onBranch !== void 0 && branchUnavailable && (0, react_jsx_runtime.jsx)("span", {
						id: reasonId,
						className: MessageIconActions_module_css_default.visuallyHidden,
						children: t("message.branchUnavailable")
					}),
					clock === "end" ? clockEl : null
				]
			});
		}
		//#endregion
		//#region lib/types/client/chat/MessageItem.js
		function contentParts(content) {
			const texts = [];
			const images = [];
			const rest = [];
			for (const block of content) {
				const b = block;
				if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
				else if (b.type === "image" && b.attachment !== void 0) images.push({ attachment: b.attachment });
				else rest.push(block);
			}
			return {
				text: texts.join(""),
				images,
				rest
			};
		}
		function retrySeconds(milliseconds) {
			return Math.max(1, Math.ceil(milliseconds / 1e3));
		}
		function ModelRetryItem({ node, active, t }) {
			const deadline = (0, react.useMemo)(() => Date.now() + node.delayMs, [node.delayMs, node.seq]);
			const scheduledSeconds = retrySeconds(node.delayMs);
			const maximum = node.mode === "normal" ? node.maxRetries : "∞";
			const [countdown, setCountdown] = (0, react.useState)(() => ({
				deadline,
				seconds: retrySeconds(deadline - Date.now())
			}));
			const remainingSeconds = countdown.deadline === deadline ? countdown.seconds : retrySeconds(deadline - Date.now());
			(0, react.useEffect)(() => {
				if (!active) return;
				const updateCountdown = () => {
					const next = retrySeconds(deadline - Date.now());
					setCountdown((current) => current.deadline === deadline && current.seconds === next ? current : {
						deadline,
						seconds: next
					});
					return next;
				};
				if (updateCountdown() === 1) return;
				const timer = window.setInterval(() => {
					if (updateCountdown() === 1) window.clearInterval(timer);
				}, 250);
				return () => {
					window.clearInterval(timer);
				};
			}, [active, deadline]);
			const label = active ? t("message.retry.active") : node.retryState === "cancelled" ? t("message.retry.cancelled") : node.retryState === "started" ? t("message.retry.started") : t("message.retry.scheduled");
			const seconds = active ? remainingSeconds : scheduledSeconds;
			return (0, react_jsx_runtime.jsxs)("details", {
				className: MessageItem_module_css_default.retryRow,
				"data-active": active || void 0,
				children: [(0, react_jsx_runtime.jsx)("summary", {
					className: MessageItem_module_css_default.retrySummary,
					children: (0, react_jsx_runtime.jsx)("span", {
						className: MessageItem_module_css_default.retryText,
						role: "status",
						children: t("message.retry.status", {
							label,
							retry: node.retry,
							maximum,
							seconds
						})
					})
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: MessageItem_module_css_default.retryDetails,
					children: [(0, react_jsx_runtime.jsxs)("div", { children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.retryDetailLabel,
							children: t("message.retry.delay")
						}),
						Math.round(node.delayMs),
						"ms"
					] }), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("span", {
						className: MessageItem_module_css_default.retryDetailLabel,
						children: t("message.retry.failure")
					}), node.failure.message] })]
				})]
			});
		}
		/** Persistent, turn-positioned feedback for a terminal failure. */
		function TurnErrorItem({ node, t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MessageItem_module_css_default.turnErrorRow,
				role: "status",
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "error",
						className: MessageItem_module_css_default.turnErrorDot
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: MessageItem_module_css_default.turnErrorCopy,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.turnErrorTitle,
							children: t("message.turnError")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: MessageItem_module_css_default.turnErrorMessage,
							children: node.message
						})]
					}),
					node.code !== void 0 && (0, react_jsx_runtime.jsx)("code", {
						className: MessageItem_module_css_default.turnErrorCode,
						children: node.code
					})
				]
			});
		}
		/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
		function TurnMaxTokensItem({ t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MessageItem_module_css_default.turnErrorRow,
				role: "status",
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "warning",
					className: MessageItem_module_css_default.turnErrorDot
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: MessageItem_module_css_default.turnErrorCopy,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: MessageItem_module_css_default.maxTokensTitle,
						children: t("message.maxTokens")
					}), (0, react_jsx_runtime.jsx)("span", {
						className: MessageItem_module_css_default.turnErrorMessage,
						children: t("message.maxTokens.hint")
					})]
				})]
			});
		}
		/**
		* Display projection of reference forms in a user bubble (free geometry — no
		* textarea alignment constraint here); everything else stays plain text. The
		* logged model text remains the single truth; this is presentation only.
		* Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
		* IS the reference — the bubble uses the same plainest token
		* scan as the composer, minus the lexicon: sent tokens were validated at
		* compose time, so shape alone decorates).
		*/
		function projectUserText(text) {
			const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g;
			const parts = [];
			let cursor = 0;
			let m;
			while ((m = re.exec(text)) !== null) {
				const tokenStart = m.index + (m[1]?.length ?? 0);
				const label = m[2] ?? "";
				if (tokenStart > cursor) parts.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text: text.slice(cursor, tokenStart) }, cursor));
				parts.push((0, react_jsx_runtime.jsx)("span", {
					className: MessageItem_module_css_default.refChip,
					"data-ref-chip": label.startsWith("@") ? "subagent" : "skill",
					children: label
				}, tokenStart));
				cursor = tokenStart + label.length;
			}
			if (parts.length === 0) return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text });
			if (cursor < text.length) parts.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text: text.slice(cursor) }, cursor));
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: parts });
		}
		/** Right-aligned bubble shared by user and steering rows. */
		function UserStyleBubble({ content, imageLoader, actions, pending = false, t }) {
			const { text, images, rest } = contentParts(content);
			const truncated = (total) => t("json.truncated", { total });
			const showBubble = text !== "" || rest.length > 0;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: MessageItem_module_css_default.userRow,
				"data-pending-steering": pending || void 0,
				"data-time-hover-root": true,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: MessageItem_module_css_default.userStack,
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_attachment.ImageGallery, {
						images,
						load: imageLoader,
						align: "end",
						labels: messageImageLabels(t)
					}), showBubble && (0, react_jsx_runtime.jsxs)("div", {
						className: MessageItem_module_css_default.bubble,
						children: [projectUserText(text), rest.map((block, i) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
							label: t("message.extraBlock"),
							payload: block,
							truncatedLabel: truncated
						}, i))]
					})]
				}), actions?.(text)]
			});
		}
		/**
		* Render one Host-authoritative pending steering item with the same visual
		* language as its eventual durable transcript node.
		* @param props - Pending message content and conversation translator.
		* @returns the pending steering bubble.
		*/
		function PendingSteeringBubble({ content, loadImage, t }) {
			return (0, react_jsx_runtime.jsx)(UserStyleBubble, {
				content,
				imageLoader: loadImage ?? (() => Promise.reject(new Error(t("image.serviceUnavailable")))),
				pending: true,
				t,
				actions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {
					text,
					clock: "start",
					className: MessageItem_module_css_default.actions,
					t
				})
			});
		}
		/** User and admitted-steering keyed Chat renderer. */
		const UserMessageNodeView = (0, react.memo)(function UserMessageNodeView({ node, loadImage, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)(UserStyleBubble, {
				content: data.content,
				imageLoader: loadImage,
				t,
				actions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {
					text,
					time: data.time,
					clock: "start",
					className: MessageItem_module_css_default.actions,
					t
				})
			});
		});
		/** Injected-context keyed Chat renderer. */
		const ContextMessageNodeView = (0, react.memo)(function ContextMessageNodeView({ node, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)(ContextInjectionRow, {
				content: data.content,
				source: data.source,
				provenance: data.provenance,
				form: data.form,
				t
			});
		});
		/** Automatic compaction keyed Chat renderer. */
		const CompactionNodeView = (0, react.memo)(function CompactionNodeView({ node, t }) {
			return (0, react_jsx_runtime.jsx)(CompactionItem, {
				node: node.data,
				t
			});
		});
		/** Correlated retry-chain keyed Chat renderer. */
		const RetryNodeView = (0, react.memo)(function RetryNodeView({ node, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)(ModelRetryItem, {
				node: data.current,
				active: data.current.retryState === "scheduled",
				t
			});
		});
		/** Terminal turn-error keyed Chat renderer. */
		const TurnErrorNodeView = (0, react.memo)(function TurnErrorNodeView({ node, t }) {
			return (0, react_jsx_runtime.jsx)(TurnErrorItem, {
				node: node.data,
				t
			});
		});
		/** Max-tokens turn-end notice keyed Chat renderer. */
		const TurnMaxTokensNodeView = (0, react.memo)(function TurnMaxTokensNodeView({ t }) {
			return (0, react_jsx_runtime.jsx)(TurnMaxTokensItem, { t });
		});
		/** Explicit unknown-surface keyed Chat renderer. */
		const UnknownNodeView = (0, react.memo)(function UnknownNodeView({ node, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)("div", {
				className: MessageItem_module_css_default.contextRow,
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
					label: t("message.unknownSurface", { type: data.type }),
					payload: data.data,
					truncatedLabel: (total) => t("json.truncated", { total })
				})
			});
		});
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/ChatView.module.css.mjs
		const css$11 = ".Md3f7G_root{flex-direction:column;flex:auto;min-height:0;display:flex;position:relative}.Md3f7G_scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto;overflow-y:auto}[data-conversation-scroll] .Md3f7G_root{flex:none;height:auto;min-height:auto}[data-conversation-scroll] .Md3f7G_scroll{flex:none;min-height:auto;overflow:visible}.Md3f7G_column{max-width:var(--dsh-chat-content-width);flex-direction:column;gap:16px;width:100%;margin:0 auto;display:flex}.Md3f7G_flowItem{min-width:0}.Md3f7G_flowItem:empty{display:none}.Md3f7G_callRow{border-radius:6px}.Md3f7G_turnStatus{height:26px;font:var(--dsw-font-s-strong-14);white-space:nowrap;background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite Md3f7G_dsh-turn-status-shimmer;display:inline-flex}.Md3f7G_turnStatusClock{font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);margin-left:8px;font-weight:400}@keyframes Md3f7G_dsh-turn-status-shimmer{to{background-position:0 0}}@media (prefers-reduced-motion:reduce){.Md3f7G_turnStatus{background-position:0 0;background-size:100% 100%;animation:none}}.Md3f7G_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.Md3f7G_openError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.Md3f7G_older{justify-content:center;display:flex}.Md3f7G_older button{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);cursor:pointer;border:none;border-radius:14px;padding:4px 12px;font-size:12px}.Md3f7G_older button:disabled{cursor:default;opacity:.6}.Md3f7G_toBottomSlot{z-index:8;height:0;padding-right:max(0px, calc((100% - var(--dsh-chat-content-width)) / 2));pointer-events:none;justify-content:flex-end;display:flex;position:sticky;bottom:16px}[data-conversation-scroll] .Md3f7G_toBottomSlot{bottom:calc(var(--dsh-composer-height,152px) + 16px)}.Md3f7G_toBottom{border:1px solid var(--dsw-alias-border-l2);width:34px;height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-shadow-lv2);cursor:pointer;pointer-events:auto;border-radius:100px;justify-content:center;align-items:center;margin-top:-34px;padding:0;display:flex}.Md3f7G_toBottom:hover{background:var(--dsw-alias-button-floating-hover)}";
		const tagId$11 = "@deepseek-ai/dsh-client-ui-conversation/ChatView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$11;
			tag.textContent = css$11;
			document.head.appendChild(tag);
		}
		var ChatView_module_css_default = {
			"toBottom": "Md3f7G_toBottom",
			"column": "Md3f7G_column",
			"callRow": "Md3f7G_callRow",
			"turnStatusClock": "Md3f7G_turnStatusClock",
			"flowItem": "Md3f7G_flowItem",
			"scroll": "Md3f7G_scroll",
			"hint": "Md3f7G_hint",
			"toBottomSlot": "Md3f7G_toBottomSlot",
			"older": "Md3f7G_older",
			"turnStatus": "Md3f7G_turnStatus",
			"root": "Md3f7G_root",
			"dsh-turn-status-shimmer": "Md3f7G_dsh-turn-status-shimmer",
			"openError": "Md3f7G_openError"
		};
		//#endregion
		//#region lib/types/client/chat/ChatNodeSeat.js
		/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
		const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions, useSession, renderSlot, t }) {
			const node = useSession((snapshot) => snapshot.chat.nodes.get(nodeKey));
			const routedNode = node;
			const owner = (0, react.useMemo)(() => node === void 0 ? null : {
				selectedCallId,
				cwd,
				openFile,
				inspectCall,
				forkAt,
				loadImage,
				fileMentions
			}, [
				node,
				selectedCallId,
				cwd,
				openFile,
				inspectCall,
				forkAt,
				loadImage,
				fileMentions
			]);
			if (routedNode === void 0 || owner === null) return null;
			const routedOwner = {
				...owner,
				node: routedNode
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: ChatView_module_css_default.flowItem,
				"data-chat-anchor-key": routedNode.key,
				"data-chat-flow-key": routedNode.key,
				"data-chat-flow-kind": routedNode.kind,
				children: renderSlot("conversation.chat.node", routedOwner, {
					entryKey: routedNode.kind,
					hookContext: nodeKey,
					fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("message.unknownSurface", { type: routedNode.kind }),
						payload: routedNode.data,
						truncatedLabel: (total) => t("json.truncated", { total })
					})
				})
			});
		});
		//#endregion
		//#region lib/types/client/chat/ChatView.js
		/** Active column host when present; otherwise the view-local scroller. */
		function scrollerOf(from) {
			return from.closest("[data-conversation-scroll]") ?? from;
		}
		/** Find an already-rendered settled row without interpolating a selector. */
		function anchorElement(list, key) {
			for (const row of list.querySelectorAll("[data-chat-anchor-key]")) if (row.dataset.chatAnchorKey === key) return row;
			return null;
		}
		/** Row position in scrollport coordinates (viewport-independent). */
		function flowTop(row, scrollport) {
			return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
		}
		/** Select a visible stable node/call identity, falling back only when layout
		* has not exposed a visible box yet. */
		function pagingAnchor(list, scrollport) {
			const viewport = scrollport.getBoundingClientRect();
			const visibleBottom = scrollport.querySelector("[data-composer-seat]")?.getBoundingClientRect().top ?? viewport.bottom;
			if (typeof document.elementsFromPoint === "function" && visibleBottom > viewport.top) {
				const content = list.getBoundingClientRect();
				const left = Math.max(viewport.left, content.left);
				const right = Math.min(viewport.right, content.right);
				const x = left + Math.max(0, right - left) / 2;
				const height = visibleBottom - viewport.top;
				const points = [
					1,
					Math.min(32, height / 3),
					height / 2,
					Math.max(1, height - 1)
				];
				for (const offset of points) for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
					const row = element instanceof HTMLElement ? element.closest("[data-chat-anchor-key]") : null;
					if (row !== null && list.contains(row)) return row;
				}
			}
			const rows = [...list.querySelectorAll("[data-chat-anchor-key]")];
			return rows.filter((row) => {
				const rect = row.getBoundingClientRect();
				return rect.bottom > viewport.top && rect.top < visibleBottom;
			})[0] ?? rows[0] ?? null;
		}
		/** Capture a reflow-resistant reader position from the current rendered window. */
		function scrollPosition(list, scrollport) {
			const row = pagingAnchor(list, scrollport);
			const anchorKey = row?.dataset.chatAnchorKey;
			if (row === null || anchorKey === void 0) return null;
			return {
				anchorKey,
				anchorTop: flowTop(row, scrollport),
				scrollTop: scrollport.scrollTop
			};
		}
		function runningTurnStartTime(timeline) {
			let latest = null;
			for (const turn of timeline.turns.values()) if (turn.status === "open" && turn.start !== void 0) latest = turn.start.time;
			return latest;
		}
		/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
		function TurnStatus({ startTime, t }) {
			const [mountedAt] = (0, react.useState)(() => Date.now());
			const anchor = startTime ?? mountedAt;
			const [elapsedMs, setElapsedMs] = (0, react.useState)(() => Math.max(0, Date.now() - anchor));
			(0, react.useEffect)(() => {
				const tick = () => {
					setElapsedMs(Math.max(0, Date.now() - anchor));
				};
				tick();
				const id = setInterval(tick, 1e3);
				return () => {
					clearInterval(id);
				};
			}, [anchor]);
			const showClock = elapsedMs >= 15e3;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ChatView_module_css_default.turnStatus,
				role: "status",
				"aria-live": "polite",
				children: ["Deep diving...", showClock && (0, react_jsx_runtime.jsx)("span", {
					className: ChatView_module_css_default.turnStatusClock,
					"aria-hidden": true,
					children: formatRunDuration(elapsedMs, t)
				})]
			});
		}
		/**
		* The chat view slot entry: pure component over the composed props; each
		* ordered business Node crosses the keyed renderer seat.
		*/
		function ChatView({ useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt, fileMentions, t }) {
			const order = useSession((s) => s.chat.order);
			const nodeStore = useSession((s) => s.chat.nodes);
			const timeline = useSession((s) => s.chat.timeline);
			const inbox = useSession((s) => s.queue);
			const cwd = useSessions((s) => s.byId[sessionId]?.cwd);
			const running = useSession((s) => s.running);
			const openState = useSession((s) => s.openState);
			const openError = useSession((s) => s.openError);
			const hasMore = useSession((s) => s.hasMore);
			const loadingOlder = useSession((s) => s.loadingOlder);
			const selectedCallId = useStore((s) => s.selection?.callId);
			const pendingSteering = (0, react.useMemo)(() => inbox.filter((item) => item.placement === "steering"), [inbox]);
			const runningTurnStart = (0, react.useMemo)(() => runningTurnStartTime(timeline), [timeline]);
			const listRef = (0, react.useRef)(null);
			const columnRef = (0, react.useRef)(null);
			const atBottomRef = (0, react.useRef)(true);
			const [atBottom, setAtBottom] = (0, react.useState)(true);
			/** Last position delivered or written on the main thread. */
			const observedTopRef = (0, react.useRef)(0);
			/** Paging anchor: semantic row/position at click, updated by reader scrolls
			* while the request is pending and restored after the prepend lands. */
			const anchorRef = (0, react.useRef)(null);
			const firstSeqRef = (0, react.useRef)(null);
			const openedRef = (0, react.useRef)(false);
			const lastKeyRef = (0, react.useRef)(null);
			const lastSteeringIdRef = (0, react.useRef)(null);
			/** Flow tip signature — follow-scroll only when this moves, never on a
			*  scroll-driven at-bottom chrome re-render (which would snap inertial
			*  scrolls the rest of the way to the floor). */
			const followSigRef = (0, react.useRef)(null);
			const firstKey = order[0];
			const firstSeq = firstKey === void 0 ? null : nodeStore.get(firstKey)?.anchorSeq ?? null;
			const lastKey = order.at(-1) ?? null;
			const lastNode = lastKey === null ? void 0 : nodeStore.get(lastKey);
			const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null;
			const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ""}`;
			const toBottom = (el) => {
				anchorRef.current = null;
				el.scrollTop = el.scrollHeight;
				observedTopRef.current = el.scrollTop;
				atBottomRef.current = true;
				setAtBottom(true);
				chatScroll.save(null);
			};
			(0, react.useLayoutEffect)(() => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
				if (local === null) return;
				const el = scrollerOf(local);
				if (openState === "open" && !openedRef.current) {
					openedRef.current = true;
					const saved = chatScroll.read();
					if (saved === null) toBottom(el);
					else {
						el.scrollTop = saved.scrollTop;
						const row = anchorElement(local, saved.anchorKey);
						if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop;
						observedTopRef.current = el.scrollTop;
						const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 25;
						atBottomRef.current = isAtBottom;
						setAtBottom(isAtBottom);
						const normalized = isAtBottom ? null : scrollPosition(local, el);
						if (isAtBottom) chatScroll.save(null);
						else if (normalized !== null) chatScroll.save(normalized);
					}
					firstSeqRef.current = firstSeq;
					lastKeyRef.current = lastKey;
					lastSteeringIdRef.current = lastSteeringId;
					followSigRef.current = followSig;
					return;
				}
				if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
					const anchor = anchorRef.current;
					anchorRef.current = null;
					const row = anchorElement(local, anchor.key);
					if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top;
					observedTopRef.current = el.scrollTop;
					firstSeqRef.current = firstSeq;
					/* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
					lastKeyRef.current = lastKey;
					lastSteeringIdRef.current = lastSteeringId;
					followSigRef.current = followSig;
					return;
				}
				firstSeqRef.current = firstSeq;
				const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === "user";
				const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current;
				const tipMoved = followSigRef.current !== followSig;
				lastKeyRef.current = lastKey;
				lastSteeringIdRef.current = lastSteeringId;
				followSigRef.current = followSig;
				if (appendedUser || appendedSteering || tipMoved && atBottomRef.current) toBottom(el);
			});
			const onScrollRef = (0, react.useRef)(() => {});
			onScrollRef.current = () => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
				if (local === null) return;
				const el = scrollerOf(local);
				const floor = Math.max(0, el.scrollHeight - el.clientHeight);
				const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > .5;
				const isAtBottom = movedByReader ? floor - el.scrollTop <= 25 : atBottomRef.current;
				if (!movedByReader && isAtBottom) {
					toBottom(el);
					return;
				}
				atBottomRef.current = isAtBottom;
				setAtBottom(isAtBottom);
				const position = isAtBottom ? null : scrollPosition(local, el);
				if (isAtBottom) anchorRef.current = null;
				else if (anchorRef.current !== null && position !== null) anchorRef.current = {
					key: position.anchorKey,
					top: position.anchorTop
				};
				if (isAtBottom) chatScroll.save(null);
				else if (position !== null) chatScroll.save(position);
				observedTopRef.current = el.scrollTop;
			};
			(0, react.useEffect)(() => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
				if (local === null) return;
				const el = scrollerOf(local);
				const onScroll = () => {
					onScrollRef.current();
				};
				el.addEventListener("scroll", onScroll, { passive: true });
				return () => {
					el.removeEventListener("scroll", onScroll);
				};
			}, []);
			const followRef = (0, react.useRef)(null);
			followRef.current = () => {
				const local = listRef.current;
				if (local !== null && atBottomRef.current) {
					const el = scrollerOf(local);
					el.scrollTop = el.scrollHeight;
					observedTopRef.current = el.scrollTop;
					chatScroll.save(null);
				}
			};
			(0, react.useEffect)(() => {
				const column = columnRef.current;
				const local = listRef.current;
				if (column === null || local === null || typeof ResizeObserver === "undefined") return;
				const composer = scrollerOf(local).querySelector("[data-composer-seat]");
				const observer = new ResizeObserver(() => {
					followRef.current?.();
				});
				observer.observe(column);
				if (composer !== null) observer.observe(composer);
				return () => {
					observer.disconnect();
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!loadingOlder) anchorRef.current = null;
			}, [loadingOlder]);
			const loadOlderAnchored = () => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
				if (local !== null) {
					const el = scrollerOf(local);
					const row = pagingAnchor(local, el);
					if (row !== null && row.dataset.chatAnchorKey !== void 0) anchorRef.current = {
						key: row.dataset.chatAnchorKey,
						top: flowTop(row, el)
					};
				}
				loadOlder();
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: ChatView_module_css_default.root,
				children: (0, react_jsx_runtime.jsxs)("div", {
					ref: listRef,
					className: ChatView_module_css_default.scroll,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						ref: columnRef,
						className: ChatView_module_css_default.column,
						"data-chat-flow": "",
						children: [
							openState === "loading" && (0, react_jsx_runtime.jsx)("div", {
								className: ChatView_module_css_default.hint,
								children: t("chat.loadingHistory")
							}),
							openState === "error" && openError !== null && (0, react_jsx_runtime.jsx)("div", {
								className: ChatView_module_css_default.openError,
								children: t("chat.loadError", {
									message: openError.message,
									code: openError.code
								})
							}),
							hasMore && (0, react_jsx_runtime.jsx)("div", {
								className: ChatView_module_css_default.older,
								children: (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loadingOlder,
									onClick: loadOlderAnchored,
									children: loadingOlder ? t("loading") : t("chat.loadOlder")
								})
							}),
							order.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
								nodeKey,
								useSession,
								selectedCallId,
								cwd,
								openFile,
								inspectCall,
								forkAt,
								loadImage,
								fileMentions,
								renderSlot,
								t
							}, nodeKey)),
							running && (0, react_jsx_runtime.jsx)(TurnStatus, {
								startTime: runningTurnStart,
								t
							}),
							pendingSteering.map((item) => (0, react_jsx_runtime.jsx)(PendingSteeringBubble, {
								content: item.content,
								loadImage,
								t
							}, item.id))
						]
					}), !atBottom && (0, react_jsx_runtime.jsx)("div", {
						className: ChatView_module_css_default.toBottomSlot,
						children: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChatView_module_css_default.toBottom,
							"aria-label": t("chat.toBottom"),
							onClick: () => {
								const local = listRef.current;
								/* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
								if (local !== null) toBottom(scrollerOf(local));
							},
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
						})
					})]
				})
			});
		}
		//#endregion
		//#region lib/types/client/contract/slots.js
		/**
		* Approval domain face over the carrier (the ui-user-questions PendingQuestion
		* pattern): render identity and question material forwarded transparently;
		* answer owns the wire encoding — the ApprovalResponsePayload value shape
		* with the audit correlation the host reconciles — and turns a rejected
		* carrier receipt into a thrown error. Minted per carrier via useMemo.
		*/
		var PendingApproval = class {
			wait;
			/**
			* @param wait - the runtime carrier for one pending approval question.
			*/
			constructor(wait) {
				this.wait = wait;
			}
			/** Opaque render identity (React key / one-shot latch remount axis), forwarded from the carrier. */
			get key() {
				return this.wait.key;
			}
			/** The tool the question is about (headline fallback), forwarded from the carrier payload. */
			get toolName() {
				return this.wait.payload.toolName;
			}
			/** The asker's human-readable WHY (headline when present), forwarded from the carrier payload. */
			get reason() {
				return this.wait.payload.reason;
			}
			/** The paired tool call's id when the ask names one (command-line lookup key), forwarded from the carrier payload. */
			get callId() {
				return this.wait.payload.callId;
			}
			/**
			* Deliver the user's decision; a rejected carrier receipt throws. Panel
			* removal stays frame-driven: the broadcast `approval/resolved` settles the
			* wait and drops it from the pending list.
			* @param outcome - the only two client-answerable outcomes.
			*/
			async answer(outcome) {
				const receipt = await this.wait.respond({
					ok: true,
					value: {
						sessionId: this.wait.sessionId,
						approvalId: this.wait.payload.approvalId,
						outcome
					}
				});
				if (!receipt.accepted) throw new Error(`approval response rejected: ${receipt.reason}`);
			}
		};
		//#endregion
		//#region lib/types/client/chat/tool-node-reader.js
		function toolNode(node) {
			return node?.kind === "tool-call" ? node : void 0;
		}
		/**
		* Read one root Tool lifecycle through the internal Chat Node index.
		* @param snapshot - current Conversation snapshot.
		* @param rootCallId - root call identity and Tool Context identity.
		* @returns root lifecycle when it is materialized in the current window.
		*/
		function rootToolCall(snapshot, rootCallId) {
			return toolNode(snapshot.chat.nodes.get((0, _deepseek_ai_dsh_client_runtime_client.conversationContextKey)("tool-call", rootCallId)))?.data.root;
		}
		/**
		* Find any root or nested Tool lifecycle through the internal Node store.
		* @param snapshot - current Conversation snapshot.
		* @param callId - root or nested call identity.
		* @returns current Tool lifecycle when materialized in the loaded window.
		*/
		function findToolCall(snapshot, callId) {
			const visit = (block) => {
				if (block.callId === callId) return block;
				for (const child of block.subCalls) {
					const found = visit(child);
					if (found !== void 0) return found;
				}
			};
			for (const node of snapshot.chat.nodes.values()) {
				const root = toolNode(node)?.data.root;
				if (root === void 0) continue;
				const found = visit(root);
				if (found !== void 0) return found;
			}
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.module.css.mjs
		const css$10 = ".bqrRRG_root{padding:8px calc(var(--dsh-composer-side-clearance) + 16px) 12px;flex-direction:column;align-items:center;display:flex}.bqrRRG_card{width:100%;max-width:var(--dsh-chat-content-width);border:1px solid var(--dsw-alias-state-warn-secondary);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:20px;overflow:hidden}.bqrRRG_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;display:flex}.bqrRRG_dot{background:var(--dsw-alias-state-warn-primary);border-radius:50%;width:8px;height:8px}.bqrRRG_body{box-sizing:border-box;max-height:var(--dsh-composer-text-max-height);flex-direction:column;gap:6px;padding:12px 16px 0;display:flex;overflow-y:auto}.bqrRRG_headline{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}.bqrRRG_command{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);word-break:break-all;font-size:13px;line-height:20px}.bqrRRG_actionRow{justify-content:flex-end;gap:8px;padding:14px 16px;display:flex}.bqrRRG_reject:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-color:#0000}";
		const tagId$10 = "@deepseek-ai/dsh-client-ui-conversation/ApprovalPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$10) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$10;
			tag.textContent = css$10;
			document.head.appendChild(tag);
		}
		var ApprovalPanel_module_css_default = {
			"card": "bqrRRG_card",
			"command": "bqrRRG_command",
			"actionRow": "bqrRRG_actionRow",
			"root": "bqrRRG_root",
			"body": "bqrRRG_body",
			"headline": "bqrRRG_headline",
			"reject": "bqrRRG_reject",
			"dot": "bqrRRG_dot",
			"strip": "bqrRRG_strip"
		};
		//#endregion
		//#region lib/types/client/skeleton/ApprovalPanel.js
		/** Extract the shell command from an approval's paired running call (bash-family args carry `command`); undefined hides the line. */
		function commandOf(call) {
			if (call === void 0) return void 0;
			try {
				const args = JSON.parse(call.argsRaw);
				return typeof args.command === "string" ? args.command : void 0;
			} catch {
				return;
			}
		}
		/**
		* Composer takeover boundary: mints the domain face on the carrier's stable
		* identity and remounts the flow per request key, so the one-shot answered
		* latch never leaks to the next pending approval.
		* @param props - the selector-matched pending approval carrier plus the framework standard kit.
		* @returns The approval prompt for this request.
		*/
		function ApprovalPanel(props) {
			const approval = (0, react.useMemo)(() => new PendingApproval(props.matched), [props.matched]);
			const command = props.useSession((snapshot) => {
				if (approval.callId === void 0) return void 0;
				const root = rootToolCall(snapshot, approval.callId);
				if (root === void 0) return void 0;
				return root.callId === approval.callId && !("kind" in root) ? commandOf(root) : void 0;
			});
			return (0, react_jsx_runtime.jsx)(ApprovalFlow, {
				pending: approval,
				t: props.t,
				...command === void 0 ? {} : { command }
			}, approval.key);
		}
		function ApprovalFlow({ pending, command, t }) {
			const [answered, setAnswered] = (0, react.useState)(false);
			const answer = (outcome) => {
				setAnswered(true);
				pending.answer(outcome).catch(() => {
					setAnswered(false);
				});
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: ApprovalPanel_module_css_default.root,
				"data-approval-key": pending.key,
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: ApprovalPanel_module_css_default.card,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: ApprovalPanel_module_css_default.strip,
							children: [(0, react_jsx_runtime.jsx)("span", { className: ApprovalPanel_module_css_default.dot }), t("approval.waiting")]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: ApprovalPanel_module_css_default.body,
							"data-approval-scroll": "",
							tabIndex: 0,
							role: "group",
							"aria-label": t("approval.detail.aria"),
							children: [(0, react_jsx_runtime.jsx)("div", {
								className: ApprovalPanel_module_css_default.headline,
								children: pending.reason ?? t("approval.escalation", { toolName: pending.toolName })
							}), command !== void 0 && (0, react_jsx_runtime.jsx)("div", {
								className: ApprovalPanel_module_css_default.command,
								children: command
							})]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: ApprovalPanel_module_css_default.actionRow,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								className: ApprovalPanel_module_css_default.reject,
								disabled: answered,
								onClick: () => {
									answer("rejected");
								},
								children: t("approval.reject")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								disabled: answered,
								onClick: () => {
									answer("allowed-once");
								},
								children: t("approval.allowOnce")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `conversation` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "conversation";
		const PLAN_NEXT_ACTION_ZH = "描述你的任务以生成计划";
		const PLAN_NEXT_ACTION_EN = "describe your task to generate plan";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"view.chat": "对话",
			"hint.plan": PLAN_NEXT_ACTION_ZH,
			"hint.goal": "输入目标，智能体将持续执行",
			"hint.goal.active": "当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除",
			"placeholder.plan": PLAN_NEXT_ACTION_ZH,
			"placeholder.default": "给智能体发消息",
			"placeholder.unavailable": "会话不可用",
			"placeholder.parentOffline": "父会话已离线，无法继续发送；仍可停止当前运行",
			"placeholder.hero": "描述你想要构建的内容",
			"placeholder.workspace": "选择一个工作区开始",
			"input.commands": "命令",
			"input.stop": "停止生成",
			"input.send": "发送消息",
			"placeholder.steerQueue": "Cmd/Ctrl+Enter 插话发送全部排队消息",
			"input.accessMode": "访问模式，当前：{name}",
			"image.dropTitle": "图片拖动到此处即可添加",
			"image.dropDesc": "最多 {count} 张，每张 {size}",
			"image.dropBlocked": "当前无法添加图片",
			"image.pending": "待发送图片",
			"image.openOriginal": "查看原图",
			"image.openOriginalLabel": "{label}，点击查看原图",
			"image.remove": "移除图片 {name}",
			"image.scrollLeft": "向左滚动图片",
			"image.scrollRight": "向右滚动图片",
			"image.original": "原图",
			"image.label": "图片",
			"image.loadFailed": "图片加载失败，点击重试",
			"image.loading": "图片加载中…",
			"image.preview": "原图预览",
			"image.closePreview": "关闭原图预览",
			"image.serviceUnavailable": "图片读取服务不可用",
			"image.unsupportedType": "仅支持 PNG、JPG、WebP、GIF 格式的图片",
			"image.tooMany": "一条消息最多添加 {count} 张图片",
			"image.fileTooLarge": "单张图片不能超过 {size}",
			"image.totalTooLarge": "图片总大小超过 {size}，请移除部分图片",
			"image.tooManyPixels": "图片分辨率过大，请压缩后重试",
			"image.modelUnsupported": "当前模型不支持图片，请切换支持图片的模型",
			"image.subagentUnsupported": "子智能体会话暂不支持图片",
			"image.sendFailed": "图片发送失败（{reason}），请重新添加图片后再试",
			"context.aria": "上下文已用 {percent}",
			"context.used": "上下文已用",
			"context.system": "系统提示词",
			"context.tools": "工具",
			"context.messages": "对话消息",
			"stats.counts": "{turns} 轮 · {steps} 步",
			"stats.llm": "LLM {duration}",
			"stats.toolCall": "工具调用 {duration}",
			"stats.ttftAverage": "首 token 平均 {duration}",
			"stats.tokensPerSecond": "{throughput} tok/s",
			"stats.cacheHit": "缓存命中 {percent}%",
			"stats.tokens": "输入 {input} tok · 输出 {output} tok",
			"settings.enter.title": "繁忙时 Enter 键行为",
			"settings.enter.description": "仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为",
			"settings.enter.queue": "排队发送",
			"settings.enter.steer": "插话发送",
			"access.confirm.title": "确认启用 Full access？",
			"access.confirm.description": "启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。",
			"access.confirm.acknowledge": "我已了解风险，并愿意继续",
			"access.confirm.cancel": "取消",
			"access.confirm.enable": "启用 Full access",
			"hero.headline": "探索未至之境",
			"hero.preview": "预览版",
			"hero.chooseWorkspace": "选择工作区",
			"session.hierarchy": "会话层级",
			"details.title": "详情",
			"details.close": "关闭详情",
			"details.empty": "点击消息流中的工具行查看详情",
			"details.notInWindow": "该调用不在当前窗口内",
			"details.input": "输入",
			"details.output": "输出",
			"details.running": "运行中…",
			"todo.title": "任务",
			"todo.progress.done": "{done} 已完成",
			"todo.progress.active": "{active} 进行中",
			"todo.progress.pending": "{pending} 待处理",
			"todo.rowTitle": "更新任务清单",
			"todo.completed": "{done}/{total} 已完成",
			"chat.loadingHistory": "载入历史…",
			"chat.loadError": "历史加载失败：{message}（{code}）",
			"chat.loadOlder": "加载更早",
			"chat.toBottom": "回到底部",
			"message.extraBlock": "附加内容块",
			"message.contextInjection": "上下文注入",
			"message.contextRecall": "跨会话召回",
			"message.context.instructions.loaded": "已载入",
			"message.context.instructions.added": "已新增",
			"message.context.instructions.updated": "已更新",
			"message.context.instructions.removed": "已移除",
			"message.context.catalog.replaced": "替换目录",
			"message.context.catalog.more": "…还有 {count} 条",
			"message.context.snapshot.supersedes": "取代先前的快照",
			"message.context.relay.from": "来自会话 {session}",
			"message.context.recall.counts": "保留 {retained} 条 · 省略 {omitted} 条",
			"message.context.recall.truncated": "已截断",
			"message.compaction": "上下文已压缩",
			"message.compaction.running": "正在压缩…",
			"message.compaction.completed": "已压缩 {items} 条历史记录（约 {tokens} tokens）",
			"message.compaction.expand": "点击查看压缩摘要",
			"message.compaction.unavailable": "压缩摘要不可用",
			"message.unknownSurface": "未知 surface 事件：{type}",
			"message.unknownBlock": "未知内容块",
			"message.stopped": "已停止",
			"message.branch": "在新对话中分支",
			"message.branchUnavailable": "仅可从已完成轮次的最后一条消息分支",
			"message.retry.active": "正在重试模型请求",
			"message.retry.cancelled": "模型请求重试已取消",
			"message.retry.started": "已重试模型请求",
			"message.retry.scheduled": "等待重试模型请求",
			"message.retry.status": "{label}（{retry}/{maximum}） · {seconds}s",
			"message.retry.delay": "重试延迟：",
			"message.retry.failure": "失败原因：",
			"message.turnError": "本轮运行失败",
			"message.maxTokens": "已达到输出 token 上限",
			"message.maxTokens.hint": "回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。",
			"message.ranFor": "用时 {duration}",
			"message.ttft": "首 token {seconds}秒",
			"message.tokensPerSecond": "{tps} tok/s",
			"duration.seconds": "{seconds}秒",
			"duration.minutes": "{minutes}分{seconds}秒",
			"command.running": "执行中…",
			"command.failed": "命令失败",
			"command.done": "已完成",
			"command.title": "命令",
			"approval.waiting": "等待审批",
			"approval.detail.aria": "审批详情",
			"approval.escalation": "工具 {toolName} 请求越权执行",
			"approval.reject": "拒绝",
			"approval.allowOnce": "允许一次",
			"ask.rowTitle": "提问",
			"ask.waiting": "等待回答",
			"ask.cancelled": "已取消",
			"ask.interrupted": "已中断",
			"ask.answered": "{answered}/{total} 已回答",
			"bash.running": "运行中",
			"bash.failed": "失败",
			"bash.stopped": "已停止",
			"row.running": "运行中",
			"row.failed": "失败",
			"row.stopped": "已停止",
			"queue.count": "{n} 条排队消息",
			"queue.edit": "编辑排队消息",
			"queue.edit.unsupported": "包含非文本内容，暂不支持编辑",
			"queue.save": "保存排队消息",
			"queue.cancelEdit": "取消编辑",
			"queue.remove": "删除排队消息",
			"queue.steer": "插话发送",
			"queue.steer.unavailable": "仅运行中可插话发送",
			"queue.editFailed": "编辑失败：这条消息可能已经开始发送。",
			"queue.removeFailed": "删除失败：这条消息可能已经开始发送。",
			"queue.steerFailed": "插话发送失败，请重试。",
			"terminal.signal": "信号 {signal}",
			"terminal.exitCode": "退出码 {code}",
			"terminal.running": "运行中",
			"terminal.failed": "失败",
			"terminal.done": "已完成",
			"terminal.noOutput": "无输出",
			"terminal.collapseAria": "收起输出",
			"terminal.expandAria": "展开其余 {n} 行输出",
			"terminal.expandRest": "… 其余 {n} 行",
			"json.truncated": "… 已截断，共 {total} 字符",
			"clock.md": "{m}月{d}日",
			"clock.ymd": "{y}年{m}月{d}日"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"view.chat": "Chat",
			"hint.plan": PLAN_NEXT_ACTION_EN,
			"hint.goal": "describe the objective for a long-running task",
			"hint.goal.active": "goal active — edit / pause / resume / clear",
			"placeholder.plan": PLAN_NEXT_ACTION_EN,
			"placeholder.default": "Message the agent",
			"placeholder.unavailable": "Session unavailable",
			"placeholder.parentOffline": "Parent session offline; sending is unavailable but you can still stop the run",
			"placeholder.hero": "Describe what you want to build",
			"placeholder.workspace": "Choose a workspace to start",
			"input.commands": "Commands",
			"input.stop": "Stop generating",
			"input.send": "Send message",
			"placeholder.steerQueue": "Cmd/Ctrl+Enter steers all queued messages",
			"input.accessMode": "Access mode, current: {name}",
			"image.dropTitle": "Drag images here to add them",
			"image.dropDesc": "Up to {count} images, {size} each",
			"image.dropBlocked": "Images cannot be added right now",
			"image.pending": "Pending images",
			"image.openOriginal": "View original",
			"image.openOriginalLabel": "{label}, click to view original",
			"image.remove": "Remove image {name}",
			"image.scrollLeft": "Scroll images left",
			"image.scrollRight": "Scroll images right",
			"image.original": "Original image",
			"image.label": "Image",
			"image.loadFailed": "Image failed to load; click to retry",
			"image.loading": "Loading image…",
			"image.preview": "Original image preview",
			"image.closePreview": "Close original image preview",
			"image.serviceUnavailable": "Image loading service unavailable",
			"image.unsupportedType": "Only PNG, JPG, WebP, and GIF images are supported",
			"image.tooMany": "A message can include up to {count} images",
			"image.fileTooLarge": "Each image must be smaller than {size}",
			"image.totalTooLarge": "Images exceed {size} in total; remove some and try again",
			"image.tooManyPixels": "Image resolution is too high; compress it and try again",
			"image.modelUnsupported": "The current model does not support images; switch to a model that does",
			"image.subagentUnsupported": "Subagent sessions do not support images yet",
			"image.sendFailed": "Sending images failed ({reason}); re-add them and try again",
			"context.aria": "{percent} of context used",
			"context.used": "of context used",
			"context.system": "System prompt",
			"context.tools": "Tools",
			"context.messages": "Messages",
			"stats.counts": "{turns} turns · {steps} steps",
			"stats.llm": "LLM {duration}",
			"stats.toolCall": "Tool call {duration}",
			"stats.ttftAverage": "TTFT avg {duration}",
			"stats.tokensPerSecond": "{throughput} tok/s",
			"stats.cacheHit": "Cache hit {percent}%",
			"stats.tokens": "Input {input} tok · Output {output} tok",
			"settings.enter.title": "Enter behavior while busy",
			"settings.enter.description": "Busy only; Cmd/Ctrl+Enter uses the other behavior",
			"settings.enter.queue": "Queue",
			"settings.enter.steer": "Steer",
			"access.confirm.title": "Enable Full access?",
			"access.confirm.description": "Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.",
			"access.confirm.acknowledge": "I understand the risks and want to continue",
			"access.confirm.cancel": "Cancel",
			"access.confirm.enable": "Enable Full access",
			"hero.headline": "Into the Unknown",
			"hero.preview": "Preview",
			"hero.chooseWorkspace": "Choose workspace",
			"session.hierarchy": "Session hierarchy",
			"details.title": "Details",
			"details.close": "Close details",
			"details.empty": "Click a tool row in the message flow to view its details",
			"details.notInWindow": "This call is outside the current window",
			"details.input": "Input",
			"details.output": "Output",
			"details.running": "Running…",
			"todo.title": "To-dos",
			"todo.progress.done": "{done} completed",
			"todo.progress.active": "{active} in progress",
			"todo.progress.pending": "{pending} pending",
			"todo.rowTitle": "Update to-do list",
			"todo.completed": "{done}/{total} completed",
			"chat.loadingHistory": "Loading history…",
			"chat.loadError": "Failed to load history: {message} ({code})",
			"chat.loadOlder": "Load earlier",
			"chat.toBottom": "Back to bottom",
			"message.extraBlock": "Extra content block",
			"message.contextInjection": "Context injection",
			"message.contextRecall": "Session recall",
			"message.context.instructions.loaded": "loaded",
			"message.context.instructions.added": "added",
			"message.context.instructions.updated": "updated",
			"message.context.instructions.removed": "removed",
			"message.context.catalog.replaced": "Replacement catalog",
			"message.context.catalog.more": "… {count} more",
			"message.context.snapshot.supersedes": "Supersedes earlier snapshots",
			"message.context.relay.from": "From session {session}",
			"message.context.recall.counts": "{retained} kept · {omitted} omitted",
			"message.context.recall.truncated": "truncated",
			"message.compaction": "Context compacted",
			"message.compaction.running": "Compacting context…",
			"message.compaction.completed": "Compacted {items} history items (~{tokens} tokens)",
			"message.compaction.expand": "View compaction summary",
			"message.compaction.unavailable": "Compaction summary unavailable",
			"message.unknownSurface": "Unknown surface event: {type}",
			"message.unknownBlock": "Unknown content block",
			"message.stopped": "Stopped",
			"message.branch": "Branch into a new conversation",
			"message.branchUnavailable": "Available only on the last message of a completed turn",
			"message.retry.active": "Retrying model request",
			"message.retry.cancelled": "Model request retry cancelled",
			"message.retry.started": "Retried model request",
			"message.retry.scheduled": "Waiting to retry model request",
			"message.retry.status": "{label} ({retry}/{maximum}) · {seconds}s",
			"message.retry.delay": "Retry delay: ",
			"message.retry.failure": "Failure reason: ",
			"message.turnError": "This turn failed",
			"message.maxTokens": "Output token limit reached",
			"message.maxTokens.hint": "The reply was cut off; earlier output is preserved in the conversation. Send \"continue\" to let the model resume.",
			"message.ranFor": "Ran for {duration}",
			"message.ttft": "TTFT {seconds}s",
			"message.tokensPerSecond": "{tps} tok/s",
			"duration.seconds": "{seconds}s",
			"duration.minutes": "{minutes}m {seconds}s",
			"command.running": "Running…",
			"command.failed": "Command failed",
			"command.done": "Completed",
			"command.title": "Command",
			"approval.waiting": "Waiting for approval",
			"approval.detail.aria": "Approval details",
			"approval.escalation": "Tool {toolName} requests privileged execution",
			"approval.reject": "Reject",
			"approval.allowOnce": "Allow once",
			"ask.rowTitle": "Ask question",
			"ask.waiting": "waiting",
			"ask.cancelled": "cancelled",
			"ask.interrupted": "interrupted",
			"ask.answered": "{answered}/{total} answered",
			"bash.running": "Running",
			"bash.failed": "Failed",
			"bash.stopped": "Stopped",
			"row.running": "Running",
			"row.failed": "Failed",
			"row.stopped": "Stopped",
			"queue.count": "{n} queued messages",
			"queue.edit": "Edit queued message",
			"queue.edit.unsupported": "Contains non-text content; editing is not supported yet",
			"queue.save": "Save queued message",
			"queue.cancelEdit": "Cancel editing",
			"queue.remove": "Remove queued message",
			"queue.steer": "Steer queued message",
			"queue.steer.unavailable": "Steering is available only while the agent is running",
			"queue.editFailed": "Edit failed: this message may have already started sending.",
			"queue.removeFailed": "Removal failed: this message may have already started sending.",
			"queue.steerFailed": "Steering failed. Try again.",
			"terminal.signal": "signal {signal}",
			"terminal.exitCode": "exit code {code}",
			"terminal.running": "Running",
			"terminal.failed": "Failed",
			"terminal.done": "Done",
			"terminal.noOutput": "No output",
			"terminal.collapseAria": "Collapse output",
			"terminal.expandAria": "Expand the remaining {n} output lines",
			"terminal.expandRest": "… {n} more lines",
			"json.truncated": "… truncated, {total} characters total",
			"clock.md": "{m}/{d}",
			"clock.ymd": "{y}-{m}-{d}"
		};
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css.mjs
		const css$9 = ".lXshSW_root{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex:none;margin:0 auto;overflow:hidden}.lXshSW_body{flex-direction:column;gap:8px;padding:6px 12px;display:flex}.lXshSW_header{text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:10px;width:100%;padding:0;display:flex}.lXshSW_lead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}.lXshSW_title{color:var(--dsw-alias-label-primary);flex:none;font-size:13px;font-weight:500;line-height:24px}.lXshSW_progress{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:13px;font-weight:400;line-height:20px;overflow:hidden}.lXshSW_chevron{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}.lXshSW_list{flex-direction:column;gap:8px;max-height:180px;margin:0;padding:0;list-style:none;display:flex;overflow-y:auto}.lXshSW_item{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:10px;font-size:13px;line-height:20px;display:flex}.lXshSW_glyph{flex:none;place-items:center;width:16px;height:16px;display:grid}.lXshSW_glyphCompleted{color:var(--dsw-alias-state-success-primary)}.lXshSW_glyphPending{color:var(--dsw-alias-label-caption)}.lXshSW_glyphProgress{color:var(--dsw-alias-state-business-primary);animation:1s linear infinite lXshSW_todo-progress-spin}@keyframes lXshSW_todo-progress-spin{to{transform:rotate(360deg)}}.lXshSW_content{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
		const tagId$9 = "@deepseek-ai/dsh-client-ui-conversation/TodoPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$9) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$9;
			tag.textContent = css$9;
			document.head.appendChild(tag);
		}
		var TodoPanel_module_css_default = {
			"glyph": "lXshSW_glyph",
			"glyphCompleted": "lXshSW_glyphCompleted",
			"item": "lXshSW_item",
			"title": "lXshSW_title",
			"glyphProgress": "lXshSW_glyphProgress",
			"glyphPending": "lXshSW_glyphPending",
			"chevron": "lXshSW_chevron",
			"todo-progress-spin": "lXshSW_todo-progress-spin",
			"root": "lXshSW_root",
			"header": "lXshSW_header",
			"body": "lXshSW_body",
			"lead": "lXshSW_lead",
			"list": "lXshSW_list",
			"progress": "lXshSW_progress",
			"content": "lXshSW_content"
		};
		//#endregion
		//#region lib/types/client/skeleton/TodoPanel.js
		/** Local exhaustiveness helper — client packages do not depend on `dsh-llm`. */
		/* v8 ignore next 3 -- closed-union backstop; only reached if status is forged */
		function assertNever(value) {
			throw new Error(`unreachable todo status: ${String(value)}`);
		}
		/** Status glyphs share the figma 14×14 artboard; the 16×16 `.glyph` cell centers them. */
		function CompletedGlyph() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				className: TodoPanel_module_css_default.glyphCompleted,
				children: [(0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "6.4",
					stroke: "currentColor",
					strokeWidth: "1.2"
				}), (0, react_jsx_runtime.jsx)("path", {
					d: "M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z",
					fill: "currentColor"
				})]
			});
		}
		/** In-progress: business-blue ring fading out; CSS spins the svg. */
		function ProgressGlyph() {
			const gradientId = (0, react.useId)();
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				className: TodoPanel_module_css_default.glyphProgress,
				children: [(0, react_jsx_runtime.jsx)("defs", { children: (0, react_jsx_runtime.jsxs)("linearGradient", {
					id: gradientId,
					x1: "2.5",
					y1: "12",
					x2: "10.5",
					y2: "3.5",
					gradientUnits: "userSpaceOnUse",
					children: [(0, react_jsx_runtime.jsx)("stop", { stopColor: "currentColor" }), (0, react_jsx_runtime.jsx)("stop", {
						offset: "1",
						stopColor: "currentColor",
						stopOpacity: "0"
					})]
				}) }), (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "6.4",
					stroke: `url(#${gradientId})`,
					strokeWidth: "1.2"
				})]
			});
		}
		/** Pending: dashed unstarted ring (figma dash 2.4 2.4). */
		function PendingGlyph() {
			return (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": "true",
				className: TodoPanel_module_css_default.glyphPending,
				children: (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "6.4",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeDasharray: "2.4 2.4"
				})
			});
		}
		function StatusGlyph({ status }) {
			switch (status) {
				case "completed": return (0, react_jsx_runtime.jsx)(CompletedGlyph, {});
				case "in_progress": return (0, react_jsx_runtime.jsx)(ProgressGlyph, {});
				case "pending": return (0, react_jsx_runtime.jsx)(PendingGlyph, {});
				/* v8 ignore next -- closed TodoItem status union */
				default: return assertNever(status);
			}
		}
		/** Header summary: "·"-joined per-status counts; zero-count segments are omitted as noise (a non-empty list keeps at least one). */
		function progressLabel(todos, t) {
			const done = todos.filter((item) => item.status === "completed").length;
			const active = todos.filter((item) => item.status === "in_progress").length;
			const pending = todos.length - done - active;
			return [
				...done > 0 ? [t("todo.progress.done", { done })] : [],
				...active > 0 ? [t("todo.progress.active", { active })] : [],
				...pending > 0 ? [t("todo.progress.pending", { pending })] : []
			].join(" · ");
		}
		function TodoPanel({ todos, t }) {
			const [collapsed, setCollapsed] = (0, react.useState)(true);
			if (todos.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("section", {
				className: TodoPanel_module_css_default.root,
				"data-testid": "todo-panel",
				"aria-label": t("todo.title"),
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: TodoPanel_module_css_default.body,
					children: [(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: TodoPanel_module_css_default.header,
						"aria-expanded": !collapsed,
						onClick: () => {
							setCollapsed((v) => !v);
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.lead,
								"aria-hidden": true,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChecklistOutline14, {})
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.title,
								children: t("todo.title")
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.progress,
								children: progressLabel(todos, t)
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.chevron,
								"aria-hidden": true,
								children: collapsed ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
							})
						]
					}), !collapsed && (0, react_jsx_runtime.jsx)("ul", {
						className: TodoPanel_module_css_default.list,
						children: todos.map((item) => (0, react_jsx_runtime.jsxs)("li", {
							className: TodoPanel_module_css_default.item,
							"data-status": item.status,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.glyph,
								"aria-hidden": true,
								children: (0, react_jsx_runtime.jsx)(StatusGlyph, { status: item.status })
							}), (0, react_jsx_runtime.jsx)("span", {
								className: TodoPanel_module_css_default.content,
								children: item.content
							})]
						}, item.content))
					})]
				})
			});
		}
		/** Dock adapter: reads the host-computed 'todos' projection (whole list; absent or null renders nothing). */
		function TodoDock({ useProjection, t }) {
			return (0, react_jsx_runtime.jsx)(TodoPanel, {
				todos: useProjection("todos") ?? [],
				t
			});
		}
		/**
		* The plan strip as a plain registrant plugin (QueueDock posture), following
		* the input-dock declaration across independent activation and reload.
		*/
		const todoDockEntry = {
			name: "conversation-todo-dock",
			inject: ["slots"],
			/**
			* Register the plan strip before the goal and queue entries (order 0).
			* @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
			*/
			apply(ctx) {
				ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
					name: "conversation.input.dock",
					id: "todo",
					order: 0,
					locale: NS
				}, TodoDock));
			}
		};
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.module.css.mjs
		const css$8 = "._7yHdaG_dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);padding:0 var(--dsh-composer-dock-inset);flex:none}._7yHdaG_panel{background:var(--dsw-specific-tip);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px 12px 0 0;width:100%;padding:2px 0;position:relative;overflow:hidden}._7yHdaG_panel:after{border:1px solid var(--dsw-alias-border-l1);border-radius:inherit;content:\"\";pointer-events:none;border-bottom:none;position:absolute;inset:0}._7yHdaG_header{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:10px;padding:4px 12px;display:flex}._7yHdaG_header:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}._7yHdaG_header:disabled{cursor:default}._7yHdaG_lead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}._7yHdaG_count{min-width:0;font-family:Inter, var(--dsw-font-family);flex:auto;font-size:13px;font-weight:500;line-height:24px}._7yHdaG_chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}._7yHdaG_list{max-height:180px;margin:0;padding:0;list-style:none;overflow-y:auto}._7yHdaG_row{box-sizing:border-box;border-radius:8px;align-items:center;gap:10px;width:100%;height:36px;padding:4px 5px 4px 12px;display:flex}._7yHdaG_row+._7yHdaG_row{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}._7yHdaG_preview,._7yHdaG_editor{min-width:0;font:var(--dsw-font-xs-13);font-family:Inter, var(--dsw-font-family);flex:auto}._7yHdaG_preview{color:var(--dsw-alias-label-primary-dimmed);text-overflow:ellipsis;white-space:nowrap;word-break:break-word;overflow:hidden}._7yHdaG_editor{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);height:28px;color:var(--dsw-alias-label-primary);border-radius:6px;outline:none;padding:0 8px}._7yHdaG_editor:focus{border-color:var(--dsw-alias-state-business-primary)}._7yHdaG_actions{flex:none;align-items:center;gap:10px;display:flex}._7yHdaG_action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}._7yHdaG_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._7yHdaG_action:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}._7yHdaG_action:disabled{cursor:default;opacity:.45}";
		const tagId$8 = "@deepseek-ai/dsh-client-ui-conversation/QueueDock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$8) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$8;
			tag.textContent = css$8;
			document.head.appendChild(tag);
		}
		var QueueDock_module_css_default = {
			"dock": "_7yHdaG_dock",
			"list": "_7yHdaG_list",
			"panel": "_7yHdaG_panel",
			"row": "_7yHdaG_row",
			"header": "_7yHdaG_header",
			"count": "_7yHdaG_count",
			"preview": "_7yHdaG_preview",
			"actions": "_7yHdaG_actions",
			"action": "_7yHdaG_action",
			"lead": "_7yHdaG_lead",
			"editor": "_7yHdaG_editor",
			"chevron": "_7yHdaG_chevron"
		};
		//#endregion
		//#region lib/types/client/queue/QueueDock.js
		/**
		* Queue strip: one item renders directly; multiple items default to a
		* collapsible count header; an empty queue renders nothing.
		*/
		function QueueDock({ useSession, updateQueue, notify, t }) {
			const inbox = useSession((s) => s.queue);
			const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued"), [inbox]);
			const running = useSession((s) => s.running);
			const queueMutable = useSession((s) => s.subagent === null);
			const [editing, setEditing] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [collapsed, setCollapsed] = (0, react.useState)(true);
			const listId = (0, react.useId)();
			(0, react.useEffect)(() => {
				if (queue.length === 0 && !collapsed) setCollapsed(true);
				if (editing !== null && (!queueMutable || !queue.some((row) => row.id === editing.id))) setEditing(null);
			}, [
				collapsed,
				editing,
				queue,
				queueMutable
			]);
			if (queue.length === 0) return null;
			const interactionActive = queueMutable && (editing !== null || busy !== null);
			const expanded = !collapsed || interactionActive;
			const listVisible = queue.length === 1 || expanded;
			const applyAction = async (itemId, action, failure) => {
				setBusy(itemId);
				try {
					await updateQueue(itemId, action);
					return true;
				} catch {
					notify("error", failure);
					return false;
				} finally {
					setBusy((current) => current === itemId ? null : current);
				}
			};
			const saveEdit = async () => {
				if (editing === null || editing.text.trim() === "") return;
				if (await applyAction(editing.id, {
					kind: "edit",
					content: [{
						type: "text",
						text: editing.text
					}]
				}, t("queue.editFailed"))) setEditing(null);
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: QueueDock_module_css_default.dock,
				"data-queue-dock": "",
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: QueueDock_module_css_default.panel,
					children: [queue.length > 1 && (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: QueueDock_module_css_default.header,
						"aria-controls": listId,
						"aria-expanded": expanded,
						disabled: interactionActive,
						onClick: () => {
							setCollapsed((value) => !value);
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: QueueDock_module_css_default.lead,
								"aria-hidden": true,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconQueueOutline14, {})
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: QueueDock_module_css_default.count,
								children: t("queue.count", { n: queue.length })
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: QueueDock_module_css_default.chevron,
								"aria-hidden": true,
								children: expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, {})
							})
						]
					}), (0, react_jsx_runtime.jsx)("ul", {
						id: listId,
						className: QueueDock_module_css_default.list,
						hidden: !listVisible,
						children: listVisible && queue.map((row) => (0, react_jsx_runtime.jsxs)("li", {
							className: QueueDock_module_css_default.row,
							children: [
								queue.length === 1 && (0, react_jsx_runtime.jsx)("span", {
									className: QueueDock_module_css_default.lead,
									"aria-hidden": true,
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconQueueOutline14, {})
								}),
								editing?.id === row.id ? (0, react_jsx_runtime.jsx)("input", {
									autoFocus: true,
									className: QueueDock_module_css_default.editor,
									"aria-label": t("queue.edit"),
									value: editing.text,
									onChange: (event) => {
										setEditing({
											id: row.id,
											text: event.currentTarget.value
										});
									},
									onKeyDown: (event) => {
										if (event.key === "Escape") {
											setEditing(null);
											return;
										}
										if (event.key === "Enter" && !event.nativeEvent.isComposing) {
											event.preventDefault();
											saveEdit();
										}
									}
								}) : (0, react_jsx_runtime.jsx)("span", {
									className: QueueDock_module_css_default.preview,
									children: row.preview
								}),
								queueMutable && (0, react_jsx_runtime.jsx)("div", {
									className: QueueDock_module_css_default.actions,
									children: editing?.id === row.id ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t("queue.save"),
										side: "bottom",
										delayMs: 500,
										children: (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: QueueDock_module_css_default.action,
											"aria-label": t("queue.save"),
											disabled: busy !== null || editing.text.trim() === "",
											onClick: () => {
												saveEdit();
											},
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })
										})
									}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t("queue.cancelEdit"),
										side: "bottom",
										delayMs: 500,
										children: (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: QueueDock_module_css_default.action,
											"aria-label": t("queue.cancelEdit"),
											disabled: busy !== null,
											onClick: () => {
												setEditing(null);
											},
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
										})
									})] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("queue.edit"),
											side: "bottom",
											delayMs: 500,
											disabled: row.text === null,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: QueueDock_module_css_default.action,
												"aria-label": t("queue.edit"),
												title: row.text === null ? t("queue.edit.unsupported") : void 0,
												disabled: busy !== null || row.text === null,
												onClick: () => {
													if (row.text !== null) setEditing({
														id: row.id,
														text: row.text
													});
												},
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, { size: 14 })
											})
										}),
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("queue.remove"),
											side: "bottom",
											delayMs: 500,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: QueueDock_module_css_default.action,
												"aria-label": t("queue.remove"),
												disabled: busy !== null,
												onClick: () => {
													applyAction(row.id, { kind: "remove" }, t("queue.removeFailed"));
												},
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, { size: 14 })
											})
										}),
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("queue.steer"),
											side: "bottom",
											delayMs: 500,
											disabled: !running,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: QueueDock_module_css_default.action,
												"aria-label": t("queue.steer"),
												title: running ? void 0 : t("queue.steer.unavailable"),
												disabled: busy !== null || !running,
												onClick: () => {
													applyAction(row.id, { kind: "steer" }, t("queue.steerFailed"));
												},
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSendOutline14, {})
											})
										})
									] })
								})
							]
						}, row.id))
					})]
				})
			});
		}
		/**
		* The dock entry as a plain registrant plugin. The conversation service is
		* the action contract; the slot declaration has an independent lifecycle boundary.
		*/
		const queueDockEntry = {
			name: "conversation-queue-dock",
			inject: [
				"slots",
				"conversation",
				"sessions"
			],
			/**
			* Register the queue strip as the terminal input-dock entry (order 20).
			* @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
			*/
			apply(ctx) {
				ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
					name: "conversation.input.dock",
					id: "queue",
					order: 20,
					locale: NS,
					inject: (sessionId) => {
						const actx = ctx.sessions.scope(sessionId);
						if (actx === void 0) throw new Error(`queue dock: session "${sessionId}" resolved no scope`);
						const conversation = actx.get("conversation");
						if (conversation === void 0) throw new Error("queue dock: conversation service unavailable");
						return {
							updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
							notify: (level, text) => {
								conversation.input.for(actx).notify(level, text);
							}
						};
					}
				}, QueueDock));
			}
		};
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css.mjs
		const css$7 = ".pXSMma_root{justify-content:center;align-items:center;min-width:0;height:100%;padding:0 24px;display:flex}.pXSMma_stack{width:100%;max-width:var(--dsh-composer-card-max-width);flex-direction:column;align-items:stretch;gap:12px;display:flex;overflow:visible}.pXSMma_headline{color:var(--dsw-alias-label-primary);grid-template-columns:34px auto auto;justify-content:center;align-items:center;column-gap:10px;font-size:26px;font-weight:500;line-height:32px;display:grid}.pXSMma_headlineText{grid-area:1/2}.pXSMma_previewBadge{border:1px solid var(--dsw-alias-interactive-bg-hover);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish);font-family:var(--ds-font-family-code);white-space:nowrap;border-radius:24px;grid-area:1/3;align-self:start;margin-top:2px;margin-left:-3px;padding:1px 7px 0;font-size:12px;font-weight:500;line-height:18px}.pXSMma_fishHitbox{grid-area:1/1;justify-content:center;align-items:center;display:inline-flex}.pXSMma_fish{color:var(--dsw-alias-label-primary);transform-origin:50% 60%}@keyframes pXSMma_hero-fish-swim{0%,to{transform:translate(0)rotate(0)}35%{transform:translate(-1px,-1px)rotate(-5deg)}70%{transform:translate(1px)rotate(3deg)}}@media (hover:hover) and (prefers-reduced-motion:no-preference){.pXSMma_fishHitbox:hover .pXSMma_fish{animation:pXSMma_hero-fish-swim var(--ds-transition-duration-slow) var(--ds-ease-in-out)}}.pXSMma_body{flex-direction:column;gap:12px;min-width:0;display:flex;position:relative;overflow:visible}.pXSMma_body>*{z-index:1;position:relative}.pXSMma_body>.pXSMma_workspaceRow{z-index:10;align-items:center;min-width:0;padding-left:8px;display:flex}.pXSMma_workspace{max-width:min(100%,360px);min-height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:16px;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.pXSMma_workspace:not(:disabled):hover,.pXSMma_workspace[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.pXSMma_workspace:disabled{cursor:default}.pXSMma_folder{color:var(--dsw-alias-label-primary);flex:none}.pXSMma_workspaceLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.pXSMma_chevron{color:var(--dsw-alias-label-caption);flex:none}.pXSMma_modalInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}.pXSMma_modalInput::placeholder{color:var(--dsw-alias-label-caption)}.pXSMma_modalInput:disabled{color:var(--dsw-alias-label-dimmed)}.pXSMma_modalAction{min-width:72px}.pXSMma_modalError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}";
		const tagId$7 = "@deepseek-ai/dsh-client-ui-conversation/HeroShell.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$7) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$7;
			tag.textContent = css$7;
			document.head.appendChild(tag);
		}
		var HeroShell_module_css_default = {
			"workspaceLabel": "pXSMma_workspaceLabel",
			"headline": "pXSMma_headline",
			"chevron": "pXSMma_chevron",
			"fish": "pXSMma_fish",
			"stack": "pXSMma_stack",
			"workspace": "pXSMma_workspace",
			"modalInput": "pXSMma_modalInput",
			"modalError": "pXSMma_modalError",
			"modalAction": "pXSMma_modalAction",
			"body": "pXSMma_body",
			"hero-fish-swim": "pXSMma_hero-fish-swim",
			"workspaceRow": "pXSMma_workspaceRow",
			"folder": "pXSMma_folder",
			"root": "pXSMma_root",
			"fishHitbox": "pXSMma_fishHitbox",
			"headlineText": "pXSMma_headlineText",
			"previewBadge": "pXSMma_previewBadge"
		};
		//#endregion
		//#region lib/types/client/skeleton/EmptyHero.js
		/**
		* Basename label for the workspace chip (the shared derivation);
		* separator-only paths echo the raw cwd.
		* @param cwd - workspace directory path (non-empty).
		* @returns chip label.
		*/
		function workspaceLabel(cwd) {
			const base = (0, _deepseek_ai_dsh_client_runtime_client.workspaceTitleOf)(cwd);
			return base !== "" ? base : cwd;
		}
		/**
		* The workspace chip (folder + label + chevron), always interactive: before
		* the first message the workspace stays switchable — picking another one
		* moves the New Session flow to that workspace's blank session. Without a
		* label the chip renders its placeholder state: closed folder + the
		* "Choose workspace" call to action.
		* @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
		* @param props.menuOpen - menu expansion echo.
		* @param props.onClick - menu toggle.
		* @returns the chip button element.
		*/
		function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				ref: buttonRef,
				type: "button",
				className: HeroShell_module_css_default.workspace,
				"aria-label": t("hero.chooseWorkspace"),
				"aria-haspopup": "menu",
				"aria-expanded": menuOpen,
				onClick,
				children: [
					label === void 0 ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {
						className: HeroShell_module_css_default.folder,
						size: 16
					}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {
						className: HeroShell_module_css_default.folder,
						size: 16
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: HeroShell_module_css_default.workspaceLabel,
						children: label ?? t("hero.chooseWorkspace")
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
						className: HeroShell_module_css_default.chevron,
						size: 12
					})
				]
			});
		}
		/**
		* The soft blue backdrop ellipse (figma 313:14109). Rendered by the hero
		* owner (ConversationRoot), not HeroShell, so it can center on the input
		* card; the owner's className supplies all positioning.
		* @param props.className - positioning class from the owner.
		* @returns the blurred-ellipse svg element.
		*/
		function HeroGlow({ className }) {
			const glowFilterId = `empty-glow-${(0, react.useId)().replace(/:/g, "")}`;
			return (0, react_jsx_runtime.jsxs)("svg", {
				className,
				viewBox: "0 0 1051 468",
				fill: "none",
				"aria-hidden": "true",
				children: [(0, react_jsx_runtime.jsx)("defs", { children: (0, react_jsx_runtime.jsxs)("filter", {
					id: glowFilterId,
					x: "0",
					y: "0",
					width: "1051",
					height: "468",
					filterUnits: "userSpaceOnUse",
					colorInterpolationFilters: "sRGB",
					children: [
						(0, react_jsx_runtime.jsx)("feFlood", {
							floodOpacity: "0",
							result: "BackgroundImageFix"
						}),
						(0, react_jsx_runtime.jsx)("feBlend", {
							mode: "normal",
							in: "SourceGraphic",
							in2: "BackgroundImageFix",
							result: "shape"
						}),
						(0, react_jsx_runtime.jsx)("feGaussianBlur", {
							stdDeviation: "50",
							result: "effect1_foregroundBlur"
						})
					]
				}) }), (0, react_jsx_runtime.jsx)("g", {
					filter: `url(#${glowFilterId})`,
					children: (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "525.5",
						cy: "234",
						rx: "425.5",
						ry: "134",
						fill: "#6187D8",
						fillOpacity: "0.08"
					})
				})]
			});
		}
		/**
		* Render the hero chrome (headline only; no glow, no composer, no workspace
		* row — the glow is the owner's {@link HeroGlow}).
		* @param props - see {@link HeroShellProps}.
		* @returns the centered hero element tree.
		*/
		function HeroShell({ t, children }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: HeroShell_module_css_default.root,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: HeroShell_module_css_default.stack,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: HeroShell_module_css_default.headline,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: HeroShell_module_css_default.fishHitbox,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, {
									size: 34,
									className: HeroShell_module_css_default.fish
								})
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: HeroShell_module_css_default.headlineText,
								children: t("hero.headline")
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: HeroShell_module_css_default.previewBadge,
								children: t("hero.preview")
							})
						]
					}), (0, react_jsx_runtime.jsx)("div", { className: HeroShell_module_css_default.body })]
				}), children]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css.mjs
		const css$6 = ".wSkVaW_root{background:var(--dsw-alias-bg-base);--dsh-chat-content-width:748px;--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;flex-direction:column;min-width:0;height:100%;display:flex}.wSkVaW_header{border-bottom:1px solid #0000;flex:none;padding:12px 28px 0 20px;position:relative}.wSkVaW_header:after{content:\"\";z-index:0;background:var(--dsw-alias-border-l2);pointer-events:none;height:1px;position:absolute;bottom:1px;left:0;right:0}.wSkVaW_headerHidden{display:none}.wSkVaW_titleRow{align-items:center;gap:0;min-height:32px;display:flex}.wSkVaW_titleCluster{flex:1;align-items:center;gap:10px;min-width:0;display:flex}.wSkVaW_crumbs{white-space:nowrap;align-items:center;gap:4px;min-width:0;display:flex;overflow:hidden}.wSkVaW_crumbSeg{align-items:center;gap:4px;min-width:0;display:inline-flex}.wSkVaW_crumbSep{color:var(--dsw-alias-label-caption);font-size:14px;line-height:20px}.wSkVaW_crumb{max-width:220px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:12px;padding:4px 8px;font-size:14px;line-height:20px;overflow:hidden}.wSkVaW_crumb:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.wSkVaW_crumbCurrent{color:var(--dsw-alias-label-primary);cursor:default;font-weight:500}.wSkVaW_headerActions{flex:none;align-items:center;gap:8px;display:flex}.wSkVaW_headerUtilities{flex:none;align-items:center;gap:8px;margin-left:20px;display:flex}.wSkVaW_headerUtilities:empty{display:none}.wSkVaW_tabs{z-index:1;gap:36px;margin-top:4px;padding-left:8px;display:flex;position:relative}.wSkVaW_tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:0 0 11px;font-size:13px;font-weight:500;line-height:16px;position:relative}.wSkVaW_tab:after{content:\"\";background:0 0;border-radius:2px;height:2px;position:absolute;bottom:1px;left:0;right:0}.wSkVaW_tabActive{color:var(--dsw-alias-state-business-primary)}.wSkVaW_tabActive:after{background:var(--dsw-alias-state-business-primary)}.wSkVaW_viewArea{flex-direction:column;flex:1;min-height:0;display:flex}.wSkVaW_composerStack{--dsh-composer-stack-gap:6px;gap:var(--dsh-composer-stack-gap);flex-direction:column;display:flex}.wSkVaW_composerSeat{--dsh-composer-text-max-height:336px;flex-direction:column;flex:none;display:flex}.wSkVaW_root[data-phase=active]{overflow:hidden}.wSkVaW_root[data-phase=active] .wSkVaW_header{flex:none}.wSkVaW_scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;display:flex;overflow:hidden auto}.wSkVaW_root[data-phase=active] .wSkVaW_viewArea{flex:1 0 auto;min-height:auto}.wSkVaW_root[data-phase=active] .wSkVaW_composerSeat{z-index:7;background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px);position:sticky;bottom:0}.wSkVaW_scrollBody:has([data-conversation-composer-overlay]){scrollbar-gutter:auto;position:relative;overflow:hidden auto}.wSkVaW_scrollBody:has([data-conversation-composer-overlay])>[data-slot=conversation\\.session]>.wSkVaW_viewArea{flex:1 1 0;min-height:0;overflow:hidden}.wSkVaW_scrollBody:has([data-conversation-composer-overlay])>.wSkVaW_composerSeat{right:var(--dsh-scrollbar-width);position:absolute;bottom:0;left:0}.wSkVaW_composerHero{width:min(calc(var(--dsh-composer-card-max-width) + 2 * var(--dsh-composer-side-clearance)), 100%);z-index:1;align-self:center;gap:8px;padding-bottom:32px;position:relative}.wSkVaW_heroGlow{z-index:-1;aspect-ratio:1051/468;pointer-events:none;width:135.438%;position:absolute;bottom:92px;left:50%;transform:translate(-50%,50%)}.wSkVaW_heroWorkspaceRow{align-items:center;gap:2px;min-width:0;margin-top:4px;padding-left:20px;display:flex}.wSkVaW_root[data-phase=hero] .wSkVaW_scrollBody{justify-content:center;overflow-y:auto}.wSkVaW_root[data-phase=settling] .wSkVaW_composerSeat{visibility:hidden}";
		const tagId$6 = "@deepseek-ai/dsh-client-ui-conversation/ConversationRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$6) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$6;
			tag.textContent = css$6;
			document.head.appendChild(tag);
		}
		var ConversationRoot_module_css_default = {
			"headerActions": "wSkVaW_headerActions",
			"crumb": "wSkVaW_crumb",
			"tab": "wSkVaW_tab",
			"tabs": "wSkVaW_tabs",
			"titleRow": "wSkVaW_titleRow",
			"composerHero": "wSkVaW_composerHero",
			"header": "wSkVaW_header",
			"crumbCurrent": "wSkVaW_crumbCurrent",
			"headerHidden": "wSkVaW_headerHidden",
			"viewArea": "wSkVaW_viewArea",
			"heroWorkspaceRow": "wSkVaW_heroWorkspaceRow",
			"titleCluster": "wSkVaW_titleCluster",
			"composerStack": "wSkVaW_composerStack",
			"scrollBody": "wSkVaW_scrollBody",
			"crumbSeg": "wSkVaW_crumbSeg",
			"crumbSep": "wSkVaW_crumbSep",
			"headerUtilities": "wSkVaW_headerUtilities",
			"tabActive": "wSkVaW_tabActive",
			"heroGlow": "wSkVaW_heroGlow",
			"composerSeat": "wSkVaW_composerSeat",
			"crumbs": "wSkVaW_crumbs",
			"root": "wSkVaW_root"
		};
		//#endregion
		//#region lib/types/client/skeleton/ConversationRoot.js
		function ConversationRoot({ sessionId, useSession, useSessions, useWorkspaces, useInput, useComposerBlock, renderSlot, renderSlotChain, selectWorkspace, t }) {
			const openState = useSession((s) => s.openState);
			const composerPhase = useSession((s) => s.composerPhase);
			const pending = useSession((s) => s.pending) ?? [];
			const session = useSession((s) => s);
			const inputState = useInput((s) => s);
			const cwd = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd);
			const summaryBlank = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.blank);
			const workspaces = useWorkspaces((s) => s);
			const composerBlock = useComposerBlock((block) => block);
			const [pickerOpen, setPickerOpen] = (0, react.useState)(false);
			const [pendingWorkspaceId, setPendingWorkspaceId] = (0, react.useState)();
			const pickerAnchor = (0, react.useRef)(null);
			const seatObserver = (0, react.useRef)(null);
			const seatResizeRef = (0, react.useCallback)((seat) => {
				seatObserver.current?.disconnect();
				seatObserver.current = null;
				const scroller = seat?.parentElement ?? null;
				if (seat === null || scroller === null) return;
				seatObserver.current = new ResizeObserver(() => {
					scroller.style.setProperty("--dsh-composer-height", `${seat.offsetHeight}px`);
				});
				seatObserver.current.observe(seat);
			}, []);
			const sessionWorkspace = sessionId === void 0 ? void 0 : workspaces.items.find((workspace) => workspace.sessionIds.includes(sessionId));
			const pendingWorkspace = workspaces.items.find((workspace) => workspace.workspaceId === pendingWorkspaceId);
			(0, react.useEffect)(() => {
				if (pendingWorkspaceId === void 0) return;
				if (sessionWorkspace?.workspaceId === pendingWorkspaceId || workspaces.phase === "ready" && pendingWorkspace === void 0) setPendingWorkspaceId(void 0);
			}, [
				pendingWorkspaceId,
				sessionWorkspace?.workspaceId,
				workspaces.phase,
				pendingWorkspace
			]);
			const settling = sessionId !== void 0 && composerPhase === "blank" && openState === "loading" && summaryBlank !== true;
			const hero = sessionId === void 0 || composerPhase === "blank" && (openState === "open" || summaryBlank === true);
			const zone = session === void 0 || inputState === void 0 ? void 0 : {
				session,
				input: inputState
			};
			const chipTitle = pendingWorkspace?.title ?? (sessionId === void 0 ? void 0 : sessionWorkspace?.title ?? (workspaces.phase === "ready" || cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd)));
			const heroWorkspaceRow = (0, react_jsx_runtime.jsxs)("div", {
				className: ConversationRoot_module_css_default.heroWorkspaceRow,
				children: [
					(0, react_jsx_runtime.jsx)(WorkspaceChip, {
						buttonRef: pickerAnchor,
						label: chipTitle,
						menuOpen: pickerOpen,
						onClick: () => {
							setPickerOpen((open) => !open);
						},
						t
					}),
					renderSlot("conversation.hero.workspace", {
						open: pickerOpen,
						anchorRef: pickerAnchor,
						selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
						onPick: (workspaceId) => {
							setPickerOpen(false);
							setPendingWorkspaceId(workspaceId);
							selectWorkspace(workspaceId).catch(() => {
								setPendingWorkspaceId((current) => current === workspaceId ? void 0 : current);
							});
						},
						onClose: () => {
							setPickerOpen(false);
						}
					}),
					renderSlot("conversation.hero.agentPreset", {})
				]
			});
			const inert = sessionId === void 0 || hero && chipTitle === void 0;
			const inputBar = renderSlot("conversation.composer.bar", {
				variant: hero ? "hero" : "composer",
				...inert ? {
					disabled: true,
					placeholder: t("placeholder.workspace"),
					workspacePickerOpen: pickerOpen,
					onRequestWorkspace: () => {
						setPickerOpen(true);
					}
				} : !inert && composerBlock !== void 0 ? {
					blocked: composerBlock,
					placeholder: composerBlock.reason
				} : hero ? { placeholder: t("placeholder.hero") } : {},
				overlay: renderSlot("conversation.input.overlay", {}),
				leftItems: zone === void 0 ? null : renderSlot("conversation.input.left", zone),
				rightItems: zone === void 0 ? null : renderSlot("conversation.input.right", zone),
				footer: !hero && zone !== void 0 ? renderSlot("conversation.composer.dock", zone) : null
			});
			const composerBar = (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(ConversationRoot_module_css_default.composerStack, hero && ConversationRoot_module_css_default.composerHero),
				children: [
					hero && (0, react_jsx_runtime.jsx)(HeroGlow, { className: ConversationRoot_module_css_default.heroGlow }),
					hero && (0, react_jsx_runtime.jsx)(HeroShell, { t }),
					hero && heroWorkspaceRow,
					zone !== void 0 && renderSlot("conversation.input.dock", zone),
					inputBar
				]
			});
			const phase = settling ? "settling" : hero ? "hero" : "active";
			const composer = renderSlotChain("conversation.composer", {
				interactions: pending,
				session
			}, {
				fallback: composerBar,
				overlay: true
			});
			const composerSeat = (0, react_jsx_runtime.jsx)("div", {
				ref: seatResizeRef,
				className: ConversationRoot_module_css_default.composerSeat,
				"data-composer-seat": "",
				children: composer
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ConversationRoot_module_css_default.root,
				"data-phase": phase,
				children: [renderSlot("conversation.session.header", {}), (0, react_jsx_runtime.jsxs)("div", {
					className: ConversationRoot_module_css_default.scrollBody,
					"data-conversation-scroll": "",
					children: [renderSlot("conversation.session", {}), composerSeat]
				})]
			});
		}
		//#endregion
		//#region lib/types/client/skeleton/ConversationSession.js
		/** Strict per-session header/body content inserted into the resident conversation layout. */
		const DEFAULT_VIEW_ID = "chat";
		/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
		function resolveActiveView(tabs, selectedId) {
			const requestedId = selectedId ?? DEFAULT_VIEW_ID;
			return tabs.find((view) => view.id === requestedId) ?? tabs.find((view) => view.id === DEFAULT_VIEW_ID);
		}
		function deriveAncestry(list, id) {
			const chain = [];
			const seen = /* @__PURE__ */ new Set();
			let cursor = id;
			while (cursor !== void 0) {
				if (seen.has(cursor)) break;
				seen.add(cursor);
				const summary = list.byId[cursor];
				if (summary === void 0) break;
				chain.unshift({
					id: summary.id,
					displayTitle: summary.displayTitle
				});
				if (summary.origin !== "subagent") break;
				cursor = summary.parentId;
			}
			return chain;
		}
		function equalBreadcrumbs(left, right) {
			return left.length === right.length && left.every((item, index) => {
				const other = right.at(index);
				return other !== void 0 && item.id === other.id && item.displayTitle === other.displayTitle;
			});
		}
		/**
		* Renders Session header chrome above the resident conversation scrollport.
		* @param props - Strict Session store, view ledger, navigation, render, and locale shares.
		* @returns the hidden blank-session header or visible title and tabs.
		*/
		function ConversationSessionHeader({ sessionId, useSession, useSessions, useStore, actions, renderSlot, views, open, t }) {
			(0, react.useSyncExternalStore)(views.subscribe, views.version);
			const tabs = views.list();
			const active = resolveActiveView(tabs, useStore((s) => s.view));
			const ancestry = useSessions((s) => deriveAncestry(s, sessionId), equalBreadcrumbs);
			const composerPhase = useSession((s) => s.composerPhase);
			const hideChrome = useSession((s) => s.blank) && composerPhase === "blank";
			return (0, react_jsx_runtime.jsx)("header", {
				className: clsx(ConversationRoot_module_css_default.header, hideChrome && ConversationRoot_module_css_default.headerHidden),
				"aria-hidden": hideChrome || void 0,
				children: !hideChrome && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ConversationRoot_module_css_default.titleRow,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: ConversationRoot_module_css_default.titleCluster,
						children: [(0, react_jsx_runtime.jsxs)("nav", {
							className: ConversationRoot_module_css_default.crumbs,
							"aria-label": t("session.hierarchy"),
							children: [ancestry.map((summary, index) => {
								const last = index === ancestry.length - 1;
								return (0, react_jsx_runtime.jsxs)("span", {
									className: ConversationRoot_module_css_default.crumbSeg,
									children: [index > 0 && (0, react_jsx_runtime.jsx)("span", {
										className: ConversationRoot_module_css_default.crumbSep,
										children: "/"
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: clsx(ConversationRoot_module_css_default.crumb, last && ConversationRoot_module_css_default.crumbCurrent),
										disabled: last,
										onClick: () => {
											open(summary.id);
										},
										children: summary.displayTitle
									})]
								}, summary.id);
							}), ancestry.length === 0 && (0, react_jsx_runtime.jsx)("span", {
								className: ConversationRoot_module_css_default.crumbCurrent,
								children: sessionId
							})]
						}), (0, react_jsx_runtime.jsx)("div", {
							className: ConversationRoot_module_css_default.headerActions,
							children: renderSlot("conversation.session.header.actions", {})
						})]
					}), (0, react_jsx_runtime.jsx)("div", {
						className: ConversationRoot_module_css_default.headerUtilities,
						children: renderSlot("conversation.session.header.utilities", {})
					})]
				}), tabs.length > 1 && (0, react_jsx_runtime.jsx)("div", {
					className: ConversationRoot_module_css_default.tabs,
					role: "tablist",
					children: tabs.map((viewTab) => (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						"aria-selected": viewTab.id === active?.id,
						className: clsx(ConversationRoot_module_css_default.tab, viewTab.id === active?.id && ConversationRoot_module_css_default.tabActive),
						onClick: () => {
							actions.setView(viewTab.id);
						},
						children: viewTab.label
					}, viewTab.id))
				})] })
			});
		}
		/**
		* Renders the active Session view inside the resident scrollport and keeps
		* the input draft mirrored while blank Hero chrome is visible.
		* @param props - Strict Session input/store, view ledger, and render shares.
		* @returns the active view area, or null while the Session remains blank.
		*/
		function ConversationSession({ sessionId, useSession, useInput, inputActions, useStore, actions, renderSlot, views, bindDraftMirror, releaseSessionImages }) {
			(0, react.useSyncExternalStore)(views.subscribe, views.version);
			const active = resolveActiveView(views.list(), useStore((s) => s.view));
			const composerPhase = useSession((s) => s.composerPhase);
			const blank = useSession((s) => s.blank);
			const inputState = useInput((s) => s);
			const storedDraft = useStore((s) => s.draft);
			const inspect = useStore((s) => s.inspect ?? null);
			(0, react.useEffect)(() => {
				if (inputState.draft === "" && storedDraft !== "") inputActions.setDraft(storedDraft);
				const unmirror = bindDraftMirror(actions.setDraft);
				return () => {
					unmirror();
				};
			}, [inputActions]);
			(0, react.useEffect)(() => () => {
				releaseSessionImages(sessionId);
			}, [releaseSessionImages, sessionId]);
			if (blank && composerPhase === "blank") return null;
			return (0, react_jsx_runtime.jsx)("div", {
				className: ConversationRoot_module_css_default.viewArea,
				children: active !== void 0 && renderSlot("conversation.view", {
					inspect,
					onInspectDone: () => {
						actions.setInspect(null);
					}
				}, { only: active.id })
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/DetailsPanel.module.css.mjs
		const css$5 = ".ydkMvW_root{border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex}.ydkMvW_header{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:8px;padding:14px 12px 12px;display:flex}.ydkMvW_title{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.ydkMvW_close{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;display:grid}.ydkMvW_close:hover{background:var(--dsw-alias-interactive-bg-hover)}.ydkMvW_body{flex:1;min-height:0;padding:12px 16px;overflow-y:auto}.ydkMvW_empty{color:var(--dsw-alias-label-tertiary);padding:8px 0;font-size:13px;line-height:20px}.ydkMvW_section{margin-bottom:16px}.ydkMvW_sectionLabel{color:var(--dsw-alias-label-secondary);margin-bottom:6px;font-size:12px;font-weight:500;line-height:18px}.ydkMvW_code{background:var(--dsw-alias-markdown-code-block);font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;border-radius:12px;margin:0;padding:16px;font-size:13px;line-height:22px}.ydkMvW_code[data-error]{color:var(--dsw-alias-state-error-primary)}";
		const tagId$5 = "@deepseek-ai/dsh-client-ui-conversation/DetailsPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$5;
			tag.textContent = css$5;
			document.head.appendChild(tag);
		}
		var DetailsPanel_module_css_default = {
			"body": "ydkMvW_body",
			"code": "ydkMvW_code",
			"sectionLabel": "ydkMvW_sectionLabel",
			"section": "ydkMvW_section",
			"close": "ydkMvW_close",
			"root": "ydkMvW_root",
			"header": "ydkMvW_header",
			"title": "ydkMvW_title",
			"empty": "ydkMvW_empty"
		};
		//#endregion
		//#region lib/types/client/skeleton/DetailsPanel.js
		/** Material of a settled result node (native call or run_code sub-dispatch). */
		function settledMaterial(node, callId) {
			return {
				name: node.call?.name ?? callId,
				argsRaw: node.call?.argsRaw ?? null,
				block: node
			};
		}
		/** Material of an in-flight call (native call or run_code sub-dispatch). */
		function runningMaterial(call) {
			return {
				name: call.name,
				argsRaw: call.argsRaw,
				block: call
			};
		}
		function materialFor(s, callId) {
			const found = findToolCall(s, callId);
			if (found === void 0) return null;
			return "kind" in found ? settledMaterial(found, callId) : runningMaterial(found);
		}
		function pretty(raw) {
			try {
				return JSON.stringify(JSON.parse(raw), null, 2);
			} catch {
				return raw;
			}
		}
		/** Flatten a settled result for the no-ui-tool fallback. */
		function rawResultText(block) {
			if (!("kind" in block)) return "";
			const parts = block.content.map((item) => item.type === "text" ? item.text : JSON.stringify(item, null, 2));
			if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
			return parts.join("\n");
		}
		function DetailsPanel({ useSession, useSessions, sessionId, useStore, renderSlot, closeDetails, t }) {
			const selection = useStore((s) => s.selection);
			const sessionCwd = useSessions((list) => list.byId[sessionId]?.cwd);
			const callId = selection?.callId;
			const material = useSession((s) => callId === void 0 ? null : materialFor(s, callId), (a, b) => (0, _deepseek_ai_dsh_client_runtime_client.shallowEqual)(a, b));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: DetailsPanel_module_css_default.root,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: DetailsPanel_module_css_default.header,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.title,
						children: selection === null ? t("details.title") : material?.name ?? selection.toolName ?? t("details.title")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: DetailsPanel_module_css_default.close,
						"aria-label": t("details.close"),
						onClick: () => {
							closeDetails();
						},
						children: (0, react_jsx_runtime.jsx)("svg", {
							viewBox: "0 0 16 16",
							width: "14",
							height: "14",
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)("path", {
								d: "M4 4l8 8M12 4l-8 8",
								stroke: "currentColor",
								strokeWidth: "1.5",
								strokeLinecap: "round"
							})
						})
					})]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: DetailsPanel_module_css_default.body,
					children: selection === null || callId === void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.empty,
						children: t("details.empty")
					}) : material === null ? (0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.empty,
						children: t("details.notInWindow")
					}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [material.argsRaw !== null && (0, react_jsx_runtime.jsxs)("section", {
						className: DetailsPanel_module_css_default.section,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.sectionLabel,
							children: t("details.input")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.CodeBlock, {
							code: pretty(material.argsRaw),
							lang: "json",
							copyLabel: t("copy"),
							copiedLabel: t("copied")
						})]
					}), (0, react_jsx_runtime.jsxs)("section", {
						className: DetailsPanel_module_css_default.section,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.sectionLabel,
							children: t("details.output")
						}), (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderSlot("conversation.details.tool", {
							block: material.block,
							cwd: sessionCwd
						}, { fallback: "kind" in material.block ? (0, react_jsx_runtime.jsx)("pre", {
							className: DetailsPanel_module_css_default.code,
							"data-error": material.block.isError || void 0,
							children: rawResultText(material.block)
						}) : (0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.empty,
							children: t("details.running")
						}) }) }, callId)]
					})] })
				})]
			});
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/common.js
		/**
		* Relative positions in one durable event's seq neighborhood: interrupted
		* Assistant, its follow-up Nodes, then follow-ups to an ordinary final. The
		* max-tokens notice sits between a closing Assistant and the turn-tail so the
		* tail stays the turn's last node and keeps its branch action enabled.
		*/
		const CHAT_SYNTHETIC_SEQ_OFFSETS = {
			interruptedAssistant: -.9,
			interruptedFollowup: -.8,
			maxTokensNotice: .05,
			finalizedFollowup: .1
		};
		/**
		* Resolve one Context's best currently loaded event Location.
		* @param context - assembled business Context.
		* @returns start or first-match Location, otherwise unresolved.
		*/
		function contextLocation(context) {
			return context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
		}
		/**
		* Build one final Chat target Node with the engine-owned stable key.
		* @param context - assembled business Context.
		* @param kind - Chat renderer dispatch key.
		* @param anchorSeq - sortable render position.
		* @param data - renderer-owned payload.
		* @param options - optional Location and visibility overrides.
		* @returns final Chat view Node.
		*/
		function chatNode(context, kind, anchorSeq, data, options = {}) {
			return {
				key: context.key,
				kind,
				id: context.id,
				target: "chat",
				anchorSeq,
				location: options.location ?? contextLocation(context),
				visibility: options.visibility ?? "visible",
				data
			};
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/assistant.js
		function initialState(turn, step) {
			return {
				turn,
				step,
				blocks: [],
				firstVisibleSeq: void 0,
				firstVisibleTime: void 0,
				firstTokenTime: void 0,
				hidden: false,
				final: void 0,
				usage: void 0
			};
		}
		function compactBlocks(blocks) {
			return blocks.filter((block) => block !== void 0);
		}
		function hasVisibleContent(blocks) {
			return blocks.some((block) => {
				if (block.kind === "tool-call") return false;
				if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
				return true;
			});
		}
		function hasInterruptionEvidence(blocks) {
			return blocks.some((block) => {
				if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
				return true;
			});
		}
		function resetForRetry(state) {
			return {
				...initialState(state.turn, state.step),
				firstTokenTime: state.firstTokenTime,
				hidden: true
			};
		}
		function updateChunk(state, match) {
			if (match.event.type !== "assistant/chunk") return state;
			const chunk = match.event.data.chunk;
			const blocks = [...state.blocks];
			switch (chunk.type) {
				case "block-start":
					blocks[chunk.index] = (0, _deepseek_ai_dsh_client_runtime_client.emptyAssistantBlock)(chunk.blockType);
					break;
				case "text-delta": {
					const previous = blocks[chunk.index];
					blocks[chunk.index] = {
						kind: "text",
						text: (previous?.kind === "text" ? previous.text : "") + chunk.text
					};
					break;
				}
				case "reasoning-delta": {
					const previous = blocks[chunk.index];
					blocks[chunk.index] = {
						kind: "reasoning",
						text: (previous?.kind === "reasoning" ? previous.text : "") + chunk.text
					};
					break;
				}
				case "tool-call-delta": {
					const previous = blocks[chunk.index];
					const base = previous?.kind === "tool-call" ? previous : {
						kind: "tool-call",
						callId: "",
						name: "",
						argsRaw: ""
					};
					blocks[chunk.index] = {
						kind: "tool-call",
						callId: base.callId || String(chunk.id),
						name: chunk.name ?? base.name,
						argsRaw: base.argsRaw + chunk.argumentsDelta
					};
					break;
				}
				case "block-end":
					blocks[chunk.index] = (0, _deepseek_ai_dsh_client_runtime_client.toAssistantBlock)(chunk.block);
					break;
				case "usage": return {
					...state,
					usage: chunk.usage
				};
				default: return state;
			}
			const visible = hasVisibleContent(compactBlocks(blocks));
			const firstToken = (0, _deepseek_ai_dsh_client_runtime_client.isTokenDelta)(chunk);
			return {
				...state,
				blocks,
				hidden: visible ? false : state.hidden,
				...visible && state.firstVisibleSeq === void 0 ? {
					firstVisibleSeq: match.event.seq,
					firstVisibleTime: match.event.time
				} : {},
				...firstToken && state.firstTokenTime === void 0 ? { firstTokenTime: match.event.time } : {}
			};
		}
		function closedBoundary(location) {
			if (location.kind === "step" && location.step.status === "closed" && location.step.end !== void 0) return location.step.end;
			if ((location.kind === "step" || location.kind === "turn") && location.turn.status === "closed" && location.turn.end !== void 0) return location.turn.end;
		}
		function finalNode(state, context) {
			const final = state.final;
			if (final?.event.type === "assistant/message") {
				const event = final.event;
				return {
					kind: "assistant",
					seq: event.seq,
					messageId: event.data.message.id,
					time: event.time,
					turn: state.turn,
					step: state.step,
					blocks: (0, _deepseek_ai_dsh_client_runtime_client.toAssistantBlocks)(event.data.message.content),
					usage: event.data.usage,
					timing: {
						stepStartTime: context.start?.event.time ?? null,
						firstTokenTime: state.firstTokenTime ?? null,
						completedTime: event.time
					}
				};
			}
			const location = context.start?.location ?? context.matches.at(-1)?.location;
			const boundary = location === void 0 ? void 0 : closedBoundary(location);
			const blocks = compactBlocks(state.blocks);
			if (boundary === void 0 || !hasInterruptionEvidence(blocks)) return void 0;
			return {
				kind: "assistant",
				seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
				time: boundary.time,
				turn: state.turn,
				step: state.step,
				blocks,
				interrupted: true
			};
		}
		function fallbackState$4(context) {
			let state;
			for (const match of context.matches) {
				if (match.event.type === "assistant/chunk") {
					state ??= initialState(match.event.data.turn, match.event.data.step);
					state = updateChunk(state, match);
					continue;
				}
				if (match.event.type === "assistant/message") {
					state ??= initialState(match.event.data.turn, match.event.data.step);
					state = {
						...state,
						blocks: (0, _deepseek_ai_dsh_client_runtime_client.toAssistantBlocks)(match.event.data.message.content),
						hidden: false,
						final: match,
						usage: match.event.data.usage
					};
					continue;
				}
				if (match.event.type === "llm/retry" && state !== void 0) state = resetForRetry(state);
			}
			return state;
		}
		function projectAssistant(context) {
			const state = context.state ?? fallbackState$4(context);
			if (state === void 0) return void 0;
			const settled = finalNode(state, context);
			const blocks = settled?.blocks ?? compactBlocks(state.blocks);
			const visible = hasVisibleContent(blocks);
			const status = settled?.interrupted === true ? "interrupted" : settled === void 0 ? "running" : "settled";
			const anchorSeq = settled?.seq ?? state.firstVisibleSeq ?? context.matches[0]?.event.seq ?? 0;
			const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0;
			return {
				anchorSeq,
				visible,
				settled,
				data: {
					status,
					turn: state.turn,
					step: state.step,
					blocks,
					time,
					...state.usage === void 0 ? {} : { usage: state.usage },
					...settled === void 0 ? {} : { finalNode: settled }
				}
			};
		}
		/** Per-step Assistant streaming/final/interruption Definition. */
		const assistantDefinition = {
			kind: "assistant-step",
			target: "chat",
			match: (event) => {
				if (event.type === "step/start") return {
					id: `${event.data.turn}:${event.data.step}`,
					role: "start"
				};
				if (event.type === "assistant/chunk" || event.type === "assistant/message" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event)) return {
					id: `${event.data.turn}:${event.data.step}`,
					role: "update"
				};
				if (event.type === "llm/retry") return {
					id: `${event.data.turn}:${event.data.step}`,
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "step/start") throw new Error("assistant-step start requires step/start");
				return initialState(match.event.data.turn, match.event.data.step);
			},
			update: (context, match) => {
				if (match.event.type === "assistant/chunk") return updateChunk(context.state, match);
				if (match.event.type === "assistant/message") return {
					...context.state,
					blocks: (0, _deepseek_ai_dsh_client_runtime_client.toAssistantBlocks)(match.event.data.message.content),
					hidden: false,
					final: match,
					usage: match.event.data.usage
				};
				if (match.event.type === "llm/retry") return resetForRetry(context.state);
				return context.state;
			},
			publication: (match) => {
				if (match.event.type === "step/start") return "none";
				if (match.event.type !== "assistant/chunk") return "immediate";
				const type = match.event.data.chunk.type;
				return type === "usage" || type === "finish" ? "none" : "animation-frame";
			},
			buildLocationData: (context, scope) => {
				if (scope !== "step") return null;
				const projected = projectAssistant(context);
				if (projected === void 0) return null;
				return {
					kind: "step",
					turn: projected.data.turn,
					step: projected.data.step,
					key: "assistant-step",
					value: projected.data
				};
			},
			buildViewNode: (context) => {
				const projected = projectAssistant(context);
				if (projected === void 0) return null;
				if (projected.settled === void 0 && !projected.visible) {
					const state = context.state ?? fallbackState$4(context);
					if (state === void 0) return null;
					const current = context.current.get("chat");
					if (!state.hidden || current === void 0 || current === null) return null;
				}
				return chatNode(context, "assistant-step", projected.anchorSeq, projected.data, { visibility: projected.settled?.interrupted === true || projected.visible ? "visible" : "hidden" });
			}
		};
		/**
		* Register the Assistant lifecycle business contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerAssistantConversationNode(ctx) {
			ctx.conversationEvents.register(assistantDefinition);
		}
		//#endregion
		//#region lib/types/client/contract/chat-nodes.js
		/**
		* Test whether a Tool root has settled.
		* @param block - Tool root lifecycle value.
		* @returns whether the root carries its final result.
		*/
		function isSettledTool(block) {
			return "kind" in block;
		}
		/**
		* Test whether a Tool root is still running.
		* @param block - Tool root lifecycle value.
		* @returns whether the root lacks a final result.
		*/
		function isRunningTool(block) {
			return !isSettledTool(block);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/chat-snapshot-builder.js
		const EMPTY_KEYS = [];
		const EMPTY_TURNS = [];
		const EMPTY_LIST = [];
		function sameReferences$1(left, right) {
			return left.length === right.length && left.every((value, index) => value === right[index]);
		}
		var MutableChatNodeStore = class {
			byKey = /* @__PURE__ */ new Map();
			valuesCache = EMPTY_LIST;
			valuesDirty = false;
			get(key) {
				return this.byKey.get(key);
			}
			values() {
				if (this.valuesDirty) {
					this.valuesCache = [...this.byKey.values()];
					this.valuesDirty = false;
				}
				return this.valuesCache;
			}
			replace(nodes) {
				this.byKey.clear();
				for (const node of nodes) this.byKey.set(node.key, node);
				this.valuesCache = [...this.byKey.values()];
				this.valuesDirty = false;
			}
			upsert(nodes) {
				let changed = false;
				for (const node of nodes) {
					if (this.byKey.get(node.key) === node) continue;
					this.byKey.set(node.key, node);
					changed = true;
				}
				if (changed) this.valuesDirty = true;
			}
		};
		var MutableChatLocationIndex = class {
			turns = /* @__PURE__ */ new Map();
			steps = /* @__PURE__ */ new Map();
			getTurn(turn) {
				return this.turns.get(turn) ?? EMPTY_KEYS;
			}
			getStep(turn, step) {
				return this.steps.get(stepKey(turn, step)) ?? EMPTY_KEYS;
			}
			rebuild(order, store) {
				const turns = /* @__PURE__ */ new Map();
				const steps = /* @__PURE__ */ new Map();
				for (const key of order) {
					const location = store.get(key)?.location;
					if (location === void 0) continue;
					const coordinates = locationCoordinates(location);
					if (coordinates.turn === void 0) continue;
					const turnKeys = turns.get(coordinates.turn) ?? [];
					turnKeys.push(key);
					turns.set(coordinates.turn, turnKeys);
					if (coordinates.step === void 0) continue;
					const step = stepKey(coordinates.turn, coordinates.step);
					const stepKeys = steps.get(step) ?? [];
					stepKeys.push(key);
					steps.set(step, stepKeys);
				}
				this.turns = updateIndex(this.turns, turns);
				this.steps = updateIndex(this.steps, steps);
			}
			/** Invalidate aggregate readers when member data changes without moving. */
			touch(nodes) {
				const turns = /* @__PURE__ */ new Set();
				const steps = /* @__PURE__ */ new Set();
				for (const node of nodes) {
					const coordinates = locationCoordinates(node.location);
					if (coordinates.turn === void 0 || !this.turns.get(coordinates.turn)?.includes(node.key)) continue;
					turns.add(coordinates.turn);
					if (coordinates.step !== void 0) steps.add(stepKey(coordinates.turn, coordinates.step));
				}
				for (const turn of turns) {
					const keys = this.turns.get(turn);
					if (keys === void 0) continue;
					this.turns.set(turn, [...keys]);
				}
				for (const step of steps) {
					const keys = this.steps.get(step);
					if (keys === void 0) continue;
					this.steps.set(step, [...keys]);
				}
			}
		};
		function updateIndex(previous, nextMutable) {
			const next = /* @__PURE__ */ new Map();
			const keys = new Set([...previous.keys(), ...nextMutable.keys()]);
			for (const key of keys) {
				const before = previous.get(key) ?? EMPTY_KEYS;
				const candidate = nextMutable.get(key) ?? EMPTY_KEYS;
				const value = sameReferences$1(before, candidate) ? before : candidate;
				if (candidate.length > 0) next.set(key, value);
			}
			return next;
		}
		function stepKey(turn, step) {
			return `${turn}:${step}`;
		}
		function locationCoordinates(location) {
			if (location.kind === "step") return {
				turn: location.turn.turn,
				step: location.step.step
			};
			if (location.kind === "turn") return { turn: location.turn.turn };
			return {};
		}
		function orderedVisible(nodes) {
			return nodes.filter((node) => node.visibility === "visible").sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key));
		}
		const EMPTY_CONTRIBUTION = {
			anchorSeq: 0,
			nodes: EMPTY_LIST,
			partial: null,
			running: null
		};
		function legacyContribution(raw) {
			const node = raw;
			if (raw.visibility !== "visible" && node.kind !== "assistant-step") return EMPTY_CONTRIBUTION;
			switch (node.kind) {
				case "user":
				case "steering":
				case "context":
				case "command":
				case "compaction":
				case "turn-error":
				case "turn-max-tokens":
				case "unknown": return {
					anchorSeq: node.anchorSeq,
					nodes: [node.data],
					partial: null,
					running: null
				};
				case "assistant-step": {
					const data = node.data;
					if (data.status === "running") {
						if (raw.visibility !== "visible") return EMPTY_CONTRIBUTION;
						return {
							anchorSeq: node.anchorSeq,
							nodes: EMPTY_LIST,
							partial: {
								turn: data.turn,
								step: data.step,
								blocks: data.blocks
							},
							running: null
						};
					}
					return {
						anchorSeq: node.anchorSeq,
						nodes: data.finalNode === void 0 ? EMPTY_LIST : [data.finalNode],
						partial: null,
						running: null
					};
				}
				case "tool-call": {
					const root = node.data.root;
					return isRunningTool(root) ? {
						anchorSeq: node.anchorSeq,
						nodes: EMPTY_LIST,
						partial: null,
						running: root
					} : {
						anchorSeq: node.anchorSeq,
						nodes: [root],
						partial: null,
						running: null
					};
				}
				case "manual-compaction": {
					const data = node.data;
					return {
						anchorSeq: node.anchorSeq,
						nodes: data.compaction === null ? [data.command] : [data.command, data.compaction],
						partial: null,
						running: null
					};
				}
				case "model-retry": return {
					anchorSeq: node.anchorSeq,
					nodes: node.data.attempts,
					partial: null,
					running: null
				};
				case "turn-tail": return EMPTY_CONTRIBUTION;
				default: return EMPTY_CONTRIBUTION;
			}
		}
		function sameContribution(left, right) {
			return left !== void 0 && left.anchorSeq === right.anchorSeq && left.partial?.blocks === right.partial?.blocks && left.partial?.turn === right.partial?.turn && left.partial?.step === right.partial?.step && left.running === right.running && sameReferences$1(left.nodes, right.nodes);
		}
		/** Incremental compatibility projection for StatsLine and legacy top-level snapshot fields. */
		var LegacySliceBuilder = class {
			contributions = /* @__PURE__ */ new Map();
			finalizedContributions = /* @__PURE__ */ new Map();
			runningContributions = /* @__PURE__ */ new Map();
			partialContributions = /* @__PURE__ */ new Map();
			finalized = EMPTY_LIST;
			runningCalls = EMPTY_LIST;
			partial = null;
			timeline;
			turnTimings = /* @__PURE__ */ new Map();
			turnEnds = /* @__PURE__ */ new Map();
			replace(nodes, timeline) {
				this.contributions.clear();
				this.finalizedContributions.clear();
				this.runningContributions.clear();
				this.partialContributions.clear();
				for (const node of nodes) {
					const contribution = legacyContribution(node);
					this.contributions.set(node.key, contribution);
					this.indexContribution(node.key, contribution);
				}
				this.rebuildFinalized();
				this.rebuildRunning();
				this.rebuildPartial();
				this.updateTimeline(timeline);
				return this.snapshot();
			}
			apply(upserts, timeline) {
				let finalizedChanged = false;
				let runningChanged = false;
				let partialChanged = false;
				for (const node of upserts) {
					const contribution = legacyContribution(node);
					const previous = this.contributions.get(node.key);
					if (sameContribution(previous, contribution)) continue;
					finalizedChanged ||= finalizedContributionChanged(previous, contribution);
					runningChanged ||= runningContributionChanged(previous, contribution);
					partialChanged ||= partialContributionChanged(previous, contribution);
					this.contributions.set(node.key, contribution);
					this.indexContribution(node.key, contribution);
				}
				if (finalizedChanged) this.rebuildFinalized();
				if (runningChanged) this.rebuildRunning();
				if (partialChanged) this.rebuildPartial();
				this.updateTimeline(timeline);
				return this.snapshot();
			}
			indexContribution(key, contribution) {
				updateContributionIndex(this.finalizedContributions, key, contribution, contribution.nodes.length > 0);
				updateContributionIndex(this.runningContributions, key, contribution, contribution.running !== null);
				updateContributionIndex(this.partialContributions, key, contribution, contribution.partial !== null);
			}
			rebuildFinalized() {
				const finalized = [...this.finalizedContributions.values()].flatMap((value) => value.nodes).sort((left, right) => left.seq - right.seq);
				if (!sameReferences$1(this.finalized, finalized)) this.finalized = finalized;
			}
			rebuildRunning() {
				const runningCalls = [...this.runningContributions.values()].sort((left, right) => left.anchorSeq - right.anchorSeq).flatMap((value) => value.running === null ? [] : [value.running]);
				if (!sameReferences$1(this.runningCalls, runningCalls)) this.runningCalls = runningCalls;
			}
			rebuildPartial() {
				const partial = [...this.partialContributions.values()].sort((left, right) => left.anchorSeq - right.anchorSeq).findLast((value) => value.partial !== null)?.partial ?? null;
				if (this.partial?.blocks !== partial?.blocks || this.partial?.turn !== partial?.turn || this.partial?.step !== partial?.step) this.partial = partial;
			}
			updateTimeline(timeline) {
				if (this.timeline === timeline) return;
				this.timeline = timeline;
				const turnTimings = /* @__PURE__ */ new Map();
				const turnEnds = /* @__PURE__ */ new Map();
				for (const turn of timeline.turns.values()) {
					if (turn.start !== void 0) turnTimings.set(turn.turn, {
						startTime: turn.start.time,
						...turn.end === void 0 ? {} : { endTime: turn.end.time }
					});
					if (turn.end !== void 0) turnEnds.set(turn.turn, turn.end.seq);
				}
				this.turnTimings = turnTimings;
				this.turnEnds = turnEnds;
			}
			snapshot() {
				return {
					nodes: this.finalized,
					turnTimings: this.turnTimings,
					turnEnds: this.turnEnds,
					partial: this.partial,
					runningCalls: this.runningCalls
				};
			}
		};
		function updateContributionIndex(index, key, contribution, present) {
			if (present) index.set(key, contribution);
			else index.delete(key);
		}
		function finalizedContributionChanged(previous, next) {
			const previousNodes = previous?.nodes ?? EMPTY_LIST;
			return !sameReferences$1(previousNodes, next.nodes) || (previousNodes.length > 0 || next.nodes.length > 0) && previous?.anchorSeq !== next.anchorSeq;
		}
		function runningContributionChanged(previous, next) {
			return previous?.running !== next.running || (previous.running !== null || next.running !== null) && previous.anchorSeq !== next.anchorSeq;
		}
		function partialContributionChanged(previous, next) {
			return previous?.partial?.blocks !== next.partial?.blocks || previous?.partial?.turn !== next.partial?.turn || previous?.partial?.step !== next.partial?.step || ((previous?.partial ?? null) !== null || next.partial !== null) && previous?.anchorSeq !== next.anchorSeq;
		}
		/** Incremental keyed Chat builder registered under the `chat` target. */
		var ChatSnapshotBuilder = class {
			store = new MutableChatNodeStore();
			locations = new MutableChatLocationIndex();
			legacy = new LegacySliceBuilder();
			order = EMPTY_KEYS;
			empty;
			constructor() {
				this.empty = this.snapshot({
					turnOrder: EMPTY_TURNS,
					turns: /* @__PURE__ */ new Map()
				});
			}
			replace(input) {
				this.store.replace(input.nodes);
				this.order = orderedVisible(input.nodes).map((node) => node.key);
				this.locations.rebuild(this.order, this.store);
				return this.snapshot(input.timeline, this.legacy.replace(input.nodes, input.timeline));
			}
			apply(input) {
				let structural = false;
				const contentOnly = [];
				for (const node of input.upserts) {
					const previous = this.store.get(node.key);
					const nodeStructural = previous === void 0 || previous.anchorSeq !== node.anchorSeq || previous.visibility !== node.visibility || locationIdentity(previous.location) !== locationIdentity(node.location);
					structural ||= nodeStructural;
					if (!nodeStructural) contentOnly.push(node);
				}
				this.store.upsert(input.upserts);
				if (structural) {
					const next = orderedVisible(this.store.values()).map((node) => node.key);
					this.order = sameReferences$1(this.order, next) ? this.order : next;
					this.locations.rebuild(this.order, this.store);
				}
				this.locations.touch(contentOnly);
				return this.snapshot(input.timeline, this.legacy.apply(input.upserts, input.timeline));
			}
			snapshot(timeline, legacy = this.legacy.replace(EMPTY_LIST, timeline)) {
				return {
					order: this.order,
					nodes: this.store,
					locations: this.locations,
					timeline,
					legacy
				};
			}
		};
		function locationIdentity(location) {
			const coordinates = locationCoordinates(location);
			return `${location.kind}:${coordinates.turn ?? ""}:${coordinates.step ?? ""}`;
		}
		/** Chat target factory contributed to the Runtime view registry. */
		const chatViewDefinition = {
			target: "chat",
			create: () => new ChatSnapshotBuilder()
		};
		/**
		* Register the incremental Chat target builder.
		* @param ctx - owning UI Conversation context.
		*/
		function registerChatConversationView(ctx) {
			ctx.conversationViews.register(chatViewDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/command.js
		const COMPACT_PLUGIN = "compact";
		function commandFromRun(match) {
			if (match.event.type !== "command/run") throw new Error("command start requires command/run");
			const data = match.event.data;
			return {
				kind: "command",
				seq: match.event.seq,
				time: match.event.time,
				commandId: data.commandId,
				name: data.name,
				args: data.args ?? null,
				outcome: null
			};
		}
		function commandFromDone(match, previous) {
			if (match.event.type !== "command/done") throw new Error("command update requires command/done");
			const data = match.event.data;
			const sourceEventSeq = data.kind === "success" && data.sourceEventSeq !== void 0 && Number.isSafeInteger(data.sourceEventSeq) && data.sourceEventSeq >= 0 ? data.sourceEventSeq : void 0;
			return {
				kind: "command",
				seq: previous?.seq ?? match.event.seq,
				time: previous?.time ?? match.event.time,
				commandId: data.commandId,
				name: previous?.name ?? null,
				args: previous?.args ?? null,
				outcome: {
					kind: data.kind,
					...data.text === void 0 ? {} : { text: data.text },
					...sourceEventSeq === void 0 ? {} : { sourceEventSeq }
				}
			};
		}
		/**
		* Read correlation identity from a compaction replacement checkpoint.
		* @param event - candidate Session event.
		* @returns correlated compaction and optional command identity.
		*/
		function compactSource(event) {
			if (event.type !== "user/message" || !(0, _deepseek_ai_dsh_client_runtime_client.isReplacementSurfaceEvent)(event)) return void 0;
			const source = event.data.source;
			if (source.kind !== "plugin" || source.plugin !== COMPACT_PLUGIN || typeof source.compactionId !== "string") return void 0;
			return {
				compactionId: source.compactionId,
				...source.sourceCommandId === void 0 ? {} : { sourceCommandId: source.sourceCommandId }
			};
		}
		/**
		* Build the visible summary marker from optional lifecycle evidence.
		* @param match - compaction/summary Match, when loaded.
		* @param checkpoint - replacement checkpoint Match.
		* @returns final compaction summary Node data.
		*/
		function compactSummary(match, checkpoint) {
			let summary = null;
			let shadowedItemCount = null;
			let shadowedTokenCount = null;
			if (match?.event.type === "compaction/summary") {
				const data = match.event.data;
				if (Array.isArray(data.summary)) {
					const text = data.summary.map((block) => block.type === "text" ? block.text : "").join("");
					summary = text.trim() === "" ? null : text;
				}
				shadowedItemCount = Array.isArray(data.shadowedSeqs) && data.shadowedSeqs.every((seq) => Number.isSafeInteger(seq) && seq >= 0) ? data.shadowedSeqs.length : null;
				shadowedTokenCount = Number.isSafeInteger(data.shadowedTokenCount) && data.shadowedTokenCount >= 0 ? data.shadowedTokenCount : null;
			}
			return {
				kind: "compaction",
				seq: checkpoint.event.seq,
				time: checkpoint.event.time,
				summary,
				summaryEventSeq: match?.event.seq ?? null,
				shadowedItemCount,
				shadowedTokenCount
			};
		}
		function fallbackState$3(context) {
			const done = context.matches.find((match) => match.event.type === "command/done");
			const checkpoint = context.matches.find((match) => compactSource(match.event) !== void 0);
			const summary = context.matches.find((match) => match.event.type === "compaction/summary");
			if (checkpoint === void 0) return done === void 0 ? void 0 : { command: commandFromDone(done) };
			const source = compactSource(checkpoint.event);
			if (source?.sourceCommandId === void 0) return done === void 0 ? void 0 : { command: commandFromDone(done) };
			return {
				command: done === void 0 ? {
					kind: "command",
					seq: checkpoint.event.seq,
					time: checkpoint.event.time,
					commandId: source.sourceCommandId,
					name: "compact",
					args: null,
					outcome: null
				} : {
					...commandFromDone(done),
					name: "compact"
				},
				checkpoint,
				...summary === void 0 ? {} : { summary }
			};
		}
		/**
		* Fold shared compaction evidence into a Definition-owned State.
		* @param state - current business State carrying optional compaction evidence.
		* @param match - next compaction lifecycle Match.
		* @returns adopted State, preserving reference identity when the Match adds no evidence.
		*/
		function updateCompactionState(state, match) {
			if (match.event.type === "compaction/summary") return {
				...state,
				summary: match
			};
			if (compactSource(match.event) !== void 0) return {
				...state,
				checkpoint: match
			};
			return state;
		}
		/** Slash-command lifecycle, including integrated manual compaction, Definition. */
		const commandDefinition = {
			kind: "command",
			target: "chat",
			match: (event) => {
				if (event.type === "command/run") return {
					id: String(event.data.commandId),
					role: "start"
				};
				if (event.type === "command/done") return {
					id: String(event.data.commandId),
					role: "update"
				};
				const checkpoint = compactSource(event);
				if (checkpoint?.sourceCommandId !== void 0) return {
					id: String(checkpoint.sourceCommandId),
					role: "update"
				};
				if (event.type === "compaction/start" || event.type === "compaction/summary" || event.type === "compaction/end") {
					if (event.data.sourceCommandId !== void 0) return {
						id: String(event.data.sourceCommandId),
						role: "update"
					};
				}
				return null;
			},
			start: (_context, match) => ({ command: commandFromRun(match) }),
			update: (context, match) => {
				if (match.event.type === "command/done") return {
					...context.state,
					command: commandFromDone(match, context.state.command)
				};
				return updateCompactionState(context.state, match);
			},
			buildViewNode: (context) => {
				const state = context.state ?? fallbackState$3(context);
				if (state === void 0) return null;
				if (state.command.name !== "compact") return chatNode(context, "command", state.command.seq, state.command);
				const compaction = state.checkpoint === void 0 ? null : compactSummary(state.summary, state.checkpoint);
				const data = {
					command: state.command,
					compaction
				};
				return chatNode(context, "manual-compaction", compaction?.seq ?? state.command.seq, data);
			}
		};
		/**
		* Register the command lifecycle business contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerCommandConversationNode(ctx) {
			ctx.conversationEvents.register(commandDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/compaction.js
		function fallbackState$2(context) {
			const summary = context.matches.find((match) => match.event.type === "compaction/summary");
			const checkpoint = context.matches.find((match) => compactSource(match.event) !== void 0);
			return {
				...summary === void 0 ? {} : { summary },
				...checkpoint === void 0 ? {} : { checkpoint }
			};
		}
		/** Automatic compaction lifecycle and landed checkpoint Definition. */
		const compactionDefinition = {
			kind: "compaction",
			target: "chat",
			match: (event) => {
				const checkpoint = compactSource(event);
				if (checkpoint !== void 0 && checkpoint.sourceCommandId === void 0) return {
					id: checkpoint.compactionId,
					role: "update"
				};
				if (event.type === "compaction/start" || event.type === "compaction/summary" || event.type === "compaction/end") {
					if (event.data.sourceCommandId !== void 0) return null;
					const compactionId = event.data.compactionId;
					if (typeof compactionId !== "string" || compactionId === "") return null;
					return {
						id: compactionId,
						role: event.type === "compaction/start" ? "start" : "update"
					};
				}
				return null;
			},
			start: () => ({}),
			update: (context, match) => updateCompactionState(context.state, match),
			buildViewNode: (context) => {
				const state = context.state ?? fallbackState$2(context);
				if (state.checkpoint === void 0) return null;
				const marker = compactSummary(state.summary, state.checkpoint);
				return chatNode(context, "compaction", marker.seq, marker);
			}
		};
		/**
		* Register the automatic-compaction business contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerCompactionConversationNode(ctx) {
			ctx.conversationEvents.register(compactionDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/fallback.js
		/** Unclaimed append-surface fallback Definition. */
		const unknownFallbackDefinition = {
			kind: "unknown-surface",
			target: "chat",
			match: (event) => (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event) ? {
				id: String(event.seq),
				role: "start"
			} : null,
			start: (_context, match) => ({
				kind: "unknown",
				seq: match.event.seq,
				time: match.event.time,
				type: match.event.type,
				data: match.event.data
			}),
			update: (context) => context.state,
			buildViewNode: (context) => context.state === void 0 ? null : chatNode(context, "unknown", context.state.seq, context.state)
		};
		/**
		* Register the unmatched append-surface fallback contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerUnknownConversationFallback(ctx) {
			ctx.conversationEvents.registerFallback(unknownFallbackDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/inbox.js
		function applySplice(previous, splice) {
			const pending = [...previous?.state.pending ?? []];
			const claimed = new Set(previous?.state.claimed ?? []);
			const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted);
			for (const identity of splice.inserted) claimed.delete(identity.id);
			if (splice.target === "next-step" && splice.outcome !== "canceled") for (const identity of removed) claimed.add(identity.id);
			return {
				pending,
				claimed
			};
		}
		function inboxDefinition(target) {
			const kind = `inbox-${target}`;
			return {
				kind,
				match: (event) => event.type === "agent/inbox/spliced" && event.data.target === target ? {
					id: String(event.seq),
					role: "start"
				} : null,
				start: (_context, match, reader) => {
					if (match.event.type !== "agent/inbox/spliced") throw new Error(`${kind} start requires agent/inbox/spliced`);
					return applySplice(reader.previous(kind), match.event.data);
				},
				update: (context) => context.state,
				publication: () => "none"
			};
		}
		/** Cumulative next-turn inbox splice Definition. */
		const nextTurnInboxDefinition = inboxDefinition("next-turn");
		/** Cumulative next-step inbox splice Definition used to classify steering. */
		const nextStepInboxDefinition = inboxDefinition("next-step");
		/**
		* Register the two durable Inbox-state contributions.
		* @param ctx - owning UI Conversation context.
		*/
		function registerInboxConversationNodes(ctx) {
			ctx.conversationEvents.register(nextTurnInboxDefinition);
			ctx.conversationEvents.register(nextStepInboxDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/message.js
		function isCompactionCheckpoint(event) {
			if (event.type !== "user/message" || !(0, _deepseek_ai_dsh_client_runtime_client.isReplacementSurfaceEvent)(event)) return false;
			const source = event.data.source;
			return source.kind === "plugin" && source.plugin === "compact";
		}
		/** User, steering, and injected-context message classification Definition. */
		const messageDefinition = {
			kind: "input-message",
			target: "chat",
			match: (event) => event.type === "user/message" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event) && !isCompactionCheckpoint(event) ? {
				id: String(event.data.id),
				role: "start"
			} : null,
			start: (_context, match, reader) => {
				if (match.event.type !== "user/message") throw new Error("input-message start requires user/message");
				const event = match.event;
				if (event.data.source.kind !== "user") return {
					kind: "context",
					seq: event.seq,
					time: event.time,
					content: event.data.content,
					source: event.data.source,
					provenance: (0, _deepseek_ai_dsh_client_runtime_client.contextProvenance)(event.data.source),
					form: (0, _deepseek_ai_dsh_client_runtime_client.contextForm)(event.data.source)
				};
				return reader.previous("inbox-next-step")?.state.claimed.has(String(event.data.id)) === true ? {
					kind: "steering",
					messageId: event.data.id,
					seq: event.seq,
					time: event.time,
					content: event.data.content,
					source: event.data.source
				} : {
					kind: "user",
					seq: event.seq,
					time: event.time,
					content: event.data.content,
					source: event.data.source
				};
			},
			update: (context) => context.state,
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				return chatNode(context, context.state.kind, context.state.seq, context.state);
			}
		};
		/**
		* Register the user, steering, and injected-context message contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerMessageConversationNode(ctx) {
			ctx.conversationEvents.register(messageDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/retry.js
		function scheduledNode(match) {
			if (match.event.type !== "llm/retry") return void 0;
			return {
				kind: "model-retry",
				seq: match.event.seq,
				time: match.event.time,
				retryState: "scheduled",
				...match.event.data
			};
		}
		/** A scheduled attempt is cancelled once either owning boundary closes. */
		function isClosed(location) {
			return location.kind === "step" && location.step.status === "closed" || (location.kind === "step" || location.kind === "turn") && location.turn.status === "closed";
		}
		/** Producer-correlated model retry chain Definition. */
		const retryDefinition = {
			kind: "model-retry",
			target: "chat",
			match: (event) => {
				if (event.type === "llm/retry") {
					const retryId = event.data.retryId;
					if (typeof retryId !== "string" || retryId === "") return null;
					return {
						id: retryId,
						role: event.data.retry === 1 ? "start" : "update"
					};
				}
				if (event.type === "llm/retry-started") {
					const retryId = event.data.retryId;
					return typeof retryId === "string" && retryId !== "" ? {
						id: retryId,
						role: "update"
					} : null;
				}
				return null;
			},
			start: (_context, match) => {
				const node = scheduledNode(match);
				if (node === void 0) throw new Error("model-retry start requires a valid llm/retry event");
				return {
					turn: node.turn,
					step: node.step,
					attempts: [node]
				};
			},
			update: (context, match) => {
				if (match.event.type === "llm/retry") {
					const node = scheduledNode(match);
					return node === void 0 ? context.state : {
						...context.state,
						attempts: [...context.state.attempts, node]
					};
				}
				if (match.event.type !== "llm/retry-started") return context.state;
				const retry = match.event.data.retry;
				return {
					...context.state,
					attempts: context.state.attempts.map((attempt) => attempt.retry === retry ? {
						...attempt,
						retryState: "started"
					} : attempt)
				};
			},
			buildViewNode: (context) => {
				if (context.state === void 0 || context.state.attempts.length === 0) return null;
				const location = context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
				const stateAttempts = context.state.attempts;
				const attempts = stateAttempts.map((attempt, index) => index === stateAttempts.length - 1 && attempt.retryState === "scheduled" && isClosed(location) ? {
					...attempt,
					retryState: "cancelled"
				} : attempt);
				const current = attempts.at(-1);
				if (current === void 0) return null;
				const data = {
					attempts,
					current
				};
				return chatNode(context, "model-retry", attempts[0]?.seq ?? current.seq, data);
			}
		};
		/**
		* Register the correlated model-retry business contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerRetryConversationNode(ctx) {
			ctx.conversationEvents.register(retryDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/tool.js
		const MAX_DEPTH = 256;
		const projectedBlocks = /* @__PURE__ */ new WeakMap();
		function jsonArguments(value) {
			return JSON.stringify(value);
		}
		function rootCall(match) {
			if (match.event.type !== "tool/call") throw new Error("tool-call start requires tool/call");
			return {
				callId: String(match.event.data.callId),
				name: match.event.data.name,
				argsRaw: match.event.data.arguments,
				turn: match.event.data.turn,
				step: match.event.data.step,
				time: match.event.time,
				callView: match.view?.for === "call" ? match.view.view : null,
				subCalls: []
			};
		}
		function rootResult(match, previous) {
			if (match.event.type !== "tool/result") return void 0;
			const result = match.event.data.message.content[0];
			return {
				kind: "tool-result",
				seq: match.event.seq,
				time: match.event.time,
				callId: String(match.event.data.message.source.callId),
				call: previous === void 0 ? null : {
					name: previous.name,
					argsRaw: previous.argsRaw
				},
				callTime: previous?.time ?? null,
				content: result.content,
				isError: result.isError === true,
				...match.event.data.error === void 0 ? {} : { error: match.event.data.error },
				meta: match.event.data.meta,
				callView: previous?.callView ?? null,
				resultView: match.view?.for === "result" ? match.view.view : null,
				subCalls: []
			};
		}
		function childCall(match, data) {
			return {
				callId: data.subCallId,
				name: data.name,
				argsRaw: jsonArguments(data.arguments),
				turn: locationTurn(match),
				step: locationStep(match),
				time: match.event.time,
				callView: null,
				subCalls: []
			};
		}
		function childResult(match, data, previous) {
			return {
				kind: "tool-result",
				seq: match.event.seq,
				time: match.event.time,
				callId: data.subCallId,
				call: {
					name: data.name,
					argsRaw: jsonArguments(data.arguments)
				},
				callTime: previous?.time ?? null,
				content: data.content ?? [],
				isError: data.isError === true,
				callView: null,
				resultView: null,
				subCalls: []
			};
		}
		function locationTurn(match) {
			return match.location.kind === "step" || match.location.kind === "turn" ? match.location.turn.turn : 0;
		}
		function locationStep(match) {
			return match.location.kind === "step" ? match.location.step.step : 0;
		}
		function acceptsEdge(state, parent, child) {
			if (parent === child || state.parents.has(child)) return false;
			let cursor = parent;
			let parentDepth = 0;
			const ancestors = /* @__PURE__ */ new Set();
			while (cursor !== void 0) {
				if (cursor === child || ancestors.has(cursor)) return false;
				ancestors.add(cursor);
				parentDepth++;
				cursor = state.parents.get(cursor);
			}
			const pending = [{
				callId: child,
				depth: 1
			}];
			const descendants = /* @__PURE__ */ new Set();
			let subtreeDepth = 0;
			for (const candidate of pending) {
				if (descendants.has(candidate.callId)) return false;
				descendants.add(candidate.callId);
				subtreeDepth = Math.max(subtreeDepth, candidate.depth);
				for (const nested of state.children.get(candidate.callId) ?? []) pending.push({
					callId: nested.callId,
					depth: candidate.depth + 1
				});
			}
			return parentDepth + subtreeDepth <= MAX_DEPTH;
		}
		function updateDispatch(state, match) {
			const event = match.event;
			if (event.type !== "tool/code-dispatch-start" && event.type !== "tool/code-dispatch") return state;
			const data = event.data;
			const parentCallId = String(data.parentCallId);
			const subCallId = String(data.subCallId);
			const siblings = state.children.get(parentCallId) ?? [];
			const index = siblings.findIndex((candidate) => candidate.callId === subCallId);
			if (event.type === "tool/code-dispatch-start") {
				if (index >= 0 || !acceptsEdge(state, parentCallId, subCallId)) return state;
				const children = new Map(state.children);
				children.set(parentCallId, [...siblings, childCall(match, data)]);
				const parents = new Map(state.parents);
				parents.set(subCallId, parentCallId);
				return {
					...state,
					children,
					parents
				};
			}
			if (index < 0 && !acceptsEdge(state, parentCallId, subCallId)) return state;
			const settled = childResult(match, data, index < 0 ? void 0 : siblings[index]);
			const children = new Map(state.children);
			children.set(parentCallId, index < 0 ? [...siblings, settled] : siblings.map((child, at) => at === index ? settled : child));
			const parents = new Map(state.parents);
			if (index < 0) parents.set(subCallId, parentCallId);
			return {
				...state,
				children,
				parents
			};
		}
		function projectBlock(block, state, interruptedAt, visited = /* @__PURE__ */ new Set(), depth = 1) {
			if (visited.has(block.callId) || depth > MAX_DEPTH) return {
				...block,
				subCalls: []
			};
			const nextVisited = new Set(visited);
			nextVisited.add(block.callId);
			const children = (state.children.get(block.callId) ?? block.subCalls).map((child) => projectBlock(child, state, interruptedAt, nextVisited, depth + 1));
			const interruptionSeq = "kind" in block ? void 0 : interruptedAt?.seq;
			const interruptionTime = "kind" in block ? void 0 : interruptedAt?.time;
			const cached = projectedBlocks.get(block);
			if (cached !== void 0 && cached.interruptionSeq === interruptionSeq && cached.interruptionTime === interruptionTime && sameReferences(cached.children, children)) return cached.value;
			const projected = "kind" in block || interruptedAt === void 0 ? sameReferences(block.subCalls, children) ? block : {
				...block,
				subCalls: children
			} : {
				kind: "tool-result",
				seq: interruptedAt.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup,
				time: interruptedAt.time,
				callId: block.callId,
				call: {
					name: block.name,
					argsRaw: block.argsRaw
				},
				callTime: block.time,
				content: [],
				isError: true,
				error: {
					name: "Interrupted",
					code: "interrupted"
				},
				callView: block.callView,
				resultView: null,
				subCalls: children
			};
			projectedBlocks.set(block, {
				children,
				interruptionSeq,
				interruptionTime,
				value: projected
			});
			return projected;
		}
		function sameReferences(left, right) {
			return left.length === right.length && left.every((value, index) => value === right[index]);
		}
		function interruption(context) {
			const location = context.start?.location;
			if (location?.kind === "step" && location.step.status === "closed") return location.step.end;
			if ((location?.kind === "step" || location?.kind === "turn") && location.turn.status === "closed") return location.turn.end;
		}
		function fallbackState$1(context) {
			const match = context.matches.find((candidate) => candidate.event.type === "tool/result");
			const root = match === void 0 ? void 0 : rootResult(match);
			if (root === void 0) return void 0;
			let state = {
				root,
				children: /* @__PURE__ */ new Map(),
				parents: /* @__PURE__ */ new Map()
			};
			for (const candidate of context.matches) state = updateDispatch(state, candidate);
			return state;
		}
		/** Root Tool lifecycle and nested Code Dispatch Definition. */
		const toolDefinition = {
			kind: "tool-call",
			target: "chat",
			match: (event) => {
				if (event.type === "tool/call") return {
					id: String(event.data.callId),
					role: "start"
				};
				if (event.type === "tool/result" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event)) return {
					id: String(event.data.message.source.callId),
					role: "update"
				};
				if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
					const rootCallId = event.data.rootCallId;
					return typeof rootCallId === "string" && rootCallId !== "" ? {
						id: rootCallId,
						role: "update"
					} : null;
				}
				return null;
			},
			start: (_context, match) => ({
				root: rootCall(match),
				children: /* @__PURE__ */ new Map(),
				parents: /* @__PURE__ */ new Map()
			}),
			update: (context, match) => {
				if (match.event.type === "tool/result") {
					const result = rootResult(match, "kind" in context.state.root ? void 0 : context.state.root);
					return result === void 0 ? context.state : {
						...context.state,
						root: result
					};
				}
				return updateDispatch(context.state, match);
			},
			buildViewNode: (context) => {
				const state = context.state ?? fallbackState$1(context);
				if (state === void 0) return null;
				const projected = projectBlock(state.root, state, interruption(context));
				return chatNode(context, "tool-call", context.start?.event.seq ?? ("kind" in state.root ? state.root.seq : context.matches[0]?.event.seq ?? 0), { root: projected });
			}
		};
		/**
		* Register the root Tool lifecycle and nested-subcall contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerToolConversationNode(ctx) {
			ctx.conversationEvents.register(toolDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/turn-error.js
		function lastStep$1(context) {
			const location = context.start?.location ?? context.matches[0]?.location;
			if (location?.kind !== "turn" && location?.kind !== "step") return 0;
			return location.turn.steps.at(-1)?.step ?? 0;
		}
		function retryTurn(event) {
			return event.type === "llm/retry" || event.type === "llm/retry-started" ? event.data.turn : void 0;
		}
		function failureFrom(match) {
			if (match.event.type !== "turn/end" || match.event.data.reason.kind !== "error") return void 0;
			const failure = match.event.data.reason.error;
			return {
				seq: match.event.seq,
				time: match.event.time,
				message: (0, _deepseek_ai_dsh_client_runtime_client.displayFailureMessage)(failure),
				code: failure.code
			};
		}
		function fallbackState(context) {
			const end = context.matches.find((match) => failureFrom(match) !== void 0);
			if (end?.event.type !== "turn/end") return void 0;
			const failure = failureFrom(end);
			if (failure === void 0) return void 0;
			const turn = end.event.data.turn;
			return {
				turn,
				hidden: context.matches.some((match) => retryTurn(match.event) === turn),
				failure
			};
		}
		/** Terminal turn failure Definition, suppressed when the turn owns a retry chain. */
		const turnErrorDefinition = {
			kind: "turn-error",
			target: "chat",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "turn/end" && event.data.reason.kind === "error") return {
					id: String(event.data.turn),
					role: "update"
				};
				const turn = retryTurn(event);
				return turn === void 0 ? null : {
					id: String(turn),
					role: "update"
				};
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("turn-error start requires turn/start");
				return {
					turn: match.event.data.turn,
					hidden: false
				};
			},
			update: (context, match) => {
				const failure = failureFrom(match);
				if (failure !== void 0) return {
					...context.state,
					failure
				};
				return retryTurn(match.event) === context.state.turn ? {
					...context.state,
					hidden: true
				} : context.state;
			},
			buildViewNode: (context) => {
				const state = context.state ?? fallbackState(context);
				if (state?.failure === void 0) return null;
				const failure = state.failure;
				const node = {
					kind: "turn-error",
					seq: failure.seq,
					time: failure.time,
					turn: state.turn,
					step: lastStep$1(context),
					message: failure.message,
					...failure.code === void 0 ? {} : { code: failure.code }
				};
				if (!state.hidden) return chatNode(context, "turn-error", node.seq, node);
				const current = context.current.get("chat");
				return current === void 0 || current === null ? null : chatNode(context, "turn-error", node.seq, node, { visibility: "hidden" });
			}
		};
		/**
		* Register the terminal Turn-error business contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerTurnErrorConversationNode(ctx) {
			ctx.conversationEvents.register(turnErrorDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/turn-max-tokens.js
		function lastStep(context) {
			const location = context.start?.location ?? context.matches[0]?.location;
			if (location?.kind !== "turn" && location?.kind !== "step") return 0;
			return location.turn.steps.at(-1)?.step ?? 0;
		}
		/**
		* Anchor the notice between the closing Assistant and the turn-tail so the
		* tail stays the turn's last Chat node and keeps its branch action enabled.
		* Without a closing text Assistant there is no branch action to protect, and
		* the turn/end seq keeps the notice at the truncation point.
		*/
		function noticeAnchor(context, seq) {
			const location = context.start?.location ?? context.matches[0]?.location;
			if (location?.kind !== "turn" && location?.kind !== "step") return seq;
			const closing = location.turn.data.get("turn-tail")?.closing;
			return closing === null || closing === void 0 ? seq : closing.finalNode.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.maxTokensNotice;
		}
		function stateFrom(match) {
			if (match.event.type !== "turn/end" || match.event.data.reason.kind !== "max-tokens") return void 0;
			return {
				turn: match.event.data.turn,
				seq: match.event.seq,
				time: match.event.time
			};
		}
		/** Notice Definition for a turn the provider ended at its output-token cap. */
		const turnMaxTokensDefinition = {
			kind: "turn-max-tokens",
			target: "chat",
			match: (event) => {
				if (event.type === "turn/end" && event.data.reason.kind === "max-tokens") return {
					id: String(event.data.turn),
					role: "start"
				};
				return null;
			},
			start: (_context, match) => {
				const state = stateFrom(match);
				if (state === void 0) throw new Error("turn-max-tokens start requires a max-tokens turn/end");
				return state;
			},
			update: (context) => context.state,
			buildViewNode: (context) => {
				const state = context.state;
				if (state === void 0) return null;
				const node = {
					kind: "turn-max-tokens",
					seq: state.seq,
					time: state.time,
					turn: state.turn,
					step: lastStep(context)
				};
				return chatNode(context, "turn-max-tokens", noticeAnchor(context, state.seq), node);
			}
		};
		/**
		* Register the max-tokens turn-end notice contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerTurnMaxTokensConversationNode(ctx) {
			ctx.conversationEvents.register(turnMaxTokensDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/turn-tail.js
		function hasTextAssistant(event) {
			return event.type === "assistant/message" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event) && (0, _deepseek_ai_dsh_client_runtime_client.toAssistantBlocks)(event.data.message.content).some((block) => block.kind === "text" && block.text.trim() !== "");
		}
		function chunkHasText(event) {
			if (event.type !== "assistant/chunk") return false;
			const chunk = event.data.chunk;
			if (chunk.type === "text-delta") return chunk.text.trim() !== "";
			return chunk.type === "block-end" && chunk.block.type === "text" && chunk.block.text.trim() !== "";
		}
		function turnCoordinates(event) {
			if (event.type === "assistant/message" || event.type === "assistant/chunk" || event.type === "step/end") return {
				turn: event.data.turn,
				step: event.data.step
			};
			if (event.type === "llm/retry") return {
				turn: event.data.turn,
				step: event.data.step
			};
		}
		function closingAnchor(context) {
			let anchor = context.matches.find((match) => match.event.type === "turn/end")?.event.seq ?? context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0;
			const steps = /* @__PURE__ */ new Map();
			for (const match of context.matches) {
				const event = match.event;
				if (event.type === "turn/end") continue;
				const coordinates = turnCoordinates(event);
				if (coordinates?.step === void 0) continue;
				const previous = steps.get(coordinates.step) ?? {
					streamedText: false,
					finalized: false
				};
				if (event.type === "assistant/chunk") {
					steps.set(coordinates.step, {
						...previous,
						streamedText: previous.streamedText || chunkHasText(event)
					});
					continue;
				}
				if (event.type === "assistant/message") {
					steps.set(coordinates.step, {
						streamedText: false,
						finalized: true
					});
					if (hasTextAssistant(event)) anchor = event.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.finalizedFollowup;
					continue;
				}
				if (event.type === "llm/retry") {
					steps.set(coordinates.step, {
						streamedText: false,
						finalized: false
					});
					continue;
				}
				if (event.type === "step/end" && previous.streamedText && !previous.finalized) anchor = event.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup;
			}
			return anchor;
		}
		function turnLocation(context) {
			const location = context.start?.location ?? context.matches[0]?.location;
			return location?.kind === "turn" || location?.kind === "step" ? location.turn : void 0;
		}
		function hasText(data) {
			return data.finalNode !== void 0 && data.blocks.some((block) => block.kind === "text" && block.text.trim() !== "");
		}
		function tailData(context) {
			const end = context.state?.end ?? context.matches.find((match) => match.event.type === "turn/end");
			if (end?.event.type !== "turn/end") return null;
			const turn = turnLocation(context);
			if (turn === void 0) return null;
			const finalized = turn.steps.map((step) => step.data.get("assistant-step")).filter((candidate) => candidate !== void 0).filter((candidate) => candidate.finalNode !== void 0).sort((left, right) => left.finalNode.seq - right.finalNode.seq);
			const closing = finalized.findLast(hasText) ?? null;
			let latestTranscriptSeq = finalized.at(-1)?.finalNode.seq;
			for (const match of context.matches) {
				const event = match.event;
				const candidate = event.type === "tool/call" || event.type === "tool/result" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event) || event.type === "turn/end" && event.data.reason.kind === "error" || event.type === "llm/retry" ? event.seq : void 0;
				if (candidate !== void 0 && (latestTranscriptSeq === void 0 || candidate > latestTranscriptSeq)) latestTranscriptSeq = candidate;
			}
			const metrics = deriveTurnMetrics(finalized.map((candidate) => candidate.finalNode)).get(end.event.data.turn);
			return {
				turn: end.event.data.turn,
				seq: end.event.seq,
				time: end.event.time,
				closing,
				branchUnavailable: closing === null || latestTranscriptSeq !== closing.finalNode.seq,
				...metrics?.ttftMs === void 0 ? {} : { ttftMs: metrics.ttftMs },
				...metrics?.tokensPerSecond === void 0 ? {} : { tokensPerSecond: metrics.tokensPerSecond }
			};
		}
		/** Completed-turn footer Definition independent of any Assistant row. */
		const turnTailDefinition = {
			kind: "turn-tail",
			target: "chat",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "turn/end") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/call" || event.type === "tool/result") return {
					id: String(event.data.turn),
					role: "update"
				};
				const coordinates = turnCoordinates(event);
				if (coordinates !== void 0) return {
					id: String(coordinates.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("turn-tail start requires turn/start");
				return { turn: match.event.data.turn };
			},
			update: (context, match) => match.event.type === "turn/end" ? {
				...context.state,
				end: match
			} : context.state,
			publication: (match) => match.event.type === "turn/end" ? "immediate" : "none",
			buildLocationData: (context, scope) => {
				if (scope !== "turn") return null;
				const value = tailData(context);
				return value === null ? null : {
					kind: "turn",
					turn: value.turn,
					key: "turn-tail",
					value
				};
			},
			buildViewNode: (context) => {
				const data = turnLocation(context)?.data.get("turn-tail");
				return data === void 0 ? null : chatNode(context, "turn-tail", closingAnchor(context), data);
			}
		};
		/**
		* Register completed-Turn footer data and its Chat node contribution.
		* @param ctx - owning UI Conversation context.
		*/
		function registerTurnTailConversationNode(ctx) {
			ctx.conversationEvents.register(turnTailDefinition);
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/register.js
		/**
		* Register the Chat business Definitions and target builder contributed by this package.
		* @param ctx - owning UI Conversation context.
		*/
		function registerConversationNodes(ctx) {
			registerInboxConversationNodes(ctx);
			registerMessageConversationNode(ctx);
			registerAssistantConversationNode(ctx);
			registerToolConversationNode(ctx);
			registerCommandConversationNode(ctx);
			registerCompactionConversationNode(ctx);
			registerRetryConversationNode(ctx);
			registerTurnErrorConversationNode(ctx);
			registerTurnMaxTokensConversationNode(ctx);
			registerTurnTailConversationNode(ctx);
			registerUnknownConversationFallback(ctx);
			registerChatConversationView(ctx);
		}
		//#endregion
		//#region lib/types/client/chat/use-throttled-visual-update.js
		/** Frame-throttled scheduling for non-essential visual alignment. */
		const DEFAULT_INTERVAL_FRAMES = 3;
		/**
		* Return a stable scheduler that coalesces visual updates over a frame interval.
		* @param update - DOM alignment to run after the throttle interval.
		* @param intervalFrames - frames to wait before applying the latest alignment.
		* @returns a stable function that schedules the latest update.
		*/
		function useThrottledVisualUpdate(update, intervalFrames = DEFAULT_INTERVAL_FRAMES) {
			const updateRef = (0, react.useRef)(update);
			updateRef.current = update;
			const pendingFrameRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => () => {
				if (pendingFrameRef.current === null) return;
				cancelAnimationFrame(pendingFrameRef.current);
				pendingFrameRef.current = null;
			}, []);
			return (0, react.useCallback)(() => {
				if (pendingFrameRef.current !== null) return;
				let remainingFrames = intervalFrames;
				const advance = () => {
					remainingFrames -= 1;
					if (remainingFrames > 0) {
						pendingFrameRef.current = requestAnimationFrame(advance);
						return;
					}
					pendingFrameRef.current = null;
					updateRef.current();
				};
				pendingFrameRef.current = requestAnimationFrame(advance);
			}, [intervalFrames]);
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/accessibility.module.css.mjs
		const css$4 = ".hXDBwq_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}";
		const tagId$4 = "@deepseek-ai/dsh-client-ui-conversation/accessibility.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var accessibility_module_css_default = { "visuallyHidden": "hXDBwq_visuallyHidden" };
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/ReasoningRow.module.css.mjs
		const css$3 = ".QWLzlG_root{flex-direction:column;display:flex}.QWLzlG_row{position:relative;overflow:hidden}.QWLzlG_root[data-state=running] .QWLzlG_row:after{content:\"\";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite QWLzlG_dsh-reasoning-row-sweep;position:absolute;left:0}@keyframes QWLzlG_dsh-reasoning-row-sweep{0%{left:-300px}90%,to{left:100%}}.QWLzlG_leading{flex-shrink:0}.QWLzlG_chevron{color:var(--dsw-alias-label-secondary)}.QWLzlG_title{font-weight:400}.QWLzlG_separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.QWLzlG_summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.QWLzlG_summary[data-follow-end]{text-overflow:clip}.QWLzlG_thinkBody{color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:14px;line-height:24px}@media (prefers-reduced-motion:reduce){.QWLzlG_root[data-state=running] .QWLzlG_row:after{animation:none}}";
		const tagId$3 = "@deepseek-ai/dsh-client-ui-conversation/ReasoningRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var ReasoningRow_module_css_default = {
			"thinkBody": "QWLzlG_thinkBody",
			"row": "QWLzlG_row",
			"root": "QWLzlG_root",
			"separator": "QWLzlG_separator",
			"chevron": "QWLzlG_chevron",
			"dsh-reasoning-row-sweep": "QWLzlG_dsh-reasoning-row-sweep",
			"summary": "QWLzlG_summary",
			"title": "QWLzlG_title",
			"leading": "QWLzlG_leading"
		};
		//#endregion
		//#region lib/types/client/chat/ReasoningRow.js
		/** Assistant reasoning disclosure, independent of Tool-call presentation. */
		function firstLine(text) {
			const newline = text.indexOf("\n");
			return newline === -1 ? text : text.slice(0, newline);
		}
		function latestLine(text) {
			const visible = text.trimEnd();
			const newline = visible.lastIndexOf("\n");
			return newline === -1 ? visible : visible.slice(newline + 1);
		}
		/**
		* Render one assistant reasoning block as the Think disclosure row.
		* @param props.text - complete or streaming reasoning text.
		* @param props.running - whether this block is the streaming tail.
		* @param props.t - conversation locale seat for the running status.
		* @returns the reasoning disclosure.
		*/
		function ReasoningRow({ text, running, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const summaryRef = (0, react.useRef)(null);
			const summary = running ? latestLine(text) : firstLine(text);
			const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
				const element = summaryRef.current;
				if (element === null) return;
				element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0;
			});
			(0, react.useEffect)(() => {
				scheduleSummaryScroll();
			}, [
				running,
				scheduleSummaryScroll,
				summary
			]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ReasoningRow_module_css_default.root,
				"data-variant": "think",
				"data-state": running ? "running" : "ok",
				children: [running && (0, react_jsx_runtime.jsx)("span", {
					className: accessibility_module_css_default.visuallyHidden,
					children: t("row.running")
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					rowClassName: ReasoningRow_module_css_default.row,
					leadingClassName: ReasoningRow_module_css_default.leading,
					titleClassName: ReasoningRow_module_css_default.title,
					chevronClassName: ReasoningRow_module_css_default.chevron,
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutline14, { size: 14 }),
					title: "Think",
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
						className: ReasoningRow_module_css_default.separator,
						"aria-hidden": true
					}), (0, react_jsx_runtime.jsx)("span", {
						ref: summaryRef,
						className: ReasoningRow_module_css_default.summary,
						"data-follow-end": running || void 0,
						children: summary
					})] }),
					children: (0, react_jsx_runtime.jsx)("div", {
						className: ReasoningRow_module_css_default.thinkBody,
						children: text
					})
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/AssistantMarkdown.module.css.mjs
		const css$2 = ".Sxvs8a_root{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex}.Sxvs8a_body{flex-direction:column;gap:16px;display:flex}.Sxvs8a_stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px}.Sxvs8a_actions{margin-top:16px;margin-left:-6px}";
		const tagId$2 = "@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var AssistantMarkdown_module_css_default = {
			"body": "Sxvs8a_body",
			"root": "Sxvs8a_root",
			"stopped": "Sxvs8a_stopped",
			"actions": "Sxvs8a_actions"
		};
		//#endregion
		//#region lib/types/client/chat/AssistantMarkdown.js
		/** Reasoning block as the Think variant summary row (figma 39:28304). */
		const AssistantMarkdown = (0, react.memo)(function AssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t }) {
			const imageLoader = loadImage ?? (() => Promise.reject(new Error(t("image.serviceUnavailable"))));
			const codeLabels = (0, react.useMemo)(() => ({
				copyLabel: t("copy"),
				copiedLabel: t("copied")
			}), [t]);
			const last = blocks.length - 1;
			if (!(streaming || interrupted === true || blocks.some((block) => block.kind !== "tool-call"))) return null;
			const rendered = [];
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i];
				if (block === void 0) continue;
				switch (block.kind) {
					case "text":
						rendered.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
							text: block.text,
							streaming,
							codeLabels,
							fileMentions: mentions
						}, i));
						break;
					case "reasoning":
						rendered.push((0, react_jsx_runtime.jsx)(ReasoningRow, {
							text: block.text,
							running: streaming && i === last,
							t
						}, i));
						break;
					case "image": {
						const start = i;
						const group = [block];
						while (i + 1 < blocks.length) {
							const next = blocks[i + 1];
							if (next === void 0 || next.kind !== "image") break;
							group.push(next);
							i += 1;
						}
						rendered.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_attachment.ImageGallery, {
							images: group,
							load: imageLoader,
							align: "start",
							labels: messageImageLabels(t)
						}, start));
						break;
					}
					case "tool-call": break;
					default: rendered.push((0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("message.unknownBlock"),
						payload: block.block,
						truncatedLabel: (total) => t("json.truncated", { total })
					}, i));
				}
			}
			return (0, react_jsx_runtime.jsx)("div", {
				className: AssistantMarkdown_module_css_default.root,
				"data-streaming": streaming || void 0,
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: AssistantMarkdown_module_css_default.body,
					children: [rendered, interrupted && (0, react_jsx_runtime.jsx)("span", {
						className: AssistantMarkdown_module_css_default.stopped,
						children: t("message.stopped")
					})]
				})
			});
		});
		//#endregion
		//#region lib/types/client/chat/AssistantNodeView.js
		/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
		const AssistantNodeView = (0, react.memo)(function AssistantNodeView({ node, useTurnData, openFile, loadImage, fileMentions, t }) {
			const data = node.data;
			const turn = node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn : void 0;
			const tail = useTurnData("turn-tail");
			const owner = (0, react.useMemo)(() => {
				if (turn?.status !== "closed" || data.finalNode === void 0) return void 0;
				if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return void 0;
				return {
					turn,
					seq: data.finalNode.seq,
					openFile
				};
			}, [
				data.finalNode,
				openFile,
				tail,
				turn
			]);
			const mentions = (0, react.useMemo)(() => owner === void 0 ? void 0 : fileMentions(owner), [fileMentions, owner]);
			return (0, react_jsx_runtime.jsx)(AssistantMarkdown, {
				blocks: data.blocks,
				streaming: data.status === "running",
				interrupted: data.status === "interrupted",
				loadImage,
				mentions,
				t
			});
		});
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/GenericCommandCard.module.css.mjs
		const css$1 = "._Xvjua_root{flex-direction:column;display:flex}._Xvjua_row{position:relative;overflow:hidden}._Xvjua_root[data-state=running] ._Xvjua_row:after{content:\"\";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite _Xvjua_dsh-command-row-sweep;position:absolute;left:0}@keyframes _Xvjua_dsh-command-row-sweep{0%{left:-300px}90%,to{left:100%}}._Xvjua_leading{flex-shrink:0}._Xvjua_chevron{color:var(--dsw-alias-label-secondary)}._Xvjua_title{font-weight:400}._Xvjua_separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}._Xvjua_summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}._Xvjua_summary[data-error],._Xvjua_body[data-error]{color:var(--dsw-alias-state-error-primary)}._Xvjua_body{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);max-height:260px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap;border-radius:12px;margin:4px 0 4px 4px;padding:12px 16px;overflow:auto}@media (prefers-reduced-motion:reduce){._Xvjua_root[data-state=running] ._Xvjua_row:after{animation:none}}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-conversation/GenericCommandCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var GenericCommandCard_module_css_default = {
			"root": "_Xvjua_root",
			"separator": "_Xvjua_separator",
			"leading": "_Xvjua_leading",
			"chevron": "_Xvjua_chevron",
			"summary": "_Xvjua_summary",
			"body": "_Xvjua_body",
			"row": "_Xvjua_row",
			"title": "_Xvjua_title",
			"dsh-command-row-sweep": "_Xvjua_dsh-command-row-sweep"
		};
		//#endregion
		//#region lib/types/client/chat/GenericCommandCard.js
		/** Node state → row state semantic (running while unsettled; outcome kind after). */
		function stateOf(outcome) {
			if (outcome === null) return "running";
			return outcome.kind === "error" ? "error" : "ok";
		}
		function leadingFor(state) {
			return state === "error" ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, { size: 14 });
		}
		function GenericCommandCard({ node, t, runningSummary }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const text = node.outcome?.text;
			const summary = node.outcome === null ? runningSummary ?? t("command.running") : text ?? (node.outcome.kind === "error" ? t("command.failed") : t("command.done"));
			const title = node.name ?? t("command.title");
			const state = stateOf(node.outcome);
			const body = text !== void 0 && text.includes("\n") ? text : null;
			const open = expanded && body !== null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: GenericCommandCard_module_css_default.root,
				"data-variant": "others",
				"data-state": state,
				children: [
					state === "running" && (0, react_jsx_runtime.jsx)("span", {
						className: accessibility_module_css_default.visuallyHidden,
						children: t("row.running")
					}),
					state === "error" && (0, react_jsx_runtime.jsx)("span", {
						className: accessibility_module_css_default.visuallyHidden,
						children: t("row.failed")
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
						rowClassName: GenericCommandCard_module_css_default.row,
						leadingClassName: GenericCommandCard_module_css_default.leading,
						titleClassName: GenericCommandCard_module_css_default.title,
						chevronClassName: GenericCommandCard_module_css_default.chevron,
						icon: leadingFor(state),
						title,
						open,
						expandable: body !== null,
						expandOnRowClick: true,
						keepContentWhenOpen: true,
						onToggle: () => {
							setExpanded((value) => !value);
						},
						collapsedContent: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
							className: GenericCommandCard_module_css_default.separator,
							"aria-hidden": true
						}), (0, react_jsx_runtime.jsx)("span", {
							className: GenericCommandCard_module_css_default.summary,
							"data-error": state === "error" || void 0,
							children: summary
						})] }),
						children: (0, react_jsx_runtime.jsx)("pre", {
							className: GenericCommandCard_module_css_default.body,
							"data-error": state === "error" || void 0,
							children: body
						})
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/chat/CompactionCommandCard.js
		/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
		function CompactionCommandCard({ node, compaction, t }) {
			if (compaction !== void 0) return (0, react_jsx_runtime.jsx)(CompactionItem, {
				node: compaction,
				title: "compact",
				fallbackSummary: node.outcome?.text ?? null,
				t
			});
			if (node.outcome !== null) return (0, react_jsx_runtime.jsx)(GenericCommandCard, {
				node,
				t
			});
			return (0, react_jsx_runtime.jsx)(GenericCommandCard, {
				node,
				t,
				runningSummary: t("message.compaction.running")
			});
		}
		//#endregion
		//#region lib/types/client/chat/CommandNodeView.js
		/** Ordinary command lifecycle renderer with command-name keyed specialization. */
		const CommandNodeView = (0, react.memo)(function CommandNodeView({ node, renderSlot, t }) {
			const command = node.data;
			const owner = (0, react.useMemo)(() => ({ node: command }), [command]);
			return (0, react_jsx_runtime.jsx)("div", {
				className: ChatView_module_css_default.callRow,
				children: renderSlot("conversation.chat.commandview", owner, {
					entryKey: command.name ?? "",
					fallback: (0, react_jsx_runtime.jsx)(GenericCommandCard, {
						...owner,
						t
					})
				})
			});
		});
		/** One integrated `/compact` command and compaction transaction renderer. */
		const ManualCompactionNodeView = (0, react.memo)(function ManualCompactionNodeView({ node, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)("div", {
				className: ChatView_module_css_default.callRow,
				children: (0, react_jsx_runtime.jsx)(CompactionCommandCard, {
					node: data.command,
					...data.compaction === null ? {} : { compaction: data.compaction },
					t
				})
			});
		});
		//#endregion
		//#region lib/types/client/chat/turn-assistant.js
		/**
		* Collect visible prose from one Assistant lifecycle.
		* @param blocks - Assistant content blocks.
		* @returns concatenated text blocks.
		*/
		function assistantText(blocks) {
			return blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("");
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-conversation/src/client/chat/TurnTailNodeView.module.css.mjs
		const css = ".osXY9a_root{flex-direction:column;gap:16px;display:flex}.osXY9a_actions{margin-left:-6px}";
		const tagId = "@deepseek-ai/dsh-client-ui-conversation/TurnTailNodeView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-conversation";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var TurnTailNodeView_module_css_default = {
			"root": "osXY9a_root",
			"actions": "osXY9a_actions"
		};
		//#endregion
		//#region lib/types/client/chat/TurnTailNodeView.js
		/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
		const TurnTailNodeView = (0, react.memo)(function TurnTailNodeView({ node, openFile, forkAt, renderSlot, renderSlotChain, t, useSession }) {
			const data = node.data;
			const hasLaterChatNode = useSession((snapshot) => snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key);
			const turn = node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn : void 0;
			if (turn === void 0) return null;
			const closing = data.closing;
			const tail = renderSlotChain("conversation.chat.turnTail", {
				turn,
				seq: closing?.finalNode.seq ?? data.seq,
				openFile
			});
			if (closing === null) return tail === null ? null : (0, react_jsx_runtime.jsx)("div", {
				className: TurnTailNodeView_module_css_default.root,
				children: tail
			});
			const runMs = turn.start === void 0 || turn.end === void 0 ? void 0 : Math.max(0, turn.end.time - turn.start.time);
			const messageId = closing.finalNode.messageId;
			const assistantActions = messageId === void 0 ? null : renderSlot("conversation.chat.assistant-actions", { messageId });
			return (0, react_jsx_runtime.jsxs)("div", {
				className: TurnTailNodeView_module_css_default.root,
				"data-turn-tail": data.turn,
				"data-time-hover-root": true,
				children: [tail, (0, react_jsx_runtime.jsx)(MessageIconActions, {
					text: assistantText(closing.blocks),
					time: closing.time,
					runMs,
					ttftMs: data.ttftMs,
					tokensPerSecond: data.tokensPerSecond,
					clock: "end",
					onBranch: () => {
						forkAt(closing.finalNode.seq);
					},
					branchUnavailable: data.branchUnavailable || hasLaterChatNode,
					className: TurnTailNodeView_module_css_default.actions,
					extraActions: assistantActions,
					t
				})]
			});
		});
		//#endregion
		//#region lib/types/client/chat/register-node-renderers.js
		/**
		* Register this package's business renderers behind the keyed Chat Node seat.
		* @param ctx - owning UI Conversation context.
		*/
		function registerChatNodeRenderers(ctx) {
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "user",
				locale: NS
			}, UserMessageNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "steering",
				locale: NS
			}, UserMessageNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "context",
				locale: NS
			}, ContextMessageNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "assistant-step",
				locale: NS
			}, AssistantNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "command",
				locale: NS,
				children: { "conversation.chat.commandview": {
					kind: "keyed",
					scope: "session"
				} }
			}, CommandNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "manual-compaction",
				locale: NS
			}, ManualCompactionNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "compaction",
				locale: NS
			}, CompactionNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "model-retry",
				locale: NS
			}, RetryNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "turn-error",
				locale: NS
			}, TurnErrorNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "turn-max-tokens",
				locale: NS
			}, TurnMaxTokensNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "turn-tail",
				locale: NS,
				children: {
					"conversation.chat.turnTail": {
						kind: "chain",
						scope: "session"
					},
					"conversation.chat.assistant-actions": {
						kind: "list",
						scope: "session"
					}
				}
			}, TurnTailNodeView));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "unknown",
				locale: NS
			}, UnknownNodeView));
		}
		//#endregion
		//#region lib/types/client/apply.js
		/** Services required by the conversation plugin. */
		const inject = [
			"slots",
			"layout",
			"sessions",
			"workspaces",
			"locale",
			"connection",
			"remote",
			"settingsScope",
			"conversationEvents",
			"conversationViews"
		];
		const ABSENT_NOTICES = {
			getSnapshot: () => null,
			subscribe: () => () => {}
		};
		/** No session, therefore nothing to block; same one-identity rule as above. */
		const ABSENT_BLOCK = {
			getSnapshot: () => void 0,
			subscribe: () => () => {}
		};
		const EMPTY_LEXICON = /* @__PURE__ */ new Map();
		const ABSENT_LEXICON = {
			getSnapshot: () => EMPTY_LEXICON,
			subscribe: () => () => {}
		};
		const ABSENT_MENU_LAUNCHER = {
			getSnapshot: () => null,
			subscribe: () => () => {}
		};
		const CHAT_NODE_INJECT = { hooks: { turnData: ({ useSession }, nodeKey) => function useTurnData(key) {
			return useSession((snapshot) => {
				const location = snapshot.chat.nodes.get(nodeKey)?.location;
				return location?.kind === "turn" || location?.kind === "step" ? location.turn.data.get(key) : void 0;
			});
		} } };
		/** Resolve the session-scoped conversation face (scope-addressed send/cancel), failing loud. */
		function scopedConversation(sessions, id) {
			const scoped = sessions.scope(id);
			if (scoped === void 0) throw new Error(`ui-conversation: session "${id}" resolved no scope`);
			const conversation = scoped.get("conversation");
			if (conversation === void 0) throw new Error("ui-conversation: conversation service unavailable through the session scope");
			return conversation;
		}
		/** Resolve package-internal attachment operations from the public service registration. */
		function concreteConversation(ctx) {
			const conversation = ctx.get("conversation");
			if (conversation === void 0) throw new Error("ui-conversation: conversation service unavailable");
			return conversation;
		}
		/** Chain routing: claim the composer while an approval wait is pending (pure — owner props only). */
		function selectApproval({ interactions }) {
			return interactions.find((i) => i.kind === "approval") ?? null;
		}
		/** Mounts the conversation plugin.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			const sessions = ctx.sessions;
			const workspaces = ctx.workspaces;
			const layout = ctx.layout;
			const slots = ctx.slots;
			registerConversationNodes(ctx);
			registerChatNodeRenderers(ctx);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-conversation: dictionaries");
			const t = ctx.locale.bind(NS);
			const chatStore = createChatStore();
			const submissionPolicy = new ComposerSubmissionPolicy(ctx.settingsScope.bind({ namespace: CONVERSATION_SETTINGS_NAMESPACE }));
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "composer-enter",
				order: 20,
				locale: NS,
				inject: () => ({
					hooks: { busyEnter: submissionPolicy.busyEnter },
					setBusyEnter: (behavior) => {
						submissionPolicy.setBusyEnter(behavior);
					}
				})
			}, EnterBehaviorRow));
			const chatScrollPositions = /* @__PURE__ */ new Map();
			const viewTabs = () => {
				const tabs = [];
				for (const entry of slots.entries("conversation.view")) {
					/* v8 ignore next -- unreachable: list registration validates id at load. */
					if (entry.options.id === void 0) continue;
					tabs.push({
						id: entry.options.id,
						label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(entry.options.label) ?? entry.options.id
					});
				}
				return tabs;
			};
			const views = {
				list: viewTabs,
				subscribe: (fn) => slots.subscribe("conversation.view", fn),
				version: () => slots.getVersion("conversation.view")
			};
			const inputHub = new InputHub(ctx, t);
			const composerBlocks = new ComposerBlockRegistry();
			ctx.effect(() => sessions.provide({
				hooks: ["input"],
				props: ["inputActions"],
				resolve: (binding) => {
					const shell = inputHub.shellFor(binding);
					return {
						hooks: { input: shell.state },
						props: { inputActions: shell.actions }
					};
				}
			}), "ui-conversation: input standard-kit provider");
			slots.register({
				name: "conversation",
				locale: NS,
				children: {
					"conversation.session": {
						kind: "single",
						scope: "session"
					},
					"conversation.session.header": {
						kind: "single",
						scope: "session"
					},
					"conversation.composer": {
						kind: "chain",
						scope: "session"
					},
					"conversation.composer.bar": {
						kind: "single",
						scope: "session-maybe"
					},
					"conversation.input.overlay": {
						kind: "list",
						scope: "session"
					},
					"conversation.input.dock": {
						kind: "list",
						scope: "session"
					},
					"conversation.composer.dock": {
						kind: "list",
						scope: "session"
					},
					"conversation.input.left": {
						kind: "list",
						scope: "session"
					},
					"conversation.input.right": {
						kind: "list",
						scope: "session"
					},
					"conversation.hero.workspace": {
						kind: "single",
						scope: "root"
					},
					"conversation.hero.agentPreset": {
						kind: "single",
						scope: "root"
					}
				},
				inject: (sessionId) => ({
					hooks: { composerBlock: sessionId === void 0 ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId) },
					selectWorkspace: async (workspaceId) => {
						const nextId = await workspaces.connectWorkspace(workspaceId);
						if (sessionId !== void 0 && nextId !== sessionId) {
							const from = inputHub.shell(sessionId);
							const draft = from.snapshot.draft;
							const imageIds = from.snapshot.imageIds;
							const next = inputHub.shell(nextId);
							if (imageIds.length === 0 || next.addImages(imageIds)) {
								if (draft !== "") {
									next.setDraft(draft);
									from.setDraft("");
								}
								if (imageIds.length > 0) for (const id of imageIds) from.removeImage(id);
							}
						}
						sessions.open(nextId);
					}
				})
			}, ConversationRoot);
			slots.register({
				name: "conversation.session",
				children: { "conversation.view": {
					kind: "list",
					scope: "session"
				} },
				store: chatStore,
				inject: (sessionId, _actions) => {
					const conversation = concreteConversation(ctx);
					return {
						views,
						releaseSessionImages: (id) => {
							conversation.releaseSessionImages(id);
						},
						bindDraftMirror: (write) => inputHub.shell(sessionId).bindMirror(write)
					};
				}
			}, ConversationSession);
			slots.register({
				name: "conversation.session.header",
				locale: NS,
				children: {
					"conversation.session.header.actions": {
						kind: "list",
						scope: "session"
					},
					"conversation.session.header.utilities": {
						kind: "list",
						scope: "session"
					}
				},
				store: chatStore,
				inject: () => ({
					views,
					open: (id) => {
						sessions.open(id);
					}
				})
			}, ConversationSessionHeader);
			slots.register({
				name: "conversation.composer.bar",
				locale: NS,
				children: {
					"conversation.input.plan": {
						kind: "single",
						scope: "session"
					},
					"conversation.input.model": {
						kind: "single",
						scope: "session"
					}
				},
				inject: (sessionId) => {
					if (sessionId === void 0) return {
						keyboard: void 0,
						addImages: void 0,
						removeImage: void 0,
						draftImages: void 0,
						resolveSubmitMode: (running, gesture, steeringAvailable) => submissionPolicy.resolve(running, gesture, steeringAvailable),
						toggleCommandMenu: void 0,
						stop: void 0,
						command: void 0,
						hooks: {
							notices: ABSENT_NOTICES,
							lexicon: ABSENT_LEXICON,
							menuLauncher: ABSENT_MENU_LAUNCHER
						}
					};
					const conversation = concreteConversation(ctx);
					const shell = inputHub.shell(sessionId);
					const inputTriggers = inputHub.inputTriggers(sessionId);
					return {
						keyboard: shell,
						addImages: (files) => {
							try {
								const images = conversation.createDraftImages(files);
								if (!shell.addImages(images.map((image) => image.id))) conversation.releaseDraftImages(images);
								return null;
							} catch (error) {
								if (error instanceof UnsupportedImageMediaTypeError) return t("image.unsupportedType");
								return error instanceof Error ? error.message : String(error);
							}
						},
						removeImage: (id) => {
							conversation.releaseDraftImage(id);
							shell.removeImage(id);
						},
						draftImages: (ids) => conversation.draftImages(ids),
						resolveSubmitMode: (running, gesture, steeringAvailable) => submissionPolicy.resolve(running, gesture, steeringAvailable),
						toggleCommandMenu: inputTriggers === void 0 ? void 0 : (selection) => {
							shell.dismissPopup();
							const snapshot = shell.snapshot;
							inputTriggers.toggleSource("command", {
								trigger: "/",
								query: "",
								position: snapshot.draft.slice(0, selection.start).trim() === "" ? "leading" : "inline",
								span: {
									...selection,
									draftRev: snapshot.draftRev
								}
							});
						},
						stop: () => {
							scopedConversation(sessions, sessionId).cancel().catch(() => {});
						},
						command: async (line) => {
							const session = sessions.binding(sessionId)?.session;
							if (session === void 0) return false;
							const result = await session.command(line);
							return result.ok && result.value.matched;
						},
						hooks: {
							notices: shell.notices,
							lexicon: shell.lexicon,
							menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER
						}
					};
				}
			}, InputBar);
			slots.register({
				name: "conversation.composer",
				select: selectApproval,
				priority: 1,
				locale: NS
			}, ApprovalPanel);
			slots.register({
				name: "conversation.view",
				id: "chat",
				order: 0,
				label: () => t("view.chat"),
				locale: NS,
				children: { "conversation.chat.node": {
					kind: "keyed",
					scope: "session",
					inject: CHAT_NODE_INJECT
				} },
				store: chatStore,
				inject: (sessionId, actions) => {
					const conversation = concreteConversation(ctx);
					const scoped = scopedConversation(sessions, sessionId);
					return {
						openDetails: (target) => {
							actions.select(target);
							layout.openDetails();
						},
						fileMentions: (owner) => ctx.get("chatFileMentions")?.forClosing(owner),
						openFile: (path) => {
							const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd;
							workspaces.openPath((0, _deepseek_ai_dsh_client_runtime_client.resolveWorkspacePath)(cwd, path)).catch(() => {});
						},
						loadOlder: () => {
							scoped.loadOlder();
						},
						loadImage: (attachment) => conversation.resolveImage(sessionId, attachment),
						inspectCall: (callId) => {
							actions.setInspect({ callId });
							actions.setView("trajectory");
						},
						chatScroll: {
							save: (position) => {
								if (position === null) chatScrollPositions.delete(sessionId);
								else chatScrollPositions.set(sessionId, position);
							},
							read: () => chatScrollPositions.get(sessionId) ?? null
						},
						forkAt: (seq) => {
							sessions.fork({
								sessionId,
								atSeq: seq,
								increaseTitle: true
							}).then((childId) => {
								sessions.open(childId);
							}).catch(() => {});
						}
					};
				}
			}, ChatView);
			slots.register({
				name: "conversation.composer.dock",
				id: "stats",
				order: 0,
				locale: NS
			}, StatsLine);
			ctx.plugin(ConversationController, {
				input: inputHub,
				blocks: composerBlocks
			});
			ctx.plugin(todoDockEntry);
			ctx.plugin(queueDockEntry);
			slots.register({
				name: "details",
				locale: NS,
				children: { "conversation.details.tool": {
					kind: "single",
					scope: "session"
				} },
				store: chatStore,
				inject: () => ({ closeDetails: () => {
					layout.closeDetails();
				} })
			}, DetailsPanel);
		}
		//#endregion
		exports.ConversationController = ConversationController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map