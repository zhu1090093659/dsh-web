window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-market",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/turnstile.ts
		/** Turnstile token relay hosted on the market origin. */
		const MARKET_ORIGIN$1 = "https://dsh-market.com";
		const CHALLENGE_URL = "https://dsh-market.com/api/turnstile/challenge";
		const TIMEOUT_MS = 1e4;
		let ready = null;
		let chain = Promise.resolve();
		/** Create a UUID v4 even when randomUUID is unavailable on an HTTP LAN origin. */
		function turnstileRequestId(source = crypto) {
			if (typeof source.randomUUID === "function") return source.randomUUID();
			const bytes = source.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
			bytes[6] = bytes[6] & 15 | 64;
			bytes[8] = bytes[8] & 63 | 128;
			const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		function challengeFrame() {
			if (ready !== null) return ready;
			ready = new Promise((resolve, reject) => {
				const iframe = document.createElement("iframe");
				iframe.src = CHALLENGE_URL;
				iframe.hidden = true;
				iframe.title = "Market verification";
				iframe.setAttribute("aria-hidden", "true");
				iframe.onload = () => {
					resolve(iframe);
				};
				iframe.onerror = () => {
					iframe.remove();
					ready = null;
					reject(/* @__PURE__ */ new Error("turnstile-frame-failed"));
				};
				document.body.append(iframe);
			});
			return ready;
		}
		async function requestOne(action) {
			const iframe = await challengeFrame();
			const id = turnstileRequestId();
			return new Promise((resolve, reject) => {
				const timer = window.setTimeout(() => finish(/* @__PURE__ */ new Error("turnstile-timeout")), TIMEOUT_MS);
				const onMessage = (event) => {
					const data = event.data;
					if (event.origin !== MARKET_ORIGIN$1 || event.source !== iframe.contentWindow) return;
					if (data?.source !== "dsh-market-card" || data.type !== "token" || data.id !== id) return;
					finish(null, typeof data.token === "string" ? data.token : "");
				};
				const finish = (error, token = "") => {
					window.clearTimeout(timer);
					window.removeEventListener("message", onMessage);
					if (error !== null) {
						iframe.remove();
						ready = null;
						reject(error);
					} else resolve(token);
				};
				window.addEventListener("message", onMessage);
				iframe.contentWindow?.postMessage({
					source: "dsh-market-card",
					type: "request",
					id,
					action
				}, MARKET_ORIGIN$1);
			});
		}
		/** Turnstile action for Workshop likes. */
		const TURNSTILE_ACTION_LIKE = "market-like";
		/** Serialize challenges because one invisible widget can execute only once at a time. */
		function marketTurnstileToken(action = TURNSTILE_ACTION_LIKE) {
			const request = chain.then(() => requestOne(action));
			chain = request.then(() => void 0, () => void 0);
			return request;
		}
		//#endregion
		//#region \0dsh-css:packages/dsh-market/src/client/settings-card.module.css.mjs
		const css$1 = ".RcIGlq_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.RcIGlq_card:hover{border-color:var(--dsw-alias-label-dimmed)}.RcIGlq_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.RcIGlq_header{appearance:none;box-sizing:border-box;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.RcIGlq_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.RcIGlq_headerStatic{box-sizing:border-box;border-radius:12px;align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}.RcIGlq_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.RcIGlq_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.RcIGlq_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.RcIGlq_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.RcIGlq_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.RcIGlq_chevronOpen{transform:rotate(180deg)}.RcIGlq_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.RcIGlq_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.RcIGlq_notExposed{color:var(--dsw-alias-state-warn-primary);margin:12px 0 0;font-size:12px;line-height:1.5}.RcIGlq_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.RcIGlq_failed{min-width:0;color:var(--dsw-alias-label-error);text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:12px;line-height:1.5;overflow:hidden}.RcIGlq_discard,.RcIGlq_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.RcIGlq_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.RcIGlq_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.RcIGlq_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.RcIGlq_discard:disabled,.RcIGlq_save:disabled{opacity:.4;cursor:default}.RcIGlq_discard:focus-visible,.RcIGlq_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.RcIGlq_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.RcIGlq_field+.RcIGlq_field{border-top:1px solid var(--dsw-alias-border-l2)}.RcIGlq_head{align-items:center;gap:8px;display:flex}.RcIGlq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.RcIGlq_badges{align-items:center;gap:8px;display:inline-flex}.RcIGlq_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.RcIGlq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.RcIGlq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.RcIGlq_reset:disabled{cursor:default}.RcIGlq_reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.RcIGlq_input,.RcIGlq_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.RcIGlq_input:focus-visible,.RcIGlq_select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.RcIGlq_input:disabled,.RcIGlq_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.RcIGlq_inputInvalid{border:1px solid var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.RcIGlq_inputInvalid:focus-visible{outline:2px solid var(--dsw-alias-label-error);outline-offset:1px;border-color:var(--dsw-alias-label-error)}.RcIGlq_selectWrap{position:relative}.RcIGlq_selectButton{appearance:none;text-align:left;cursor:pointer;justify-content:space-between;align-items:center;gap:8px;width:100%;display:flex}.RcIGlq_selectLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.RcIGlq_selectChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.RcIGlq_selectChevronOpen{transform:rotate(180deg)}.RcIGlq_selectPopup{z-index:40;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);max-height:240px;box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2);opacity:0;border-radius:8px;flex-direction:column;padding:4px;transition:opacity .1s,transform .1s;display:flex;position:absolute;top:calc(100% + 4px);left:0;right:0;overflow-y:auto;transform:translateY(-4px)}.RcIGlq_selectPopupOpen{opacity:1;transform:none}.RcIGlq_selectPopupClose{opacity:0;pointer-events:none;transform:translateY(-4px)}.RcIGlq_selectOption{color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;text-overflow:ellipsis;border-radius:6px;flex-shrink:0;padding:6px 10px;font-size:13px;line-height:1.5;overflow:hidden}.RcIGlq_selectOption:hover,.RcIGlq_selectOptionActive{background:var(--dsw-alias-interactive-bg-hover)}.RcIGlq_selectOptionSelected{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 10%, transparent);font-weight:500}.RcIGlq_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.RcIGlq_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}@media (prefers-reduced-motion:reduce){.RcIGlq_card,.RcIGlq_header,.RcIGlq_chevron,.RcIGlq_chevronOpen,.RcIGlq_discard,.RcIGlq_save,.RcIGlq_selectChevron,.RcIGlq_selectChevronOpen,.RcIGlq_selectPopup{transition:none}}";
		const tagId$1 = "@linxin666/dsh-client-ui-market/settings-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-market";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var settings_card_module_css_default = {
			"badge": "RcIGlq_badge",
			"badges": "RcIGlq_badges",
			"body": "RcIGlq_body",
			"card": "RcIGlq_card",
			"cardOpen": "RcIGlq_cardOpen",
			"chevron": "RcIGlq_chevron",
			"chevronOpen": "RcIGlq_chevronOpen",
			"description": "RcIGlq_description",
			"discard": "RcIGlq_discard",
			"failed": "RcIGlq_failed",
			"field": "RcIGlq_field",
			"footer": "RcIGlq_footer",
			"head": "RcIGlq_head",
			"headText": "RcIGlq_headText",
			"header": "RcIGlq_header",
			"headerStatic": "RcIGlq_headerStatic",
			"hint": "RcIGlq_hint",
			"input": "RcIGlq_input",
			"inputInvalid": "RcIGlq_inputInvalid",
			"invalid": "RcIGlq_invalid",
			"label": "RcIGlq_label",
			"name": "RcIGlq_name",
			"notExposed": "RcIGlq_notExposed",
			"pending": "RcIGlq_pending",
			"readOnly": "RcIGlq_readOnly",
			"reset": "RcIGlq_reset",
			"save": "RcIGlq_save",
			"select": "RcIGlq_select",
			"selectButton": "RcIGlq_selectButton",
			"selectChevron": "RcIGlq_selectChevron",
			"selectChevronOpen": "RcIGlq_selectChevronOpen",
			"selectLabel": "RcIGlq_selectLabel",
			"selectOption": "RcIGlq_selectOption",
			"selectOptionActive": "RcIGlq_selectOptionActive",
			"selectOptionSelected": "RcIGlq_selectOptionSelected",
			"selectPopup": "RcIGlq_selectPopup",
			"selectPopupClose": "RcIGlq_selectPopupClose",
			"selectPopupOpen": "RcIGlq_selectPopupOpen",
			"selectWrap": "RcIGlq_selectWrap"
		};
		//#endregion
		//#region src/client/PluginSettingsCard.tsx
		/**
		* Family-shared chrome for plugin settings cards: a disclosure header naming
		* the plugin and what its settings govern, the controls inside, and the save
		* that writes them. Renders nothing while the namespace is unavailable — a
		* deployment that does not compose the owning plugin should show no trace of
		* it. Inlined into each consumer's client bundle; mirrors the official
		* ui-plugin-config PluginCard in a self-contained slice.
		*/
		/**
		* Render one plugin settings card.
		* @param props - the plugin's copy keys, its form state, and its controls.
		* @returns the card, or nothing while the namespace is still loading.
		*/
		function PluginSettingsCard(props) {
			const [open, setOpen] = (0, react.useState)(props.defaultOpen ?? true);
			const { state, alwaysOpen } = props;
			if (!state.available) return null;
			const title = props.t(props.titleKey);
			const description = props.t(props.descriptionKey);
			const blocked = !state.dirty || state.invalid || state.saving;
			const expanded = alwaysOpen === true || open;
			const cardClass = expanded ? `${settings_card_module_css_default.cardOpen} ${settings_card_module_css_default.card}` : settings_card_module_css_default.card;
			const header = alwaysOpen === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.headerStatic,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: settings_card_module_css_default.headText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.name,
						title,
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.description,
						title: description,
						children: props.descriptionNode ?? description
					})]
				}), state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.pending,
					title: props.t("settings.unsaved"),
					children: props.t("settings.unsaved")
				}) : null]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: settings_card_module_css_default.header,
				"aria-expanded": open,
				"aria-label": `${props.t(open ? "settings.collapse" : "settings.expand")}: ${title}`,
				onClick: () => {
					setOpen(!open);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: settings_card_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.name,
							title,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.description,
							title: description,
							children: props.descriptionNode ?? description
						})]
					}),
					state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.pending,
						title: props.t("settings.unsaved"),
						children: props.t("settings.unsaved")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						fill: "none",
						xmlns: "http://www.w3.org/2000/svg",
						className: open ? `${settings_card_module_css_default.chevron} ${settings_card_module_css_default.chevronOpen}` : settings_card_module_css_default.chevron,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
							fill: "currentColor"
						})
					})
				]
			});
			if (!state.exposed) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: settings_card_module_css_default.body,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.notExposed,
						role: "status",
						children: props.t("settings.notExposed")
					})
				}) : null]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: settings_card_module_css_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: settings_card_module_css_default.readOnly,
							role: "status",
							children: props.t("settings.readOnly")
						}) : null,
						props.children,
						props.hideFooter === true ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_card_module_css_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: settings_card_module_css_default.failed,
									role: "status",
									children: [props.t("settings.saveFailed"), state.failedReason ? " - " + state.failedReason : ""]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.discard,
									disabled: !state.dirty || state.saving,
									onClick: props.onDiscard,
									children: props.t("settings.discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.save,
									disabled: blocked,
									onClick: props.onSave,
									children: props.t(!state.saving ? "settings.save" : "settings.saving")
								})
							]
						})
					]
				}) : null]
			});
		}
		const NON_SKIN_BODY_MARKERS = /* @__PURE__ */ new Set(["dshSkinCenter", "dshSidebarCollapsed"]);
		function isSkinActive() {
			return Object.keys(document.body.dataset).some((key) => key.startsWith("dsh") && !NON_SKIN_BODY_MARKERS.has(key));
		}
		const SELECT_CLOSE_MS = 100;
		/**
		* The shared dual-mode select control. While an appearance skin is active it
		* renders the legacy native `<select>` untouched, so element-level skin
		* selectors keep working; under the default appearance it renders a
		* self-drawn `role="listbox"` popup whose open/close is transition-animated.
		* Staged cards reach it through BooleanField/ChoiceField; immediate-apply
		* editors (the side-card prefs) bind it directly through onEdit.
		* 双模式下拉框：皮肤激活时用原生 select，默认外观用自绘动画弹层。
		*/
		function SelectField(props) {
			const { id, options, value } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const [closing, setClosing] = (0, react.useState)(false);
			const [phase, setPhase] = (0, react.useState)("initial");
			const [activeIndex, setActiveIndex] = (0, react.useState)(0);
			const closeTimer = (0, react.useRef)(void 0);
			const wrapRef = (0, react.useRef)(null);
			const popupRef = (0, react.useRef)(null);
			const currentIndex = () => {
				const index = options.findIndex((option) => option.value === value);
				return index >= 0 ? index : 0;
			};
			const close = (0, react.useCallback)(() => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
				setClosing(true);
				closeTimer.current = setTimeout(() => {
					setClosing(false);
					setOpen(false);
				}, SELECT_CLOSE_MS);
			}, []);
			const openPopup = () => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
				setActiveIndex(currentIndex());
				setPhase("initial");
				setClosing(false);
				setOpen(true);
			};
			const commit = (index) => {
				const option = options[index];
				if (option) props.onEdit(option.value);
				close();
			};
			const onTriggerClick = () => {
				if (props.disabled) return;
				if (open && !closing) close();
				else openPopup();
			};
			const onKeyDown = (event) => {
				if (props.disabled) return;
				const count = options.length;
				switch (event.key) {
					case "ArrowDown":
					case "ArrowUp":
					case "Enter":
					case " ":
						event.preventDefault();
						if (!open) openPopup();
						else if (!closing) if (event.key === "ArrowDown") setActiveIndex((index) => (index + 1) % count);
						else if (event.key === "ArrowUp") setActiveIndex((index) => (index - 1 + count) % count);
						else commit(activeIndex);
						break;
					case "Escape":
						if (open) {
							event.preventDefault();
							event.stopPropagation();
							close();
						}
						break;
					case "Tab":
						if (open) close();
						break;
				}
			};
			(0, react.useEffect)(() => () => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
			}, []);
			(0, react.useLayoutEffect)(() => {
				if (open && !closing && phase === "initial") {
					popupRef.current?.offsetHeight;
					setPhase("open");
				}
			}, [
				open,
				closing,
				phase
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (target instanceof Node && !wrapRef.current?.contains(target)) close();
				};
				document.addEventListener("pointerdown", onPointerDown);
				return () => document.removeEventListener("pointerdown", onPointerDown);
			}, [open, close]);
			(0, react.useEffect)(() => {
				if (props.disabled && open) close();
			}, [
				props.disabled,
				open,
				close
			]);
			if (isSkinActive()) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				id,
				className: settings_card_module_css_default.select,
				value,
				disabled: props.disabled,
				onChange: (event) => {
					props.onEdit(event.target.value);
				},
				children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: option.value,
					children: option.label
				}, option.value))
			});
			const label = options.find((option) => option.value === value)?.label ?? "";
			const popupClass = closing ? `${settings_card_module_css_default.selectPopup} ${settings_card_module_css_default.selectPopupClose}` : phase === "open" ? `${settings_card_module_css_default.selectPopup} ${settings_card_module_css_default.selectPopupOpen}` : settings_card_module_css_default.selectPopup;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.selectWrap,
				ref: wrapRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					id,
					className: `${settings_card_module_css_default.select} ${settings_card_module_css_default.selectButton}`,
					disabled: props.disabled,
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					"aria-activedescendant": open ? `${id}-o${activeIndex}` : void 0,
					"aria-invalid": props.invalid || void 0,
					onClick: onTriggerClick,
					onKeyDown,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.selectLabel,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						fill: "none",
						xmlns: "http://www.w3.org/2000/svg",
						className: open ? `${settings_card_module_css_default.selectChevron} ${settings_card_module_css_default.selectChevronOpen}` : settings_card_module_css_default.selectChevron,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
							fill: "currentColor"
						})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: popupClass,
					role: "listbox",
					ref: popupRef,
					children: options.map((option, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						id: `${id}-o${index}`,
						role: "option",
						"aria-selected": option.value === value,
						className: `${settings_card_module_css_default.selectOption}${option.value === value ? ` ${settings_card_module_css_default.selectOptionSelected}` : ""}${index === activeIndex && !closing ? ` ${settings_card_module_css_default.selectOptionActive}` : ""}`,
						onClick: () => {
							commit(index);
						},
						children: option.label
					}, option.value))
				}) : null]
			});
		}
		/** A staged boolean field: 继承 / 开 / 关. */
		function BooleanField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: settings_card_module_css_default.label,
							htmlFor: props.id,
							children: props.label
						}), props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: settings_card_module_css_default.badges,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.badge,
								children: props.overriddenLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: settings_card_module_css_default.reset,
								disabled: props.disabled,
								onClick: props.onReset,
								children: props.resetLabel
							})]
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
						id: props.id,
						options: [
							{
								value: "",
								label: props.inheritLabel
							},
							{
								value: "true",
								label: props.onLabel
							},
							{
								value: "false",
								label: props.offLabel
							}
						],
						value: props.text,
						disabled: props.disabled,
						invalid: props.invalid,
						onEdit: props.onEdit
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.hint,
						children: props.hint
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-store-engine
		const platform = ["@deepseek-ai/dsh-client", "-store"].join("");
		const legacy = ["@deepseek-ai/dsh-client-runtime", "/client"].join("");
		let engine;
		try {
			engine = require(platform);
		} catch {
			engine = require(legacy);
		}
		const createSnapshotStore = engine.createSnapshotStore;
		engine.defineStore;
		engine.shallowEqual;
		//#endregion
		//#region src/client/settings-form.ts
		/** A boolean field, edited through true/false draft text. */
		function booleanField(field) {
			return {
				field,
				format: (value) => typeof value === "boolean" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true") return {
						kind: "set",
						value: true
					};
					if (trimmed === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/**
		* Stages one card's edits over one settings namespace and writes them on save.
		*
		* The Host is the only authority on whether a value was accepted — its
		* validators own the constraints no schema can express — so the outcome is
		* read back from the section rather than predicted here. A save that did not
		* land keeps its drafts, so the user can correct them instead of retyping.
		*/
		var CardForm = class {
			scope;
			specs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			/** The scope subscription installed in the constructor; released by dispose(). */
			disposeScope;
			disposed = false;
			saving = false;
			failed = false;
			failedReason;
			/** @param scope - the bound settings scope for this card's namespace. */
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.disposeScope = scope.subscribe(() => {
					this.publish();
				});
			}
			/**
			* Release the scope subscription and every bound store listener. The card
			* must call this on teardown; later calls are no-ops.
			*/
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.disposeScope();
				this.listeners.clear();
			}
			/** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
			bind(project) {
				const store = createSnapshotStore(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Read the card-level state: what the Host serves, and what a save would do. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status !== "loading",
					exposed: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.judge === void 0),
					saving: this.saving,
					failed: this.failed,
					...this.failedReason === void 0 ? {} : { failedReason: this.failedReason }
				};
			}
			/** Read one field's state from the effective section and its staged draft. */
			field(field) {
				const spec = this.specOf(field);
				const staged = this.staged.get(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			/** The actions the card's slot registration injects. */
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, {
							text,
							clear: false
						});
					},
					resetField: (field) => {
						this.stage(field, {
							text: this.specOf(field).format(this.baseValue(field)),
							clear: true
						});
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.failedReason = void 0;
						this.publish();
					}
				};
			}
			/**
			* Write every staged edit in one atomic scope mutation, then re-seed from
			* what the Host accepted.
			*
			* The whole batch rides one mutate, so cross-field validate hooks
			* (baseURL+model) judge it as a unit: the Host either applies every write
			* or refuses the batch. The 0.1.2 scope contract never rejects a refused
			* mutation — the scope recovers with a fresh Host view and resolves — so
			* resolution alone proves nothing: the outcome is judged by reading the
			* settled snapshot back, one planned write at a time, and one missed write
			* fails the whole save. A scope that still rejects on refusal (the dsh-web
			* bridge scope) reports through the same failure path with its rejection
			* message. A save that did not land keeps its drafts, so the user can
			* correct them instead of retyping.
			* @returns settlement after the mutation and the read-back.
			*/
			async save() {
				const plan = this.plan();
				const valid = plan.filter((item) => item.judge !== void 0);
				if (plan.length === 0 || this.saving || valid.length !== plan.length) return;
				const pending = /* @__PURE__ */ new Map();
				for (const item of plan) pending.set(item.field, this.staged.get(item.field));
				this.saving = true;
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
				const ops = valid.map((item) => item.op.op === "set" ? {
					op: "set",
					path: [item.field],
					value: item.op.value
				} : {
					op: "unset",
					path: [item.field]
				});
				let failedReason;
				try {
					await this.scope.mutate(ops);
				} catch (error) {
					failedReason = error instanceof Error ? error.message : String(error);
				}
				const landed = failedReason === void 0 && valid.every((item) => item.judge());
				for (const [field, before] of pending) if (landed && this.staged.get(field) === before) this.staged.delete(field);
				this.saving = false;
				this.failed = !landed;
				this.failedReason = failedReason;
				this.publish();
			}
			/**
			* Every staged edit a save would write. An entry whose draft is not a value
			* its field accepts carries no write: the form is still dirty, and the save
			* refuses rather than dropping the edit. A staged edit that matches the
			* effective section is not a write at all.
			* @returns the planned writes, in the order the fields were staged.
			*/
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.specOf(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({
							field,
							op: {
								field,
								op: "unset"
							},
							judge: () => this.landedUnset(field)
						});
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({
						field,
						op: {
							field,
							op: "unset"
						},
						judge: void 0
					});
					else if (write.kind === "clear") plan.push({
						field,
						op: {
							field,
							op: "unset"
						},
						judge: () => this.landedUnset(field)
					});
					else plan.push({
						field,
						op: {
							field,
							op: "set",
							value: write.value
						},
						judge: () => this.landedSet(field, write.value)
					});
				}
				return plan;
			}
			/**
			* Read-back judgment for a planned set: the user layer must hold the
			* intended value once the mutation has settled.
			*/
			landedSet(field, value) {
				if (this.specOf(field).secret) return true;
				return this.userLayer()?.[field] === value;
			}
			/**
			* Read-back judgment for a planned unset: the field must be gone from the
			* user layer once the mutation has settled.
			*/
			landedUnset(field) {
				return !this.stored(field);
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`settings card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseValue(field) {
				return this.snapshotOf().base?.[field];
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/plugin-manager-bridge.ts
		let snapshot = {
			face: null,
			version: 0
		};
		const listeners = /* @__PURE__ */ new Set();
		/** Replace the held face and notify subscribers. */
		function setFace(face) {
			snapshot = {
				face,
				version: snapshot.version + 1
			};
			for (const listener of listeners) listener();
		}
		/** Current bridge snapshot (cached reference, safe for useSyncExternalStore). */
		function getPluginManagerSnapshot() {
			return snapshot;
		}
		/** Subscribe to face changes; returns the unsubscribe function. */
		function subscribePluginManager(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/**
		* Bridge the optional 'pluginManager' service into the module store. Uses
		* ctx.inject (NOT the plugin's module-level inject array) so the service
		* stays optional: the inner callback runs when the sibling plugin provides
		* the face and is disposed when it goes away, which clears the store.
		* @param ctx - the client root context.
		*/
		function bridgePluginManager(ctx) {
			ctx.inject(["pluginManager"], (inner) => {
				inner.effect(() => {
					setFace(inner.pluginManager ?? null);
					return () => {
						setFace(null);
					};
				}, "dsh-web-ui-market: pluginManager bridge");
			});
		}
		//#endregion
		//#region src/client/install-source.ts
		/**
		* npm package name (optionally scoped, lowercase) as the store manifest
		* uses it, plus the optional concrete version/tag suffix npm accepts
		* (e.g. pkg@1.2.3, @scope/pkg@next). Range operators are not part of the
		* store convention, so `^1.0.0`-style specs stay rejected.
		*/
		const NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9A-Za-z][0-9A-Za-z._-]*)?$/;
		/** The command to install a plugin entry (npm package when published, else its repository URL). */
		function installCommand(entry) {
			return `dsh plugin --profile web add ${entry.npm ?? entry.repo ?? entry.id}`;
		}
		/** The spec handed to the pluginManager service. */
		function installSpec(entry) {
			return entry.npm ?? entry.repo ?? entry.id;
		}
		/**
		* Whether an install spec may be handed to the plugin manager. Acceptable
		* shapes are an npm package name (optionally pkg@version) or a plain
		* https:// git URL; ssh://, git@-style, file://, http://, relative paths and
		* bare repo names are rejected, so the remote manifest can never drive a
		* non-https or local install.
		*/
		function isInstallSpecValid(spec) {
			if (spec.startsWith("https://")) return isHttpsGitUrl(spec);
			return NPM_SPEC.test(spec);
		}
		/** Whether a spec is a well-formed https:// URL with a host. */
		function isHttpsGitUrl(spec) {
			if (!/^https:\/\/[A-Za-z0-9]/.test(spec)) return false;
			if (/[\s\u0000-\u001F\u007F]/.test(spec)) return false;
			try {
				const url = new URL(spec);
				return url.protocol === "https:" && url.hostname !== "";
			} catch {
				return false;
			}
		}
		/** Strips an npm scope prefix (e.g. '@scope/pkg' -> 'pkg'). */
		function unscoped(name) {
			return name.replace(/^@[^/]+\//, "");
		}
		/** Strips version/tag suffix from an npm spec (e.g. 'pkg@1.2.3' -> 'pkg', '@scope/pkg@1.2.3' -> '@scope/pkg'). */
		function stripVersion(spec) {
			const atIdx = spec.lastIndexOf("@");
			return atIdx > 0 ? spec.slice(0, atIdx) : spec;
		}
		/** Normalizes a git URL or spec to a canonical owner/repo path. */
		function normalizeRepo(spec) {
			let s = spec.trim().toLowerCase();
			const hashIdx = s.indexOf("#");
			if (hashIdx !== -1) s = s.slice(0, hashIdx);
			s = s.replace(/^(?:git\+)?https?:\/\/(?:www\.)?github\.com\//, "").replace(/^github:/, "").replace(/^git@github\.com:/, "").replace(/\.git$/, "").replace(/\/+$/, "");
			return s;
		}
		/** Whether an installed plugin row corresponds to a market plugin entry. */
		function isRowMatch(entry, item) {
			if (item.id === entry.id || item.name === entry.id) return true;
			if (entry.npm) {
				const entryNpmBase = stripVersion(entry.npm);
				if (item.id === entry.npm || item.id === entryNpmBase) return true;
				if (item.name === entry.npm || item.name === entryNpmBase) return true;
				if (stripVersion(item.source.spec) === entryNpmBase) return true;
			}
			const itemUnscoped = unscoped(item.id);
			const nameUnscoped = unscoped(item.name);
			if (itemUnscoped === entry.id || nameUnscoped === entry.id) return true;
			if (entry.npm) {
				const entryUnscoped = unscoped(stripVersion(entry.npm));
				if (itemUnscoped === entryUnscoped || nameUnscoped === entryUnscoped) return true;
				if (entryUnscoped === item.id || entryUnscoped === item.name) return true;
			}
			if (entry.repo) {
				const entryCanon = normalizeRepo(entry.repo);
				if (entryCanon) {
					if (normalizeRepo(item.id) === entryCanon) return true;
					if (normalizeRepo(item.name) === entryCanon) return true;
					if (normalizeRepo(item.source.spec) === entryCanon) return true;
				}
			}
			return false;
		}
		/** Find the installed row for an entry (null when not installed or no snapshot). */
		function entryInstalled(entry, installed) {
			return installed.find((item) => isRowMatch(entry, item)) ?? null;
		}
		//#endregion
		//#region src/client/filter.ts
		/** Present categories with counts (missing category counts as 'other'). */
		function categoryCounts(items) {
			const counts = /* @__PURE__ */ new Map();
			for (const it of items) {
				const id = it.category ?? "other";
				counts.set(id, (counts.get(id) ?? 0) + 1);
			}
			return [...counts.entries()].map(([id, count]) => ({
				id,
				count
			})).sort((a, b) => a.id.localeCompare(b.id));
		}
		/**
		* Present subcategory counts of one category. Canonical order (the
		* category's legal subcategory list) first, extras after, then alphabetical.
		*/
		function subcategoryCounts(items, cat, order = []) {
			const counts = /* @__PURE__ */ new Map();
			for (const it of items) {
				if (it.category !== cat || !it.subcategory) continue;
				counts.set(it.subcategory, (counts.get(it.subcategory) ?? 0) + 1);
			}
			return [...counts.entries()].map(([id, count]) => ({
				id,
				count
			})).sort((a, b) => {
				const ia = order.indexOf(a.id);
				const ib = order.indexOf(b.id);
				if (ia !== -1 && ib !== -1) return ia - ib;
				if (ia !== -1) return -1;
				if (ib !== -1) return 1;
				return a.id.localeCompare(b.id);
			});
		}
		//#endregion
		//#region src/client/categories.ts
		/** Canonical category → subcategory mapping (scripts/community-index mirrors this). */
		const SUBCATEGORY_IDS = {
			ui: [
				"terminal",
				"chat",
				"render",
				"panel"
			],
			agent: ["preset"],
			tools: [
				"context",
				"browser",
				"api",
				"model",
				"dev"
			],
			knowledge: [
				"memory",
				"reading",
				"qa"
			],
			integration: [
				"remote",
				"bridge",
				"sync",
				"external-ai"
			],
			security: ["access", "policy"],
			utility: [
				"cleanup",
				"stats",
				"notify",
				"net"
			]
		};
		/** Locale-key lookup for category ids (including the manifest default 'other'). */
		const CATEGORY_LABEL_KEY = {
			ui: "category.ui",
			agent: "category.agent",
			tools: "category.tools",
			knowledge: "category.knowledge",
			integration: "category.integration",
			security: "category.security",
			utility: "category.utility",
			other: "category.other"
		};
		/** Locale-key lookup for subcategory ids. */
		const SUBCATEGORY_LABEL_KEY = {
			terminal: "subcategory.terminal",
			chat: "subcategory.chat",
			render: "subcategory.render",
			panel: "subcategory.panel",
			preset: "subcategory.preset",
			context: "subcategory.context",
			browser: "subcategory.browser",
			api: "subcategory.api",
			model: "subcategory.model",
			dev: "subcategory.dev",
			memory: "subcategory.memory",
			reading: "subcategory.reading",
			qa: "subcategory.qa",
			remote: "subcategory.remote",
			bridge: "subcategory.bridge",
			sync: "subcategory.sync",
			"external-ai": "subcategory.external-ai",
			access: "subcategory.access",
			policy: "subcategory.policy",
			cleanup: "subcategory.cleanup",
			stats: "subcategory.stats",
			notify: "subcategory.notify",
			net: "subcategory.net"
		};
		//#endregion
		//#region \0dsh-css:packages/dsh-market/src/client/market.module.css.mjs
		const css = ".bkhjFa_market{flex-direction:column;gap:10px;display:flex}.bkhjFa_tabs{flex-wrap:wrap;gap:6px;display:flex}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab{font:inherit;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:999px;padding:2px 10px;font-size:12px;line-height:1.6}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab:hover:enabled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab.bkhjFa_tabActive{color:var(--dsw-alias-bg-layer-3);background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);font-weight:600}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab.bkhjFa_tabActive:hover:enabled{color:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-label-primary)}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab:active:enabled{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}.bkhjFa_market .bkhjFa_tabs>button.bkhjFa_tab.bkhjFa_tabActive:active:enabled{color:var(--dsw-alias-bg-layer-3);background:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-label-primary)}.bkhjFa_tabCount{opacity:.72;margin-left:6px;font-size:12px}.bkhjFa_search{width:100%;max-width:460px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px;font-size:13px;line-height:1.5}.bkhjFa_search::placeholder{color:var(--dsw-alias-label-tertiary)}.bkhjFa_search:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.bkhjFa_grid{grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:10px;margin:4px 0 0;padding:0;list-style:none;display:grid}.bkhjFa_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;gap:10px;min-width:0;padding:12px;display:flex}.bkhjFa_card:hover{border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_thumb{object-fit:cover;background:var(--dsw-alias-bg-layer-2);border-radius:6px;flex:none;place-items:center;width:72px;height:72px;display:grid}.bkhjFa_cardBody{flex-direction:column;flex:1;gap:6px;min-width:0;display:flex}.bkhjFa_cardName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}.bkhjFa_cardVersion{color:var(--dsw-alias-label-tertiary);margin-left:6px;font-size:11px;font-weight:400}.bkhjFa_cardMeta{color:var(--dsw-alias-label-tertiary);white-space:nowrap;align-items:center;gap:6px;font-size:12px;line-height:1.4;display:flex;overflow:hidden}.bkhjFa_badge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);white-space:nowrap;border-radius:999px;flex:none;padding:0 8px;font-size:11px;line-height:1.6}.bkhjFa_badgeInstalled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}.bkhjFa_metrics{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-wrap:wrap;gap:4px 10px;font-size:11px;line-height:1.5;display:flex}.bkhjFa_cardDesc{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;overflow-wrap:anywhere;-webkit-box-orient:vertical;margin:0;font-size:13px;line-height:1.45;display:-webkit-box;overflow:hidden}.bkhjFa_cardFooter{flex-direction:column;gap:8px;margin-top:auto;padding-top:8px;display:flex}.bkhjFa_actionRow{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like,.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_previewLink{font:inherit;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:999px;align-items:center;padding:1px 10px;font-size:12px;line-height:1.5;text-decoration:none;display:inline-flex}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like{font-variant-numeric:tabular-nums}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like:hover:enabled,.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_previewLink:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_actionRowPrimary{align-items:stretch;gap:8px;display:flex}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_install{min-width:0;font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:1 1 0;justify-content:center;align-items:center;min-height:30px;padding:4px 14px;font-size:12px;font-weight:600;line-height:1.5;display:inline-flex}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_install:hover:enabled{border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);flex-grow:2}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary:hover:enabled{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary:disabled{opacity:.55;cursor:default}.bkhjFa_error{color:var(--dsw-alias-label-error,#c53030);margin:0;font-size:12px;line-height:1.4}.bkhjFa_callout{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:1.4}.bkhjFa_filterRows{flex-direction:column;gap:6px;display:flex}.bkhjFa_filterRow{flex-wrap:wrap;gap:6px;display:flex}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip{font:inherit;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:999px;padding:2px 10px;font-size:12px;line-height:1.6}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip:hover:enabled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipSub{color:var(--dsw-alias-label-tertiary);border-style:dashed;font-size:11px}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipOn{color:var(--dsw-alias-bg-layer-3);background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);border-style:solid;font-weight:600}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipOn:hover:enabled{color:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-label-primary)}.bkhjFa_filterCount{opacity:.72;margin-left:6px;font-size:11px}.bkhjFa_empty{color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;font-size:13px;display:flex}.bkhjFa_retry{padding:3px 10px;font-size:12px}.bkhjFa_remoteNote{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.4}.bkhjFa_modalActions{justify-content:flex-end;gap:8px;margin-top:10px;display:flex}";
		const tagId = "@linxin666/dsh-client-ui-market/market.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-market";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var market_module_css_default = {
			"actionRow": "bkhjFa_actionRow",
			"actionRowPrimary": "bkhjFa_actionRowPrimary",
			"badge": "bkhjFa_badge",
			"badgeInstalled": "bkhjFa_badgeInstalled",
			"callout": "bkhjFa_callout",
			"card": "bkhjFa_card",
			"cardBody": "bkhjFa_cardBody",
			"cardDesc": "bkhjFa_cardDesc",
			"cardFooter": "bkhjFa_cardFooter",
			"cardMeta": "bkhjFa_cardMeta",
			"cardName": "bkhjFa_cardName",
			"cardVersion": "bkhjFa_cardVersion",
			"empty": "bkhjFa_empty",
			"error": "bkhjFa_error",
			"filterChip": "bkhjFa_filterChip",
			"filterChipOn": "bkhjFa_filterChipOn",
			"filterChipSub": "bkhjFa_filterChipSub",
			"filterCount": "bkhjFa_filterCount",
			"filterRow": "bkhjFa_filterRow",
			"filterRows": "bkhjFa_filterRows",
			"grid": "bkhjFa_grid",
			"install": "bkhjFa_install",
			"installPrimary": "bkhjFa_installPrimary",
			"like": "bkhjFa_like",
			"market": "bkhjFa_market",
			"metrics": "bkhjFa_metrics",
			"modalActions": "bkhjFa_modalActions",
			"previewLink": "bkhjFa_previewLink",
			"remoteNote": "bkhjFa_remoteNote",
			"retry": "bkhjFa_retry",
			"search": "bkhjFa_search",
			"tab": "bkhjFa_tab",
			"tabActive": "bkhjFa_tabActive",
			"tabCount": "bkhjFa_tabCount",
			"tabs": "bkhjFa_tabs",
			"thumb": "bkhjFa_thumb"
		};
		//#endregion
		//#region src/client/MarketCard.tsx
		/**
		* The market card: a first-level settings section that browses
		* dsh-market.com (skins / pets / community plugins), ranks entries by
		* device-backed likes, and offers one-click install — assets land in the
		* DSH home directories through the host gateway, plugins go through the
		* optional pluginManager service (with the copy-command degradation).
		*/
		const MARKET_ORIGIN = "https://dsh-market.com";
		/** Bridges the market scope onto the card's staged form. */
		var MarketCardController = class {
			form;
			store;
			/** @param scope - the bound settings scope for the dsh-web-ui-market namespace. */
			constructor(scope) {
				this.form = new CardForm(scope, [booleanField("enabled")]);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					enabled: this.form.field("enabled")
				};
			}
			/** Build the face the card's slot registration injects. */
			inject() {
				return {
					hooks: { marketCard: this.store },
					...this.form.actions()
				};
			}
			/** Release the scope subscription; the slot disposer calls this on teardown. */
			dispose() {
				this.form.dispose();
			}
		};
		const KIND_LABEL = {
			skin: "tab.skin",
			pet: "tab.pet",
			plugin: "tab.plugin"
		};
		function deviceFp() {
			const key = "dsh-market-web-fp";
			let fp = "";
			try {
				fp = window.localStorage.getItem(key) || "";
			} catch {}
			if (!fp || !/^[A-Za-z0-9_-]{16,64}$/.test(fp)) {
				fp = window.crypto.randomUUID ? window.crypto.randomUUID() : "fp-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
				try {
					window.localStorage.setItem(key, fp);
				} catch {}
			}
			return fp;
		}
		function messageOf(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		async function fetchJson(url) {
			const res = await fetch(url, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error("HTTP " + res.status);
			return res.json();
		}
		async function fetchJsonOptional(url) {
			try {
				return await fetchJson(url);
			} catch {
				return null;
			}
		}
		function formatCount(count) {
			if (count >= 1e6) return Math.round(count / 1e5) / 10 + "m";
			if (count >= 1e3) return Math.round(count / 100) / 10 + "k";
			return String(count);
		}
		/**
		* Render the market card.
		*/
		function MarketCard(props) {
			const { t } = props;
			const state = props.useMarketCard((snapshot) => snapshot);
			const disabled = !state.writable;
			const cardVisible = state.enabled.text !== "false";
			const fieldProps = {
				overriddenLabel: t("settings.overridden"),
				resetLabel: t("settings.reset"),
				invalidLabel: t("settings.invalidNumber"),
				disabled
			};
			const [tab, setTab] = (0, react.useState)("skin");
			const [query, setQuery] = (0, react.useState)("");
			const [cat, setCat] = (0, react.useState)("all");
			const [subcat, setSubcat] = (0, react.useState)("all");
			const [data, setData] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [loadAttempt, setLoadAttempt] = (0, react.useState)(0);
			const [installed, setInstalled] = (0, react.useState)({
				skins: [],
				pets: []
			});
			const [installing, setInstalling] = (0, react.useState)(null);
			const [conflict, setConflict] = (0, react.useState)(null);
			const [copiedId, setCopiedId] = (0, react.useState)(null);
			const [callouts, setCallouts] = (0, react.useState)({});
			const [pluginList, setPluginList] = (0, react.useState)(null);
			const [pluginErrors, setPluginErrors] = (0, react.useState)({});
			const [npmDownloads, setNpmDownloads] = (0, react.useState)({});
			const likeSeq = (0, react.useRef)(/* @__PURE__ */ new Map());
			(0, react.useEffect)(() => {
				if (props.remote !== void 0) {
					setData(props.remote);
					setFailed(false);
					setLoading(false);
					if (props.npmDownloads !== void 0 && typeof props.npmDownloads !== "function") setNpmDownloads(props.npmDownloads);
					return;
				}
				let alive = true;
				setLoading(true);
				const downloadsLoader = typeof props.npmDownloads === "function" ? props.npmDownloads : props.npmDownloads !== void 0 ? async () => props.npmDownloads : () => fetchJsonOptional("https://dsh-market.com/api/npm-downloads");
				Promise.all([
					fetchJson("https://dsh-market.com/manifest/skins.json"),
					fetchJson("https://dsh-market.com/manifest/pets.json"),
					fetchJson("https://dsh-market.com/manifest/plugins.json"),
					fetchJson("https://dsh-market.com/api/stats"),
					downloadsLoader()
				]).then(([skins, pets, plugins, stats, downloads]) => {
					if (!alive) return;
					const s = stats ?? {
						skin: {},
						pet: {},
						plugin: {}
					};
					setData({
						items: {
							skin: skins.items ?? [],
							pet: pets.items ?? [],
							plugin: plugins.items ?? []
						},
						stats: {
							skin: s.skin ?? {},
							pet: s.pet ?? {},
							plugin: s.plugin ?? {},
							installs: s.installs ?? void 0
						}
					});
					if (downloads && typeof downloads === "object" && downloads.downloads) {
						const list = downloads.downloads;
						setNpmDownloads((prev) => ({
							...prev,
							...list
						}));
					} else if (downloads && typeof downloads === "object") setNpmDownloads((prev) => ({
						...prev,
						...downloads
					}));
					setFailed(false);
					setLoading(false);
				}).catch(() => {
					if (!alive) return;
					setFailed(true);
					setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [
				props.remote,
				props.npmDownloads,
				loadAttempt
			]);
			const [liveGateway, setLiveGateway] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (props.gateway !== void 0) return;
				let alive = true;
				const gatewayClient = {
					async install(kind, id, force) {
						const res = await fetch("/api/market/install-" + (kind === "skin" ? "skin" : "pet"), {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								id,
								force
							})
						});
						const data = await res.json().catch(() => ({}));
						if (!res.ok || data.ok !== true) {
							const errMsg = data.message ?? data.error ?? "HTTP " + res.status;
							const err = new Error(errMsg);
							err.code = data.error ?? "write";
							err.dest = data.dest;
							throw err;
						}
						return { dest: data.dest ?? id };
					},
					async list() {
						const r = await fetchJson("/api/market/installed");
						return {
							skins: r.skins ?? [],
							pets: r.pets ?? []
						};
					}
				};
				gatewayClient.list().then((list) => {
					if (!alive) return;
					setInstalled(list);
					setLiveGateway(gatewayClient);
				}).catch(() => {
					if (alive) setLiveGateway(null);
				});
				return () => {
					alive = false;
				};
			}, [props.gateway]);
			const gateway = props.gateway !== void 0 ? props.gateway : liveGateway ?? null;
			const bridge = (0, react.useSyncExternalStore)(subscribePluginManager, getPluginManagerSnapshot);
			const face = props.pluginManager !== void 0 ? props.pluginManager : bridge.face;
			const faceLoopback = face !== null && face.isLoopback;
			(0, react.useEffect)(() => {
				if (face === null || !face.isLoopback) {
					setPluginList(null);
					return;
				}
				let alive = true;
				const refresh = () => {
					face.list().then((list) => {
						if (alive) setPluginList(list);
					}, () => {});
				};
				refresh();
				const unsubscribe = face.onChange(refresh);
				return () => {
					alive = false;
					unsubscribe();
				};
			}, [face, faceLoopback]);
			const votesOf = (kind, id) => {
				return (data?.stats ?? {
					skin: {},
					pet: {},
					plugin: {}
				})[kind][id] ?? 0;
			};
			const installsOf = (kind, id) => {
				return (data?.stats?.installs ?? {
					skin: {},
					pet: {},
					plugin: {}
				})[kind][id] ?? 0;
			};
			const sorted = (kind) => {
				const items = (data?.items[kind] ?? []).slice();
				items.sort((a, b) => {
					const va = votesOf(kind, a.id);
					const vb = votesOf(kind, b.id);
					if (va !== vb) return vb - va;
					return (a.rank ?? 999) - (b.rank ?? 999);
				});
				return items;
			};
			const categoryLabel = (id) => CATEGORY_LABEL_KEY[id] ? t(CATEGORY_LABEL_KEY[id]) : id;
			const subcategoryLabel = (id) => SUBCATEGORY_LABEL_KEY[id] ? t(SUBCATEGORY_LABEL_KEY[id]) : id;
			const matches = (item) => {
				if (tab === "plugin") {
					if (cat !== "all" && (item.category ?? "other") !== cat) return false;
					if (subcat !== "all" && item.subcategory !== subcat) return false;
				}
				if (!query) return true;
				const q = query.toLowerCase();
				return [
					item.name,
					item.nameEn,
					item.displayName,
					item.author,
					item.description,
					item.descriptionEn,
					item.category ? categoryLabel(item.category) : "",
					item.subcategory ? subcategoryLabel(item.subcategory) : ""
				].filter(Boolean).join(" ").toLowerCase().includes(q);
			};
			const callout = (id, text) => {
				setCallouts((prev) => ({
					...prev,
					[id]: text
				}));
				window.setTimeout(() => {
					setCallouts((prev) => {
						const next = { ...prev };
						delete next[id];
						return next;
					});
				}, 2400);
			};
			const copyCommand = (id, command) => {
				const done = () => {
					setCopiedId(id);
					window.setTimeout(() => setCopiedId(null), 1200);
				};
				const fallback = () => {
					const ta = document.createElement("textarea");
					ta.value = command;
					document.body.appendChild(ta);
					ta.select();
					let ok = false;
					try {
						ok = document.execCommand("copy");
					} catch {
						ok = false;
					}
					ta.remove();
					return ok;
				};
				if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(command).then(done, () => {
					if (fallback()) done();
				});
				else if (fallback()) done();
			};
			const installAssetKind = async (kind, id, force) => {
				if (gateway === null) return;
				const key = kind + ":" + id;
				setInstalling(key);
				try {
					const result = await gateway.install(kind, id, force);
					callout(id, t("installedAt", { path: result.dest }));
					const list = await gateway.list();
					setInstalled(list);
					reportInstall(kind, id).then((count) => {
						setData((prev) => prev ? {
							...prev,
							stats: {
								...prev.stats,
								installs: {
									...prev.stats.installs ?? {
										skin: {},
										pet: {},
										plugin: {}
									},
									[kind]: {
										...prev.stats.installs?.[kind] ?? {},
										[id]: count
									}
								}
							}
						} : prev);
					}).catch(() => {});
					if (kind === "skin") try {
						await fetch("/api/skin-center/v2/active", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ active: id })
						});
						if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dsh-skin-applied", { detail: { id } }));
					} catch {}
				} catch (err) {
					if (err.code === "conflict" && !force) setConflict({
						kind,
						id,
						dest: err.dest ?? id
					});
					else callout(id, t("installFailed", { reason: messageOf(err) }));
				} finally {
					setInstalling(null);
				}
			};
			const onInstallAsset = (kind, id) => {
				if (gateway === null || installing !== null) return;
				installAssetKind(kind, id, false);
			};
			const onInstallPlugin = (item) => {
				if (face === null || !face.isLoopback || installing !== null) return;
				const id = item.id;
				const spec = installSpec(item);
				if (!isInstallSpecValid(spec)) {
					setPluginErrors((prev) => ({
						...prev,
						[id]: t("installFailed", { reason: t("installSpecInvalid") })
					}));
					return;
				}
				setInstalling("plugin:" + id);
				face.install(spec).then(() => face.list()).then((list) => {
					setPluginList(list);
					callout(id, t("installed", {}));
					reportInstall("plugin", id).then((count) => {
						setData((prev) => prev ? {
							...prev,
							stats: {
								...prev.stats,
								installs: {
									...prev.stats.installs ?? {
										skin: {},
										pet: {},
										plugin: {}
									},
									plugin: {
										...prev.stats.installs?.plugin ?? {},
										[id]: count
									}
								}
							}
						} : prev);
					}).catch(() => {});
				}).catch((reason) => {
					setPluginErrors((prev) => ({
						...prev,
						[id]: t("installFailed", { reason: messageOf(reason) })
					}));
				}).finally(() => setInstalling(null));
			};
			const onLike = async (kind, id) => {
				const key = kind + ":" + id;
				const seq = (likeSeq.current.get(key) ?? 0) + 1;
				likeSeq.current.set(key, seq);
				const current = votesOf(kind, id);
				setData((prev) => prev ? {
					...prev,
					stats: {
						...prev.stats,
						[kind]: {
							...prev.stats[kind],
							[id]: current + 1
						}
					}
				} : prev);
				try {
					const token = await (props.turnstileToken ?? marketTurnstileToken)();
					const res = await fetch("https://dsh-market.com/api/like", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							kind,
							asset_id: id,
							device_fp: deviceFp(),
							turnstile_token: token
						})
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const out = await res.json();
					if (likeSeq.current.get(key) !== seq) return;
					setData((prev) => prev ? {
						...prev,
						stats: {
							...prev.stats,
							[kind]: {
								...prev.stats[kind],
								[id]: out.votes ?? current + 1
							}
						}
					} : prev);
				} catch {
					if (likeSeq.current.get(key) !== seq) return;
					setData((prev) => prev ? {
						...prev,
						stats: {
							...prev.stats,
							[kind]: {
								...prev.stats[kind],
								[id]: current
							}
						}
					} : prev);
					setCallouts((prev) => ({
						...prev,
						[id]: t("likeFailed", {})
					}));
				}
			};
			const origin = props.marketOrigin ?? MARKET_ORIGIN;
			const reportInstall = props.reportInstall ?? (async (kind, id) => {
				const token = await (props.turnstileToken ?? (() => marketTurnstileToken("market-install")))();
				const installId = window.crypto.randomUUID ? window.crypto.randomUUID() : "ins-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
				const res = await fetch(origin + "/api/install", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						kind,
						asset_id: id,
						device_fp: deviceFp(),
						install_id: installId,
						turnstile_token: token
					})
				});
				if (!res.ok) throw new Error("HTTP " + res.status);
				return (await res.json()).installs ?? 0;
			});
			const pluginItems = data?.items.plugin ?? [];
			const chipClass = (isOn, isSub) => {
				const cls = [market_module_css_default.filterChip];
				if (isSub) cls.push(market_module_css_default.filterChipSub);
				if (isOn) cls.push(market_module_css_default.filterChipOn);
				return cls.join(" ");
			};
			const visible = sorted(tab).filter(matches);
			const total = (data?.items[tab] ?? []).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PluginSettingsCard, {
				t,
				titleKey: "settings.title",
				descriptionKey: "settings.description",
				descriptionNode: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					t("settings.descriptionPrefix"),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						className: market_module_css_default.previewLink,
						href: MARKET_ORIGIN,
						target: "_blank",
						rel: "noreferrer",
						children: t("badge.market")
					}),
					t("settings.descriptionSuffix")
				] }),
				state,
				alwaysOpen: true,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
						id: "settings-market-enabled",
						label: t("settings.enable"),
						hint: t("settings.enableHint"),
						inheritLabel: t("settings.inherit"),
						onLabel: t("settings.on"),
						offLabel: t("settings.off"),
						...fieldProps,
						...state.enabled,
						onEdit: (value) => {
							props.edit("enabled", value);
						},
						onReset: () => {
							props.resetField("enabled");
						}
					}),
					cardVisible ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: market_module_css_default.market,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: market_module_css_default.tabs,
								role: "tablist",
								"aria-label": t("settings.title"),
								children: [
									"skin",
									"pet",
									"plugin"
								].map((kind) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === kind,
									className: tab === kind ? market_module_css_default.tab + " " + market_module_css_default.tabActive : market_module_css_default.tab,
									onClick: () => {
										setTab(kind);
										setCat("all");
										setSubcat("all");
									},
									children: [t(KIND_LABEL[kind]), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: market_module_css_default.tabCount,
										children: (data?.items[kind] ?? []).length
									})]
								}, kind))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: market_module_css_default.search,
								type: "search",
								"aria-label": t("search.label"),
								placeholder: t("search.label"),
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}),
							tab === "plugin" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: market_module_css_default.filterRows,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: market_module_css_default.filterRow,
									role: "group",
									"aria-label": t("filter.category"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: chipClass(cat === "all", false),
										onClick: () => {
											setCat("all");
											setSubcat("all");
										},
										children: [
											t("filter.all"),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: market_module_css_default.filterCount,
												children: pluginItems.length
											})
										]
									}), categoryCounts(pluginItems).map(({ id, count }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: chipClass(cat === id, false),
										onClick: () => {
											setCat(id);
											setSubcat("all");
										},
										children: [
											categoryLabel(id),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: market_module_css_default.filterCount,
												children: count
											})
										]
									}, id))]
								}), cat !== "all" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: market_module_css_default.filterRow,
									role: "group",
									"aria-label": t("filter.subcategory"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: chipClass(subcat === "all", true),
										onClick: () => {
											setSubcat("all");
										},
										children: [
											t("filter.all"),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: market_module_css_default.filterCount,
												children: subcategoryCounts(pluginItems, cat, SUBCATEGORY_IDS[cat]).reduce((sum, entry) => sum + entry.count, 0)
											})
										]
									}), subcategoryCounts(pluginItems, cat, SUBCATEGORY_IDS[cat]).map(({ id, count }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: chipClass(subcat === id, true),
										onClick: () => {
											setSubcat(id);
										},
										children: [
											subcategoryLabel(id),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: market_module_css_default.filterCount,
												children: count
											})
										]
									}, id))]
								}) : null]
							}) : null,
							failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: market_module_css_default.empty,
								role: "status",
								children: [t("empty"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									className: market_module_css_default.retry,
									onClick: () => {
										setLoadAttempt((value) => value + 1);
									},
									children: t("retry")
								})]
							}) : loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: market_module_css_default.empty,
								role: "status",
								children: t("loading")
							}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: market_module_css_default.empty,
								role: "status",
								children: total === 0 ? t("empty") : t("noMatch")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: market_module_css_default.grid,
								children: visible.map((item) => {
									const name = item.name ?? item.displayName ?? item.id;
									const id = item.id;
									const installedHere = tab === "skin" ? installed.skins.includes(id) : tab === "pet" ? installed.pets.includes(id) : entryInstalled(item, pluginList ?? []) !== null;
									const isInstalling = installing === tab + ":" + id || installing === "plugin:" + id;
									const command = tab === "plugin" ? installCommand(item) : "";
									const thumb = tab === "skin" ? item.preview?.light : tab === "pet" ? item.previews?.[0] ?? item.spritesheet : "";
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: market_module_css_default.card,
										children: [thumb ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
											className: market_module_css_default.thumb,
											src: "https://dsh-market.com/" + thumb,
											alt: "",
											loading: "lazy"
										}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: market_module_css_default.cardBody,
											children: [
												item.repo ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
													className: market_module_css_default.cardName,
													href: item.repo,
													target: "_blank",
													rel: "noreferrer",
													title: name,
													children: [name, item.version ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: market_module_css_default.cardVersion,
														children: ["v", item.version]
													}) : null]
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: market_module_css_default.cardName,
													title: name,
													children: [name, item.version ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: market_module_css_default.cardVersion,
														children: ["v", item.version]
													}) : null]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: market_module_css_default.cardMeta,
													children: [
														item.author ?? "",
														item.category ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: market_module_css_default.badge,
															children: categoryLabel(item.category)
														}) : null,
														item.subcategory ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: market_module_css_default.badge,
															children: subcategoryLabel(item.subcategory)
														}) : null,
														installedHere ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: market_module_css_default.badge + " " + market_module_css_default.badgeInstalled,
															children: t("installed")
														}) : null
													]
												}),
												item.description || item.descriptionEn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: market_module_css_default.cardDesc,
													children: (item.description ?? item.descriptionEn ?? "").slice(0, 140)
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: market_module_css_default.metrics,
													children: [installsOf(tab, id) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installs", { count: formatCount(installsOf(tab, id)) }) }) : null, item.npm && npmDownloads[item.npm] !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("npmDownloads", { count: formatCount(npmDownloads[item.npm] ?? 0) }) }) : null]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: market_module_css_default.cardFooter,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: market_module_css_default.actionRow,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
																type: "button",
																className: market_module_css_default.like,
																onClick: () => {
																	onLike(tab, id);
																},
																children: [
																	t("like"),
																	" ",
																	votesOf(tab, id)
																]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: market_module_css_default.previewLink,
																onClick: () => {
																	window.open(tab === "skin" ? "https://dsh-market.com/preview.html?skin=" + encodeURIComponent(id) + "&theme=light&chrome=0" : "https://dsh-market.com/", "_blank", "noopener");
																},
																children: t("preview")
															}),
															(tab === "plugin" || tab === "skin") && item.repo ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
																className: market_module_css_default.previewLink,
																href: item.repo,
																target: "_blank",
																rel: "noreferrer",
																children: t("repository")
															}) : null
														]
													}), tab === "plugin" || gateway !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: market_module_css_default.actionRowPrimary,
														children: [
															tab === "plugin" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: market_module_css_default.install,
																title: command,
																onClick: () => {
																	copyCommand(id, command);
																},
																children: copiedId === id ? t("copied") : t("copyCommand")
															}) : null,
															tab === "plugin" && faceLoopback && !installedHere ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: market_module_css_default.install + " " + market_module_css_default.installPrimary,
																disabled: installing !== null,
																onClick: () => {
																	onInstallPlugin(item);
																},
																children: isInstalling ? t("installing") : t("installNow")
															}) : null,
															(tab === "skin" || tab === "pet") && gateway !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: market_module_css_default.install + " " + market_module_css_default.installPrimary,
																disabled: installing !== null || installedHere,
																onClick: () => {
																	onInstallAsset(tab, id);
																},
																children: isInstalling ? t("installing") : installedHere ? t("installed") : t("installNow")
															}) : null
														]
													}) : null]
												}),
												pluginErrors[id] ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: market_module_css_default.error,
													children: pluginErrors[id]
												}) : null,
												callouts[id] ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: market_module_css_default.callout,
													children: callouts[id]
												}) : null
											]
										})]
									}, id);
								})
							}),
							gateway === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: market_module_css_default.remoteNote,
								children: t("remote.note")
							}) : null
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						title: conflict ? t("conflict.title") : "",
						open: conflict !== null,
						onClose: () => {
							setConflict(null);
						},
						closeLabel: t("cancel"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("conflict.text", { dest: conflict?.dest ?? "" }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: market_module_css_default.modalActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								onClick: () => {
									const target = conflict;
									setConflict(null);
									if (target) installAssetKind(target.kind, target.id, true);
								},
								children: t("replace")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								onClick: () => {
									setConflict(null);
								},
								children: t("cancel")
							})]
						})] })
					})
				]
			});
		}
		function MarketSection(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketCard, { ...props });
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Market card dictionaries. zh is the key source; en mirrors every key.
		*/
		const zh = {
			"settings.collapse": "收起",
			"settings.expand": "展开",
			"settings.notExposed": "该设置段未暴露（宿主命名空间缺失）",
			"settings.unsaved": "有未保存的更改",
			"settings.readOnly": "只读",
			"settings.saveFailed": "保存失败",
			"settings.discard": "放弃更改",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.overridden": "已覆盖默认值",
			"settings.reset": "恢复默认",
			"settings.invalidNumber": "无效值",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.title": "创意工坊",
			"settings.description": "浏览 dsh-market.com 的皮肤、宠物与社区插件，一键安装到本机 dsh。",
			"settings.descriptionPrefix": "浏览 ",
			"settings.descriptionSuffix": " 的皮肤、宠物与社区插件，一键安装到本机 dsh。",
			"settings.enable": "启用创意工坊卡片",
			"settings.enableHint": "关闭后隐藏创意工坊内容，仅保留开关本身。",
			"tab.skin": "皮肤",
			"tab.pet": "宠物",
			"tab.plugin": "插件",
			"search.label": "搜索名称、作者或描述…",
			"filter.all": "全部",
			"filter.category": "分类筛选",
			"filter.subcategory": "二级分类",
			"category.ui": "界面",
			"category.agent": "Agent",
			"category.tools": "工具",
			"category.knowledge": "知识",
			"category.integration": "集成",
			"category.security": "安全",
			"category.utility": "实用",
			"category.other": "其他",
			"subcategory.terminal": "终端界面",
			"subcategory.chat": "对话增强",
			"subcategory.render": "回复内容渲染",
			"subcategory.panel": "侧栏面板",
			"subcategory.preset": "Agent 预设",
			"subcategory.context": "上下文洞察",
			"subcategory.browser": "浏览器自动化",
			"subcategory.api": "接口与网络调试",
			"subcategory.model": "模型与多模态",
			"subcategory.dev": "开发工作流",
			"subcategory.memory": "记忆",
			"subcategory.reading": "深度阅读",
			"subcategory.qa": "知识库问答",
			"subcategory.remote": "远程访问",
			"subcategory.bridge": "跨系统桥",
			"subcategory.sync": "云同步",
			"subcategory.external-ai": "外部 AI 接入",
			"subcategory.access": "访问控制",
			"subcategory.policy": "审批策略",
			"subcategory.cleanup": "系统整理",
			"subcategory.stats": "统计",
			"subcategory.notify": "通知",
			"subcategory.net": "网络与传输",
			"result.count": "共 {shown} / {total} 个条目",
			"empty": "创意工坊清单为空（网络不可达？点击重试）",
			"noMatch": "没有匹配的条目",
			"retry": "重试",
			"online": "",
			"offline": "创意工坊数据不可用，请检查网络",
			"install": "安装",
			"installNow": "一键安装",
			"installing": "安装中…",
			"installed": "已安装",
			"installFailed": "安装失败：{reason}",
			"installSpecInvalid": "安装来源无效，仅支持 npm 包名或 https:// git 地址",
			"copied": "已复制",
			"copyCommand": "复制安装命令",
			"command.title": "复制下方命令到 dsh host 终端执行",
			"conflict.title": "已存在同名目录",
			"conflict.text": "{dest} 已存在。继续将覆盖该目录中的旧版本文件（不可撤销）。",
			"replace": "覆盖并安装",
			"cancel": "取消",
			"preview": "预览",
			"openSite": "打开创意工坊站",
			"repository": "源码仓库",
			"like": "赞",
			"liked": "已赞",
			"likeFailed": "点赞失败",
			"badge.market": "dsh-market.com",
			"install.path": "安装目录：{path}",
			"installedAt": "安装到 {path}",
			"loading": "加载中…",
			"votes": "{count} 票",
			"installs": "安装 {count}",
			"npmDownloads": "npm 近 30 天 {count}",
			"remote.note": "远程浏览器仅可浏览与复制命令；一键安装需在本机（回环）浏览器。"
		};
		const en = {
			"settings.collapse": "Collapse",
			"settings.expand": "Expand",
			"settings.notExposed": "Section not exposed (host namespace missing)",
			"settings.unsaved": "Unsaved changes",
			"settings.readOnly": "Read only",
			"settings.saveFailed": "Save failed",
			"settings.discard": "Discard changes",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.overridden": "Overrides default",
			"settings.reset": "Reset",
			"settings.invalidNumber": "Invalid value",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.title": "Workshop",
			"settings.description": "Browse skins, pets and community plugins from dsh-market.com and install them locally with one click.",
			"settings.descriptionPrefix": "Browse skins, pets and community plugins from ",
			"settings.descriptionSuffix": " and install them locally with one click.",
			"settings.enable": "Enable the Workshop card",
			"settings.enableHint": "Hides the Workshop content and keeps the switch only.",
			"tab.skin": "Skins",
			"tab.pet": "Pets",
			"tab.plugin": "Plugins",
			"search.label": "Search name, author or description…",
			"filter.all": "All",
			"filter.category": "Category filter",
			"filter.subcategory": "Subcategory",
			"category.ui": "UI",
			"category.agent": "Agent",
			"category.tools": "Tools",
			"category.knowledge": "Knowledge",
			"category.integration": "Integration",
			"category.security": "Security",
			"category.utility": "Utility",
			"category.other": "Other",
			"subcategory.terminal": "Terminal UI",
			"subcategory.chat": "Chat enhancements",
			"subcategory.render": "Reply rendering",
			"subcategory.panel": "Sidebar panel",
			"subcategory.preset": "Agent presets",
			"subcategory.context": "Context insights",
			"subcategory.browser": "Browser automation",
			"subcategory.api": "API & network tools",
			"subcategory.model": "Models & multimodal",
			"subcategory.dev": "Dev workflow",
			"subcategory.memory": "Memory",
			"subcategory.reading": "Deep reading",
			"subcategory.qa": "Knowledge-base Q&A",
			"subcategory.remote": "Remote access",
			"subcategory.bridge": "Cross-system bridge",
			"subcategory.sync": "Cloud sync",
			"subcategory.external-ai": "External AI",
			"subcategory.access": "Access control",
			"subcategory.policy": "Approval policy",
			"subcategory.cleanup": "System cleanup",
			"subcategory.stats": "Statistics",
			"subcategory.notify": "Notifications",
			"subcategory.net": "Networking",
			"result.count": "{shown} / {total} entries",
			"empty": "Workshop list empty (network unreachable? click retry)",
			"noMatch": "No matching entries",
			"retry": "Retry",
			"online": "",
			"offline": "Workshop data unavailable",
			"install": "Install",
			"installNow": "Install now",
			"installing": "Installing…",
			"installed": "Installed",
			"installFailed": "Install failed: {reason}",
			"installSpecInvalid": "Invalid install source; only npm package names and https:// git URLs are supported",
			"copied": "Copied",
			"copyCommand": "Copy install command",
			"command.title": "Copy this command into a dsh host terminal",
			"conflict.title": "Same-named directory exists",
			"conflict.text": "{dest} already exists. Continuing will replace its files with the old version (not undoable).",
			"replace": "Replace and install",
			"cancel": "Cancel",
			"preview": "Preview",
			"openSite": "Open the Workshop site",
			"repository": "Source repository",
			"like": "Like",
			"liked": "Liked",
			"likeFailed": "Like failed",
			"badge.market": "dsh-market.com",
			"install.path": "Install directory: {path}",
			"installedAt": "Installed to {path}",
			"loading": "Loading…",
			"votes": "{count} votes",
			"installs": "{count} installs",
			"npmDownloads": "npm {count} last 30d",
			"remote.note": "Remote browsers can browse and copy commands only; one-click install needs the local (loopback) browser."
		};
		//#endregion
		//#region src/client/telemetry.ts
		const VISITOR_KEY = "dsh-web-ui-telemetry-visitor";
		const DAY_KEY_PREFIX = "dsh-web-ui-telemetry-day:";
		const ENDPOINT = "https://dsh-market.com/api/telemetry/event";
		/** The building package's version, when the bundle carries it. */
		function bakedVersion() {
			try {
				return "0.3.10";
			} catch {
				return;
			}
		}
		/** Read or lazily create the anonymous visitor id; null when storage is unavailable. */
		function visitorId() {
			try {
				const existing = localStorage.getItem(VISITOR_KEY);
				if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
				const fresh = crypto.randomUUID().replaceAll("-", "");
				localStorage.setItem(VISITOR_KEY, fresh);
				return fresh;
			} catch {
				return null;
			}
		}
		/** Drop stale per-day dedup keys so localStorage does not grow forever. */
		function pruneDayKeys(today) {
			try {
				for (let index = localStorage.length - 1; index >= 0; index -= 1) {
					const key = localStorage.key(index);
					if (key !== null && key.startsWith(DAY_KEY_PREFIX) && key !== DAY_KEY_PREFIX + today) localStorage.removeItem(key);
				}
			} catch {}
		}
		/**
		* Fire the daily heartbeat for the given items at most once per UTC day per
		* browser. Never throws and never blocks the caller. Items without an explicit
		* version inherit the bundle's baked build version.
		*/
		function reportDailyHeartbeat(items) {
			try {
				if (items.length === 0) return;
				const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
				if (navigator.webdriver) return;
				if (localStorage.getItem(DAY_KEY_PREFIX + today) !== null) return;
				const visitor = visitorId();
				if (visitor === null) return;
				pruneDayKeys(today);
				const payloadItems = items.map((item) => {
					const out = { name: item.name };
					const version = item.version ?? bakedVersion();
					if (version !== void 0) out.version = version;
					if (item.channel !== void 0) out.channel = item.channel;
					return out;
				});
				const body = JSON.stringify({
					kind: "heartbeat",
					visitor,
					items: payloadItems
				});
				fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
					keepalive: true
				}).then((response) => {
					if (response.ok) localStorage.setItem(DAY_KEY_PREFIX + today, "1");
				}).catch(() => {});
			} catch {}
		}
		//#endregion
		//#region src/client/index.ts
		const MARKET_NS = "dsh-web-ui-market";
		const SECTION_ID = "dsh-workshop";
		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope",
			"remote"
		];
		/** Register the market section and the plugin-manager bridge. */
		function apply(ctx) {
			reportDailyHeartbeat([{ name: "@linxin666/dsh-client-ui-market" }]);
			ctx.effect(() => {
				try {
					return ctx.locale.register(MARKET_NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "dsh-web-ui-market: dictionaries");
			bridgePluginManager(ctx);
			const controller = new MarketCardController((ctx.get("webUiSettings") ?? ctx.settingsScope).bind({ namespace: MARKET_NS }));
			ctx.slots.inject("settings.section", () => {
				try {
					const unregister = ctx.slots.register({
						name: "settings.section",
						id: SECTION_ID,
						order: 150,
						label: () => ctx.locale.bind(MARKET_NS)("settings.title"),
						locale: MARKET_NS,
						inject: () => controller.inject()
					}, MarketSection);
					return () => {
						unregister();
						controller.dispose();
					};
				} catch {
					return () => {};
				}
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map