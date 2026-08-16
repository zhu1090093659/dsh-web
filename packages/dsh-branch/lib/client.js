window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-branch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/api.ts
		const TRANSPORT_ERROR = {
			code: "internal",
			message: "branch route unavailable"
		};
		async function post(path, payload) {
			let response;
			try {
				response = await fetch(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				});
			} catch {
				return {
					ok: false,
					error: TRANSPORT_ERROR
				};
			}
			try {
				const envelope = await response.json();
				if (typeof envelope !== "object" || envelope === null) return {
					ok: false,
					error: TRANSPORT_ERROR
				};
				const record = envelope;
				if (record.ok === true) return {
					ok: true,
					value: record.value
				};
				return {
					ok: false,
					error: record.error ?? TRANSPORT_ERROR
				};
			} catch {
				return {
					ok: false,
					error: TRANSPORT_ERROR
				};
			}
		}
		var BranchApi = class {
			preview(cwd, writes, deletes) {
				return post("/branch/preview", {
					cwd,
					writes,
					deletes
				});
			}
			apply(cwd, writes, deletes) {
				return post("/branch/apply", {
					cwd,
					writes,
					deletes
				});
			}
		};
		//#endregion
		//#region src/core/trajectory.ts
		function parseArgs(argsRaw) {
			if (argsRaw === void 0 || argsRaw === "") return void 0;
			try {
				return JSON.parse(argsRaw);
			} catch {
				return;
			}
		}
		function createdFromResult(resultText) {
			if (resultText === void 0 || resultText === "") return void 0;
			if (/created/i.test(resultText)) return true;
			if (/updated/i.test(resultText)) return false;
		}
		/** Derive one file op from a settled tool call (write/edit only). */
		function fileOpFromCall(seq, time, turn, step, name, argsRaw, resultText) {
			if (name !== "write" && name !== "edit") return void 0;
			const args = parseArgs(argsRaw);
			if (typeof args !== "object" || args === null) return void 0;
			const record = args;
			const path = typeof record.file_path === "string" ? record.file_path : "";
			if (path === "") return void 0;
			const id = `${seq}:${step}:${name}:${path}`;
			if (name === "write") return {
				id,
				seq,
				time,
				turn,
				step,
				kind: "write",
				path,
				content: typeof record.content === "string" ? record.content : "",
				created: createdFromResult(resultText)
			};
			const oldString = typeof record.old_string === "string" ? record.old_string : "";
			const newString = typeof record.new_string === "string" ? record.new_string : "";
			if (oldString === "") return void 0;
			return {
				id,
				seq,
				time,
				turn,
				step,
				kind: "edit",
				path,
				oldString,
				newString,
				replaceAll: record.replace_all === true
			};
		}
		function textOf(blocks) {
			if (blocks === void 0) return "";
			return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
		}
		/** File state at a given op count (clamped), for rollback/restore targets. */
		function applySetAt(ops, count) {
			const clamped = Math.max(0, Math.min(count, ops.length));
			const state = /* @__PURE__ */ new Map();
			const createdBy = /* @__PURE__ */ new Map();
			ops.forEach((op, index) => {
				if (op.kind === "write" && op.created === true && !createdBy.has(op.path)) createdBy.set(op.path, index);
			});
			for (let index = 0; index < clamped; index++) {
				const op = ops[index];
				if (op === void 0) continue;
				if (op.kind === "write") {
					state.set(op.path, {
						content: op.content ?? "",
						exact: true
					});
					continue;
				}
				const entry = state.get(op.path);
				if (entry !== void 0 && entry.exact && entry.content !== void 0 && op.oldString !== void 0 && op.newString !== void 0) {
					const next = op.replaceAll === true ? entry.content.replaceAll(op.oldString, op.newString) : entry.content.replace(op.oldString, op.newString);
					state.set(op.path, next === entry.content ? {
						content: void 0,
						exact: false
					} : {
						content: next,
						exact: true
					});
				} else state.set(op.path, {
					content: void 0,
					exact: false
				});
			}
			const writes = [];
			const skipped = /* @__PURE__ */ new Set();
			for (const [path, entry] of state) if (entry.exact && entry.content !== void 0) writes.push({
				path,
				content: entry.content
			});
			else skipped.add(path);
			const deletes = [];
			for (const [path, createdIndex] of createdBy) if (createdIndex >= clamped) deletes.push(path);
			return {
				writes,
				deletes,
				skipped: [...skipped]
			};
		}
		//#endregion
		//#region src/core/official-rows.ts
		function requestOf(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const record = value;
			if (typeof record.purpose !== "string" || typeof record.startSeq !== "number") return void 0;
			const changeRaw = record.promptChange;
			let promptChange;
			if (typeof changeRaw === "object" && changeRaw !== null) {
				const change = changeRaw;
				if (typeof change.seq === "number" && typeof change.kind === "string") promptChange = {
					seq: change.seq,
					kind: change.kind
				};
			}
			return {
				purpose: record.purpose,
				startSeq: record.startSeq,
				turn: typeof record.turn === "number" ? record.turn : null,
				step: typeof record.step === "number" ? record.step : 0,
				...promptChange === void 0 ? {} : { promptChange },
				prompt: record.prompt
			};
		}
		function asBlock(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const record = value;
			if (typeof record.callId !== "string" || record.callId === "") return void 0;
			const call = typeof record.call === "object" && record.call !== null ? record.call : void 0;
			const callName = typeof call?.name === "string" && call.name !== "" ? call.name : void 0;
			const callArgs = typeof call?.argsRaw === "string" ? call.argsRaw : void 0;
			return {
				kind: typeof record.kind === "string" ? record.kind : void 0,
				callId: record.callId,
				name: typeof record.name === "string" && record.name !== "" ? record.name : callName ?? record.callId,
				argsRaw: callArgs ?? (typeof record.argsRaw === "string" ? record.argsRaw : void 0),
				subCalls: Array.isArray(record.subCalls) ? record.subCalls : void 0,
				content: Array.isArray(record.content) ? record.content : void 0,
				call: call === void 0 ? null : {
					name: callName ?? null,
					argsRaw: callArgs
				}
			};
		}
		/**
		* Enumerate the official trajectory rows and attach per-row file state.
		* @returns rows sorted by cellIndex (the official display order).
		*/
		function projectOfficialRows(input) {
			const { nodes, requests = [], partial = null, runningCalls = [] } = input;
			const resultByCall = /* @__PURE__ */ new Map();
			const emittedFromBlocks = /* @__PURE__ */ new Set();
			for (const node of nodes) if (node.kind === "tool-result") {
				const block = asBlock(node);
				if (block !== void 0) resultByCall.set(node.callId, block);
			} else if (node.kind === "assistant") {
				for (const block of node.blocks) if (block.kind === "tool-call") emittedFromBlocks.add(block.callId);
			}
			const callById = new Map(resultByCall);
			for (const call of runningCalls) {
				const block = asBlock(call);
				if (block !== void 0) callById.set(call.callId, block);
			}
			const represented = /* @__PURE__ */ new Set();
			for (const node of nodes) if (node.kind === "assistant" && node.step > 0) represented.add(`${node.turn}\u0000${node.step}`);
			if (partial !== null && partial.step > 0) represented.add(`${partial.turn}\u0000${partial.step}`);
			for (const call of runningCalls) if (call.step > 0) represented.add(`${call.turn}\u0000${call.step}`);
			const entries = [];
			for (const node of nodes) entries.push({
				kind: "node",
				seq: node.seq,
				initial: false,
				node
			});
			for (const raw of requests) {
				const request = requestOf(raw);
				if (request === void 0) continue;
				if (request.purpose === "compaction") entries.push({
					kind: "compaction",
					seq: request.startSeq,
					initial: false
				});
				else if (request.purpose === "assistant") {
					if (request.promptChange !== void 0 && request.prompt !== void 0) entries.push({
						kind: "system",
						seq: request.promptChange.seq,
						initial: request.promptChange.kind === "initial"
					});
					if (!represented.has(`${request.turn}\u0000${request.step}`)) entries.push({
						kind: "request",
						seq: request.startSeq,
						initial: false
					});
				}
			}
			entries.sort((left, right) => (left.initial ? Number.NEGATIVE_INFINITY : left.seq) - (right.initial ? Number.NEGATIVE_INFINITY : right.seq));
			const rows = [];
			let index = 0;
			let opCount = 0;
			const emittedRows = /* @__PURE__ */ new Set();
			const push = (kind, callId, op, label) => {
				index += 1;
				if (op !== void 0) opCount += 1;
				if (callId !== void 0) emittedRows.add(callId);
				rows.push({
					cellIndex: index,
					kind,
					op,
					stateIndex: opCount,
					...callId === void 0 ? {} : { callId },
					label
				});
			};
			const emitSubCalls = (subs) => {
				if (subs === void 0) return;
				for (const raw of subs) {
					const block = asBlock(raw);
					if (block === void 0) continue;
					if (block.kind === "tool-result") {
						const op = fileOpFromCall(0, 0, 0, 0, block.name, block.argsRaw, textOf(block.content));
						push("subtool", block.callId, op, block.name);
					} else push("subtool", block.callId, void 0, block.name);
					emitSubCalls(block.subCalls);
				}
			};
			const emitToolRow = (callId, name, argsRaw, result, subCalls) => {
				const op = result === void 0 ? void 0 : fileOpFromCall(0, 0, 0, 0, name, argsRaw, textOf(result.content));
				push("tool", callId, op, name);
				emitSubCalls(subCalls);
			};
			const emitAssistantBlocks = (blocks) => {
				push("message", void 0, void 0, "assistant");
				for (const raw of blocks) {
					if (typeof raw !== "object" || raw === null) continue;
					const record = raw;
					if (record.kind !== "tool-call") continue;
					const callId = typeof record.callId === "string" ? record.callId : "";
					const name = typeof record.name === "string" ? record.name : callId;
					if (callId === "") continue;
					const argsRaw = typeof record.argsRaw === "string" ? record.argsRaw : void 0;
					const call = callById.get(callId);
					emitToolRow(callId, name, argsRaw, resultByCall.get(callId), call?.subCalls);
				}
			};
			for (const entry of entries) {
				if (entry.kind === "request") {
					push("request", void 0, void 0, "request");
					continue;
				}
				if (entry.kind === "system") {
					push("system", void 0, void 0, "system");
					continue;
				}
				if (entry.kind === "compaction") {
					push("compacted", void 0, void 0, "compacted");
					continue;
				}
				const node = entry.node;
				if (node === void 0) continue;
				switch (node.kind) {
					case "user":
					case "steering":
						push("user", void 0, void 0, node.kind);
						break;
					case "context":
						push("context", void 0, void 0, "context");
						break;
					case "assistant":
						emitAssistantBlocks(node.blocks);
						break;
					case "tool-result": {
						if (emittedFromBlocks.has(node.callId)) break;
						const block = asBlock(node);
						if (block === void 0) break;
						emitToolRow(node.callId, block.name, block.argsRaw, block, block.subCalls);
						break;
					}
					default: break;
				}
			}
			if (partial !== null) emitAssistantBlocks(partial.blocks);
			for (const call of runningCalls) {
				if (emittedRows.has(call.callId)) continue;
				const block = asBlock(call);
				emitToolRow(call.callId, call.name, call.argsRaw, void 0, block?.subCalls);
			}
			return rows;
		}
		//#endregion
		//#region src/core/trees.ts
		/**
		* Pure branch-tree registry: the git-like master/main tree model backing
		* trajectory rollback/restore.
		*
		* - `main` is the implicit main tree: the workspace state at the trajectory
		*   head (all file ops applied). Its stateIndex is always the live op count,
		*   so it is not stored in `trees`.
		* - Rolling back to a node creates a numbered master tree (master1, master2,
		*   ...) holding that node's file state; a later rollback to the same state
		*   reuses the existing tree instead of creating a duplicate.
		* - Restoring returns the workspace to the main tree.
		*
		* The registry itself is pure data; persistence (localStorage per workspace)
		* and file application live in the client/host halves.
		*/
		const MAIN_TREE = "main";
		const EMPTY_TREE_REGISTRY = {
			trees: [],
			current: MAIN_TREE,
			masterCounter: 0
		};
		function treeByName(registry, name) {
			return registry.trees.find((tree) => tree.name === name);
		}
		function nextMasterName(registry) {
			return "master" + (registry.masterCounter + 1);
		}
		/**
		* Resolve the master tree for one target state, creating it (masterN) when
		* no stored tree already points at that exact state.
		* @returns the (possibly new) tree and whether it was created.
		*/
		function branchTreeAt(registry, stateIndex, nodeIndex, label, now) {
			const existing = registry.trees.find((tree) => tree.stateIndex === stateIndex);
			if (existing !== void 0) return {
				registry,
				tree: existing,
				created: false
			};
			const name = nextMasterName(registry);
			const tree = {
				name,
				label: label !== "" ? label : name,
				kind: "master",
				nodeIndex,
				stateIndex,
				createdAt: now
			};
			return {
				registry: {
					trees: [...registry.trees, tree],
					current: registry.current,
					masterCounter: registry.masterCounter + 1
				},
				tree,
				created: true
			};
		}
		/** Mark the named tree as current; unknown names leave the registry untouched. */
		function withCurrent(registry, name) {
			if (name !== "main" && treeByName(registry, name) === void 0) return registry;
			if (registry.current === name) return registry;
			return {
				...registry,
				current: name
			};
		}
		function isMainTree(registry) {
			return registry.current === MAIN_TREE;
		}
		/** Highest master number already minted (0 when none). */
		function masterNumber(registry) {
			let max = 0;
			for (const tree of registry.trees) {
				const match = /^master(\d+)$/.exec(tree.name);
				if (match !== null) max = Math.max(max, Number(match[1]));
			}
			return max;
		}
		function isFiniteNumber(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		function parseTreeRef(value) {
			if (typeof value !== "object" || value === null) return null;
			const record = value;
			if (typeof record.name !== "string" || record.name === "") return null;
			if (record.kind !== "main" && record.kind !== "master") return null;
			if (!isFiniteNumber(record.nodeIndex) || !isFiniteNumber(record.stateIndex)) return null;
			return {
				name: record.name,
				label: typeof record.label === "string" && record.label !== "" ? record.label : record.name,
				kind: record.kind,
				nodeIndex: record.nodeIndex,
				stateIndex: record.stateIndex,
				createdAt: isFiniteNumber(record.createdAt) ? record.createdAt : 0
			};
		}
		/** Repair unknown/corrupt persisted payloads into a valid registry. */
		function parseTreeRegistry(value) {
			if (typeof value !== "object" || value === null) return EMPTY_TREE_REGISTRY;
			const record = value;
			const trees = [];
			if (Array.isArray(record.trees)) for (const entry of record.trees) {
				const tree = parseTreeRef(entry);
				if (tree !== null && tree.name !== "main") trees.push(tree);
			}
			const deduped = [...new Map(trees.map((tree) => [tree.name, tree])).values()];
			const counter = Math.max(isFiniteNumber(record.masterCounter) ? Math.max(0, Math.floor(record.masterCounter)) : 0, masterNumber({
				trees: deduped,
				current: MAIN_TREE,
				masterCounter: 0
			}));
			return {
				trees: deduped,
				current: typeof record.current === "string" && (record.current === "main" || deduped.some((tree) => tree.name === record.current)) ? record.current : MAIN_TREE,
				masterCounter: counter
			};
		}
		//#endregion
		//#region src/client/trajectory-snapshot.ts
		const EMPTY_TRAJECTORY_SNAPSHOT = {
			eventNodes: [],
			partial: null,
			runningCalls: []
		};
		//#endregion
		//#region src/client/tree-store.ts
		/**
		* Browser persistence for the branch-tree registry, keyed per workspace path
		* (localStorage, same pattern as dsh-task-board). Content is never stored —
		* tree file states are re-derived from the trajectory ops at apply time.
		*/
		const PREFIX = "dsh-branch.trees.";
		function treeStoreKey(cwd) {
			return PREFIX + encodeURIComponent(cwd);
		}
		function loadTreeRegistry(cwd) {
			if (cwd === "" || typeof localStorage === "undefined") return EMPTY_TREE_REGISTRY;
			try {
				const raw = localStorage.getItem(treeStoreKey(cwd));
				if (raw === null) return EMPTY_TREE_REGISTRY;
				return parseTreeRegistry(JSON.parse(raw));
			} catch {
				return EMPTY_TREE_REGISTRY;
			}
		}
		function saveTreeRegistry(cwd, registry) {
			if (cwd === "" || typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(treeStoreKey(cwd), JSON.stringify({
					trees: registry.trees,
					current: registry.current,
					masterCounter: registry.masterCounter
				}));
			} catch {}
		}
		//#endregion
		//#region \0dsh-css:packages/dsh-branch/src/client/branch.module.css.mjs
		const css = ":root{--branch-bg:#fff;--branch-fg:#1f2328;--branch-muted:#57606a;--branch-faint:#8c959f;--branch-border:#d0d7de;--branch-border-soft:#eaeef2;--branch-hover:#f2f4f6;--branch-accent:#0969da;--branch-accent-soft:#ddf4ff;--branch-danger:#cf222e;--branch-danger-soft:#ffebe9;--branch-ok:#1a7f37;--branch-ok-soft:#dafbe1;--branch-warn:#9a6700;--branch-icon-hover-bg:#6e7681;--branch-shadow:0 12px 32px #1b1f2429;font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif}@media (prefers-color-scheme:dark){:root{--branch-bg:#0d1117;--branch-fg:#e6edf3;--branch-muted:#aeb6c0;--branch-faint:#6e7681;--branch-border:#30363d;--branch-border-soft:#21262d;--branch-hover:#161b22;--branch-accent:#4493f8;--branch-accent-soft:#0c2d6b;--branch-danger:#f85149;--branch-danger-soft:#3d1517;--branch-ok:#3fb950;--branch-ok-soft:#12261b;--branch-warn:#d29922;--branch-icon-hover-bg:#484f58;--branch-shadow:0 12px 32px #0104098c}}.RfIOlG_actionsCell{border-bottom:1px solid var(--branch-border-soft);vertical-align:middle;white-space:nowrap;text-align:right;width:56px;padding:0 10px 0 0}.RfIOlG_actionsInner{opacity:.35;align-items:center;gap:1px;transition:opacity .12s;display:inline-flex}tr:hover .RfIOlG_actionsInner{opacity:1}.RfIOlG_iconButton{width:24px;height:24px;color:var(--branch-faint);cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.RfIOlG_iconButton svg{width:14px;height:14px}.RfIOlG_iconButton:hover:not(:disabled){background:var(--branch-icon-hover-bg);color:#fff}.RfIOlG_iconButton:disabled{opacity:.25;cursor:default}.RfIOlG_iconButtonActive{color:var(--branch-accent)}.RfIOlG_treeChip{flex:none;align-items:center;height:20px;display:inline-flex;position:relative}.RfIOlG_treeChipButton{height:20px;color:var(--dsw-alias-label-tertiary,var(--branch-muted));cursor:pointer;font:var(--dsw-font-xxs-12,12px/1.5 -apple-system, \"Segoe UI\", sans-serif);background:0 0;border:0;border-radius:3px;flex:none;align-items:center;gap:4px;padding:0 5px;display:inline-flex}.RfIOlG_treeChipButton:hover{color:var(--dsw-alias-label-primary,var(--branch-fg));background:var(--dsw-alias-interactive-bg-hover,var(--branch-hover))}.RfIOlG_treeChipButton:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary,var(--branch-accent));outline-offset:1px}.RfIOlG_treeChipButton svg{stroke:currentColor;stroke-width:1.25px;stroke-linecap:round;stroke-linejoin:round;width:12px;height:12px;color:var(--dsw-alias-label-tertiary,var(--branch-faint));flex:none}.RfIOlG_treeChipName{text-overflow:ellipsis;white-space:nowrap;max-width:120px;overflow:hidden}.RfIOlG_treeCaret{color:var(--dsw-alias-label-caption,var(--branch-faint));font-size:8px}.RfIOlG_notice{z-index:220;max-width:60%;box-shadow:var(--branch-shadow);border-radius:8px;padding:7px 12px;font-size:12px;position:fixed;top:10px;left:50%;transform:translate(-50%)}.RfIOlG_noticeOk{border:1px solid var(--branch-ok);background:var(--branch-ok-soft);color:var(--branch-ok)}.RfIOlG_noticeError{border:1px solid var(--branch-danger);background:var(--branch-danger-soft);color:var(--branch-danger)}.RfIOlG_modalOverlay{z-index:210;background:#0d111766;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}.RfIOlG_modalCard{background:var(--branch-bg);width:420px;max-width:calc(100vw - 40px);max-height:calc(100vh - 80px);color:var(--branch-fg);border:1px solid var(--branch-border);box-shadow:var(--branch-shadow);font:inherit;border-radius:12px;flex-direction:column;display:flex;overflow:hidden}.RfIOlG_modalHead{justify-content:space-between;align-items:center;padding:12px 16px 8px;display:flex}.RfIOlG_modalTitle{font-size:13px;font-weight:600}.RfIOlG_modalClose{color:var(--branch-faint);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:3px 7px;font-size:15px;line-height:1}.RfIOlG_modalClose:hover{background:var(--branch-hover);color:var(--branch-fg)}.RfIOlG_modalNode{color:var(--branch-muted);overflow-wrap:anywhere;padding:0 16px 2px;font-size:12px}.RfIOlG_modalTree{color:var(--branch-accent);padding:4px 16px 0;font-size:12px;font-weight:600}.RfIOlG_modalSubtitle{color:var(--branch-faint);padding:10px 16px 4px;font-size:12px}.RfIOlG_modalLoading{color:var(--branch-muted);padding:8px 16px 12px;font-size:12px}.RfIOlG_modalList{gap:3px;max-height:220px;padding:2px 16px 10px;display:grid;overflow:auto}.RfIOlG_modalRow{background:var(--branch-hover);border-radius:7px;align-items:center;gap:10px;padding:4px 8px;display:flex}.RfIOlG_modalPath{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow:hidden}.RfIOlG_modalBadge{border-radius:20px;flex-shrink:0;padding:1px 8px;font-size:11px;font-weight:600}.RfIOlG_badgeCreate{background:var(--branch-ok-soft);color:var(--branch-ok)}.RfIOlG_badgeWrite{background:var(--branch-accent-soft);color:var(--branch-accent)}.RfIOlG_badgeDelete{background:var(--branch-danger-soft);color:var(--branch-danger)}.RfIOlG_badgeUnchanged{background:var(--branch-hover);color:var(--branch-faint);border:1px solid var(--branch-border-soft)}.RfIOlG_modalSkipped{color:var(--branch-warn);padding:2px 8px;font-size:12px}.RfIOlG_modalFooter{border-top:1px solid var(--branch-border-soft);justify-content:flex-end;gap:8px;padding:10px 16px;display:flex}.RfIOlG_rowAction{border:1px solid var(--branch-border);background:var(--branch-bg);color:var(--branch-fg);font:inherit;cursor:pointer;white-space:nowrap;border-radius:7px;padding:4px 12px;font-size:12px}.RfIOlG_rowAction:hover:not(:disabled){border-color:var(--branch-accent);color:var(--branch-accent)}.RfIOlG_rowAction:disabled{opacity:.45;cursor:default}.RfIOlG_primaryButton{border:1px solid var(--branch-accent);background:var(--branch-accent);color:#fff;font:inherit;cursor:pointer;border-radius:7px;padding:4px 14px;font-size:12px;font-weight:600}.RfIOlG_primaryButton:hover:not(:disabled){filter:brightness(1.06)}.RfIOlG_primaryButton:disabled{opacity:.5;cursor:default}";
		const tagId = "@linxin666/dsh-client-ui-branch/branch.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-branch";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var branch_module_css_default = {
			"actionsCell": "RfIOlG_actionsCell",
			"actionsInner": "RfIOlG_actionsInner",
			"badgeCreate": "RfIOlG_badgeCreate",
			"badgeDelete": "RfIOlG_badgeDelete",
			"badgeUnchanged": "RfIOlG_badgeUnchanged",
			"badgeWrite": "RfIOlG_badgeWrite",
			"iconButton": "RfIOlG_iconButton",
			"iconButtonActive": "RfIOlG_iconButtonActive",
			"modalBadge": "RfIOlG_modalBadge",
			"modalCard": "RfIOlG_modalCard",
			"modalClose": "RfIOlG_modalClose",
			"modalFooter": "RfIOlG_modalFooter",
			"modalHead": "RfIOlG_modalHead",
			"modalList": "RfIOlG_modalList",
			"modalLoading": "RfIOlG_modalLoading",
			"modalNode": "RfIOlG_modalNode",
			"modalOverlay": "RfIOlG_modalOverlay",
			"modalPath": "RfIOlG_modalPath",
			"modalRow": "RfIOlG_modalRow",
			"modalSkipped": "RfIOlG_modalSkipped",
			"modalSubtitle": "RfIOlG_modalSubtitle",
			"modalTitle": "RfIOlG_modalTitle",
			"modalTree": "RfIOlG_modalTree",
			"notice": "RfIOlG_notice",
			"noticeError": "RfIOlG_noticeError",
			"noticeOk": "RfIOlG_noticeOk",
			"primaryButton": "RfIOlG_primaryButton",
			"rowAction": "RfIOlG_rowAction",
			"treeCaret": "RfIOlG_treeCaret",
			"treeChip": "RfIOlG_treeChip",
			"treeChipButton": "RfIOlG_treeChipButton",
			"treeChipName": "RfIOlG_treeChipName"
		};
		//#endregion
		//#region src/client/inject.ts
		const VIEW_SELECTOR = "[data-conversation-composer-overlay]";
		const ROW_SELECTOR = "tr[data-record-index]";
		const CELL_MARK = "data-dsh-branch-cell";
		const CHIP_MARK = "data-dsh-branch-tree";
		const NOTICE_MARK = "data-dsh-branch-notice";
		function createState() {
			return {
				sessionId: null,
				cwd: void 0,
				rows: [],
				ops: [],
				registry: loadTreeRegistry(""),
				busy: false,
				pending: null,
				menuOpen: false,
				unbindSession: null,
				observer: null,
				syncTimer: null,
				noticeTimer: null
			};
		}
		function el(tag, className, attrs = {}) {
			const node = document.createElement(tag);
			if (className !== void 0) node.className = className;
			for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
			return node;
		}
		function buttonEl(className, attrs = {}) {
			const node = document.createElement("button");
			node.type = "button";
			if (className !== void 0) node.className = className;
			for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
			return node;
		}
		/** Line-icon SVGs (stroke-based, inherit currentColor). */
		const ROLLBACK_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 7v6h6\"/><path d=\"M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13\"/></svg>";
		const RESTORE_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z\"/><line x1=\"4\" x2=\"4\" y1=\"22\" y2=\"15\"/></svg>";
		const BRANCH_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"6\" cy=\"6\" r=\"2.5\"/><circle cx=\"6\" cy=\"18\" r=\"2.5\"/><circle cx=\"18\" cy=\"6\" r=\"2.5\"/><path d=\"M6 8.5v7\"/><path d=\"M18 8.5a6 6 0 0 1-6 6H8.5\"/></svg>";
		/** Start the injector; returns the disposer (registered via ctx.effect). */
		function startBranchInjection(ctx, api, t, sessionIdOf, cwdOf) {
			const state = createState();
			const notice = (kind, text) => {
				if (state.noticeTimer !== null) clearTimeout(state.noticeTimer);
				let node = document.querySelector("[data-dsh-branch-notice]");
				if (node === null) {
					node = el("div", branch_module_css_default.notice + " " + (kind === "error" ? branch_module_css_default.noticeError : branch_module_css_default.noticeOk), { [NOTICE_MARK]: "" });
					node.style.position = "fixed";
					node.style.top = "10px";
					node.style.left = "50%";
					node.style.transform = "translateX(-50%)";
					document.body.appendChild(node);
				} else node.className = branch_module_css_default.notice + " " + (kind === "error" ? branch_module_css_default.noticeError : branch_module_css_default.noticeOk);
				node.textContent = text;
				state.noticeTimer = setTimeout(() => {
					node?.remove();
				}, 6e3);
			};
			const refreshModel = () => {
				const id = sessionIdOf();
				if (id === void 0) {
					state.sessionId = null;
					state.rows = [];
					state.ops = [];
					syncDom();
					return;
				}
				state.sessionId = id;
				const cwd = cwdOf(id);
				if (cwd !== state.cwd) {
					state.cwd = cwd;
					state.registry = loadTreeRegistry(cwd ?? "");
				}
				const trajectory = (ctx.sessions.binding(id)?.session.getSnapshot())?.views.get("trajectory") ?? EMPTY_TRAJECTORY_SNAPSHOT;
				const rows = projectOfficialRows({
					nodes: trajectory.eventNodes,
					requests: trajectory.requests,
					partial: trajectory.partial,
					runningCalls: trajectory.runningCalls
				});
				state.rows = rows;
				state.ops = rows.flatMap((row) => row.op === void 0 ? [] : [row.op]);
				syncDom();
			};
			const syncSession = () => {
				const id = sessionIdOf();
				if (id === state.sessionId) {
					refreshModel();
					return;
				}
				state.unbindSession?.();
				state.unbindSession = null;
				if (id === void 0) {
					refreshModel();
					return;
				}
				const binding = ctx.sessions.binding(id);
				if (binding === void 0) {
					refreshModel();
					return;
				}
				state.unbindSession = binding.session.subscribe(refreshModel);
				refreshModel();
			};
			const scheduleSync = () => {
				if (state.syncTimer !== null) clearTimeout(state.syncTimer);
				state.syncTimer = setTimeout(() => {
					state.syncTimer = null;
					syncDom();
				}, 80);
			};
			const currentMaster = () => isMainTree(state.registry) ? void 0 : treeByName(state.registry, state.registry.current);
			const rowOf = (cellIndex) => state.rows.find((row) => row.cellIndex === cellIndex);
			const onRowTree = (row) => {
				const master = currentMaster();
				return master !== void 0 && master.stateIndex === row.stateIndex;
			};
			const openApply = async (target) => {
				if (state.busy || state.pending !== null) return;
				const cwd = state.cwd;
				if (cwd === void 0 || cwd === "") {
					notice("error", t("apply.noWorkspace"));
					return;
				}
				const set = applySetAt(state.ops, target.stateIndex);
				if (set.writes.length === 0 && set.deletes.length === 0) {
					notice("ok", t("apply.noChanges") + (set.skipped.length > 0 ? t("apply.partial", { skipped: set.skipped.length }) : ""));
					return;
				}
				state.pending = {
					target,
					set,
					entries: null
				};
				renderModal();
				const result = await api.preview(cwd, set.writes, set.deletes);
				if (state.pending === null) return;
				state.pending = {
					...state.pending,
					entries: result.ok ? [...result.value] : []
				};
				renderModal();
				if (!result.ok) {
					notice("error", t("apply.error", { error: result.error.message }));
					state.pending = null;
					renderModal();
				}
			};
			const requestApply = (cellIndex, mode) => {
				if (state.busy || state.pending !== null) return;
				const row = rowOf(cellIndex);
				if (row === void 0) return;
				if (mode === "restore") {
					if (isMainTree(state.registry)) {
						notice("ok", t("tree.alreadyOn"));
						return;
					}
					openApply({
						mode: "restore",
						stateIndex: state.ops.length,
						cellIndex: -1,
						name: MAIN_TREE,
						created: false,
						treeLabel: t("tree.main"),
						label: t("tree.restoreMain")
					});
					return;
				}
				if (onRowTree(row)) {
					notice("ok", t("tree.alreadyOn"));
					return;
				}
				const branched = branchTreeAt(state.registry, row.stateIndex, row.cellIndex, row.label, Date.now());
				openApply({
					mode: "rollback",
					stateIndex: row.stateIndex,
					cellIndex: row.cellIndex,
					name: branched.tree.name,
					created: branched.created,
					treeLabel: row.label,
					label: row.label + " · #" + row.cellIndex
				});
			};
			const requestTreeEntry = (entry) => {
				if (state.busy || state.pending !== null) return;
				if (entry.current) {
					notice("ok", t("tree.alreadyOn"));
					return;
				}
				const mode = entry.name === "main" ? "restore" : "checkout";
				openApply({
					mode,
					stateIndex: entry.stateIndex,
					cellIndex: entry.cellIndex,
					name: entry.name,
					created: false,
					treeLabel: entry.label,
					label: entry.name === "main" ? t("tree.restoreMain") : t("tree.checkout", { name: entry.name })
				});
			};
			const confirmApply = async () => {
				const pending = state.pending;
				if (pending === null || state.busy) return;
				const cwd = state.cwd;
				if (cwd === void 0 || cwd === "") {
					notice("error", t("apply.noWorkspace"));
					return;
				}
				state.busy = true;
				syncDom();
				const result = await api.apply(cwd, pending.set.writes, pending.set.deletes);
				state.busy = false;
				if (!result.ok) {
					notice("error", t("apply.error", { error: result.error.message }));
					state.pending = null;
					renderModal();
					syncDom();
					return;
				}
				const target = pending.target;
				let suffix = "";
				if (target.mode === "rollback") {
					const branched = branchTreeAt(state.registry, target.stateIndex, target.cellIndex, target.treeLabel, Date.now());
					state.registry = withCurrent(branched.registry, branched.tree.name);
					suffix = branched.created ? " · " + t("tree.created", { name: branched.tree.name }) : " · " + t("tree.switched", { name: branched.tree.name });
				} else {
					state.registry = withCurrent(state.registry, target.name);
					suffix = target.name === "main" ? " · " + t("tree.restored") : " · " + t("tree.switched", { name: target.name });
				}
				saveTreeRegistry(cwd, state.registry);
				state.pending = null;
				renderModal();
				syncDom();
				notice(result.value.failed > 0 ? "error" : "ok", t("apply.done", {
					written: result.value.written,
					deleted: result.value.deleted,
					skipped: pending.set.skipped.length
				}) + (result.value.failed > 0 ? t("apply.failed", { failed: result.value.failed }) : "") + (result.value.failed === 0 ? suffix : ""));
			};
			let overlay = null;
			const closeModal = () => {
				state.pending = null;
				overlay?.remove();
				overlay = null;
			};
			const changeKey = (entry) => {
				if (entry.action === "create") return "change.create";
				if (entry.action === "delete") return "change.delete";
				if (entry.action === "unchanged") return "change.unchanged";
				return "change.write";
			};
			const changeClass = (entry) => {
				if (entry.action === "create") return branch_module_css_default.badgeCreate;
				if (entry.action === "delete") return branch_module_css_default.badgeDelete;
				if (entry.action === "unchanged") return branch_module_css_default.badgeUnchanged;
				return branch_module_css_default.badgeWrite;
			};
			const renderModal = () => {
				overlay?.remove();
				overlay = null;
				const pending = state.pending;
				if (pending === null) return;
				const target = pending.target;
				const title = target.mode === "rollback" ? t("modal.rollbackTitle") : target.mode === "restore" ? t("modal.restoreTitle") : t("modal.checkoutTitle");
				const confirm = target.mode === "rollback" ? t("modal.confirmRollback") : target.mode === "restore" ? t("modal.confirmRestore") : t("modal.confirmCheckout");
				const treeLine = target.mode === "rollback" ? target.created ? t("tree.rollbackCreate", { name: target.name }) : t("tree.rollbackSwitch", { name: target.name }) : target.name === "main" ? t("tree.restoreMain") : t("tree.checkout", { name: target.name });
				const overlayNode = el("div", branch_module_css_default.modalOverlay);
				const card = el("div", branch_module_css_default.modalCard);
				const head = el("div", branch_module_css_default.modalHead);
				const titleNode = el("span", branch_module_css_default.modalTitle);
				titleNode.textContent = title;
				head.appendChild(titleNode);
				const close = buttonEl(branch_module_css_default.modalClose, { "aria-label": t("modal.close") });
				close.textContent = "×";
				close.addEventListener("click", () => {
					if (!state.busy) closeModal();
				});
				head.appendChild(close);
				card.appendChild(head);
				const node = el("div", branch_module_css_default.modalNode);
				node.textContent = target.label;
				card.appendChild(node);
				const tree = el("div", branch_module_css_default.modalTree);
				tree.textContent = treeLine;
				card.appendChild(tree);
				const subtitle = el("div", branch_module_css_default.modalSubtitle);
				subtitle.textContent = t("modal.subtitle");
				card.appendChild(subtitle);
				if (pending.entries === null) {
					const loading = el("div", branch_module_css_default.modalLoading);
					loading.textContent = t("modal.loading");
					card.appendChild(loading);
				} else {
					const list = el("div", branch_module_css_default.modalList);
					for (const entry of pending.entries) {
						const row = el("div", branch_module_css_default.modalRow);
						const path = el("span", branch_module_css_default.modalPath, { title: entry.path });
						path.textContent = entry.path;
						const badge = el("span", branch_module_css_default.modalBadge + " " + changeClass(entry));
						badge.textContent = t(changeKey(entry));
						row.append(path, badge);
						list.appendChild(row);
					}
					if (pending.set.skipped.length > 0) {
						const skipped = el("div", branch_module_css_default.modalSkipped);
						skipped.textContent = t("modal.skipped", { n: pending.set.skipped.length });
						list.appendChild(skipped);
					}
					card.appendChild(list);
				}
				const footer = el("div", branch_module_css_default.modalFooter);
				const cancel = buttonEl(branch_module_css_default.rowAction);
				cancel.textContent = t("modal.cancel");
				cancel.addEventListener("click", () => {
					if (!state.busy) closeModal();
				});
				const ok = buttonEl(branch_module_css_default.primaryButton);
				ok.textContent = confirm;
				ok.disabled = state.busy || pending.entries === null;
				ok.addEventListener("click", () => {
					confirmApply();
				});
				footer.append(cancel, ok);
				card.appendChild(footer);
				overlayNode.addEventListener("click", (event) => {
					if (event.target === overlayNode && !state.busy) closeModal();
				});
				overlayNode.appendChild(card);
				document.body.appendChild(overlayNode);
				overlay = overlayNode;
			};
			const renderTreeChip = (root) => {
				const anchor = root.querySelector("[role=\"toolbar\"] input[type=\"search\"]")?.parentElement;
				let chip = root.querySelector("[data-dsh-branch-tree]");
				if (anchor === void 0 || anchor === null) {
					chip?.remove();
					return;
				}
				if (chip === null) {
					chip = el("div", branch_module_css_default.treeChip, { [CHIP_MARK]: "" });
					anchor.after(chip);
				} else if (chip.parentElement !== anchor) anchor.after(chip);
				chip.replaceChildren();
				const button = buttonEl(branch_module_css_default.treeChipButton, {
					"aria-expanded": String(state.menuOpen),
					"aria-label": t("tree.switch")
				});
				const icon = el("span");
				icon.innerHTML = BRANCH_ICON;
				const name = el("span", branch_module_css_default.treeChipName);
				name.textContent = state.registry.current;
				const caret = el("span", branch_module_css_default.treeCaret, { "aria-hidden": "true" });
				caret.textContent = state.menuOpen ? "▲" : "▼";
				button.append(icon, name, caret);
				button.addEventListener("click", (event) => {
					event.stopPropagation();
					state.menuOpen = !state.menuOpen;
					renderTreeChip(root);
				});
				chip.appendChild(button);
				if (state.menuOpen) {
					const menu = el("div", branch_module_css_default.treeMenu, { role: "menu" });
					const entries = [{
						name: MAIN_TREE,
						label: t("tree.main"),
						stateIndex: state.ops.length,
						cellIndex: -1,
						current: isMainTree(state.registry)
					}, ...state.registry.trees.slice().sort((a, b) => a.createdAt - b.createdAt).map((tree) => ({
						name: tree.name,
						label: tree.label,
						stateIndex: tree.stateIndex,
						cellIndex: tree.nodeIndex,
						current: state.registry.current === tree.name
					}))];
					for (const entry of entries) {
						const item = buttonEl(branch_module_css_default.treeMenuItem + (entry.current ? " " + branch_module_css_default.treeMenuItemCurrent : ""), { role: "menuitem" });
						item.disabled = state.busy || entry.current;
						const itemName = el("span", branch_module_css_default.treeMenuName);
						itemName.textContent = entry.name;
						const meta = el("span", branch_module_css_default.treeMenuMeta);
						meta.textContent = entry.name === "main" ? "#" + entry.stateIndex : entry.label || "#" + entry.stateIndex;
						item.append(itemName, meta);
						item.addEventListener("click", (event) => {
							event.stopPropagation();
							state.menuOpen = false;
							requestTreeEntry(entry);
							renderTreeChip(root);
						});
						menu.appendChild(item);
					}
					chip.appendChild(menu);
				}
			};
			const createCell = (tr, row) => {
				const cell = document.createElement("td");
				cell.setAttribute(CELL_MARK, "");
				cell.dataset.dshBranchIndex = String(row.cellIndex);
				cell.className = branch_module_css_default.actionsCell;
				const inner = el("span", branch_module_css_default.actionsInner);
				const rollback = buttonEl(branch_module_css_default.iconButton, {
					"data-dsh-branch-role": "rollback",
					title: t("action.rollback"),
					"aria-label": t("action.rollback")
				});
				rollback.innerHTML = ROLLBACK_ICON;
				rollback.addEventListener("click", (event) => {
					event.stopPropagation();
					requestApply(row.cellIndex, "rollback");
				});
				const restore = buttonEl(branch_module_css_default.iconButton, {
					"data-dsh-branch-role": "restore",
					title: t("action.restore"),
					"aria-label": t("action.restore")
				});
				restore.innerHTML = RESTORE_ICON;
				restore.addEventListener("click", (event) => {
					event.stopPropagation();
					requestApply(row.cellIndex, "restore");
				});
				inner.append(rollback, restore);
				cell.appendChild(inner);
				tr.appendChild(cell);
				updateCell(cell, row);
			};
			const updateCell = (cell, row) => {
				const rollback = cell.querySelector("button[data-dsh-branch-role=\"rollback\"]");
				const restore = cell.querySelector("button[data-dsh-branch-role=\"restore\"]");
				if (rollback !== null) {
					const onTree = onRowTree(row);
					rollback.disabled = state.busy || onTree;
					rollback.title = onTree ? t("tree.alreadyOn") : t("action.rollback");
					rollback.classList.toggle(branch_module_css_default.iconButtonActive, onTree);
				}
				if (restore !== null) {
					const onMain = isMainTree(state.registry);
					restore.disabled = state.busy || onMain;
					restore.title = onMain ? t("tree.alreadyOn") : t("action.restore");
				}
			};
			const syncDom = () => {
				const roots = document.querySelectorAll(VIEW_SELECTOR);
				const byIndex = new Map(state.rows.map((row) => [row.cellIndex, row]));
				for (const root of roots) {
					renderTreeChip(root);
					const trs = root.querySelectorAll(ROW_SELECTOR);
					for (const tr of trs) {
						const raw = tr.dataset.recordIndex;
						const index = raw === void 0 ? NaN : Number(raw);
						if (!Number.isInteger(index) || index < 0) continue;
						const row = byIndex.get(index);
						const cell = tr.querySelector("td[data-dsh-branch-cell]");
						if (row === void 0) {
							cell?.remove();
							continue;
						}
						if (cell === null || Number(cell.dataset.dshBranchIndex) !== row.cellIndex) {
							cell?.remove();
							createCell(tr, row);
							continue;
						}
						updateCell(cell, row);
					}
				}
			};
			const unsubList = ctx.sessions.list.subscribe(syncSession);
			syncSession();
			state.observer = new MutationObserver(scheduleSync);
			state.observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			const closeOnOutsideClick = (event) => {
				const target = event.target;
				const chip = document.querySelector("[data-dsh-branch-tree]");
				if (chip !== null && target !== null && !chip.contains(target) && state.menuOpen) {
					state.menuOpen = false;
					for (const root of document.querySelectorAll(VIEW_SELECTOR)) renderTreeChip(root);
				}
			};
			document.addEventListener("click", closeOnOutsideClick);
			return () => {
				unsubList();
				state.unbindSession?.();
				state.observer?.disconnect();
				document.removeEventListener("click", closeOnOutsideClick);
				if (state.syncTimer !== null) clearTimeout(state.syncTimer);
				if (state.noticeTimer !== null) clearTimeout(state.noticeTimer);
				overlay?.remove();
				overlay = null;
				for (const node of document.querySelectorAll("[data-dsh-branch-cell], [data-dsh-branch-tree], [data-dsh-branch-notice]")) node.remove();
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/** `branch` namespace dictionaries (DOM-injected trajectory actions). */
		const zh = {
			"action.rollback": "回滚",
			"action.restore": "恢复",
			"tree.current": "当前树",
			"tree.switch": "切换树",
			"tree.main": "main",
			"tree.rollbackCreate": "将创建 {name} 并切换到该树",
			"tree.rollbackSwitch": "将切换到 {name}",
			"tree.restoreMain": "将回到 main 树",
			"tree.checkout": "将切换到 {name}",
			"tree.alreadyOn": "工作区已在该树",
			"tree.created": "已创建 {name}",
			"tree.switched": "已切换到 {name}",
			"tree.restored": "已回到 main 树",
			"modal.rollbackTitle": "回滚到该节点",
			"modal.restoreTitle": "恢复到该节点",
			"modal.checkoutTitle": "切换到该树",
			"modal.subtitle": "以下文件将被修改：",
			"modal.skipped": "{n} 个文件在轨迹窗口外，状态未知，已跳过",
			"modal.loading": "正在计算文件变更…",
			"modal.confirmRollback": "确认回滚",
			"modal.confirmRestore": "确认恢复",
			"modal.confirmCheckout": "确认切换",
			"modal.cancel": "取消",
			"modal.close": "关闭",
			"change.write": "写入",
			"change.create": "创建",
			"change.delete": "删除",
			"change.unchanged": "无变化",
			"apply.done": "已应用：写入 {written}，删除 {deleted}，跳过 {skipped}",
			"apply.failed": "部分失败：{failed} 个文件",
			"apply.error": "应用失败：{error}",
			"apply.noWorkspace": "当前会话没有工作区，无法操作文件",
			"apply.noChanges": "该节点没有可应用的变更",
			"apply.partial": "注意：{skipped} 个文件在轨迹窗口外，未包含"
		};
		const en = {
			"action.rollback": "Rollback",
			"action.restore": "Restore",
			"tree.current": "Current tree",
			"tree.switch": "Switch tree",
			"tree.main": "main",
			"tree.rollbackCreate": "Will create {name} and switch to it",
			"tree.rollbackSwitch": "Will switch to {name}",
			"tree.restoreMain": "Will return to the main tree",
			"tree.checkout": "Will switch to {name}",
			"tree.alreadyOn": "Workspace is already on this tree",
			"tree.created": "Created {name}",
			"tree.switched": "Switched to {name}",
			"tree.restored": "Back on the main tree",
			"modal.rollbackTitle": "Rollback to this node",
			"modal.restoreTitle": "Restore to this node",
			"modal.checkoutTitle": "Switch to this tree",
			"modal.subtitle": "These files will change:",
			"modal.skipped": "{n} files outside the trajectory window have unknown state and are skipped",
			"modal.loading": "Computing file changes…",
			"modal.confirmRollback": "Confirm rollback",
			"modal.confirmRestore": "Confirm restore",
			"modal.confirmCheckout": "Confirm switch",
			"modal.cancel": "Cancel",
			"modal.close": "Close",
			"change.write": "write",
			"change.create": "create",
			"change.delete": "delete",
			"change.unchanged": "unchanged",
			"apply.done": "Applied: {written} written, {deleted} deleted, {skipped} skipped",
			"apply.failed": "Partially failed: {failed} files",
			"apply.error": "Apply failed: {error}",
			"apply.noWorkspace": "This session has no workspace",
			"apply.noChanges": "No changes to apply at this node",
			"apply.partial": "Note: {skipped} files outside the trajectory window are not included"
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "branch";
		const inject = ["sessions", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-branch: dictionaries");
			const t = ctx.locale.bind(NS);
			const api = new BranchApi();
			ctx.effect(() => startBranchInjection(ctx, api, t, () => ctx.sessions.list.getSnapshot().current, (id) => ctx.sessions.list.getSnapshot().byId[id]?.cwd), "dsh-branch: trajectory row injection");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map