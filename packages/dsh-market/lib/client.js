window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-market",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
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
		const css$1 = ".RcIGlq_card{--settings-card-radius:12px;--settings-card-header-pad:16px;--settings-card-header-gap:13px;--settings-card-title-size:15px;--settings-card-description-size:13px;--settings-card-body-inset:16px;--settings-card-motion:.18s;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:var(--settings-card-radius);list-style:none;transition:border-color .16s,background .16s}.RcIGlq_card:hover{border-color:var(--dsw-alias-label-dimmed)}.RcIGlq_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.RcIGlq_cardNested{--settings-card-radius:10px;--settings-card-header-pad:10px 12px;--settings-card-header-gap:10px;--settings-card-title-size:13px;--settings-card-description-size:12px;--settings-card-body-inset:12px}.RcIGlq_cardNested .RcIGlq_description{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.RcIGlq_header{appearance:none;box-sizing:border-box;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:var(--settings-card-radius);align-items:center;gap:var(--settings-card-header-gap);padding:var(--settings-card-header-pad);background:0 0;border:0;display:flex}.RcIGlq_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.RcIGlq_headerStatic{box-sizing:border-box;border-radius:var(--settings-card-radius);align-items:center;gap:var(--settings-card-header-gap);width:100%;padding:var(--settings-card-header-pad);display:flex}.RcIGlq_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.RcIGlq_mark{background:var(--dsw-alias-bg-module-platform);width:34px;height:34px;color:var(--dsw-alias-label-secondary);border-radius:10px;flex:none;place-items:center;transition:color .16s;display:grid}.RcIGlq_header:hover .RcIGlq_mark,.RcIGlq_cardOpen .RcIGlq_mark{color:var(--dsw-alias-label-primary)}.RcIGlq_name{color:var(--dsw-alias-label-primary);font-size:var(--settings-card-title-size);font-weight:600;line-height:1.4}.RcIGlq_description{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.RcIGlq_headerAction{flex:none;align-items:center;display:inline-flex}.RcIGlq_chevron{color:var(--dsw-alias-label-tertiary);flex:none;width:16px;height:16px;transition:transform .16s,color .16s}.RcIGlq_header:hover .RcIGlq_chevron{color:var(--dsw-alias-label-secondary)}.RcIGlq_chevronOpen{transform:rotate(180deg)}.RcIGlq_disclosure{opacity:0;transition:grid-template-rows var(--settings-card-motion) ease, opacity var(--settings-card-motion) ease;grid-template-rows:0fr;display:grid}.RcIGlq_disclosure[data-state=collapsed],.RcIGlq_disclosure[data-state=entering],.RcIGlq_disclosure[data-state=closing]{overflow:hidden}.RcIGlq_disclosure[data-state=entering],.RcIGlq_disclosure[data-state=shown]{opacity:1;grid-template-rows:1fr}.RcIGlq_disclosure>.RcIGlq_body{min-height:0}.RcIGlq_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 var(--settings-card-body-inset);padding-bottom:8px;container:RcIGlq_settings-card/inline-size}.RcIGlq_readOnly{color:var(--dsw-alias-label-secondary);margin:12px 0 0;font-size:12px;line-height:1.5}.RcIGlq_notExposed{color:var(--dsw-alias-state-warn-primary);margin:12px 0 0;font-size:12px;line-height:1.5}.RcIGlq_failed{color:var(--dsw-alias-state-error-primary,#b42318);overflow-wrap:anywhere;margin:8px 0 4px;font-size:12px;line-height:18px}.RcIGlq_field{grid-template-columns:minmax(0,1fr) fit-content(50%);grid-template-areas:\"RcIGlq_head RcIGlq_control\"\"RcIGlq_hint RcIGlq_control\";align-items:center;gap:4px 24px;padding:16px 0;display:grid}.RcIGlq_field>.RcIGlq_head{grid-area:RcIGlq_head}.RcIGlq_field>:is(.RcIGlq_hint,.RcIGlq_invalid){grid-area:RcIGlq_hint}.RcIGlq_field>:not(.RcIGlq_head,.RcIGlq_hint,.RcIGlq_invalid){grid-area:RcIGlq_control;justify-self:end;max-width:100%}.RcIGlq_field+.RcIGlq_field{border-top:1px solid var(--dsw-alias-border-l2)}.RcIGlq_head{align-items:center;gap:8px;display:flex}.RcIGlq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:14px;font-weight:400;line-height:22px}.RcIGlq_badges{align-items:center;gap:8px;display:inline-flex}.RcIGlq_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.RcIGlq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.RcIGlq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.RcIGlq_reset:disabled{cursor:default}.RcIGlq_reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.RcIGlq_segmentGroup{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);border-radius:8px;flex-wrap:wrap;align-items:center;gap:2px;padding:2px;display:inline-flex;position:relative}.RcIGlq_segment{appearance:none;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:0;border-radius:7px;margin:0;padding:3px 12px;font-size:13px;font-weight:500;line-height:18px;transition:background-color .12s,color .12s}.RcIGlq_segment:hover:not(:disabled):not([data-active]){color:var(--dsw-alias-label-primary)}.RcIGlq_segmentGroup:not([data-pill])>.RcIGlq_segment[data-active],.RcIGlq_segmentGroup[data-pill]:before{background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3));box-shadow:0 1px 2px #14141314}body[data-ds-dark-theme] .RcIGlq_segmentGroup:not([data-pill])>.RcIGlq_segment[data-active],body[data-ds-dark-theme] .RcIGlq_segmentGroup[data-pill]:before{box-shadow:none;background:#ffffff24}.RcIGlq_segment[data-active]{color:var(--dsw-alias-label-primary)}.RcIGlq_segmentGroup[data-pill]:before{content:\"\";width:var(--segment-pill-w,0px);height:var(--segment-pill-h,0px);transform:translate(var(--segment-pill-x,0px), var(--segment-pill-y,0px));pointer-events:none;border-radius:7px;transition:transform .24s cubic-bezier(.22,.61,.36,1),width .24s cubic-bezier(.22,.61,.36,1),height .24s cubic-bezier(.22,.61,.36,1);position:absolute;top:0;left:0}.RcIGlq_segmentGroup>*{z-index:1;position:relative}.RcIGlq_segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.RcIGlq_segment:disabled{cursor:not-allowed;opacity:.45}.RcIGlq_segmentGroup[data-pill]:has(>.RcIGlq_segment:disabled):before{opacity:.45}.RcIGlq_input,.RcIGlq_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.RcIGlq_input:focus-visible,.RcIGlq_select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.RcIGlq_input:disabled,.RcIGlq_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.RcIGlq_inputInvalid{border:1px solid var(--dsw-alias-state-error-primary,#b42318);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.RcIGlq_inputInvalid:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary,#b42318);outline-offset:1px;border-color:var(--dsw-alias-state-error-primary,#b42318)}.RcIGlq_field>:is(.RcIGlq_input,.RcIGlq_inputInvalid,.RcIGlq_select,.RcIGlq_selectWrap,.RcIGlq_rangeAnchor){box-sizing:border-box;width:220px}.RcIGlq_rangeAnchor>:is(.RcIGlq_input,.RcIGlq_inputInvalid){box-sizing:border-box;width:100%}@container RcIGlq_settings-card (width<=440px){.RcIGlq_field{grid-template-columns:minmax(0,1fr);grid-template-areas:\"RcIGlq_head\"\"RcIGlq_hint\"\"RcIGlq_control\";row-gap:8px}.RcIGlq_field>:not(.RcIGlq_head,.RcIGlq_hint,.RcIGlq_invalid){justify-self:start}.RcIGlq_field>:is(.RcIGlq_input,.RcIGlq_inputInvalid,.RcIGlq_select,.RcIGlq_selectWrap,.RcIGlq_rangeAnchor){justify-self:stretch;width:auto}}.RcIGlq_selectWrap{position:relative}.RcIGlq_selectButton{appearance:none;text-align:left;cursor:pointer;justify-content:space-between;align-items:center;gap:8px;width:100%;display:flex}.RcIGlq_selectLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.RcIGlq_selectChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.RcIGlq_selectChevronOpen{transform:rotate(180deg)}.RcIGlq_selectPopup{z-index:40;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);max-height:240px;box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2);opacity:0;border-radius:8px;flex-direction:column;padding:4px;transition:opacity .1s,transform .1s;display:flex;position:absolute;top:calc(100% + 4px);left:0;right:0;overflow-y:auto;transform:translateY(-4px)}.RcIGlq_selectPopupOpen{opacity:1;transform:none}.RcIGlq_selectPopupClose{opacity:0;pointer-events:none;transform:translateY(-4px)}.RcIGlq_rangeAnchor{display:inline-flex;position:relative}.RcIGlq_rangeBubble{z-index:40;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);width:220px;box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2);opacity:0;visibility:hidden;border-radius:10px;padding:10px 12px 6px;transition:opacity .12s,transform .12s,visibility 0s linear .12s;position:absolute;right:0}.RcIGlq_rangeBubble[data-side=above]{bottom:calc(100% + 6px);transform:translateY(4px)}.RcIGlq_rangeBubble[data-side=below]{top:calc(100% + 6px);transform:translateY(-4px)}.RcIGlq_rangeBubble[data-open]{opacity:1;visibility:visible;transition:opacity .12s,transform .12s,visibility;transform:none}.RcIGlq_rangeSlider{appearance:none;cursor:pointer;background:0 0;width:100%;height:18px;margin:0;display:block}.RcIGlq_rangeSlider::-webkit-slider-runnable-track{background:linear-gradient(to right, var(--dsw-alias-brand-primary) var(--range-fill,0%), color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent) var(--range-fill,0%));border-radius:999px;height:4px}.RcIGlq_rangeSlider::-moz-range-track{background:color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);border-radius:999px;height:4px}.RcIGlq_rangeSlider::-moz-range-progress{background:var(--dsw-alias-brand-primary);border-radius:999px;height:4px}.RcIGlq_rangeSlider::-webkit-slider-thumb{appearance:none;background:#fff;border:0;border-radius:50%;width:14px;height:14px;margin-top:-5px;transition:transform .12s;box-shadow:0 0 0 1px #0000001f,0 1px 3px #00000040}.RcIGlq_rangeSlider::-moz-range-thumb{background:#fff;border:0;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 1px #0000001f,0 1px 3px #00000040}.RcIGlq_rangeSlider:active::-webkit-slider-thumb{transform:scale(1.15)}.RcIGlq_rangeSlider:focus-visible{outline:none}.RcIGlq_rangeSlider:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}.RcIGlq_rangeSlider:disabled{cursor:not-allowed}.RcIGlq_rangeEnds{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;justify-content:space-between;margin-top:2px;font-size:11px;line-height:16px;display:flex}.RcIGlq_selectOption{color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;text-overflow:ellipsis;border-radius:6px;flex-shrink:0;padding:6px 10px;font-size:13px;line-height:1.5;overflow:hidden}.RcIGlq_selectOption:hover,.RcIGlq_selectOptionActive{background:var(--dsw-alias-interactive-bg-hover)}.RcIGlq_selectOptionSelected{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);font-weight:500}.RcIGlq_invalid{color:var(--dsw-alias-state-error-primary,#b42318);margin:0;font-size:12px;line-height:18px}.RcIGlq_hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}.RcIGlq_toggle{appearance:none;cursor:pointer;font:inherit;background:0 0;border:0;border-radius:999px;align-items:center;margin:0;padding:0;display:inline-flex}.RcIGlq_toggleTrack{background:var(--dsw-alias-label-dimmed);border-radius:999px;flex:none;width:36px;height:20px;transition:background-color .18s;position:relative}.RcIGlq_toggleThumb{--toggle-travel:16px;--toggle-overshoot:1px;background:var(--dsw-alias-bg-layer-3);border-radius:50%;width:16px;height:16px;transition:translate .18s;position:absolute;top:2px;left:2px;translate:0;box-shadow:0 1px 2px #1414132e}.RcIGlq_toggle[aria-checked=true] .RcIGlq_toggleTrack{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary))}.RcIGlq_toggle[aria-checked=true] .RcIGlq_toggleThumb{translate:var(--toggle-travel) 0;background:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-3))}.RcIGlq_toggle[data-moved][aria-checked=true] .RcIGlq_toggleThumb{animation:.35s cubic-bezier(.34,1.45,.64,1) both RcIGlq_toggle-on}.RcIGlq_toggle[data-moved][aria-checked=false] .RcIGlq_toggleThumb{animation:.35s cubic-bezier(.34,1.45,.64,1) both RcIGlq_toggle-off}@keyframes RcIGlq_toggle-on{0%{translate:0}55%{translate:calc(var(--toggle-travel) + var(--toggle-overshoot)) 0}80%,to{translate:var(--toggle-travel) 0}}@keyframes RcIGlq_toggle-off{0%{translate:var(--toggle-travel) 0}55%{translate:calc(0px - var(--toggle-overshoot)) 0}80%,to{translate:0}}.RcIGlq_toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.RcIGlq_toggle:disabled{opacity:.45;cursor:not-allowed}@media (prefers-reduced-motion:reduce){.RcIGlq_card,.RcIGlq_header,.RcIGlq_mark,.RcIGlq_chevron,.RcIGlq_chevronOpen,.RcIGlq_rangeBubble,.RcIGlq_selectChevron,.RcIGlq_selectChevronOpen,.RcIGlq_selectPopup,.RcIGlq_toggleTrack,.RcIGlq_toggleThumb{transition:none}.RcIGlq_toggle[data-moved] .RcIGlq_toggleThumb{animation:none}.RcIGlq_disclosure{transition-property:opacity}}";
		const tagId$1 = "@linxin666/dsh-client-ui-market/packages/dsh-market/src/client/settings-card.module.css";
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
			"cardNested": "RcIGlq_cardNested",
			"cardOpen": "RcIGlq_cardOpen",
			"chevron": "RcIGlq_chevron",
			"chevronOpen": "RcIGlq_chevronOpen",
			"control": "RcIGlq_control",
			"description": "RcIGlq_description",
			"disclosure": "RcIGlq_disclosure",
			"failed": "RcIGlq_failed",
			"field": "RcIGlq_field",
			"head": "RcIGlq_head",
			"headText": "RcIGlq_headText",
			"header": "RcIGlq_header",
			"headerAction": "RcIGlq_headerAction",
			"headerStatic": "RcIGlq_headerStatic",
			"hint": "RcIGlq_hint",
			"input": "RcIGlq_input",
			"inputInvalid": "RcIGlq_inputInvalid",
			"invalid": "RcIGlq_invalid",
			"label": "RcIGlq_label",
			"mark": "RcIGlq_mark",
			"name": "RcIGlq_name",
			"notExposed": "RcIGlq_notExposed",
			"rangeAnchor": "RcIGlq_rangeAnchor",
			"rangeBubble": "RcIGlq_rangeBubble",
			"rangeEnds": "RcIGlq_rangeEnds",
			"rangeSlider": "RcIGlq_rangeSlider",
			"readOnly": "RcIGlq_readOnly",
			"reset": "RcIGlq_reset",
			"segment": "RcIGlq_segment",
			"segmentGroup": "RcIGlq_segmentGroup",
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
			"selectWrap": "RcIGlq_selectWrap",
			"settings-card": "RcIGlq_settings-card",
			"toggle": "RcIGlq_toggle",
			"toggle-off": "RcIGlq_toggle-off",
			"toggle-on": "RcIGlq_toggle-on",
			"toggleThumb": "RcIGlq_toggleThumb",
			"toggleTrack": "RcIGlq_toggleTrack"
		};
		//#endregion
		//#region src/client/RangeBubble.tsx
		/**
		* Coarse adjustment for a bounded number: resting the pointer on the control
		* (or moving focus into it) raises a small bubble holding a slider across the
		* field's whole range, so a large change is one drag instead of many presses
		* or a retyped value. The control itself stays the precise entry.
		*
		* The bubble belongs to the anchor's subtree, so moving from the control onto
		* the bubble never counts as leaving. It opens after a short rest and closes a
		* moment after the pointer and focus have both gone, so crossing the control
		* on the way elsewhere does not flash it. While a drag is in progress the
		* bubble stays put even if the pointer strays off it.
		*
		* Dragging reports each value through `onInput`, so the field shows it live;
		* releasing the thumb, or a key press on it, reports `onCommit` once. The
		* bubble opens on the side of the control that has room inside the nearest
		* scrolling ancestor, so a row near the top of a settings page does not hang
		* its bubble under the page edge.
		*/
		//#endregion
		//#region src/client/SegmentGroup.tsx
		/**
		* The family's segmented control: a quiet track whose options share one
		* highlight that slides to the pressed option, instead of each option fading
		* its own background out and the next one in. The settings fields' small
		* choices and the Web Extensions TAB strip both render through it, so the two
		* read as one control.
		*
		* The caller builds the option buttons and marks the pressed one with
		* `data-active`; the group measures that button after every render and writes
		* its box as four custom properties, and the stylesheet draws the highlight
		* there (`.segmentGroup[data-pill]::before`). Attribute and first placement
		* land in the same task, so the highlight appears in place and only later
		* changes slide. A ResizeObserver re-measures when the group or an option
		* changes size: a longer locale, a font arriving, a container growing, a
		* strip wrapping onto a second line.
		*/
		/** The attribute marking a group whose highlight has been placed. */
		const PILL_ATTR = "data-pill";
		/** The pressed option, relative to the group. */
		const ACTIVE_SELECTOR = ":scope > [data-active]";
		const PILL_PROPERTIES = [
			"--segment-pill-x",
			"--segment-pill-y",
			"--segment-pill-w",
			"--segment-pill-h"
		];
		/**
		* Write the highlight's box from the pressed option's box, or take the
		* highlight off when nothing is pressed or the group has no layout yet.
		* The two boxes are read in viewport pixels and turned back into the group's
		* own CSS pixels, so a dialog that opens through a scale transform still
		* lands the highlight on its option.
		*/
		function placePill(group) {
			const item = group.querySelector(ACTIVE_SELECTOR);
			const box = group.getBoundingClientRect();
			if (item === null || group.offsetWidth === 0 || box.width === 0) {
				group.removeAttribute(PILL_ATTR);
				for (const property of PILL_PROPERTIES) group.style.removeProperty(property);
				return;
			}
			const scale = box.width / group.offsetWidth;
			const itemBox = item.getBoundingClientRect();
			[
				(itemBox.left - box.left) / scale - group.clientLeft,
				(itemBox.top - box.top) / scale - group.clientTop,
				itemBox.width / scale,
				itemBox.height / scale
			].forEach((value, index) => {
				group.style.setProperty(PILL_PROPERTIES[index], `${Math.round(value * 100) / 100}px`);
			});
			if (!group.hasAttribute(PILL_ATTR)) group.setAttribute(PILL_ATTR, "");
		}
		/**
		* Render a segmented track around the caller's option buttons.
		* @param props - the track's attributes (role, accessible name, key handler) and its options.
		* @returns the track.
		*/
		function SegmentGroup(props) {
			const { children, className, ...rest } = props;
			const group = (0, react.useRef)(null);
			const count = react.Children.count(children);
			(0, react.useLayoutEffect)(() => {
				if (group.current !== null) placePill(group.current);
			});
			(0, react.useLayoutEffect)(() => {
				const element = group.current;
				if (element === null || typeof ResizeObserver === "undefined") return void 0;
				const observer = new ResizeObserver(() => {
					placePill(element);
				});
				observer.observe(element);
				for (const item of Array.from(element.children)) observer.observe(item);
				return () => {
					observer.disconnect();
				};
			}, [count]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				...rest,
				ref: group,
				className: className === void 0 ? settings_card_module_css_default.segmentGroup : `${settings_card_module_css_default.segmentGroup} ${className}`,
				children
			});
		}
		//#endregion
		//#region src/client/PluginSettingsCard.tsx
		/**
		* Family-shared chrome for plugin settings cards: a disclosure header naming
		* the plugin and what its settings govern, the controls inside, and the line
		* that reports a refused write. A pick is written the moment it is made and a
		* typed value after a pause, so the card has no save button and nothing waits
		* on the reader. Renders nothing while the namespace is unavailable — a
		* deployment that does not compose the owning plugin should show no trace of
		* it. Inlined into each consumer's client bundle; mirrors the official
		* ui-plugin-config PluginCard in a self-contained slice.
		*
		* Every field inside the body is one settings row: the label and its hint on
		* the left, the control on the right, a hairline between two rows; a narrow
		* card stacks the control under the text (settings-card.module.css).
		*/
		/**
		* What a text field inside a card reaches without its plugin wiring it: write
		* the pending draft now (Enter, leaving the field) or put it back (Escape).
		* Picks need neither; they are written the moment they are made.
		*/
		const CardApply = (0, react.createContext)(null);
		/** Length of the body's disclosure motion; it matches `--settings-card-motion` on the card root. */
		const BODY_MOTION_MS = 180;
		/**
		* Render one plugin settings card.
		* @param props - the plugin's copy keys, its form state, and its controls.
		* @returns the card, or nothing while the namespace is still loading.
		*/
		function PluginSettingsCard(props) {
			const [open, setOpen] = (0, react.useState)(props.defaultOpen ?? true);
			const { state, alwaysOpen } = props;
			const expanded = alwaysOpen === true || open;
			const [bodyPhase, setBodyPhase] = (0, react.useState)(expanded ? "shown" : "hidden");
			const bodyRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				if (expanded) {
					if (bodyPhase === "hidden") setBodyPhase("collapsed");
					else if (bodyPhase === "collapsed") {
						const node = bodyRef.current;
						if (node !== null) node.offsetHeight;
						setBodyPhase("entering");
					} else if (bodyPhase === "closing") setBodyPhase("entering");
					return;
				}
				if (bodyPhase === "collapsed") setBodyPhase("hidden");
				else if (bodyPhase === "entering" || bodyPhase === "shown") setBodyPhase("closing");
			}, [expanded, bodyPhase]);
			(0, react.useEffect)(() => {
				if (bodyPhase !== "entering" && bodyPhase !== "closing") return;
				const timer = setTimeout(() => {
					setBodyPhase(bodyPhase === "entering" ? "shown" : "hidden");
				}, BODY_MOTION_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [bodyPhase]);
			if (!state.available) return null;
			const title = props.t(props.titleKey);
			const description = props.t(props.descriptionKey);
			const descriptionTitle = props.descriptionTitleKey === void 0 ? description : props.t(props.descriptionTitleKey);
			const baseClass = expanded ? `${settings_card_module_css_default.cardOpen} ${settings_card_module_css_default.card}` : settings_card_module_css_default.card;
			const cardClass = props.density === "nested" ? `${baseClass} ${settings_card_module_css_default.cardNested}` : baseClass;
			/** The body region both legs share; a hidden phase renders nothing at all. */
			const bodyRegion = (content) => bodyPhase === "hidden" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: settings_card_module_css_default.disclosure,
				"data-state": bodyPhase,
				ref: bodyRef,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: settings_card_module_css_default.body,
					children: content
				})
			});
			const header = alwaysOpen === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.headerStatic,
				children: [
					props.icon !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.mark,
						"aria-hidden": "true",
						children: props.icon
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: settings_card_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.name,
							id: props.titleId,
							title,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.description,
							title: descriptionTitle,
							children: props.descriptionNode ?? description
						})]
					}),
					props.headerAction !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.headerAction,
						children: props.headerAction
					}) : null
				]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: settings_card_module_css_default.header,
				"aria-expanded": open,
				"aria-label": `${props.t(open ? "settings.collapse" : "settings.expand")}: ${title}`,
				onClick: () => {
					setOpen(!open);
				},
				children: [
					props.icon !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.mark,
						"aria-hidden": "true",
						children: props.icon
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: settings_card_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.name,
							id: props.titleId,
							title,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.description,
							title: descriptionTitle,
							children: props.descriptionNode ?? description
						})]
					}),
					props.headerAction !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.headerAction,
						children: props.headerAction
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
			const notExposedNotice = state.exposed || props.hideNotExposedNotice === true ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: settings_card_module_css_default.notExposed,
				role: "status",
				children: props.t("settings.notExposed")
			});
			if (!state.exposed && props.renderChildrenWhenNotExposed !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, bodyRegion(notExposedNotice)]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, props.headerOnly !== true ? bodyRegion(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					notExposedNotice,
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.readOnly,
						role: "status",
						children: props.t("settings.readOnly")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardApply.Provider, {
						value: {
							commit: props.onSave,
							revert: props.onDiscard
						},
						children: props.children
					}),
					props.hideFooter !== true && state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: settings_card_module_css_default.failed,
						role: "status",
						children: [props.t("settings.saveFailed"), state.failedReason ? " - " + state.failedReason : ""]
					}) : null
				] })) : null]
			});
		}
		/**
		* A boolean toggle drawn as a switch track, for a setting that is only on or
		* off and applies on flip. It is a real button with
		* `role="switch"` and `aria-checked`, so keyboard and assistive activation
		* arrive as a click and the state is announced instead of inferred from a
		* checkbox tick.
		*
		* The thumb bounces across only once the reader has pressed this switch: the
		* press writes the mark that arms the bounce, so a page opening, a TAB
		* switching back or a value arriving from elsewhere draws every thumb at rest.
		*/
		function ToggleSwitch(props) {
			const [moved, setMoved] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: settings_card_module_css_default.toggle,
				role: "switch",
				"aria-checked": props.checked,
				"aria-labelledby": props.labelledBy,
				"aria-label": props.labelledBy === void 0 ? props.ariaLabel : void 0,
				disabled: props.disabled,
				"data-moved": moved ? "" : void 0,
				onClick: () => {
					setMoved(true);
					props.onChange(!props.checked);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.toggleTrack,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: settings_card_module_css_default.toggleThumb })
				})
			});
		}
		/** A boolean field, edited through true/false draft text. */
		function booleanField(field) {
			return {
				field,
				entry: "pick",
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
		* Applies one card's edits to one settings namespace as the reader makes them.
		*
		* The Host is the only authority on whether a value was accepted — its
		* validators own the constraints no schema can express — so the outcome is
		* read back from the section rather than predicted here. A write that did not
		* land puts each pick back to the stored value, the way a switch that could not
		* flip springs back, and keeps typed text so the reader can correct it instead
		* of retyping.
		*/
		var CardForm = class {
			scope;
			specs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			/** The form subscription installed in the constructor; released by dispose(). */
			disposeForm;
			disposed = false;
			/** The pending write of typed text, waiting for typing to pause. */
			typePause;
			saving = false;
			/** A save asked for while one was in flight; it runs once the first settles (#1754). */
			saveQueued = false;
			failed = false;
			failedReason;
			/** @param scope - the bound configuration form for this card's namespace. */
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.disposeForm = scope.subscribe(() => {
					this.publish();
				});
			}
			/**
			* Release the form subscription and every bound store listener. The card
			* must call this on teardown; later calls are no-ops.
			*/
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				clearTimeout(this.typePause);
				this.disposeForm();
				this.listeners.clear();
			}
			/** Publish a projection of this form, rebuilt whenever the form or a draft changes. */
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Read the card-level state: what the Host serves, and what is still waiting to be written. */
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
						this.applyNow();
					},
					discard: () => {
						clearTimeout(this.typePause);
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.failedReason = void 0;
						this.publish();
					}
				};
			}
			/**
			* Run one write, and re-run it once if another was asked for while this one
			* was still in flight.
			*
			* A write is a Host round trip that also drives the profile reconcile, and
			* the Host runs it inside one exclusive transaction. Answering an edit that
			* arrives mid-flight by returning immediately dropped it with no explanation
			* (#1754). Serializing instead means an edit made while another write is
			* still settling is written against the settled state.
			* @returns settlement after the mutation and the read-back.
			*/
			async requestSave() {
				if (this.saving) {
					this.saveQueued = true;
					return;
				}
				await this.save();
				if (!this.saveQueued) return;
				this.saveQueued = false;
				await this.requestSave();
			}
			/**
			* Write every valid draft in one atomic form mutation, then re-seed from
			* what the Host accepted. A draft the field does not accept stays on screen,
			* unwritten, without holding the others back.
			*
			* The batch rides one mutate, so cross-field validate hooks (baseURL+model)
			* judge it as a unit: the Host either applies every write or refuses the
			* batch. The form contract answers a refusal or a skipped write with `false`
			* (it recovers with a fresh Host view instead of throwing), so the outcome is
			* judged twice: the answer itself, and then the settled snapshot read back
			* one planned write at a time. One missed write fails the whole batch. A
			* transport that rejects instead (the dsh-web bridge controller on a dead
			* connection) reports through the same failure path with its rejection
			* message. A batch that did not land puts its picks and clears back to the
			* stored value and keeps its typed text, so the reader can correct it.
			* @returns settlement after the mutation and the read-back.
			*/
			async save() {
				const valid = this.plan().filter((item) => item.judge !== void 0);
				if (valid.length === 0 || this.saving) return;
				const pending = /* @__PURE__ */ new Map();
				for (const item of valid) pending.set(item.field, this.staged.get(item.field));
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
				let accepted = false;
				try {
					accepted = await this.scope.mutate(ops);
				} catch (error) {
					failedReason = error instanceof Error ? error.message : String(error);
				}
				const landed = accepted && failedReason === void 0 && valid.every((item) => item.judge());
				for (const [field, before] of pending) {
					if (this.staged.get(field) !== before) continue;
					if (landed || before === void 0 || before.clear || this.specOf(field).entry === "pick") this.staged.delete(field);
				}
				this.saving = false;
				this.failed = !landed;
				this.failedReason = failedReason;
				this.publish();
			}
			/**
			* Every staged edit a write would carry. An entry whose draft is not a value
			* its field accepts carries no write: the form is still dirty, and the draft
			* stays on screen rather than being dropped. A staged edit that matches the
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
			/**
			* Take one edit and schedule its write: a pick or a clear is written now,
			* typed text once typing has rested for TYPE_PAUSE_MS.
			*/
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
				if (edit.clear || this.specOf(field).entry === "pick") {
					this.applyNow();
					return;
				}
				clearTimeout(this.typePause);
				this.typePause = setTimeout(() => {
					this.applyNow();
				}, 600);
			}
			/** Write every pending draft now, taking the place of a waiting pause. */
			applyNow() {
				clearTimeout(this.typePause);
				this.typePause = void 0;
				if (this.disposed) return;
				this.requestSave();
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
		let snapshot$1 = {
			face: null,
			version: 0
		};
		const listeners$1 = /* @__PURE__ */ new Set();
		/** Replace the held face and notify subscribers. */
		function setFace(face) {
			snapshot$1 = {
				face,
				version: snapshot$1.version + 1
			};
			for (const listener of listeners$1) listener();
		}
		/** Current bridge snapshot (cached reference, safe for useSyncExternalStore). */
		function getPluginManagerSnapshot() {
			return snapshot$1;
		}
		/** Subscribe to face changes; returns the unsubscribe function. */
		function subscribePluginManager(listener) {
			listeners$1.add(listener);
			return () => {
				listeners$1.delete(listener);
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
		/**
		* The installed dependency name the official Plugins page addresses for one
		* entry: the installed row's own id when the entry is installed, else the
		* entry's npm package name without its version/tag suffix, else its id.
		* @param entry - one store plugin entry.
		* @param installed - the installed-row snapshot (may be empty).
		* @returns the package name to hand to `pluginNavigation.openBundle`.
		*/
		function managePackageName(entry, installed) {
			const row = entryInstalled(entry, installed);
			if (row !== null) return row.id;
			return entry.npm === void 0 ? entry.id : stripVersion(entry.npm);
		}
		//#endregion
		//#region src/client/native-plugin-faces.ts
		let snapshot = {
			manager: null,
			navigation: null,
			version: 0
		};
		const listeners = /* @__PURE__ */ new Set();
		/** Merge one face change into the snapshot and notify subscribers. */
		function patchFaces(patch) {
			snapshot = {
				manager: patch.manager === void 0 ? snapshot.manager : patch.manager,
				navigation: patch.navigation === void 0 ? snapshot.navigation : patch.navigation,
				version: snapshot.version + 1
			};
			for (const listener of listeners) listener();
		}
		/** Current native-faces snapshot (cached reference, safe for useSyncExternalStore). */
		function getNativePluginFaces() {
			return snapshot;
		}
		/** Subscribe to face changes; returns the unsubscribe function. */
		function subscribeNativePluginFaces(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/**
		* Bridge both official faces into the module store. Uses ctx.inject (NOT the
		* plugin's module-level inject array) so each face stays optional: the inner
		* callback runs when the official plugin provides it and is disposed when it
		* goes away, which clears the store.
		* @param ctx - the client root context.
		*/
		function bridgeNativePluginFaces(ctx) {
			ctx.inject(["remote.pluginManager"], (inner) => {
				inner.effect(() => {
					patchFaces({ manager: inner.get("remote.pluginManager") ?? null });
					return () => {
						patchFaces({ manager: null });
					};
				}, "dsh-web-ui-market: official pluginManager bridge");
			});
			ctx.inject(["pluginNavigation"], (inner) => {
				inner.effect(() => {
					patchFaces({ navigation: inner.get("pluginNavigation") ?? null });
					return () => {
						patchFaces({ navigation: null });
					};
				}, "dsh-web-ui-market: official pluginNavigation bridge");
			});
		}
		/**
		* Install one spec through the official manager, surfacing a refusal as a
		* thrown error. The manager owns registry resolution, the profile lock and
		* bundle activation; this store only reports what it answered.
		* @param manager - the official remote face.
		* @param spec - validated install spec.
		* @param requestId - id the run is tracked under (also the UI's install key).
		*/
		async function installViaOfficialManager(manager, spec, requestId) {
			const result = await manager.installBundle(spec, {
				enabled: true,
				requestId
			});
			if (result !== null && typeof result === "object" && result.ok === false) {
				const error = result.error;
				throw new Error(error?.message ?? error?.code ?? "plugin-manager: official install failed");
			}
		}
		//#endregion
		//#region src/client/filter.ts
		/** Keep items whose category matches; 'all' keeps everything. */
		function byCategory(items, cat) {
			if (cat === "all") return [...items];
			return items.filter((it) => (it.category ?? "other") === cat);
		}
		/** Keep items whose subcategory matches; 'all' keeps everything. */
		function bySubcategory(items, subcat) {
			if (subcat === "all") return [...items];
			return items.filter((it) => it.subcategory === subcat);
		}
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
		/** Preset category → second-level ids; a category with no list renders one row. */
		const PRESET_SUBCATEGORY_IDS = { roleplay: [] };
		/** Locale-key lookup for preset category ids (shares the plugin category keys). */
		const PRESET_CATEGORY_LABEL_KEY = {
			roleplay: "category.roleplay",
			other: "category.other"
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
		const css = ".bkhjFa_market{flex-direction:column;gap:10px;display:flex}.bkhjFa_tabs{align-self:stretch;display:flex}.bkhjFa_tabs>.bkhjFa_tab{text-align:center;flex:1 1 0;min-width:max-content}.bkhjFa_tabCount{opacity:.72;font-variant-numeric:tabular-nums;margin-left:6px;font-size:12px}.bkhjFa_toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.bkhjFa_toolbar:empty{display:none}.bkhjFa_search{min-width:0;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;flex:240px;padding:6px 10px;font-size:13px;line-height:1.5}.bkhjFa_search::placeholder{color:var(--dsw-alias-label-tertiary)}.bkhjFa_search:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.bkhjFa_grid{grid-template-columns:repeat(auto-fill,minmax(min(272px,100%),1fr));gap:10px;margin:4px 0 0;padding:0;list-style:none;display:grid}.bkhjFa_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;gap:10px;min-width:0;padding:12px;display:flex}.bkhjFa_card:hover{border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_thumb{object-fit:cover;background:var(--dsw-alias-bg-layer-2);border-radius:6px;flex:none;place-items:center;width:72px;height:72px;display:grid}.bkhjFa_cardBody{flex-direction:column;flex:1;gap:6px;min-width:0;display:flex}.bkhjFa_cardName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}.bkhjFa_cardVersion{color:var(--dsw-alias-label-tertiary);margin-left:6px;font-size:11px;font-weight:400}.bkhjFa_cardMeta{color:var(--dsw-alias-label-tertiary);white-space:nowrap;align-items:center;gap:6px;font-size:12px;line-height:1.4;display:flex;overflow:hidden}.bkhjFa_badge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);white-space:nowrap;border-radius:999px;flex:none;padding:0 8px;font-size:11px;line-height:1.6}.bkhjFa_badgeInstalled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}.bkhjFa_metrics{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-wrap:wrap;gap:4px 10px;font-size:11px;line-height:1.5;display:flex}.bkhjFa_cardDesc{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;overflow-wrap:anywhere;-webkit-box-orient:vertical;margin:0;font-size:13px;line-height:1.45;display:-webkit-box;overflow:hidden}.bkhjFa_cardFooter{flex-direction:column;gap:8px;margin-top:auto;padding-top:8px;display:flex}.bkhjFa_actionRow{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like,.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_previewLink{font:inherit;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:999px;align-items:center;padding:1px 10px;font-size:12px;line-height:1.5;text-decoration:none;display:inline-flex}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like{font-variant-numeric:tabular-nums}.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_like:hover:enabled,.bkhjFa_market .bkhjFa_actionRow>.bkhjFa_previewLink:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_actionRowPrimary{align-items:stretch;gap:8px;display:flex}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_install{min-width:0;font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:1 1 0;justify-content:center;align-items:center;min-height:30px;padding:4px 14px;font-size:12px;font-weight:600;line-height:1.5;display:inline-flex}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_install:hover:enabled{border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);flex-grow:2}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary:hover:enabled{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}.bkhjFa_market .bkhjFa_actionRowPrimary>.bkhjFa_installPrimary:disabled{opacity:.55;cursor:default}.bkhjFa_error{color:var(--dsw-alias-label-error,#c53030);margin:0;font-size:12px;line-height:1.4}.bkhjFa_market .bkhjFa_bulkRow{flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto;display:flex}.bkhjFa_market .bkhjFa_bulkButton,.bkhjFa_market .bkhjFa_bulkArmed,.bkhjFa_market .bkhjFa_bulkCancel{font:inherit;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:6px;padding:3px 10px;font-size:12px;line-height:1.6}.bkhjFa_market .bkhjFa_bulkButton:hover:not(:disabled),.bkhjFa_market .bkhjFa_bulkCancel:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.bkhjFa_market .bkhjFa_bulkButton:disabled,.bkhjFa_market .bkhjFa_bulkArmed:disabled{opacity:.55;cursor:default}.bkhjFa_market .bkhjFa_bulkArmed{border-color:var(--dsw-alias-state-danger-primary,#d93025);background:var(--dsw-alias-state-danger-primary,#d93025);color:#fff}.bkhjFa_market .bkhjFa_bulkNote,.bkhjFa_market .bkhjFa_bulkNoteWarn{margin:4px 0 0;font-size:12px;line-height:1.4}.bkhjFa_market .bkhjFa_bulkNote{color:var(--dsw-alias-state-success-primary)}.bkhjFa_market .bkhjFa_bulkNoteWarn{color:var(--dsw-alias-label-warning,#b06000)}.bkhjFa_callout{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:1.4}.bkhjFa_filterRows{flex-direction:column;gap:6px;display:flex}.bkhjFa_filterRow{flex-wrap:wrap;gap:6px;display:flex}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip{font:inherit;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:999px;padding:2px 10px;font-size:12px;line-height:1.6}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip:hover:enabled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipSub{color:var(--dsw-alias-label-tertiary);border-style:dashed;font-size:11px}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipOn{color:var(--dsw-alias-bg-layer-3);background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);border-style:solid;font-weight:600}.bkhjFa_market .bkhjFa_filterRow>button.bkhjFa_filterChip.bkhjFa_filterChipOn:hover:enabled{color:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-label-primary)}.bkhjFa_filterCount{opacity:.72;margin-left:6px;font-size:11px}.bkhjFa_empty{color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;font-size:13px;display:flex}.bkhjFa_retry{padding:3px 10px;font-size:12px}.bkhjFa_remoteNote{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.4}.bkhjFa_modalActions{justify-content:flex-end;gap:8px;margin-top:10px;display:flex}";
		const tagId = "@linxin666/dsh-client-ui-market/packages/dsh-market/src/client/market.module.css";
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
			"bulkArmed": "bkhjFa_bulkArmed",
			"bulkButton": "bkhjFa_bulkButton",
			"bulkCancel": "bkhjFa_bulkCancel",
			"bulkNote": "bkhjFa_bulkNote",
			"bulkNoteWarn": "bkhjFa_bulkNoteWarn",
			"bulkRow": "bkhjFa_bulkRow",
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
			"tabCount": "bkhjFa_tabCount",
			"tabs": "bkhjFa_tabs",
			"thumb": "bkhjFa_thumb",
			"toolbar": "bkhjFa_toolbar"
		};
		//#endregion
		//#region src/client/MarketCard.tsx
		/**
		* The market card: a first-level settings section that browses
		* dsh-market.com (skins / pets / community plugins), ranks entries by
		* device-backed likes, and offers one-click install — assets land in the
		* DSH home directories through the host gateway, while plugins go through the
		* official in-process plugin manager's remote face when the host publishes it
		* (the same call the official Plugins page makes), fall back to the family
		* pluginManager service otherwise, and hand management of an installed plugin
		* over to the official Plugins page instead of re-implementing it.
		*/
		const MARKET_ORIGIN = "https://dsh-market.com";
		/** Bridges the market config form onto the card's staged form. */
		var MarketCardController = class {
			form;
			store;
			/** @param scope - the bound configuration form of the market card's settings entry. */
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
			/**
			* Build the face the card's slot registration injects.
			* @param openExternal - the shell-bound external-link opener.
			*/
			inject(openExternal) {
				return {
					hooks: { marketCard: this.store },
					openExternal,
					...this.form.actions()
				};
			}
			/** Release the form subscription; the slot disposer calls this on teardown. */
			dispose() {
				this.form.dispose();
			}
		};
		const KIND_LABEL = {
			skin: "tab.skin",
			pet: "tab.pet",
			plugin: "tab.plugin",
			preset: "tab.preset"
		};
		/** Tab order: the curated picks category leads the catalog kinds. */
		const TAB_ORDER = [
			"picks",
			"skin",
			"pet",
			"plugin",
			"preset"
		];
		const TAB_LABEL = {
			picks: "tab.picks",
			...KIND_LABEL
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
			const { t, renderSlot } = props;
			const state = props.useMarketCard((snapshot) => snapshot);
			const disabled = !state.writable;
			const cardVisible = state.enabled.text !== "false";
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
				pets: [],
				presets: []
			});
			const [installing, setInstalling] = (0, react.useState)(null);
			const [conflict, setConflict] = (0, react.useState)(null);
			const [copiedId, setCopiedId] = (0, react.useState)(null);
			const [callouts, setCallouts] = (0, react.useState)({});
			const [pluginList, setPluginList] = (0, react.useState)(null);
			const [pluginErrors, setPluginErrors] = (0, react.useState)({});
			const [npmDownloads, setNpmDownloads] = (0, react.useState)({});
			const likeSeq = (0, react.useRef)(/* @__PURE__ */ new Map());
			const [installAllArmed, setInstallAllArmed] = (0, react.useState)(false);
			const [installAll, setInstallAll] = (0, react.useState)(null);
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
					fetchJson("https://dsh-market.com/manifest/presets.json").catch(() => ({ items: [] })),
					fetchJson("https://dsh-market.com/api/stats"),
					fetchJsonOptional("https://dsh-market.com/manifest/editor-picks.json"),
					downloadsLoader()
				]).then(([skins, pets, plugins, presets, stats, picks, downloads]) => {
					if (!alive) return;
					const s = stats ?? {
						skin: {},
						pet: {},
						plugin: {},
						preset: {}
					};
					setData({
						items: {
							skin: skins.items ?? [],
							pet: pets.items ?? [],
							plugin: plugins.items ?? [],
							preset: presets.items ?? []
						},
						stats: {
							skin: s.skin ?? {},
							pet: s.pet ?? {},
							plugin: s.plugin ?? {},
							preset: s.preset ?? {},
							installs: s.installs ?? void 0
						},
						picks: picks?.items ?? []
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
				let alive = true;
				const gatewayClient = {
					async install(kind, id, force) {
						const res = await fetch("api/market/install-" + kind, {
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
						const r = await fetchJson("api/market/installed");
						return {
							skins: r.skins ?? [],
							pets: r.pets ?? [],
							presets: r.presets ?? []
						};
					}
				};
				(props.gateway ?? gatewayClient).list().then((list) => {
					if (!alive) return;
					setInstalled(list);
					setLiveGateway(props.gateway ?? gatewayClient);
				}).catch(() => {
					if (alive && props.gateway === void 0) setLiveGateway(null);
				});
				return () => {
					alive = false;
				};
			}, [props.gateway]);
			const gateway = props.gateway !== void 0 ? props.gateway : liveGateway ?? null;
			const bridge = (0, react.useSyncExternalStore)(subscribePluginManager, getPluginManagerSnapshot);
			const face = props.pluginManager !== void 0 ? props.pluginManager : bridge.face;
			const faceLoopback = face !== null && face.isLoopback;
			const nativeFaces = (0, react.useSyncExternalStore)(subscribeNativePluginFaces, getNativePluginFaces);
			const nativeManager = props.nativePluginManager !== void 0 ? props.nativePluginManager : nativeFaces.manager;
			const pluginNavigation = props.pluginNavigation !== void 0 ? props.pluginNavigation : nativeFaces.navigation;
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
					plugin: {},
					preset: {}
				})[kind][id] ?? 0;
			};
			const installsOf = (kind, id) => {
				return (data?.stats?.installs ?? {
					skin: {},
					pet: {},
					plugin: {},
					preset: {}
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
			const facetKind = tab === "plugin" || tab === "preset" ? tab : null;
			const facetItems = facetKind === null ? [] : data?.items[facetKind] ?? [];
			const facetVocab = facetKind === "preset" ? {
				labelKey: PRESET_CATEGORY_LABEL_KEY,
				subIds: PRESET_SUBCATEGORY_IDS
			} : {
				labelKey: CATEGORY_LABEL_KEY,
				subIds: SUBCATEGORY_IDS
			};
			const facetSubs = cat === "all" ? [] : subcategoryCounts(facetItems, cat, facetVocab.subIds[cat]);
			const categoryLabel = (id) => facetVocab.labelKey[id] ? t(facetVocab.labelKey[id]) : id;
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
										plugin: {},
										preset: {}
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
						await fetch("api/skin-center/v2/active", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ active: id })
						});
						if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dsh-skin-applied", { detail: { id } }));
					} catch {}
				} catch (err) {
					const code = err.code;
					if (code === "conflict" && !force) setConflict({
						kind,
						id,
						dest: err.dest ?? id
					});
					else if (code === "blocked") callout(id, t("installBlocked"));
					else callout(id, t("installFailed", { reason: messageOf(err) }));
				} finally {
					setInstalling(null);
				}
			};
			/**
			* Install every published skin this machine does not have yet, then report
			* the whole run to the market as ONE event.
			*
			* The downloads go through the same loopback gateway one at a time, so each
			* asset keeps its own progress, its own failure and its own integrity
			* write. Only the reporting is aggregated: a bulk install is one user
			* gesture, so it costs one Turnstile challenge and one request rather than
			* one per asset, and the per-asset counters it produces are the same rows a
			* run of single installs would have written.
			*/
			/** Published skins this machine does not have yet, in catalog order. */
			const missingInstallCount = () => {
				const have = new Set(installed.skins);
				return (data?.items.skin ?? []).filter((item) => !have.has(item.id)).length;
			};
			const onInstallAll = async () => {
				if (gateway === null) return;
				setInstallAllArmed(false);
				setInstallAll({
					phase: "checking",
					done: 0,
					total: 0,
					failed: 0,
					reported: 0,
					note: ""
				});
				const published = (data?.items.skin ?? []).map((item) => item.id);
				const have = new Set(installed.skins);
				const missing = published.filter((id) => !have.has(id));
				if (missing.length === 0) {
					setInstallAll({
						phase: "idle",
						done: 0,
						total: 0,
						failed: 0,
						reported: 0,
						note: t("installAllNone", {})
					});
					return;
				}
				if (!installAllArmed) {
					setInstallAll({
						phase: "idle",
						done: 0,
						total: 0,
						failed: 0,
						reported: 0,
						note: ""
					});
					setInstallAllArmed(true);
					return;
				}
				let done = 0;
				let failed = 0;
				const landed = [];
				for (const id of missing) {
					setInstallAll({
						phase: "running",
						done,
						total: missing.length,
						failed,
						reported: 0,
						note: ""
					});
					try {
						await gateway.install("skin", id, false);
						landed.push(id);
					} catch {
						failed++;
					}
					done++;
				}
				try {
					setInstalled(await gateway.list());
				} catch {}
				let reported = 0;
				if (landed.length > 0) try {
					const counts = await reportInstallBatch("skin", landed);
					reported = Object.keys(counts).length;
					setData((prev) => prev ? {
						...prev,
						stats: {
							...prev.stats,
							installs: {
								...prev.stats.installs ?? {
									skin: {},
									pet: {},
									plugin: {},
									preset: {}
								},
								skin: {
									...prev.stats.installs?.skin ?? {},
									...counts
								}
							}
						}
					} : prev);
				} catch {}
				setInstallAll({
					phase: "idle",
					done,
					total: missing.length,
					failed,
					reported,
					note: failed === 0 ? t("installAllDone", { count: done }) : t("installAllFailed", { count: failed })
				});
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
				const manager = nativeManager;
				const requestId = window.crypto.randomUUID ? window.crypto.randomUUID() : "market-" + id + "-" + Date.now().toString(36);
				(manager != null ? installViaOfficialManager(manager, spec, requestId) : face.install(spec)).then(() => face.list()).then((list) => {
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
										plugin: {},
										preset: {}
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
			const onManagePlugin = (item) => {
				if (pluginNavigation == null) return;
				pluginNavigation.openBundle(managePackageName(item, pluginList ?? []));
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
			/**
			* Report a whole bulk install as ONE request.
			*
			* A bulk install is one user gesture, so it must not spend one Turnstile
			* challenge and one round trip per asset. The edge endpoint writes exactly
			* the same per-asset rows and per-asset counts a run of single installs
			* would - it only folds them into one D1 batch - so the public counters are
			* indistinguishable from installing one at a time.
			*/
			const reportInstallBatch = props.reportInstallBatch ?? (async (kind, ids) => {
				if (ids.length === 0) return {};
				const token = await (props.turnstileToken ?? (() => marketTurnstileToken("market-install")))();
				const installId = window.crypto.randomUUID ? window.crypto.randomUUID() : "ins-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
				const res = await fetch(origin + "/api/install-batch", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						kind,
						asset_ids: ids,
						device_fp: deviceFp(),
						install_id: installId,
						turnstile_token: token
					})
				});
				if (!res.ok) throw new Error("HTTP " + res.status);
				return (await res.json()).installs ?? {};
			});
			const chipClass = (isOn, isSub) => {
				const cls = [market_module_css_default.filterChip];
				if (isSub) cls.push(market_module_css_default.filterChipSub);
				if (isOn) cls.push(market_module_css_default.filterChipOn);
				return cls.join(" ");
			};
			/**
			* Resolve the fixed 编辑推荐 references against the loaded catalogs,
			* preserving the editorial order and dropping any reference this
			* deployment cannot resolve.
			*/
			const pickEntries = () => {
				const out = [];
				const seen = /* @__PURE__ */ new Set();
				for (const pick of data?.picks ?? []) {
					const kind = pick.kind;
					if (kind !== "skin" && kind !== "pet" && kind !== "plugin") continue;
					const id = pick.id;
					if (!id || seen.has(kind + ":" + id)) continue;
					const item = (data?.items[kind] ?? []).find((candidate) => candidate.id === id);
					if (!item) continue;
					seen.add(kind + ":" + id);
					out.push({
						kind,
						item
					});
				}
				return out;
			};
			const picks = pickEntries();
			const entries = tab === "picks" ? picks : sorted(tab).filter(matches).map((item) => ({
				kind: tab,
				item
			}));
			const total = tab === "picks" ? picks.length : (data?.items[tab] ?? []).length;
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
						onClick: (event) => {
							event.preventDefault();
							props.openExternal(MARKET_ORIGIN);
						},
						children: t("badge.market")
					}),
					t("settings.descriptionSuffix")
				] }),
				titleId: "settings-market-title",
				headerAction: state.exposed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleSwitch, {
					labelledBy: "settings-market-title",
					checked: cardVisible,
					disabled,
					onChange: (next) => {
						props.edit("enabled", String(next));
					}
				}) : void 0,
				headerOnly: !cardVisible && !state.failed,
				state,
				alwaysOpen: true,
				renderChildrenWhenNotExposed: true,
				hideNotExposedNotice: true,
				onSave: props.save,
				onDiscard: props.discard,
				children: [cardVisible ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: market_module_css_default.market,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegmentGroup, {
							className: market_module_css_default.tabs,
							role: "tablist",
							"aria-label": t("settings.title"),
							children: TAB_ORDER.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab === entry,
								className: `${settings_card_module_css_default.segment} ${market_module_css_default.tab}`,
								"data-active": tab === entry ? "" : void 0,
								onClick: () => {
									setTab(entry);
									setCat("all");
									setSubcat("all");
								},
								children: [t(TAB_LABEL[entry]), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: market_module_css_default.tabCount,
									children: entry === "picks" ? picks.length : (data?.items[entry] ?? []).length
								})]
							}, entry))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: market_module_css_default.toolbar,
							children: [tab === "preset" || tab === "picks" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: market_module_css_default.search,
								type: "search",
								"aria-label": t("search.label"),
								placeholder: t("search.label"),
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}), tab === "skin" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: market_module_css_default.bulkRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: installAllArmed ? market_module_css_default.bulkArmed : market_module_css_default.bulkButton,
									disabled: gateway === null || installing !== null || installAll !== null && installAll.phase === "running",
									onClick: () => {
										onInstallAll();
									},
									children: installAll?.phase === "checking" ? t("installAllChecking", {}) : installAll?.phase === "running" ? t("installAllRunning", {
										done: installAll.done,
										total: installAll.total
									}) : installAllArmed ? t("installAllConfirm", { count: missingInstallCount() }) : t("installAll", {})
								}), installAllArmed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: market_module_css_default.bulkCancel,
									onClick: () => {
										setInstallAllArmed(false);
									},
									children: t("cancel", {})
								}) : null]
							}) : null]
						}),
						installAll !== null && installAll.note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: installAll.failed > 0 ? market_module_css_default.bulkNoteWarn : market_module_css_default.bulkNote,
							children: [installAll.note, installAll.reported > 0 ? " · " + t("installAllSummary", { count: installAll.reported }) : ""]
						}) : null,
						facetKind !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											children: facetItems.length
										})
									]
								}), categoryCounts(facetItems).map(({ id, count }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
							}), cat !== "all" && facetSubs.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											children: facetSubs.reduce((sum, entry) => sum + entry.count, 0)
										})
									]
								}), facetSubs.map(({ id, count }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
						tab === "preset" ? renderSlot("dsh-workshop.panel", {
							items: bySubcategory(byCategory(data?.items.preset ?? [], cat), subcat),
							catalogState: failed ? "error" : loading ? "loading" : "ready",
							gateway: gateway !== null,
							installs: data?.stats.installs?.preset ?? {},
							install: gateway === null ? void 0 : (id, force) => gateway.install("preset", id, force),
							reportInstall: (id) => reportInstall("preset", id)
						}, {
							entryKey: "preset",
							fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: market_module_css_default.empty,
								role: "status",
								children: t("presetPanel.missing")
							})
						}) : failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
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
						}) : entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: market_module_css_default.empty,
							role: "status",
							children: tab === "picks" ? t("picks.empty") : total === 0 ? t("empty") : t("noMatch")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: market_module_css_default.grid,
							children: entries.map(({ kind, item }) => {
								const name = item.name ?? item.displayName ?? item.id;
								const id = item.id;
								const installedHere = kind === "skin" ? installed.skins.includes(id) : kind === "pet" ? installed.pets.includes(id) : entryInstalled(item, pluginList ?? []) !== null;
								const isInstalling = installing === kind + ":" + id || installing === "plugin:" + id;
								const command = kind === "plugin" ? installCommand(item) : "";
								const thumb = kind === "skin" ? item.preview?.light : kind === "pet" ? item.previews?.[0] ?? item.spritesheet : "";
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
												onClick: (event) => {
													event.preventDefault();
													props.openExternal(item.repo ?? MARKET_ORIGIN);
												},
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
												children: [installsOf(kind, id) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installs", { count: formatCount(installsOf(kind, id)) }) }) : null, item.npm && npmDownloads[item.npm] !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("npmDownloads", { count: formatCount(npmDownloads[item.npm] ?? 0) }) }) : null]
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
																onLike(kind, id);
															},
															children: [
																t("like"),
																" ",
																votesOf(kind, id)
															]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: market_module_css_default.previewLink,
															onClick: () => {
																props.openExternal(kind === "skin" ? "https://dsh-market.com/preview.html?skin=" + encodeURIComponent(id) + "&theme=light&chrome=0" : "https://dsh-market.com/");
															},
															children: t("preview")
														}),
														(kind === "plugin" || kind === "skin") && item.repo ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
															className: market_module_css_default.previewLink,
															href: item.repo,
															target: "_blank",
															rel: "noreferrer",
															onClick: (event) => {
																event.preventDefault();
																props.openExternal(item.repo ?? MARKET_ORIGIN);
															},
															children: t("repository")
														}) : null
													]
												}), kind === "plugin" || gateway !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: market_module_css_default.actionRowPrimary,
													children: [
														kind === "plugin" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: market_module_css_default.install,
															title: command,
															onClick: () => {
																copyCommand(id, command);
															},
															children: copiedId === id ? t("copied") : t("copyCommand")
														}) : null,
														kind === "plugin" && faceLoopback && !installedHere ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: market_module_css_default.install + " " + market_module_css_default.installPrimary,
															disabled: installing !== null,
															onClick: () => {
																onInstallPlugin(item);
															},
															children: isInstalling ? t("installing") : t("installNow")
														}) : null,
														kind === "plugin" && installedHere && pluginNavigation != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: market_module_css_default.install,
															onClick: () => {
																onManagePlugin(item);
															},
															children: t("manageInPluginPage")
														}) : null,
														(kind === "skin" || kind === "pet") && gateway !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: market_module_css_default.install + " " + market_module_css_default.installPrimary,
															disabled: installing !== null || installedHere,
															onClick: () => {
																onInstallAsset(kind, id);
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
								}, kind + ":" + id);
							})
						}),
						gateway === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: market_module_css_default.remoteNote,
							children: t("remote.note")
						}) : null
					]
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
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
				})]
			});
		}
		function MarketSection(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-dsh-plugin": "dsh-web-ui-market",
				"data-dsh-part": "panel",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketCard, { ...props })
			});
		}
		//#endregion
		//#region src/client/external-link.ts
		/**
		* External-link opener for the Workshop card, with the official right-sidebar
		* browser as the first seat.
		*
		* alpha.2 registers a `browser` tab type in the right sidebar and the official
		* chat routes an external link there through `sidebarRight.openTab`, falling
		* back to a new browser tab when the type is absent. The store card's market,
		* preview and repository links use the same probe, read through the structural
		* slices below so this package needs no sidebar SDK dependency (the browser
		* half may only type-import official packages).
		*
		* @module @linxin666/dsh-client-ui-market/client/external-link
		*/
		/** The tab kind the official sidebar browser registers. */
		const BROWSER_TAB_KIND = "browser";
		/** Open one URL in a new browser tab: the fallback when no sidebar browser exists. */
		function openInNewTab(url) {
			window.open(url, "_blank", "noopener,noreferrer");
		}
		/**
		* Build the card's external-link opener.
		* @param ctx - client context (its services decide the seat).
		* @param fallback - what to do when the sidebar browser is unavailable; tests inject a recorder.
		* @returns an opener that never throws.
		*/
		function createExternalLinkOpener(ctx, fallback = openInNewTab) {
			return (url) => {
				let registry;
				try {
					registry = ctx.get?.call(ctx, "sidebarRightTabs");
				} catch {
					registry = void 0;
				}
				let declared = false;
				try {
					declared = typeof registry?.get === "function" && registry.get("browser") !== void 0;
				} catch {
					declared = false;
				}
				if (declared && ctx.sidebarRight !== void 0) {
					ctx.sidebarRight.openTab(BROWSER_TAB_KIND, { params: { url } });
					return;
				}
				fallback(url);
			};
		}
		//#endregion
		//#region src/client/settings-entry-form.ts
		/** The snapshot a form reports before the Host has answered with this entry. */
		function pendingSnapshot() {
			return {
				status: "loading",
				value: void 0,
				base: void 0,
				user: void 0,
				revision: void 0,
				writable: false
			};
		}
		/**
		* Create a settings form bound to the profile entry id this Host serves, and
		* rebound whenever the shared describe mirror names a different one of this
		* package's rows.
		* @param options - the shared forms service and this package's candidate row ids.
		* @returns a form delegating to the currently resolved entry's own form.
		*/
		function createServedEntryForm(options) {
			const { forms, entryIds } = options;
			const fallbackId = entryIds[0];
			const namespaceId = entryIds[entryIds.length - 1];
			const listeners = /* @__PURE__ */ new Set();
			let boundId;
			let bound;
			let offBound;
			let snapshot = pendingSnapshot();
			/** Republish: the delegated snapshot when one is bound, the pending one otherwise. */
			const publish = () => {
				if (bound !== void 0) snapshot = bound.getSnapshot();
				for (const listener of [...listeners]) listener();
			};
			/**
			* The entry id the mirror currently justifies. An unanswered or empty mirror
			* is not evidence of absence, so it keeps the first candidate; a mirror that
			* answers without any of this package's rows leaves the namespace itself.
			* @returns the entry id to bind.
			*/
			const resolve = () => {
				let served;
				try {
					served = forms.describe().getSnapshot().view?.namespaces.map((row) => row.ns);
				} catch {
					served = void 0;
				}
				if (served === void 0 || served.length === 0) return fallbackId;
				return entryIds.find((id) => served.includes(id)) ?? namespaceId;
			};
			/** Bind (or rebind) the resolved entry's form; a no-op while it is unchanged. */
			const bind = () => {
				const target = resolve();
				if (target === boundId) return;
				offBound?.();
				offBound = void 0;
				let form;
				try {
					form = forms.get(target);
				} catch {
					boundId = void 0;
					return;
				}
				boundId = target;
				bound = form;
				offBound = form.subscribe(() => {
					publish();
				});
				publish();
			};
			try {
				forms.describe().subscribe(() => {
					bind();
				});
			} catch {}
			bind();
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set: (field, value) => bound?.set(field, value) ?? Promise.resolve(false),
				unset: (field) => bound?.unset(field) ?? Promise.resolve(false),
				mutate: (ops, expectedRevision) => bound?.mutate(ops, expectedRevision) ?? Promise.resolve(false)
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Market card dictionaries. zh is the key source; en mirrors every key.
		*/
		const zh = {
			"settings.collapse": "收起",
			"settings.expand": "展开",
			"settings.notExposed": "这个版本的 DSH 没有开放创意工坊的设置。",
			"settings.readOnly": "设置只读。",
			"settings.saveFailed": "没有保存成功。",
			"settings.title": "创意工坊",
			"settings.description": "从 dsh-market.com 安装皮肤、宠物与社区插件。",
			"settings.descriptionPrefix": "从 ",
			"settings.descriptionSuffix": " 安装皮肤、宠物与社区插件。",
			"tab.picks": "编辑推荐",
			"tab.skin": "皮肤",
			"tab.pet": "宠物",
			"tab.plugin": "插件",
			"tab.preset": "预设",
			"picks.empty": "还没有编辑推荐。",
			"presetPanel.missing": "未安装预设中心插件（@linxin666/dsh-client-ui-preset-center），无法管理社区预设。",
			"search.label": "搜索名称、作者或描述",
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
			"category.roleplay": "角色扮演",
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
			"empty": "没能读到创意工坊清单。",
			"noMatch": "没有匹配的条目",
			"retry": "重试",
			"online": "",
			"offline": "创意工坊数据不可用，请检查网络",
			"install": "安装",
			"installNow": "一键安装",
			"installing": "安装中…",
			"installAll": "全部安装",
			"installAllChecking": "正在检查缺失项…",
			"installAllRunning": "正在安装 {done}/{total}…",
			"installAllConfirm": "确认补装 {count} 款皮肤",
			"installAllDone": "已安装 {count} 款皮肤",
			"installAllNone": "所有皮肤均已安装",
			"installAllFailed": "{count} 款皮肤安装失败",
			"installAllSummary": "已汇总上报 {count} 款安装记录",
			"installed": "已安装",
			"manageInPluginPage": "在插件页管理",
			"installFailed": "安装失败：{reason}",
			"installBlocked": "被 Cloudflare 挑战拦截：请切换网络或关闭代理后重试",
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
			"remote.note": "远程浏览器只能浏览和复制命令，一键安装要在本机浏览器里进行。"
		};
		const en = {
			"settings.collapse": "Collapse",
			"settings.expand": "Expand",
			"settings.notExposed": "This DSH version does not open the Workshop settings.",
			"settings.readOnly": "Settings are read-only.",
			"settings.saveFailed": "Not saved.",
			"settings.title": "Workshop",
			"settings.description": "Install skins, pets and community plugins from dsh-market.com.",
			"settings.descriptionPrefix": "Install skins, pets and community plugins from ",
			"settings.descriptionSuffix": ".",
			"tab.picks": "Editor's Picks",
			"tab.skin": "Skins",
			"tab.pet": "Pets",
			"tab.plugin": "Plugins",
			"tab.preset": "Presets",
			"picks.empty": "No editor picks yet.",
			"presetPanel.missing": "The preset center plugin (@linxin666/dsh-client-ui-preset-center) is not installed, so community presets cannot be managed.",
			"search.label": "Search name, author or description",
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
			"category.roleplay": "Roleplay",
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
			"empty": "Could not read the Workshop list.",
			"noMatch": "No matching entries",
			"retry": "Retry",
			"online": "",
			"offline": "Workshop data unavailable",
			"install": "Install",
			"installNow": "Install now",
			"installing": "Installing…",
			"installAll": "Install all",
			"installAllChecking": "Checking for missing…",
			"installAllRunning": "Installing {done}/{total}…",
			"installAllConfirm": "Install {count} missing skins",
			"installAllDone": "Installed {count} skin(s)",
			"installAllNone": "Every skin is already installed",
			"installAllFailed": "{count} skin(s) failed to install",
			"installAllSummary": "Reported {count} install(s) as one batch",
			"installed": "Installed",
			"manageInPluginPage": "Manage in Plugins",
			"installFailed": "Install failed: {reason}",
			"installBlocked": "Blocked by a Cloudflare challenge: switch network or disable the proxy, then retry",
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
			"remote.note": "A remote browser can browse and copy commands; one-click install runs in a local browser."
		};
		//#endregion
		//#region src/client/telemetry.ts
		/** localStorage key carrying the family-wide telemetry opt-out ('1' = off). */
		const TELEMETRY_OPT_OUT_KEY = "dsh-web-ui-telemetry-opt-out";
		const VISITOR_KEY = "dsh-web-ui-telemetry-visitor";
		const DAY_KEY_PREFIX = "dsh-web-ui-telemetry-day:";
		const ENDPOINT = "https://dsh-market.com/api/telemetry/event";
		/** The building package's version, when the bundle carries it. */
		function bakedVersion() {
			try {
				return "0.4.13";
			} catch {
				return;
			}
		}
		/** Whether the user switched the family-wide opt-out on (reads storage only). */
		function isTelemetryOptedOut() {
			try {
				return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === "1";
			} catch {
				return false;
			}
		}
		/** Whether the browser itself asks not to be tracked; a failed read means no signal. */
		function doNotTrackRequested() {
			try {
				return navigator.doNotTrack === "1" || navigator.doNotTrack === "yes";
			} catch {
				return false;
			}
		}
		/** Whether a heartbeat must be suppressed right now: opt-out stored, or the browser asks not to be tracked. */
		function isTelemetrySuppressed() {
			return isTelemetryOptedOut() || doNotTrackRequested();
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
				if (isTelemetrySuppressed()) return;
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
		//#region src/client/web-extension-page.ts
		const SETTINGS_SECTION = "settings.section";
		const WEB_EXTENSION_SLOT = "web-ui.extension";
		function serviceOf(ctx) {
			if (typeof ctx.get !== "function") return void 0;
			try {
				const candidate = ctx.get("webUiExtensions");
				return candidate !== null && typeof candidate === "object" && typeof candidate.sectionId === "string" && typeof candidate.registerPage === "function" ? candidate : void 0;
			} catch {
				return;
			}
		}
		function warn(seat, error) {
			try {
				console.warn(`[dsh-web-settings] page "${seat}" could not be mounted`, error);
			} catch {}
		}
		/**
		* Keep exactly one reachable page contribution while the parent loads or
		* unloads. The parent service owns integrated mounting; only the fallback uses
		* this plugin's own slot registry. Slot disposal is synchronous, so the latch
		* prevents a move from recursively registering a duplicate.
		*/
		function installWebExtensionPage(ctx, page) {
			let dispose;
			let current;
			let reconciling = false;
			let disposed = false;
			const present = (seat) => {
				if (typeof ctx.slots.entries !== "function") return current === seat;
				const slot = seat === "integrated" ? WEB_EXTENSION_SLOT : SETTINGS_SECTION;
				return ctx.slots.entries(slot).some((entry) => entry.component === page.component && (seat === "integrated" ? entry.options.key : entry.options.id) === page.key);
			};
			const registerSeat = (seat) => {
				if (seat === "integrated") {
					const service = serviceOf(ctx);
					if (service === void 0) throw new Error("webUiExtensions service is unavailable");
					return service.registerPage(page);
				}
				return ctx.slots.register({
					name: SETTINGS_SECTION,
					id: page.key,
					order: page.order,
					label: page.label,
					locale: page.locale,
					inject: page.inject,
					...page.children === void 0 ? {} : { children: page.children }
				}, page.component);
			};
			const reconcile = () => {
				if (disposed || reconciling) return;
				const target = serviceOf(ctx) === void 0 ? "legacy" : "integrated";
				if (current === target && present(target)) return;
				const slot = target === "integrated" ? WEB_EXTENSION_SLOT : SETTINGS_SECTION;
				if (typeof ctx.slots.spec === "function" && ctx.slots.spec(slot) === void 0) return;
				reconciling = true;
				const previous = current;
				const disposePrevious = dispose;
				current = void 0;
				dispose = void 0;
				disposePrevious?.();
				try {
					dispose = registerSeat(target);
					current = target;
				} catch (error) {
					warn(target, error);
					if (previous !== void 0 && previous !== target) try {
						dispose = registerSeat(previous);
						current = previous;
					} catch (restoreError) {
						warn(previous, restoreError);
					}
				} finally {
					reconciling = false;
				}
			};
			if (typeof ctx.on === "function") try {
				ctx.on("slots/changed", reconcile);
			} catch {}
			reconcile();
			return () => {
				if (disposed) return;
				disposed = true;
				dispose?.();
				dispose = void 0;
				current = void 0;
			};
		}
		//#endregion
		//#region src/client/extension-seat.ts
		/** The Workshop page contribution: Web Extensions parent or standalone section. */
		const WORKSHOP_SECTION_ID = "dsh-workshop";
		/** Keep exactly one reachable Workshop page while the parent loads or unloads. */
		function installWorkshopSection(ctx, registration) {
			return installWebExtensionPage(ctx, {
				key: WORKSHOP_SECTION_ID,
				order: 150,
				locale: registration.locale,
				label: registration.label,
				inject: registration.inject,
				component: registration.component,
				children: { "dsh-workshop.panel": {
					kind: "keyed",
					scope: "root"
				} }
			});
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Settings namespace the store card edits: the family identity of this plugin's
		* own settings form, and the locale namespace this half registers.
		*/
		const MARKET_NS = "dsh-web-ui-market";
		/** Profile entry ids this package's patch rows carry, most likely first. */
		const MARKET_ENTRY_IDS = [
			"web-ui-market",
			"ui-market",
			MARKET_NS
		];
		const inject = [
			"slots",
			"locale",
			"connection",
			"configForms",
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
			bridgeNativePluginFaces(ctx);
			const binder = ctx.get("webUiSettings");
			const controller = new MarketCardController(binder !== void 0 ? binder.bind({ namespace: MARKET_NS }) : createServedEntryForm({
				forms: ctx.configForms,
				entryIds: MARKET_ENTRY_IDS
			}));
			ctx.effect(() => () => {
				controller.dispose();
			}, "dsh-web-ui-market: settings form");
			const disposeSection = installWorkshopSection(ctx, {
				label: () => ctx.locale.bind(MARKET_NS)("settings.title"),
				locale: MARKET_NS,
				inject: () => controller.inject(createExternalLinkOpener(ctx)),
				component: MarketSection
			});
			ctx.effect(() => disposeSection, "dsh-web-ui-market: settings seat");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map