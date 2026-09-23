window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-preset-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:packages/dsh-preset-center/src/client/preset-center.module.css.mjs
		const css = ".fP-OOa_panel{flex-direction:column;gap:10px;display:flex}.fP-OOa_search{box-sizing:border-box;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:7px 10px;font-size:13px}.fP-OOa_search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.fP-OOa_empty{color:var(--dsw-alias-label-tertiary);margin:0;padding:14px 0;font-size:13px}.fP-OOa_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.fP-OOa_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex-direction:column;gap:6px;padding:12px;display:flex}.fP-OOa_cardHead{flex-wrap:wrap;align-items:baseline;gap:6px 10px;min-width:0;display:flex}.fP-OOa_cardName{color:var(--dsw-alias-label-primary);font-weight:600}.fP-OOa_cardName a{color:inherit;text-decoration:none}.fP-OOa_cardName a:hover{text-decoration:underline}.fP-OOa_version{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:6px;font-size:11px}.fP-OOa_cardMeta{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;display:flex}.fP-OOa_cardDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:1.45}.fP-OOa_badgeMuted,.fP-OOa_badgeOn,.fP-OOa_badgeOff,.fP-OOa_badgeWarn,.fP-OOa_badgeCode{white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:0 8px;font-size:11px;line-height:1.6}.fP-OOa_badgeOn{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.fP-OOa_badgeWarn{color:var(--dsw-alias-label-error,#c53030)}.fP-OOa_badgeCode{color:var(--dsw-alias-label-primary)}.fP-OOa_profile{flex-wrap:wrap;align-items:center;gap:6px;margin:0;display:flex}.fP-OOa_profileText{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}.fP-OOa_actions{flex-wrap:wrap;gap:6px;display:flex}.fP-OOa_actions>button{font-size:12px}.fP-OOa_primary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill)}.fP-OOa_primary:hover:enabled{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}.fP-OOa_primary:disabled{opacity:.55;cursor:default}.fP-OOa_secondary{color:var(--dsw-alias-label-primary)}.fP-OOa_danger{color:var(--dsw-alias-label-error,#c53030)}.fP-OOa_note{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:1.5}.fP-OOa_inlineButton{margin-left:8px;font-size:12px}.fP-OOa_viewer{white-space:pre;max-height:46vh;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;margin:0;padding:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;overflow:auto}.fP-OOa_modalActions{justify-content:flex-end;gap:8px;margin-top:12px;display:flex}";
		const tagId = "@linxin666/dsh-client-ui-preset-center/packages/dsh-preset-center/src/client/preset-center.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-preset-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var preset_center_module_css_default = {
			"actions": "fP-OOa_actions",
			"badgeCode": "fP-OOa_badgeCode",
			"badgeMuted": "fP-OOa_badgeMuted",
			"badgeOff": "fP-OOa_badgeOff",
			"badgeOn": "fP-OOa_badgeOn",
			"badgeWarn": "fP-OOa_badgeWarn",
			"card": "fP-OOa_card",
			"cardDesc": "fP-OOa_cardDesc",
			"cardHead": "fP-OOa_cardHead",
			"cardMeta": "fP-OOa_cardMeta",
			"cardName": "fP-OOa_cardName",
			"danger": "fP-OOa_danger",
			"empty": "fP-OOa_empty",
			"inlineButton": "fP-OOa_inlineButton",
			"list": "fP-OOa_list",
			"modalActions": "fP-OOa_modalActions",
			"note": "fP-OOa_note",
			"panel": "fP-OOa_panel",
			"primary": "fP-OOa_primary",
			"profile": "fP-OOa_profile",
			"profileText": "fP-OOa_profileText",
			"search": "fP-OOa_search",
			"secondary": "fP-OOa_secondary",
			"version": "fP-OOa_version",
			"viewer": "fP-OOa_viewer"
		};
		//#endregion
		//#region src/client/PresetPanel.tsx
		/**
		* The Workshop's Presets panel: browse the community preset catalog and drive
		* the host library (install into `$DSH_HOME/agent-presets/<id>` and declare it
		* to the agent-preset registry, disable, uninstall), with the composition
		* profile shown before anything executable is declared.
		*
		* The panel owns no catalog fetch: the Workshop card already fetches
		* `manifest/presets.json` and passes the records down, so one store section
		* makes one catalog request. Preset state comes from the preset-center host
		* routes, which derive it from disk and the live declarations on every read.
		* @module @linxin666/dsh-client-ui-preset-center/client/PresetPanel
		*/
		const EMPTY_PROFILE = {
			plugins: [],
			relativeNames: [],
			inlineExpressions: 0,
			codeFiles: [],
			codeExecution: "none",
			rows: 0
		};
		function messageOf(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		async function fetchJson(url) {
			const res = await fetch(url, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error("HTTP " + res.status);
			return res.json();
		}
		async function postJson(url, body) {
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const data = await res.json().catch(() => ({}));
			return {
				status: res.status,
				data
			};
		}
		function parseSemver(value) {
			const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
			if (match === null) return void 0;
			return {
				major: Number(match[1]),
				minor: Number(match[2]),
				patch: Number(match[3]),
				prerelease: match[4] === void 0 ? [] : match[4].split(".")
			};
		}
		function compareVersions(a, b) {
			const pa = parseSemver(a);
			const pb = parseSemver(b);
			if (pa === void 0 && pb === void 0) return 0;
			if (pa === void 0) return -1;
			if (pb === void 0) return 1;
			for (const key of [
				"major",
				"minor",
				"patch"
			]) if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
			if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
			if (pa.prerelease.length === 0) return 1;
			if (pb.prerelease.length === 0) return -1;
			for (let index = 0; index < Math.max(pa.prerelease.length, pb.prerelease.length); index++) {
				const ra = pa.prerelease[index];
				const rb = pb.prerelease[index];
				if (ra === void 0) return -1;
				if (rb === void 0) return 1;
				if (ra === rb) continue;
				const numericA = /^\d+$/.test(ra);
				const numericB = /^\d+$/.test(rb);
				if (numericA && numericB) return Number(ra) < Number(rb) ? -1 : 1;
				if (numericA) return -1;
				if (numericB) return 1;
				return ra < rb ? -1 : 1;
			}
			return 0;
		}
		/** Whether the catalog advertises a version newer than the installed one. */
		function hasUpdate(record, row) {
			if (row === void 0 || !row.installed) return false;
			if (record.version === void 0 || row.assetVersion === void 0) return false;
			return compareVersions(record.version, row.assetVersion) > 0;
		}
		/** Render the Presets panel. */
		function PresetPanel(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(null);
			const [notes, setNotes] = (0, react.useState)({});
			const [viewer, setViewer] = (0, react.useState)(null);
			const [confirmInstall, setConfirmInstall] = (0, react.useState)(null);
			const [confirmUninstall, setConfirmUninstall] = (0, react.useState)(null);
			const [reload, setReload] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let alive = true;
				setLoadError(null);
				fetchJson("/api/preset-center/state").then((raw) => {
					if (!alive) return;
					setState(raw);
				}).catch((reason) => {
					if (!alive) return;
					setState(null);
					setLoadError(messageOf(reason));
				});
				return () => {
					alive = false;
				};
			}, [reload]);
			const rows = props.items ?? [];
			const stateById = new Map((state?.presets ?? []).map((row) => [row.id, row]));
			const occupied = new Set(state?.occupied ?? []);
			const gateway = props.gateway === true && state !== null;
			const busyNow = busy !== null;
			const note = (id, text) => {
				setNotes((prev) => ({
					...prev,
					[id]: text
				}));
				window.setTimeout(() => {
					setNotes((prev) => {
						const next = { ...prev };
						delete next[id];
						return next;
					});
				}, 4e3);
			};
			const refresh = () => {
				setReload((value) => value + 1);
			};
			const run = async (id, label, work) => {
				if (busyNow) return;
				setBusy(id);
				try {
					await work();
				} catch (reason) {
					note(id, t("note.actionFailed", { reason: messageOf(reason) }));
				} finally {
					setBusy(null);
				}
			};
			/** Declare one installed preset, asking for confirmation when it carries code. */
			const declareNow = async (record, confirm, success) => {
				const res = await postJson("/api/preset-center/install", {
					id: record.id,
					confirm
				});
				if (res.data.ok === true) {
					setConfirmInstall(null);
					note(record.id, t(success, {}));
					refresh();
					return;
				}
				if (res.data.error === "confirmation-required") {
					setConfirmInstall({
						id: record.id,
						name: displayName(record),
						profile: res.data.profile ?? EMPTY_PROFILE
					});
					return;
				}
				if (res.data.error === "broken" || res.data.error === "invalid-composition") {
					note(record.id, t("note.broken", { reason: res.data.message ?? "" }));
					refresh();
					return;
				}
				if (res.data.error === "shadowed") {
					note(record.id, t("note.shadowed", {}));
					refresh();
					return;
				}
				if (res.data.error === "roster-unavailable") {
					note(record.id, t("note.rosterUnavailable", {}));
					return;
				}
				note(record.id, t("note.actionFailed", { reason: res.data.message ?? res.data.error ?? "HTTP " + res.status }));
			};
			const install = (record, force) => run(record.id, "install", async () => {
				if (props.install === void 0) return;
				try {
					await props.install(record.id, force);
				} catch (reason) {
					if (reason.code === "conflict") {
						note(record.id, t("note.conflict", {}));
						return;
					}
					note(record.id, t("note.installFailed", { reason: messageOf(reason) }));
					return;
				}
				props.reportInstall?.(record.id).catch(() => {});
				refresh();
				await declareNow(record, false, force ? "note.updated" : "note.enabled");
			});
			const update = (record, row) => run(record.id, "update", async () => {
				if (props.install === void 0) return;
				const wasEnabled = row.enabled;
				if (wasEnabled) {
					const off = await postJson("/api/preset-center/disable", { id: record.id });
					if (off.data.ok !== true) {
						note(record.id, t("note.actionFailed", { reason: off.data.message ?? off.data.error ?? "HTTP " + off.status }));
						return;
					}
				}
				try {
					await props.install(record.id, true);
				} catch (reason) {
					note(record.id, t("note.installFailed", { reason: messageOf(reason) }));
					refresh();
					return;
				}
				props.reportInstall?.(record.id).catch(() => {});
				if (wasEnabled) {
					await declareNow(record, true, "note.updated");
					return;
				}
				note(record.id, t("note.updated", {}));
				refresh();
			});
			const enable = (record, confirm) => run(record.id, "enable", async () => {
				await declareNow(record, confirm, "note.enabled");
			});
			const disable = (record) => run(record.id, "disable", async () => {
				const res = await postJson("/api/preset-center/disable", { id: record.id });
				if (res.data.ok === true) {
					note(record.id, t("note.disabled", {}));
					refresh();
					return;
				}
				if (res.data.error === "default-preset") {
					note(record.id, t("note.defaultPreset", {}));
					return;
				}
				note(record.id, t("note.actionFailed", { reason: res.data.message ?? res.data.error ?? "HTTP " + res.status }));
			});
			const uninstall = (record) => run(record.id, "uninstall", async () => {
				const res = await postJson("/api/preset-center/uninstall", { id: record.id });
				setConfirmUninstall(null);
				if (res.data.ok === true) {
					note(record.id, t("note.uninstalled", {}));
					refresh();
					return;
				}
				if (res.data.error === "default-preset") {
					note(record.id, t("note.defaultPreset", {}));
					return;
				}
				note(record.id, t("note.actionFailed", { reason: res.data.message ?? res.data.error ?? "HTTP " + res.status }));
			});
			const view = (record) => run(record.id, "view", async () => {
				const raw = await fetchJson("/api/preset-center/composition?id=" + encodeURIComponent(record.id));
				setViewer({
					id: record.id,
					text: raw.text ?? "",
					truncated: raw.truncated === true
				});
			});
			function displayName(record) {
				return record.name ?? record.nameEn ?? record.id;
			}
			const matches = (record) => {
				if (query === "") return true;
				const q = query.toLowerCase();
				return [
					record.name,
					record.nameEn,
					record.author,
					record.description,
					record.descriptionEn,
					...record.tags ?? []
				].filter(Boolean).join(" ").toLowerCase().includes(q);
			};
			const visible = rows.filter(matches).slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || displayName(a).localeCompare(displayName(b)));
			const codeBadgeKey = (profile) => profile.codeExecution === "local" ? "code.local" : profile.codeExecution === "inline" ? "code.inline" : "code.none";
			const statusOf = (record, row) => {
				if (occupied.has(record.id)) return {
					key: "state.shadowed",
					tone: preset_center_module_css_default.badgeWarn
				};
				if (row === void 0) return {
					key: "state.notInstalled",
					tone: preset_center_module_css_default.badgeMuted
				};
				if (!row.managed) return {
					key: "state.local",
					tone: preset_center_module_css_default.badgeWarn
				};
				if (row.integrity === "modified") return {
					key: "state.modified",
					tone: preset_center_module_css_default.badgeWarn
				};
				if (row.enabled) return {
					key: "state.enabled",
					tone: preset_center_module_css_default.badgeOn
				};
				return {
					key: "state.installed",
					tone: preset_center_module_css_default.badgeOff
				};
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: preset_center_module_css_default.panel,
				"data-dsh-plugin": "preset-center",
				"data-dsh-part": "preset-panel",
				children: [
					props.gateway !== true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: preset_center_module_css_default.note,
						children: t("note.remoteInstall", {})
					}) : null,
					state === null && loadError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: preset_center_module_css_default.note,
						role: "status",
						children: [gateway ? t("note.loadFailed", { reason: loadError }) : t("note.gatewayUnavailable", {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							className: preset_center_module_css_default.inlineButton,
							onClick: refresh,
							children: t("action.refresh")
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: preset_center_module_css_default.search,
						type: "search",
						"aria-label": t("search.placeholder"),
						placeholder: t("search.placeholder"),
						value: query,
						onChange: (event) => {
							setQuery(event.target.value);
						}
					}),
					props.catalogState === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: preset_center_module_css_default.empty,
						role: "status",
						children: t("installing", {})
					}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: preset_center_module_css_default.empty,
						role: "status",
						children: rows.length === 0 ? t("note.emptyCatalog", {}) : t("note.noMatch", {})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: preset_center_module_css_default.list,
						children: visible.map((record) => {
							const row = stateById.get(record.id);
							const status = statusOf(record, row);
							const profile = row?.profile ?? EMPTY_PROFILE;
							const updateAvailable = hasUpdate(record, row);
							const busyHere = busy === record.id;
							const blockedByLocal = row !== void 0 && !row.managed && row.installed;
							const installable = gateway && props.install !== void 0 && !occupied.has(record.id) && !blockedByLocal;
							const installs = props.installs?.[record.id] ?? 0;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: preset_center_module_css_default.card,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: preset_center_module_css_default.cardHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: preset_center_module_css_default.cardName,
											title: displayName(record),
											children: [record.repo ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
												href: record.repo,
												target: "_blank",
												rel: "noreferrer",
												children: displayName(record)
											}) : displayName(record), record.version ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: preset_center_module_css_default.version,
												children: ["v", record.version]
											}) : null]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: preset_center_module_css_default.cardMeta,
											children: [
												record.author ?? "",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: status.tone,
													children: t(status.key, {})
												}),
												updateAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: preset_center_module_css_default.badgeWarn,
													children: t("state.newVersion", { version: record.version ?? "" })
												}) : null,
												row?.enabled && row.integrity === "valid" ? null : null,
												installs > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: preset_center_module_css_default.badgeMuted,
													children: t("count.installs", { count: String(installs) })
												}) : null
											]
										})]
									}),
									record.description || record.descriptionEn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: preset_center_module_css_default.cardDesc,
										children: (record.description ?? record.descriptionEn ?? "").slice(0, 200)
									}) : null,
									row !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: preset_center_module_css_default.profile,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: preset_center_module_css_default.badgeCode,
											children: t(codeBadgeKey(profile), {})
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: preset_center_module_css_default.profileText,
											children: t("code.detail", {
												files: String(profile.codeFiles.length),
												expressions: String(profile.inlineExpressions),
												plugins: String(profile.plugins.length)
											})
										})]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: preset_center_module_css_default.actions,
										children: [
											row === void 0 || !row.managed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.primary,
												disabled: !installable || busyNow,
												onClick: () => {
													install(record, false);
												},
												children: busyHere ? t("installing", {}) : t("action.install", {})
											}) : null,
											row !== void 0 && row.managed && !row.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.primary,
												disabled: !gateway || busyNow || occupied.has(record.id),
												onClick: () => {
													enable(record, false);
												},
												children: busyHere ? t("installing", {}) : t("action.enable", {})
											}) : null,
											row !== void 0 && row.managed && row.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.secondary,
												disabled: !gateway || busyNow,
												onClick: () => {
													disable(record);
												},
												children: t("action.disable", {})
											}) : null,
											row !== void 0 && row.managed && (updateAvailable || row.integrity === "modified") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.secondary,
												disabled: !installable || busyNow,
												onClick: () => {
													update(record, row);
												},
												children: t("action.update", {})
											}) : null,
											row !== void 0 && row.integrity !== "none" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.secondary,
												disabled: busyNow,
												onClick: () => {
													view(record);
												},
												children: t("action.view", {})
											}) : null,
											row !== void 0 && row.managed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												className: preset_center_module_css_default.danger,
												disabled: busyNow,
												onClick: () => {
													setConfirmUninstall({
														id: record.id,
														name: displayName(record)
													});
												},
												children: t("action.uninstall", {})
											}) : null
										]
									}),
									notes[record.id] ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: preset_center_module_css_default.note,
										role: "status",
										children: notes[record.id]
									}) : null
								]
							}, record.id);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						title: viewer ? t("viewer.title", { name: viewer.id }) : "",
						open: viewer !== null,
						onClose: () => {
							setViewer(null);
						},
						closeLabel: t("action.cancel", {}),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: preset_center_module_css_default.viewer,
							children: viewer?.text === "" ? t("viewer.empty", {}) : viewer?.text
						}), viewer?.truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: preset_center_module_css_default.note,
							children: t("viewer.empty", {})
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						title: t("confirm.title", {}),
						open: confirmInstall !== null,
						onClose: () => {
							setConfirmInstall(null);
						},
						closeLabel: t("action.cancel", {}),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("confirm.text", {
							name: confirmInstall?.name ?? "",
							detail: t("code.detail", {
								files: String(confirmInstall?.profile.codeFiles.length ?? 0),
								expressions: String(confirmInstall?.profile.inlineExpressions ?? 0),
								plugins: String(confirmInstall?.profile.plugins.length ?? 0)
							})
						}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: preset_center_module_css_default.modalActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: preset_center_module_css_default.primary,
								onClick: () => {
									const target = confirmInstall;
									setConfirmInstall(null);
									const record = rows.find((entry) => entry.id === target?.id);
									if (record !== void 0) enable(record, true);
								},
								children: t("action.enable", {})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: preset_center_module_css_default.secondary,
								onClick: () => {
									setConfirmInstall(null);
								},
								children: t("action.cancel", {})
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						title: t("uninstall.title", {}),
						open: confirmUninstall !== null,
						onClose: () => {
							setConfirmUninstall(null);
						},
						closeLabel: t("action.cancel", {}),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("uninstall.text", { name: confirmUninstall?.name ?? "" }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: preset_center_module_css_default.modalActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: preset_center_module_css_default.danger,
								onClick: () => {
									const target = confirmUninstall;
									const record = rows.find((entry) => entry.id === target?.id);
									if (record !== void 0) uninstall(record);
									else setConfirmUninstall(null);
								},
								children: t("action.uninstall", {})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: preset_center_module_css_default.secondary,
								onClick: () => {
									setConfirmUninstall(null);
								},
								children: t("action.cancel", {})
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Preset-center copy (zh is the key source; en mirrors it key for key).
		* @module @linxin666/dsh-client-ui-preset-center/client/locales
		*/
		/** Locale namespace owned by this plugin (single home; the entry and the panel import it). */
		const NS = "dsh-web-ui-preset-center";
		const zh = {
			"state.notInstalled": "未安装",
			"state.installed": "已安装 · 未启用",
			"state.enabled": "已启用",
			"state.modified": "本地已修改",
			"state.conflict": "目录状态异常",
			"state.local": "本地自建同名预设",
			"state.shadowed": "id 已被其它插件声明的预设占用",
			"state.newVersion": "有新版本 {version}",
			"state.broken": "无法加载",
			"action.install": "安装",
			"action.update": "更新",
			"action.enable": "启用",
			"action.disable": "停用",
			"action.uninstall": "卸载",
			"action.view": "查看组合",
			"action.cancel": "取消",
			"action.refresh": "刷新",
			"code.local": "含本地代码",
			"code.inline": "含内联表达式",
			"code.none": "仅组合已安装插件",
			"code.detail": "{files} 个代码文件 · {expressions} 个 !!js 表达式 · {plugins} 个插件",
			"confirm.title": "安装可执行预设",
			"confirm.text": "「{name}」安装后会在 DSH 主进程内加载其组合内容，权限等同 shell 访问。{detail} 确认继续？",
			"uninstall.title": "卸载预设",
			"uninstall.text": "将注销「{name}」并删除其本地文件（$DSH_HOME/agent-presets 中的副本）。已使用该预设的会话不受影响。",
			"viewer.title": "{name} · agent.cordis.yml",
			"viewer.empty": "（组合文件为空或不可读）",
			"note.installFailed": "安装失败：{reason}",
			"note.conflict": "本地已存在同名目录，未覆盖任何文件",
			"note.actionFailed": "操作失败：{reason}",
			"note.enabled": "已安装并启用；刷新页面后在「设置 → Agent 预设」中可见",
			"note.disabled": "已停用；文件仍保留在预设库中，可随时重新启用",
			"note.uninstalled": "已卸载",
			"note.updated": "已更新到最新版本",
			"note.broken": "无法加载：{reason}",
			"note.shadowed": "该 id 已被另一插件声明的预设占用，无法声明",
			"note.defaultPreset": "这是当前默认预设，请先在「设置 → Agent 预设」切换默认值",
			"note.rosterUnavailable": "宿主未提供 agent-preset 注册表服务，无法声明预设",
			"note.gatewayUnavailable": "本机网关不可用：远程浏览器或 host 路由未挂载，无法安装或启用",
			"note.loadFailed": "读取预设状态失败：{reason}",
			"note.emptyCatalog": "社区预设目录为空",
			"note.noMatch": "没有匹配的预设",
			"note.remoteInstall": "请在运行 DSH 的本机浏览器中操作",
			"search.placeholder": "搜索预设",
			"count.installs": "安装 {count}",
			"installing": "处理中…"
		};
		const en = {
			"state.notInstalled": "Not installed",
			"state.installed": "Installed - disabled",
			"state.enabled": "Enabled",
			"state.modified": "Modified locally",
			"state.conflict": "Directory state conflict",
			"state.local": "Local preset with this id",
			"state.shadowed": "Id taken by a preset another plugin declares",
			"state.newVersion": "Update {version} available",
			"state.broken": "Cannot load",
			"action.install": "Install",
			"action.update": "Update",
			"action.enable": "Enable",
			"action.disable": "Disable",
			"action.uninstall": "Uninstall",
			"action.view": "View composition",
			"action.cancel": "Cancel",
			"action.refresh": "Refresh",
			"code.local": "Ships local code",
			"code.inline": "Has inline expressions",
			"code.none": "Composes installed plugins only",
			"code.detail": "{files} code files - {expressions} !!js expressions - {plugins} plugins",
			"confirm.title": "Install an executable preset",
			"confirm.text": "Installing \"{name}\" loads its composition inside the DSH host process, which carries the same trust as shell access. {detail} Continue?",
			"uninstall.title": "Uninstall preset",
			"uninstall.text": "Unregisters \"{name}\" and deletes its local files (the copy under $DSH_HOME/agent-presets). Sessions already using it keep running.",
			"viewer.title": "{name} - agent.cordis.yml",
			"viewer.empty": "(composition file is empty or unreadable)",
			"note.installFailed": "Install failed: {reason}",
			"note.conflict": "A directory with this id already exists locally; nothing was overwritten",
			"note.actionFailed": "Action failed: {reason}",
			"note.enabled": "Installed and enabled; refresh the page to see it under Settings - Agent presets",
			"note.disabled": "Disabled; the files stay in the preset library and can be enabled again",
			"note.uninstalled": "Uninstalled",
			"note.updated": "Updated to the newest version",
			"note.broken": "Cannot load: {reason}",
			"note.shadowed": "A preset another plugin declares already owns this id, so it cannot be declared",
			"note.defaultPreset": "This is the current default preset; change the default under Settings - Agent presets first",
			"note.rosterUnavailable": "The host exposes no agent-preset registry service, so presets cannot be declared",
			"note.gatewayUnavailable": "Local gateway unavailable: remote browser or host routes not mounted; install and enable are disabled",
			"note.loadFailed": "Reading preset state failed: {reason}",
			"note.emptyCatalog": "The community preset catalog is empty",
			"note.noMatch": "No matching preset",
			"note.remoteInstall": "Run this in a browser on the machine hosting DSH",
			"search.placeholder": "Search presets",
			"count.installs": "{count} installs",
			"installing": "Working..."
		};
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		/** Register the dictionaries and the Presets panel cell. */
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "dsh-preset-center: dictionaries");
			ctx.slots.inject("dsh-workshop.panel", () => {
				try {
					const unregister = ctx.slots.register({
						name: "dsh-workshop.panel",
						key: "preset",
						locale: NS
					}, PresetPanel);
					return () => {
						unregister();
					};
				} catch {
					return () => {};
				}
			});
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map