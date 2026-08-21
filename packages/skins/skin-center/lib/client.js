window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:packages/skins/skin-center/src/client/skin-center.module.css.mjs
		const css = "body[data-dsh-skin-center] .eDzMgW_sectionList{margin:0;padding:0;list-style:none}body[data-dsh-skin-center] .eDzMgW_pluginCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}body[data-dsh-skin-center] .eDzMgW_pluginCard:hover{border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_cardHeaderStatic{align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}body[data-dsh-skin-center] .eDzMgW_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_pluginName{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-size:15px;font-weight:600;line-height:1.4;display:flex}body[data-dsh-skin-center] .eDzMgW_cardDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_cardBody{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;margin:0 16px;padding:12px 0 8px;display:flex}body[data-dsh-skin-center] .eDzMgW_head{flex-direction:column;gap:6px;display:flex}body[data-dsh-skin-center] .eDzMgW_titleBadge{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-weight:500}body[data-dsh-skin-center] .eDzMgW_intro{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:1.55}body[data-dsh-skin-center] .eDzMgW_themeRow{align-items:center;gap:8px;margin-top:2px;display:flex}body[data-dsh-skin-center] .eDzMgW_themeLabel{color:var(--dsw-alias-label-secondary,#6b7280);margin-right:2px;font-size:12px}body[data-dsh-skin-center] .eDzMgW_themeButton{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_themeButton:hover{border-color:var(--dsw-alias-border-l4,#94a3b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:active{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_themeButtonActive{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_list{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_card{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}body[data-dsh-skin-center] .eDzMgW_cardHead{align-items:center;gap:10px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_swatch{width:14px;height:14px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;flex:none}body[data-dsh-skin-center] .eDzMgW_cardName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_cardTagline{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.45}body[data-dsh-skin-center] .eDzMgW_badge{letter-spacing:.02em;border-radius:999px;flex:none;min-width:0;margin-left:auto;padding:2px 8px;font-size:11px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_badgeActive{color:var(--dsw-alias-state-success-primary,#0f6b3a);background:var(--dsw-alias-state-success-tertiary,#dcf3e5)}body[data-dsh-skin-center] .eDzMgW_badgeTrying{color:var(--dsw-alias-brand-primary,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e2edfc)}body[data-dsh-skin-center] .eDzMgW_actions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_button{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:7px;padding:6px 12px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2b7cd9);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:active:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_buttonPrimary{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-fill,#2b7cd9);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:active:not(:disabled),body[data-dsh-skin-center] .eDzMgW_buttonPrimary:focus-visible:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_buttonGhost{background:0 0;border-color:#0000}body[data-dsh-skin-center] .eDzMgW_button:disabled{opacity:.55;cursor:default}body[data-dsh-skin-center] .eDzMgW_error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}body[data-dsh-skin-center] .eDzMgW_enableRow{flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;display:flex}body[data-dsh-skin-center] .eDzMgW_enableLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_enableHint{min-width:100%;color:var(--dsw-alias-label-secondary,#6b7280);flex:1;margin:0;font-size:12px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_switch{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-3,#e2e8f0);cursor:pointer;border-radius:999px;flex:none;align-items:center;width:40px;height:22px;padding:2px;transition:background .12s,border-color .12s;display:inline-flex;position:relative}body[data-dsh-skin-center] .eDzMgW_switchOn{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-brand-primary,#2b7cd9)}body[data-dsh-skin-center] .eDzMgW_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_switchThumb{background:var(--dsw-alias-label-primary-foreground,#fff);width:18px;height:18px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;transition:transform .12s;display:block;transform:translate(0)}body[data-dsh-skin-center] .eDzMgW_switchOn .eDzMgW_switchThumb{transform:translate(18px)}body[data-dsh-skin-center] .eDzMgW_offNote{color:var(--dsw-alias-label-secondary,#6b7280);margin:0;font-size:12.5px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_backgroundRow{flex-direction:column;gap:6px;padding:8px 0;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundHead{align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_backgroundValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#2b7cd9);flex:none;margin-left:auto;font-size:12px}body[data-dsh-skin-center] .eDzMgW_backgroundRange{background:var(--dsw-alias-label-tertiary,#9aa4b5);background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#9aa4b5) 45%, transparent);width:100%;height:4px;box-shadow:0 0 0 1px var(--dsw-alias-border-l3,#cbd5e1);-webkit-appearance:none;appearance:none;cursor:pointer;border-radius:999px;margin:0}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-webkit-slider-runnable-track{background:var(--dsw-alias-bg-layer-3,#e2e8f0);border-radius:999px;height:4px}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-moz-range-track{background:var(--dsw-alias-bg-layer-3,#e2e8f0);border-radius:999px;height:4px}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:14px;height:14px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%;margin-top:-5px}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-moz-range-thumb{border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:12px;height:12px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%}body[data-dsh-skin-center] .eDzMgW_backgroundRange:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_backgroundHint{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_backgroundHintMuted{color:var(--dsw-alias-label-tertiary,#9aa4b5);font-size:12px;line-height:1.5}@media (prefers-reduced-motion:reduce){body[data-dsh-skin-center] .eDzMgW_pluginCard,body[data-dsh-skin-center] .eDzMgW_themeButton,body[data-dsh-skin-center] .eDzMgW_button,body[data-dsh-skin-center] .eDzMgW_switch,body[data-dsh-skin-center] .eDzMgW_switchThumb{transition:none}}body[data-dsh-skin-center] .eDzMgW_wallpaperSection{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;padding-top:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperStatus{color:var(--dsw-alias-label-secondary,#6b7280);align-items:center;gap:8px;font-size:12px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperStatusError{color:var(--dsw-alias-state-danger,#c53030)}body[data-dsh-skin-center] .eDzMgW_wallpaperControls{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperGrid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;display:grid}body[data-dsh-skin-center] .eDzMgW_wallpaperCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:6px;padding:8px;transition:border-color .16s;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperCard:hover{border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbWrap{aspect-ratio:16/9;background:var(--dsw-alias-bg-layer-1,#f1f5f9);border-radius:6px;position:relative;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_wallpaperThumb{object-fit:cover;width:100%;height:100%;display:block}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbEmpty{width:100%;height:100%}body[data-dsh-skin-center] .eDzMgW_wallpaperType{color:var(--dsw-alias-label-primary,#172a45);background:var(--dsw-alias-bg-layer-2,#ffffffd9);border-radius:4px;padding:3px 6px;font-size:10.5px;line-height:1;position:absolute;top:6px;left:6px}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbWrap .eDzMgW_badge{position:absolute;top:6px;right:6px}body[data-dsh-skin-center] .eDzMgW_wallpaperName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.35;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_wallpaperActions{flex-wrap:wrap;gap:6px;display:flex}body[data-dsh-skin-center] .eDzMgW_customThemeCard{overflow:hidden}body[data-dsh-skin-center] .eDzMgW_customThemeEditor{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:9px;flex-direction:column;gap:14px;margin:2px -2px -2px;padding:14px;display:flex}body[data-dsh-skin-center] .eDzMgW_customThemeScheme{flex-wrap:wrap;align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_customThemeFields{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;display:grid}body[data-dsh-skin-center] .eDzMgW_customThemeField,body[data-dsh-skin-center] .eDzMgW_customThemeContrast{flex-direction:column;gap:7px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_customThemeFieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}body[data-dsh-skin-center] .eDzMgW_customThemeInputRow{align-items:center;gap:7px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_customThemeColor{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;border-radius:7px;flex:none;width:34px;height:30px;padding:2px}body[data-dsh-skin-center] .eDzMgW_customThemeHex{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);width:100%;min-width:0;height:30px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:7px;outline:none;padding:0 9px;font-size:12px}body[data-dsh-skin-center] .eDzMgW_customThemeHex:focus,body[data-dsh-skin-center] .eDzMgW_customThemeColor:focus-visible{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-button-primary-dimmed)}body[data-dsh-skin-center] .eDzMgW_customThemeFooter{justify-content:space-between;align-items:center;gap:12px;padding-top:2px;display:flex}@media (width<=680px){body[data-dsh-skin-center] .eDzMgW_customThemeFields{grid-template-columns:1fr}body[data-dsh-skin-center] .eDzMgW_customThemeFooter{flex-direction:column;align-items:flex-start}}";
		const tagId = "@linxin666/dsh-client-ui-skin-center/skin-center.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var skin_center_module_css_default = {
			"actions": "eDzMgW_actions",
			"backgroundHead": "eDzMgW_backgroundHead",
			"backgroundHint": "eDzMgW_backgroundHint",
			"backgroundHintMuted": "eDzMgW_backgroundHintMuted",
			"backgroundLabel": "eDzMgW_backgroundLabel",
			"backgroundRange": "eDzMgW_backgroundRange",
			"backgroundRow": "eDzMgW_backgroundRow",
			"backgroundValue": "eDzMgW_backgroundValue",
			"badge": "eDzMgW_badge",
			"badgeActive": "eDzMgW_badgeActive",
			"badgeTrying": "eDzMgW_badgeTrying",
			"button": "eDzMgW_button",
			"buttonGhost": "eDzMgW_buttonGhost",
			"buttonPrimary": "eDzMgW_buttonPrimary",
			"card": "eDzMgW_card",
			"cardBody": "eDzMgW_cardBody",
			"cardDescription": "eDzMgW_cardDescription",
			"cardHead": "eDzMgW_cardHead",
			"cardHeaderStatic": "eDzMgW_cardHeaderStatic",
			"cardName": "eDzMgW_cardName",
			"cardTagline": "eDzMgW_cardTagline",
			"customThemeCard": "eDzMgW_customThemeCard",
			"customThemeColor": "eDzMgW_customThemeColor",
			"customThemeContrast": "eDzMgW_customThemeContrast",
			"customThemeEditor": "eDzMgW_customThemeEditor",
			"customThemeField": "eDzMgW_customThemeField",
			"customThemeFieldLabel": "eDzMgW_customThemeFieldLabel",
			"customThemeFields": "eDzMgW_customThemeFields",
			"customThemeFooter": "eDzMgW_customThemeFooter",
			"customThemeHex": "eDzMgW_customThemeHex",
			"customThemeInputRow": "eDzMgW_customThemeInputRow",
			"customThemeScheme": "eDzMgW_customThemeScheme",
			"enableHint": "eDzMgW_enableHint",
			"enableLabel": "eDzMgW_enableLabel",
			"enableRow": "eDzMgW_enableRow",
			"error": "eDzMgW_error",
			"head": "eDzMgW_head",
			"headText": "eDzMgW_headText",
			"intro": "eDzMgW_intro",
			"list": "eDzMgW_list",
			"offNote": "eDzMgW_offNote",
			"pluginCard": "eDzMgW_pluginCard",
			"pluginName": "eDzMgW_pluginName",
			"sectionList": "eDzMgW_sectionList",
			"swatch": "eDzMgW_swatch",
			"switch": "eDzMgW_switch",
			"switchOn": "eDzMgW_switchOn",
			"switchThumb": "eDzMgW_switchThumb",
			"themeButton": "eDzMgW_themeButton",
			"themeButtonActive": "eDzMgW_themeButtonActive",
			"themeLabel": "eDzMgW_themeLabel",
			"themeRow": "eDzMgW_themeRow",
			"titleBadge": "eDzMgW_titleBadge",
			"wallpaperActions": "eDzMgW_wallpaperActions",
			"wallpaperCard": "eDzMgW_wallpaperCard",
			"wallpaperControls": "eDzMgW_wallpaperControls",
			"wallpaperGrid": "eDzMgW_wallpaperGrid",
			"wallpaperName": "eDzMgW_wallpaperName",
			"wallpaperSection": "eDzMgW_wallpaperSection",
			"wallpaperStatus": "eDzMgW_wallpaperStatus",
			"wallpaperStatusError": "eDzMgW_wallpaperStatusError",
			"wallpaperThumb": "eDzMgW_wallpaperThumb",
			"wallpaperThumbEmpty": "eDzMgW_wallpaperThumbEmpty",
			"wallpaperThumbWrap": "eDzMgW_wallpaperThumbWrap",
			"wallpaperType": "eDzMgW_wallpaperType"
		};
		//#endregion
		//#region src/client/CustomThemePanel.tsx
		function CustomThemeCard(props) {
			const { t, customTheme, scheme, setScheme, isActive, isTrying, busy, disabled, onTryOn, onExitTryOn, onApply } = props;
			const customThemeState = (0, react.useSyncExternalStore)(customTheme.subscribe, customTheme.getState);
			const profile = customTheme.profile(scheme);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [draftColors, setDraftColors] = (0, react.useState)({
				accent: profile.accent,
				background: profile.background,
				foreground: profile.foreground
			});
			(0, react.useEffect)(() => {
				setDraftColors({
					accent: profile.accent,
					background: profile.background,
					foreground: profile.foreground
				});
			}, [
				scheme,
				profile.accent,
				profile.background,
				profile.foreground
			]);
			const setDraft = (key, value) => {
				setDraftColors((current) => ({
					...current,
					[key]: value
				}));
			};
			const commitColor = (key) => {
				const value = draftColors[key];
				if (/^#[0-9a-f]{6}$/i.test(value)) customTheme.setProfileValue(scheme, key, value);
				else setDraft(key, profile[key]);
			};
			const colorField = (key, label) => {
				const draft = draftColors[key];
				const pickerValue = /^#[0-9a-f]{6}$/i.test(draft) ? draft : profile[key];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: skin_center_module_css_default.customThemeField,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: skin_center_module_css_default.customThemeFieldLabel,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: skin_center_module_css_default.customThemeInputRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: skin_center_module_css_default.customThemeColor,
							type: "color",
							value: pickerValue,
							"aria-label": label,
							disabled,
							onChange: (event) => {
								const value = event.target.value;
								setDraft(key, value);
								customTheme.setProfileValue(scheme, key, value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: skin_center_module_css_default.customThemeHex,
							type: "text",
							value: draft,
							inputMode: "text",
							maxLength: 7,
							spellCheck: false,
							"aria-label": `${label} hex`,
							disabled,
							onChange: (event) => {
								setDraft(key, event.target.value);
							},
							onBlur: () => {
								commitColor(key);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") event.currentTarget.blur();
							}
						})]
					})]
				}, key);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${skin_center_module_css_default.card} ${skin_center_module_css_default.customThemeCard}`,
				"data-dsh-custom-theme-card": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.cardHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.swatch,
								style: { background: profile.accent },
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.cardName,
								children: t("customThemeTitle")
							}),
							(isActive || isTrying) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
								children: isActive ? t("active") : t("tryingOn")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.cardTagline,
						children: t("customThemeTagline")
					}),
					customThemeState.writeError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.error,
						role: "alert",
						children: t("customThemeSaveFailed")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.actions,
						children: [
							isActive && !isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonGhost}`,
								disabled: true,
								children: t("tryOn")
							}) : isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
								disabled,
								onClick: onExitTryOn,
								children: t("exitTryOn")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
								disabled,
								onClick: onTryOn,
								children: busy ? t("loading") : t("tryOn")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: skin_center_module_css_default.button,
								disabled,
								onClick: onApply,
								children: busy ? t("applying") : t("apply")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: skin_center_module_css_default.button,
								"aria-expanded": expanded,
								disabled,
								onClick: () => {
									setExpanded((value) => !value);
								},
								children: expanded ? t("customThemeCloseEdit") : t("customThemeEdit")
							})
						]
					}),
					expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.customThemeEditor,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.customThemeScheme,
								role: "group",
								"aria-label": t("customThemeMode"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("customThemeMode")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-pressed": scheme === "light",
										className: `${skin_center_module_css_default.themeButton} ${scheme === "light" ? skin_center_module_css_default.themeButtonActive : ""}`,
										disabled,
										onClick: () => {
											setScheme("light");
										},
										children: t("customThemeLight")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-pressed": scheme === "dark",
										className: `${skin_center_module_css_default.themeButton} ${scheme === "dark" ? skin_center_module_css_default.themeButtonActive : ""}`,
										disabled,
										onClick: () => {
											setScheme("dark");
										},
										children: t("customThemeDark")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.customThemeFields,
								children: [
									colorField("accent", t("customThemeAccent")),
									colorField("background", t("customThemeBackground")),
									colorField("foreground", t("customThemeForeground"))
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: skin_center_module_css_default.customThemeContrast,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.customThemeFieldLabel,
										children: t("customThemeContrast")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: profile.contrast
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: skin_center_module_css_default.backgroundRange,
									type: "range",
									min: "0",
									max: "100",
									step: "1",
									value: profile.contrast,
									"aria-label": t("customThemeContrast"),
									"aria-valuetext": String(profile.contrast),
									disabled,
									onChange: (event) => {
										customTheme.setProfileValue(scheme, "contrast", Number(event.target.value));
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.customThemeFooter,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.backgroundHintMuted,
									children: t("customThemeResetHint")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: skin_center_module_css_default.button,
									disabled,
									onClick: () => {
										customTheme.reset(scheme);
									},
									children: t("customThemeReset")
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/runtime/backdrop-scene.ts
		/**
		* Unified "backdrop visible" scene marker (issue #777).
		*
		* A skin with painted background media or a mounted Wallpaper Engine
		* wallpaper both put real backdrop art behind the app. The two runtime
		* controllers (skin-controller and wallpaper) report their mount state
		* through setSceneBackdropActive(); this module folds them into ONE body /
		* html marker `data-dsh-backdrop-active` and installs the shared composer
		* seat neutralizer that keys on it.
		*
		* The composer seat paints an opaque base fade under the input card (rc.8: a
		* linear gradient to --dsw-alias-bg-base, z-index 7; some builds additionally
		* use a ::before with backdrop-filter). While ANY backdrop art is visible the
		* fade would hide it behind the input area, so the official mask is
		* neutralized uniformly for skins and wallpapers alike (issue #747 direction).
		*
		* Readability after the mask is gone comes from a shared frost on the whole
		* composer seat plus the input card itself ([data-composer-card], the official
		* shell's stable card anchor). The seat uses the overlay surface token so the
		* strip below the card occludes message text scrolling underneath without
		* flattening backdrop art, while the card keeps its own translucent tint and
		* gains the same configurable backdrop blur (default INPUT_FROST_BLUR_PX).
		* Both rules are enabled only while the conversation actually has message
		* content (data-dsh-conversation-content): an empty conversation has no正文 to
		* occlude, so the input keeps its normal hero appearance without a frost flash.
		* The strength is provided by --dsh-input-card-blur and falls back to the
		* compatibility default when the setting has not loaded yet.
		*
		* The marker is body/html level (managed outside the surface/part/plugin
		* enum, see contracts/semantic-attrs-v1.md) and survives a neutralizer
		* teardown; the style is inert whenever the marker is absent.
		* @module @linxin666/dsh-client-ui-skin-center/runtime/backdrop-scene
		*/
		/** Shared marker: set on html + body while a source reports backdrop art. */
		const BACKDROP_ACTIVE_ATTR = "data-dsh-backdrop-active";
		/** The shared composer-seat neutralizer style's own attribute. */
		const SCENE_NEUTRALIZER_ATTR = "data-dsh-scene-neutralizer";
		/** Conversation-content marker: set while the active conversation has rows. */
		const CONVERSATION_CONTENT_ATTR = "data-dsh-conversation-content";
		/**
		* Stable shell scrollport scoped row selectors. Official builds emit the chat
		* anchor; the CSS-module suffix fallbacks retain compatibility with older
		* shells without returning to a body-wide topic/session query.
		*/
		const ACTIVE_CONVERSATION_CONTENT_SELECTOR = [
			"[data-conversation-scroll] [data-chat-anchor-key]",
			"[data-conversation-scroll] [class*=\"_userRow\"]",
			"[data-conversation-scroll] [class*=\"_compactionRow\"]",
			"[data-conversation-scroll] [class*=\"_contextRow\"]",
			"[data-conversation-scroll] [class*=\"_turnErrorRow\"]"
		].join(", ");
		const sourceSets = /* @__PURE__ */ new WeakMap();
		const contentObservers = /* @__PURE__ */ new WeakMap();
		/**
		* Report one source's backdrop-art presence. The marker stays on while any
		* source is active, so the skin and wallpaper controllers never clobber each
		* other across their mount/unmount cycles.
		*/
		function setSceneBackdropActive(doc, source, active) {
			let sources = sourceSets.get(doc);
			if (sources === void 0) {
				sources = /* @__PURE__ */ new Set();
				sourceSets.set(doc, sources);
			}
			if (active) sources.add(source);
			else sources.delete(source);
			syncMarker(doc, sources);
		}
		/** Reflect the source set onto html/body and ensure the neutralizer on use. */
		function syncMarker(doc, sources) {
			if (sources.size > 0) {
				doc.body?.setAttribute(BACKDROP_ACTIVE_ATTR, "true");
				doc.documentElement?.setAttribute(BACKDROP_ACTIVE_ATTR, "true");
				ensureSceneNeutralizer(doc);
				startContentObserver(doc);
			} else {
				doc.body?.removeAttribute(BACKDROP_ACTIVE_ATTR);
				doc.documentElement?.removeAttribute(BACKDROP_ACTIVE_ATTR);
				stopContentObserver(doc);
			}
		}
		/**
		* Track whether the active conversation scrollport has message rows for the
		* frost gate. Topic pickers and outgoing session trees can retain their own
		* data-chat-anchor-key nodes during a switch; a body-wide query would count
		* those stale rows and flash the composer frost over the new empty topic.
		*/
		function updateConversationContent(doc) {
			if (doc.body !== null && doc.body.querySelector(ACTIVE_CONVERSATION_CONTENT_SELECTOR) !== null) {
				doc.body?.setAttribute(CONVERSATION_CONTENT_ATTR, "true");
				doc.documentElement?.setAttribute(CONVERSATION_CONTENT_ATTR, "true");
			} else {
				doc.body?.removeAttribute(CONVERSATION_CONTENT_ATTR);
				doc.documentElement?.removeAttribute(CONVERSATION_CONTENT_ATTR);
			}
		}
		/** Observe the conversation tree while a backdrop is visible. */
		function startContentObserver(doc) {
			if (contentObservers.has(doc)) return;
			updateConversationContent(doc);
			const win = doc.defaultView;
			if (win === null || typeof win.MutationObserver !== "function") return;
			const observer = new win.MutationObserver(() => updateConversationContent(doc));
			observer.observe(doc.body ?? doc.documentElement, {
				childList: true,
				subtree: true
			});
			contentObservers.set(doc, observer);
		}
		/** Stop the content observer and drop the content marker. */
		function stopContentObserver(doc) {
			const observer = contentObservers.get(doc);
			if (observer !== void 0) {
				observer.disconnect();
				contentObservers.delete(doc);
			}
			doc.body?.removeAttribute(CONVERSATION_CONTENT_ATTR);
			doc.documentElement?.removeAttribute(CONVERSATION_CONTENT_ATTR);
		}
		/**
		* Install the shared composer-seat neutralizer, keyed by head presence so a
		* cleared head (tests) or a re-mount re-creates it. Without the marker the
		* rules are inert, so the style can outlive a single mount without changing
		* any other look.
		*/
		function ensureSceneNeutralizer(doc) {
			if (doc.head === null) return;
			if (doc.head.querySelector(`style[data-dsh-scene-neutralizer]`) !== null) return;
			const style = doc.createElement("style");
			style.setAttribute(SCENE_NEUTRALIZER_ATTR, "");
			style.textContent = `
    html[data-dsh-backdrop-active] [data-composer-seat]::before {
      background: none !important;
      backdrop-filter: none !important;
    }
    html[data-dsh-backdrop-active][data-dsh-conversation-content] [data-composer-seat] {
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--dsw-alias-bg-overlay) 0%, transparent) 0px,
        var(--dsw-alias-bg-overlay) 36px
      ) !important;
      backdrop-filter: blur(var(--dsh-input-card-blur, 10px)) !important;
      -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, 10px)) !important;
    }
    html[data-dsh-backdrop-active][data-dsh-conversation-content] [data-composer-card] {
      backdrop-filter: blur(var(--dsh-input-card-blur, 10px)) !important;
      -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, 10px)) !important;
    }
  `;
			doc.head.appendChild(style);
		}
		//#endregion
		//#region src/client/wallpaper.ts
		/** The namespace string the Host registers (mirrors src/index.ts). */
		const SKIN_WALLPAPER_NS = "skin-wallpaper";
		const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
		/** Style one fixed, non-interactive, under-everything wallpaper layer. */
		function styleLayer(element, zIndex, layer) {
			element.dataset.dshWallpaperLayer = layer;
			element.style.position = "fixed";
			element.style.inset = "0";
			element.style.zIndex = String(zIndex);
			element.style.pointerEvents = "none";
			element.style.overflow = "hidden";
			element.setAttribute("aria-hidden", "true");
		}
		/** Style a full-bleed cover child (video / img / iframe). */
		function styleCover(element, fit = "cover") {
			element.style.width = "100%";
			element.style.height = "100%";
			element.style.objectFit = fit;
			element.style.border = "0";
			element.style.display = "block";
		}
		/** Max static-frame capture edge (the backdrop never needs more pixels). */
		const FRAME_MAX_EDGE = 1920;
		const MIN_VIEWPORT_SURFACE_HEIGHT = .9;
		const MAX_SURFACE_OVERLAY_Z_INDEX = 100;
		/** Any nontransparent background blocks some of the wallpaper. */
		function hasVisibleBackground(color) {
			const normalized = color.trim().toLowerCase();
			if (normalized === "" || normalized === "transparent") return false;
			const match = normalized.match(/^[a-z-]+\((.*)\)$/);
			if (match === null) return true;
			const args = match[1];
			const slash = args.lastIndexOf("/");
			if (slash >= 0) return hasVisibleAlpha(args.slice(slash + 1));
			const channels = args.split(",");
			return channels.length === 4 ? hasVisibleAlpha(channels[3] ?? "") : true;
		}
		function hasVisibleAlpha(value) {
			const alpha = Number.parseFloat(value);
			return Number.isFinite(alpha) && alpha > 0;
		}
		/** Exclude owned layers plus modal/plugin surfaces that must retain their paint. */
		function isExcludedWallpaperSurface(el, zIndex) {
			if (typeof el.closest === "function" && el.closest("[data-dsh-wallpaper-layer], dialog, [role=\"dialog\"], [aria-modal=\"true\"], [data-shell-overlay], [data-slot=\"shell.overlay\"], [data-dsh-plugin]") !== null) return true;
			const numericZIndex = Number.parseFloat(zIndex);
			return Number.isFinite(numericZIndex) && numericZIndex > MAX_SURFACE_OVERLAY_Z_INDEX;
		}
		/**
		* Default shell-surface detector for WE wallpaper neutralization (#712). A
		* target must cover most of the visible viewport and paint a nontransparent
		* background. It deliberately avoids equality against a theme token because
		* real shell surfaces can resolve a different or partially transparent color.
		* Modal and plugin overlays stay out of scope even when they fill the viewport.
		*/
		function defaultWallpaperSurface(el, doc) {
			const win = doc.defaultView;
			if (win === null) return false;
			let rectHeight = 0;
			let viewportHeight = 0;
			let background = "";
			let zIndex = "";
			try {
				rectHeight = el.getBoundingClientRect().height;
				viewportHeight = doc.documentElement.clientHeight || win.innerHeight || 0;
				const cs = win.getComputedStyle(el);
				background = cs.backgroundColor;
				zIndex = cs.zIndex;
			} catch {
				return false;
			}
			return viewportHeight > 0 && rectHeight >= viewportHeight * MIN_VIEWPORT_SURFACE_HEIGHT && hasVisibleBackground(background) && !isExcludedWallpaperSurface(el, zIndex);
		}
		/**
		* Workspace-list end-fade detector (#734): a gradient-background element inside
		* the sidebar workspaces slot. The official `data-slot="sidebar.workspaces"`
		* anchor is stable; the fade element only carries hashed CSS-module classes, so
		* this selects it by computed style instead of class names.
		*/
		function defaultWorkspaceFade(el, doc) {
			const win = doc.defaultView;
			if (win === null) return false;
			try {
				return win.getComputedStyle(el).backgroundImage.includes("gradient");
			} catch {
				return false;
			}
		}
		/**
		* Own the skin-wallpaper scope: keep the mounted layers in sync with the
		* persisted selection and the card-driven descriptor resolution.
		*/
		var WallpaperController = class {
			enabledValue = true;
			selectionValue = "";
			modeValue = "live";
			fitValue = "cover";
			pauseOnHiddenValue = true;
			soundValue = false;
			volumeValue = 100;
			dimValue = 25;
			blurValue = 0;
			dirsValue = [];
			listeners = /* @__PURE__ */ new Set();
			scope;
			options;
			doc;
			/** The descriptor of the applied selection, resolved by the card. */
			applied = null;
			/** The try-on descriptor while a preview is up. */
			previewing = null;
			mediaLayer = null;
			scrimLayer = null;
			videoElement = null;
			rootNeutralizer = null;
			/** Re-asserts the wallpaper layers if the shell tears the body subtree down. */
			mountObserver = null;
			/** Re-tags full-viewport surfaces after navigation rebuilds #root (#805). */
			surfaceObserver = null;
			/** Shell surfaces tagged with data-dsh-wallpaper-surface during this mount. */
			taggedSurfaces = /* @__PURE__ */ new Set();
			disposed = false;
			/** In-flight scene probes by wallpaper id; overlapping entry points
			*  (applySelection / tryOn / sync / fetchAndSync) must not re-read the
			*  same packed scene concurrently. */
			probePending = /* @__PURE__ */ new Map();
			/** Detached frame-capture video; released on error/abort/loadeddata and on
			*  teardown so it never keeps buffering the source file. */
			captureVideo = null;
			constructor(scope, options = {}) {
				this.scope = scope;
				this.options = options;
				this.doc = options.doc ?? document;
				this.readAll();
				scope.subscribe(() => {
					this.readAll();
					if (this.enabledValue && this.selectionValue && (!this.applied || this.applied.id !== this.selectionValue)) this.fetchAndSync();
					else {
						this.render();
						this.publish();
					}
				});
				this.doc.addEventListener("visibilitychange", this.onVisibility);
				this.doc.defaultView?.addEventListener("message", this.onSceneMessage);
				this.doc.addEventListener("pointerdown", this.onFirstGesture);
				this.doc.addEventListener("keydown", this.onFirstGesture);
				const win = this.doc.defaultView;
				if (win !== null && typeof win.MutationObserver === "function") {
					this.mountObserver = new win.MutationObserver(() => {
						if (this.disposed) return;
						if ((this.previewing ?? this.applied) === null) return;
						if (this.mediaLayer === null || !this.mediaLayer.isConnected) this.render();
					});
					this.mountObserver.observe(this.doc.body, { childList: true });
				}
				if (this.enabledValue && this.selectionValue) this.fetchAndSync();
			}
			fetchAndSync() {
				if (!this.selectionValue || !this.doc) return;
				const targetId = this.selectionValue;
				const fetchFn = this.options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(this.doc.defaultView ?? globalThis) : void 0);
				if (!fetchFn) return;
				fetchFn(`${this.options.apiBase ?? "/api/skin-center/we"}/inventory`).then(async (response) => {
					if (this.disposed || !response.ok) return;
					const payload = await response.json().catch(() => null);
					if (payload?.ok === true && Array.isArray(payload.wallpapers)) {
						const item = payload.wallpapers.find((w) => w.id === targetId);
						if (item && this.selectionValue === targetId) {
							this.applied = item;
							this.render();
							this.publish();
							this.probeSceneCapabilitiesIfNeeded(item);
						}
					}
				}).catch(() => {});
			}
			/**
			* Lazily probe a scene's video/WebGL capabilities: the inventory never
			* reads packed scene payloads, so only the wallpaper the user actually
			* selects (apply, try-on or boot sync) asks the probe route. The response
			* is merged into every slot (previewing and applied) that holds the id.
			*/
			probeSceneCapabilitiesIfNeeded(descriptor) {
				if (this.disposed || descriptor.type !== "scene" || descriptor.videoUrl !== null || descriptor.sceneUrl != null) return;
				const targetId = descriptor.id;
				if (this.probePending.has(targetId)) return;
				const fetchFn = this.options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(this.doc.defaultView ?? globalThis) : void 0);
				if (!fetchFn) return;
				const pending = fetchFn((this.options.apiBase ?? "/api/skin-center/we") + "/scene-probe?id=" + encodeURIComponent(targetId)).then(async (response) => {
					if (this.disposed || !response.ok) return;
					const payload = await response.json().catch(() => null);
					if (!payload || payload.ok !== true) return;
					let changed = false;
					if (this.previewing?.id === targetId) {
						const merged = {
							...this.previewing,
							videoUrl: payload.videoUrl ?? this.previewing.videoUrl,
							sceneUrl: payload.sceneUrl ?? this.previewing.sceneUrl
						};
						if (merged.videoUrl !== this.previewing.videoUrl || merged.sceneUrl !== this.previewing.sceneUrl) {
							this.previewing = merged;
							changed = true;
						}
					}
					if (this.applied?.id === targetId) {
						const merged = {
							...this.applied,
							videoUrl: payload.videoUrl ?? this.applied.videoUrl,
							sceneUrl: payload.sceneUrl ?? this.applied.sceneUrl
						};
						if (merged.videoUrl !== this.applied.videoUrl || merged.sceneUrl !== this.applied.sceneUrl) {
							this.applied = merged;
							changed = true;
						}
					}
					if (!changed) return;
					this.render();
					this.publish();
				}).catch(() => {}).finally(() => {
					this.probePending.delete(targetId);
				});
				this.probePending.set(targetId, pending);
			}
			enabled = () => this.enabledValue;
			selection = () => this.selectionValue;
			mode = () => this.modeValue;
			fit = () => this.fitValue;
			dim = () => this.dimValue;
			wallpaperBlur = () => this.blurValue;
			pauseOnHidden = () => this.pauseOnHiddenValue;
			sound = () => this.soundValue;
			volume = () => this.volumeValue;
			dirs = () => this.dirsValue;
			addDir(dir) {
				const trimmed = dir.trim();
				if (trimmed === "" || this.dirsValue.includes(trimmed)) return;
				this.dirsValue = [...this.dirsValue, trimmed];
				this.publish();
				this.scope.set("weLibraryDirs", this.dirsValue);
			}
			removeDir(dir) {
				const next = this.dirsValue.filter((d) => d !== dir);
				if (next.length === this.dirsValue.length) return;
				this.dirsValue = next;
				this.publish();
				this.scope.set("weLibraryDirs", this.dirsValue);
			}
			activeId = () => {
				const current = this.previewing ?? this.applied;
				return this.mediaLayer !== null && current !== null ? current.id : null;
			};
			trying = () => this.previewing !== null;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			setEnabled(value) {
				this.enabledValue = value;
				this.render();
				this.publish();
				this.scope.set("enabled", value);
			}
			setMode(mode) {
				this.modeValue = mode;
				this.render();
				this.publish();
				this.scope.set("mode", mode);
			}
			setFit(fit) {
				this.fitValue = fit;
				this.render();
				this.publish();
				this.scope.set("fit", fit);
			}
			setDim(value) {
				this.dimValue = clamp(value, 0, 90);
				this.render();
				this.publish();
				this.scope.set("dim", this.dimValue);
			}
			setBlur(value) {
				this.blurValue = clamp(value, 0, 60);
				this.render();
				this.publish();
				this.scope.set("wallpaperBlur", this.blurValue);
			}
			setPauseOnHidden(value) {
				this.pauseOnHiddenValue = value;
				this.publish();
				this.scope.set("pauseOnHidden", value);
			}
			setSound(value) {
				this.soundValue = value;
				this.applySound();
				this.publish();
				this.scope.set("sound", value);
			}
			setVolume(value) {
				this.volumeValue = clamp(value, 0, 100);
				this.applySound();
				this.publish();
				this.scope.set("volume", this.volumeValue);
			}
			applySelection(descriptor) {
				this.applied = descriptor;
				this.previewing = null;
				this.selectionValue = descriptor.id;
				this.render();
				this.publish();
				this.scope.set("selection", descriptor.id);
				this.probeSceneCapabilitiesIfNeeded(descriptor);
			}
			clearSelection() {
				this.applied = null;
				this.previewing = null;
				this.selectionValue = "";
				this.render();
				this.publish();
				this.scope.set("selection", "");
			}
			sync(descriptor) {
				this.applied = descriptor;
				this.render();
				if (descriptor !== null) this.probeSceneCapabilitiesIfNeeded(descriptor);
			}
			tryOn(descriptor) {
				this.previewing = descriptor;
				this.render();
				this.publish();
				this.probeSceneCapabilitiesIfNeeded(descriptor);
			}
			exitTryOn() {
				if (this.previewing === null) return;
				this.previewing = null;
				this.render();
				this.publish();
			}
			recoverScenePlayer() {
				const scenePlayer = this.mediaLayer?.firstElementChild ?? null;
				if (!(scenePlayer instanceof HTMLIFrameElement) || scenePlayer.dataset.dshScenePlayer !== "") return;
				try {
					scenePlayer.contentWindow?.postMessage({ type: "dsh-recover-renderer" }, window.location.origin);
				} catch {}
			}
			dispose() {
				this.disposed = true;
				this.mountObserver?.disconnect();
				this.mountObserver = null;
				this.doc.removeEventListener("visibilitychange", this.onVisibility);
				this.doc.defaultView?.removeEventListener("message", this.onSceneMessage);
				this.doc.removeEventListener("pointerdown", this.onFirstGesture);
				this.doc.removeEventListener("keydown", this.onFirstGesture);
				this.teardownLayers();
			}
			readAll() {
				const value = this.scope.getSnapshot().value ?? {};
				this.enabledValue = typeof value.enabled === "boolean" ? value.enabled : true;
				this.selectionValue = typeof value.selection === "string" ? value.selection : "";
				this.modeValue = value.mode === "frame" ? "frame" : "live";
				const rawFit = value.fit;
				this.fitValue = rawFit === "contain" || rawFit === "fill" ? rawFit : "cover";
				this.pauseOnHiddenValue = typeof value.pauseOnHidden === "boolean" ? value.pauseOnHidden : true;
				this.soundValue = typeof value.sound === "boolean" ? value.sound : false;
				this.volumeValue = typeof value.volume === "number" && Number.isFinite(value.volume) ? clamp(value.volume, 0, 100) : 100;
				this.dimValue = typeof value.dim === "number" && Number.isFinite(value.dim) ? clamp(value.dim, 0, 90) : 25;
				this.blurValue = typeof value.wallpaperBlur === "number" && Number.isFinite(value.wallpaperBlur) ? clamp(value.wallpaperBlur, 0, 60) : 0;
				this.dirsValue = Array.isArray(value.weLibraryDirs) ? value.weLibraryDirs.filter((d) => typeof d === "string" && d.trim() !== "") : [];
			}
			/** Resume a policy-blocked video on the first user gesture (#580). */
			onFirstGesture = () => {
				if (this.videoElement === null || !this.videoElement.paused) return;
				this.videoElement.play()?.catch(() => {});
			};
			onSceneMessage = (event) => {
				const scenePlayer = this.mediaLayer?.firstElementChild ?? null;
				if (!(scenePlayer instanceof HTMLIFrameElement) || scenePlayer.dataset.dshScenePlayer !== "") return;
				if (event.source !== scenePlayer.contentWindow || event.origin !== this.doc.location?.origin) return;
				if (event.data?.type !== "dsh-scene-needs-reload") return;
				scenePlayer.src = scenePlayer.src;
			};
			onVisibility = () => {
				if (!this.pauseOnHiddenValue) return;
				if (this.videoElement !== null) if (this.doc.hidden) this.videoElement.pause();
				else this.videoElement.play()?.catch(() => {});
				const scenePlayer = this.mediaLayer?.firstElementChild ?? null;
				if (scenePlayer instanceof HTMLIFrameElement && scenePlayer.dataset.dshScenePlayer === "") try {
					scenePlayer.contentWindow?.postMessage({
						type: "dsh-set-pause",
						paused: this.doc.hidden
					}, window.location.origin);
				} catch {}
			};
			/** Reconcile the DOM with (enabled, previewing ?? applied, mode, dim, blur). */
			render() {
				if (this.disposed) return;
				const current = this.enabledValue ? this.previewing ?? this.applied : null;
				if (current === null) {
					this.teardownLayers();
					return;
				}
				this.ensureLayers(current);
			}
			ensureLayers(descriptor) {
				if (this.rootNeutralizer === null) {
					this.rootNeutralizer = this.doc.createElement("style");
					this.rootNeutralizer.dataset.dshWallpaperRoot = "";
					this.rootNeutralizer.textContent = `
        [id="root"] { background: transparent; }
        html[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active] body,
        html[data-dsh-skin] body[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active][data-ds-dark-theme],
        html[data-dsh-wallpaper-active] [id="root"] {
          background-color: transparent !important;
          background-image: none !important;
        }
        /* Some skins (e.g. summer-liquid-glass) paint a frosted ::before on
           the composer seat. Neutralize that pseudo independently of the
           shared scene marker, but leave the seat element itself available
           for the content-gated readability frost (issues #777 and #951). */
        html[data-dsh-wallpaper-active] [data-composer-seat]::before {
          background: none !important;
          backdrop-filter: none !important;
        }
        /* Full-viewport shell surfaces (AppFrame frame, conversation root,
           details root) paint the opaque app base background via hashed
           CSS-module classes. While a WE wallpaper is mounted the controller
           tags them with the own marker data-dsh-wallpaper-surface
           (markWallpaperSurfaces), and this rule neutralizes them with no
           class-name dependency (issue #734). */
        html[data-dsh-wallpaper-active] [data-dsh-wallpaper-surface] {
          background-color: transparent !important;
          background-image: none !important;
        }
      `;
					this.doc.head.appendChild(this.rootNeutralizer);
				}
				this.doc.body.dataset.dshWallpaperActive = "true";
				this.doc.documentElement.dataset.dshWallpaperActive = "true";
				setSceneBackdropActive(this.doc, "wallpaper", true);
				this.markSurfaces();
				this.ensureSurfaceObserver();
				if (this.mediaLayer !== null && !this.mediaLayer.isConnected) this.doc.body.appendChild(this.mediaLayer);
				if (this.mediaLayer === null) {
					this.mediaLayer = this.doc.createElement("div");
					styleLayer(this.mediaLayer, -3, "media");
					this.doc.body.appendChild(this.mediaLayer);
				}
				if (this.scrimLayer !== null && !this.scrimLayer.isConnected) this.doc.body.appendChild(this.scrimLayer);
				if (this.scrimLayer === null) {
					this.scrimLayer = this.doc.createElement("div");
					styleLayer(this.scrimLayer, -2, "scrim");
					this.doc.body.appendChild(this.scrimLayer);
				}
				const mediaKey = descriptor.id + ":" + this.modeValue + ":" + (descriptor.videoUrl ?? "") + ":" + (descriptor.sceneUrl ?? "");
				if (this.mediaLayer.dataset.mediaKey !== mediaKey) {
					this.mediaLayer.dataset.mediaKey = mediaKey;
					this.releaseCaptureVideo();
					this.mediaLayer.replaceChildren();
					this.videoElement = null;
					const child = this.buildMedia(descriptor);
					if (child !== null) {
						this.mediaLayer.appendChild(child);
						if (child instanceof HTMLVideoElement && child.paused) child.play()?.catch(() => {});
					}
				} else {
					const child = this.mediaLayer.firstElementChild;
					const VideoCtor = this.doc.defaultView?.HTMLVideoElement;
					if (VideoCtor !== void 0 && child instanceof VideoCtor && child.paused) child.play()?.catch(() => {});
				}
				this.applyFit();
				const blur = this.blurValue > 0 ? "blur(" + String(this.blurValue) + "px)" : "";
				this.mediaLayer.style.filter = blur;
				this.mediaLayer.style.transform = this.blurValue > 0 ? "scale(1.05)" : "";
				this.scrimLayer.style.background = "rgba(0, 0, 0, " + String(this.dimValue / 100) + ")";
			}
			/** Push the current sizing mode onto the mounted media element. */
			applyFit() {
				const child = this.mediaLayer?.firstElementChild ?? null;
				if (child instanceof HTMLElement) styleCover(child, this.fitValue);
				if (child instanceof HTMLIFrameElement && child.dataset.dshScenePlayer === "") try {
					child.contentWindow?.postMessage({
						type: "dsh-set-fit",
						fit: this.fitValue
					}, window.location.origin);
				} catch {}
			}
			/** Build the cover child for one descriptor + mode; null when unrenderable. */
			buildMedia(descriptor) {
				if (descriptor.type === "video") {
					if (this.modeValue === "live" && descriptor.videoUrl !== null) return this.buildVideo(descriptor.videoUrl);
					if (descriptor.videoUrl !== null) return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl);
					return this.buildImage(descriptor.previewUrl);
				}
				if (descriptor.type === "web") {
					if (this.modeValue === "live" && descriptor.webUrl !== null) {
						const iframe = this.doc.createElement("iframe");
						iframe.src = descriptor.webUrl;
						iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
						iframe.setAttribute("tabindex", "-1");
						styleCover(iframe, this.fitValue);
						return iframe;
					}
					return this.buildImage(descriptor.previewUrl);
				}
				if (descriptor.type === "scene") {
					if (this.modeValue === "live" && descriptor.videoUrl !== null) return this.buildVideo(descriptor.videoUrl, descriptor.frameUrl, descriptor.previewUrl);
					if (this.modeValue === "live" && descriptor.sceneUrl) {
						const iframe = this.doc.createElement("iframe");
						iframe.src = descriptor.sceneUrl;
						iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
						iframe.setAttribute("tabindex", "-1");
						iframe.dataset.dshScenePlayer = "";
						styleCover(iframe, this.fitValue);
						iframe.addEventListener("load", () => {
							try {
								iframe.contentWindow?.postMessage({
									type: "dsh-set-fit",
									fit: this.fitValue
								}, window.location.origin);
							} catch {}
						});
						return iframe;
					}
					if (this.modeValue === "frame" && descriptor.videoUrl !== null && descriptor.frameUrl === null) return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl);
					return this.buildImage(descriptor.frameUrl ?? descriptor.previewUrl, descriptor.previewUrl);
				}
				return this.buildImage(descriptor.previewUrl);
			}
			/** Push the persisted sound/volume settings onto the mounted video. */
			applySound() {
				if (this.videoElement === null) return;
				this.videoElement.muted = !this.soundValue;
				this.videoElement.volume = this.volumeValue / 100;
			}
			buildVideo(url, frameUrl = null, previewUrl = null) {
				const video = this.doc.createElement("video");
				video.src = url;
				video.muted = !this.soundValue;
				video.volume = this.volumeValue / 100;
				video.loop = true;
				video.autoplay = true;
				video.playsInline = true;
				video.preload = "auto";
				video.setAttribute("aria-hidden", "true");
				styleCover(video, this.fitValue);
				this.videoElement = video;
				if (frameUrl !== null || previewUrl !== null) video.addEventListener("error", () => {
					const nextUrl = frameUrl ?? previewUrl;
					const nextFallback = frameUrl !== null ? previewUrl : null;
					const img = this.buildImage(nextUrl, nextFallback);
					if (img && video.parentElement) video.parentElement.replaceChild(img, video);
				}, { once: true });
				video.play()?.catch(() => {});
				return video;
			}
			/** Static-frame mode for video: capture the first frame into an image. */
			buildVideoFrame(url, previewUrl) {
				const image = this.doc.createElement("img");
				styleCover(image, this.fitValue);
				if (previewUrl !== null) image.src = previewUrl;
				const video = this.doc.createElement("video");
				video.muted = true;
				video.playsInline = true;
				video.preload = "auto";
				video.src = url;
				this.releaseCaptureVideo();
				this.captureVideo = video;
				const release = () => {
					video.removeAttribute("src");
					video.load();
				};
				video.addEventListener("error", release, { once: true });
				video.addEventListener("abort", release, { once: true });
				video.addEventListener("loadeddata", () => {
					try {
						const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
						const canvas = this.doc.createElement("canvas");
						canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
						canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
						const context = canvas.getContext("2d");
						if (context !== null) {
							context.drawImage(video, 0, 0, canvas.width, canvas.height);
							image.src = canvas.toDataURL("image/jpeg", .85);
						}
					} catch {} finally {
						release();
					}
				}, { once: true });
				return image;
			}
			releaseCaptureVideo() {
				if (this.captureVideo === null) return;
				this.captureVideo.removeAttribute("src");
				this.captureVideo.load();
				this.captureVideo = null;
			}
			buildImage(url, fallbackUrl = null) {
				if (url === null) return null;
				const image = this.doc.createElement("img");
				image.src = url;
				image.alt = "";
				if (fallbackUrl !== null && fallbackUrl !== url) image.addEventListener("error", () => {
					if (image.src !== fallbackUrl) image.src = fallbackUrl;
				}, { once: true });
				styleCover(image, this.fitValue);
				return image;
			}
			/** Tag the official shell full-viewport background surfaces (AppFrame
			* frame, conversation root, details root) and the sidebar workspace-list
			* end fade with the own marker data-dsh-wallpaper-surface so the
			* neutralizer can target them without hashed class names (#734). Idempotent
			* across renders within one mount; untagged on teardown. */
			markSurfaces() {
				const root = this.doc.getElementById("root");
				if (root !== null) {
					const custom = this.options.declareSurface;
					const isSurface = custom !== void 0 ? (el) => custom(el, this.doc) : (el) => defaultWallpaperSurface(el, this.doc);
					const stack = [root];
					while (stack.length > 0) {
						const node = stack.pop();
						if (node === void 0) continue;
						if (node instanceof HTMLElement && !node.hasAttribute("data-dsh-wallpaper-surface") && isSurface(node)) {
							node.setAttribute("data-dsh-wallpaper-surface", "");
							this.taggedSurfaces.add(node);
						}
						for (const child of Array.from(node.children)) stack.push(child);
					}
				}
				this.markWorkspaceFades();
			}
			/** Tag the sidebar workspaces list-end fade with the same own marker (#734). */
			markWorkspaceFades() {
				const slot = this.doc.querySelector("[data-slot=\"sidebar.workspaces\"]");
				if (slot === null) return;
				const isFade = this.options.declareWorkspaceFade ?? defaultWorkspaceFade;
				const stack = [slot];
				while (stack.length > 0) {
					const node = stack.pop();
					if (node === void 0) continue;
					if (node instanceof HTMLElement && !node.hasAttribute("data-dsh-wallpaper-surface") && isFade(node, this.doc)) {
						node.setAttribute("data-dsh-wallpaper-surface", "");
						this.taggedSurfaces.add(node);
					}
					for (const child of Array.from(node.children)) stack.push(child);
				}
			}
			/**
			* Watch document.body (subtree) while a wallpaper is active and re-tag only
			* the surfaces affected by each mutation. Navigation rebuilds #root by
			* replacing its children, so the added subtrees are scanned instead of the
			* whole tree; removed nodes are untagged immediately. This avoids repeated
			* full-tree scans and forced layout during chat streaming (#review).
			*/
			ensureSurfaceObserver() {
				if (this.disposed || this.surfaceObserver !== null) return;
				const win = this.doc.defaultView;
				if (win === null || typeof win.MutationObserver !== "function") return;
				this.surfaceObserver = new win.MutationObserver((records) => this.handleSurfaceMutations(records));
				this.surfaceObserver.observe(this.doc.body, {
					childList: true,
					subtree: true
				});
			}
			/** Incrementally tag added subtrees and untag removed subtrees. */
			handleSurfaceMutations(records) {
				if (this.disposed || (this.previewing ?? this.applied) === null) return;
				for (const record of records) {
					for (const node of record.addedNodes) if (node instanceof HTMLElement) this.tagAddedSubtree(node);
					for (const node of record.removedNodes) if (node instanceof HTMLElement) this.untagRemovedSubtree(node);
				}
			}
			/** Tag newly added elements that qualify as full-viewport surfaces or workspace fades. */
			tagAddedSubtree(root) {
				const isSurface = this.options.declareSurface !== void 0 ? (el) => this.options.declareSurface(el, this.doc) : (el) => defaultWallpaperSurface(el, this.doc);
				const isFade = this.options.declareWorkspaceFade ?? defaultWorkspaceFade;
				const stack = [root];
				while (stack.length > 0) {
					const node = stack.pop();
					if (node === void 0) continue;
					if (!node.hasAttribute("data-dsh-wallpaper-surface")) {
						const inWallpaperLayer = node.closest("[data-dsh-wallpaper-layer]") !== null;
						const inWorkspaces = node.closest("[data-slot=\"sidebar.workspaces\"]") !== null;
						if (!inWallpaperLayer && (isSurface(node) || inWorkspaces && isFade(node, this.doc))) {
							node.setAttribute("data-dsh-wallpaper-surface", "");
							this.taggedSurfaces.add(node);
						}
					}
					for (const child of Array.from(node.children)) if (child instanceof HTMLElement) stack.push(child);
				}
			}
			/** Remove tags from a removed subtree and drop its references. */
			untagRemovedSubtree(root) {
				const stack = [root];
				while (stack.length > 0) {
					const node = stack.pop();
					if (node === void 0) continue;
					if (node.hasAttribute("data-dsh-wallpaper-surface")) {
						node.removeAttribute("data-dsh-wallpaper-surface");
						this.taggedSurfaces.delete(node);
					}
					for (const child of Array.from(node.children)) if (child instanceof HTMLElement) stack.push(child);
				}
			}
			untagSurfaces() {
				for (const el of Array.from(this.taggedSurfaces)) el.removeAttribute("data-dsh-wallpaper-surface");
				this.taggedSurfaces.clear();
			}
			teardownLayers() {
				this.releaseCaptureVideo();
				this.surfaceObserver?.disconnect();
				this.surfaceObserver = null;
				this.untagSurfaces();
				delete this.doc.body.dataset.dshWallpaperActive;
				delete this.doc.documentElement.dataset.dshWallpaperActive;
				setSceneBackdropActive(this.doc, "wallpaper", false);
				if (this.rootNeutralizer !== null) {
					this.rootNeutralizer.remove();
					this.rootNeutralizer = null;
				}
				if (this.videoElement !== null) {
					this.videoElement.pause();
					this.videoElement = null;
				}
				if (this.mediaLayer !== null) {
					this.mediaLayer.remove();
					this.mediaLayer = null;
				}
				if (this.scrimLayer !== null) {
					this.scrimLayer.remove();
					this.scrimLayer = null;
				}
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		/** Resolve a persisted selection id against an inventory list: exact id first, then the imported copy. */
		function resolveSelection(wallpapers, selection) {
			return wallpapers.find((w) => w.id === selection) ?? wallpapers.find((w) => w.id === "imported/" + selection);
		}
		/**
		* Restore the persisted wallpaper selection at boot: resolve it against the
		* host inventory and mount it, without waiting for the skin-center panel to
		* open — the panel's mount effect is the only other sync() caller, so a page
		* load with a persisted selection otherwise renders nothing until the card
		* is opened. Best-effort and idempotent: the first non-empty selection wins;
		* the panel re-resolves on open if the inventory is still in flight or fails.
		*/
		function installBootRestore(wallpaper) {
			let synced = false;
			const restore = () => {
				if (synced) return;
				const selected = wallpaper.selection();
				if (selected === "") return;
				synced = true;
				(async () => {
					try {
						const response = await fetch("/api/skin-center/we/inventory");
						if (!response.ok) return;
						const payload = await response.json().catch(() => null);
						if (payload?.ok !== true || !Array.isArray(payload.wallpapers)) return;
						const match = resolveSelection(payload.wallpapers, selected);
						if (match !== void 0) wallpaper.sync(match);
					} catch {}
				})();
			};
			restore();
			wallpaper.subscribe(restore);
		}
		//#endregion
		//#region src/client/SliderControl.tsx
		/**
		* A drag-smooth range slider that decouples the visible value from the
		* external store while the user drags (issue #725).
		*
		* Binding <input type="range"> directly to a useSyncExternalStore value
		* causes two defects during drag:
		* 1. Snapping back: the store subscription re-reads the scope snapshot while
		*    the async scope.set() write is still in flight, resetting the thumb
		*    to the old value mid-drag.
		* 2. Lag and stale labels: every onChange drives a full set -> publish ->
		*    React render cycle, and the displayed number only updates once the
		*    external store settles instead of following the thumb.
		*
		* This control keeps the input effectively uncontrolled: the browser moves
		* the thumb on the compositor thread with zero React involvement while
		* dragging, onInput reports the live value (one callback per animation
		* frame) so labels update in real time, and the final value is committed to
		* the external store through the native change event, which fires once per
		* completed pointer interaction (pointer release). Keyboard-only users get
		* an explicit commit path through onBlur and the Enter/Escape keydown
		* handlers, because not every engine fires the native change event for
		* range inputs on blur or Enter (jsdom does not; behavior varies by
		* browser). A pointer cancel aborts without committing, and the external
		* value is re-synced into the DOM only while the user is neither dragging
		* nor keyboard-focusing the input.
		* @module @linxin666/dsh-client-ui-skin-center/slider-control
		*/
		/**
		* A range slider that stays smooth during drag (issue #725).
		*
		* @param props - slider props.
		* @returns the range input element.
		*/
		function SliderControl({ value: externalValue, min = 0, max = 100, step = 1, onChange, onChanging, className, id, ariaLabel, ariaValuetext }) {
			const inputRef = (0, react.useRef)(null);
			const draggingRef = (0, react.useRef)(false);
			const rafRef = (0, react.useRef)(null);
			const liveRef = (0, react.useRef)(0);
			const lastCommittedRef = (0, react.useRef)(null);
			const onChangingRef = (0, react.useRef)(onChanging);
			onChangingRef.current = onChanging;
			const commitRef = (0, react.useRef)(onChange);
			commitRef.current = onChange;
			/**
			* Persist a value to the external store, de-duplicated against the last
			* committed value so the explicit keyboard/onBlur commit paths never
			* double-fire alongside the native change event (which real browsers also
			* emit on blur or Enter for range inputs).
			*/
			const commit = (0, react.useCallback)((value) => {
				if (lastCommittedRef.current === value) return;
				lastCommittedRef.current = value;
				commitRef.current(value);
			}, []);
			const commitCurrent = (0, react.useCallback)(() => {
				const input = inputRef.current;
				if (input === null) return;
				draggingRef.current = false;
				if (rafRef.current !== null) {
					cancelAnimationFrame(rafRef.current);
					rafRef.current = null;
				}
				commit(Number(input.value));
			}, [commit]);
			(0, react.useEffect)(() => {
				const input = inputRef.current;
				if (input !== null && !draggingRef.current && input !== input.ownerDocument.activeElement) input.value = String(externalValue);
			}, [externalValue]);
			(0, react.useEffect)(() => {
				const input = inputRef.current;
				if (input === null) return;
				const listener = () => {
					draggingRef.current = false;
					if (rafRef.current !== null) {
						cancelAnimationFrame(rafRef.current);
						rafRef.current = null;
					}
					commit(Number(input.value));
				};
				input.addEventListener("change", listener);
				return () => {
					input.removeEventListener("change", listener);
				};
			}, [commit]);
			(0, react.useEffect)(() => {
				return () => {
					if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
				};
			}, []);
			/** Throttled live-value reporter: fires onChanging at most once per frame. */
			const reportLive = (0, react.useCallback)((value) => {
				liveRef.current = value;
				if (rafRef.current !== null) return;
				rafRef.current = requestAnimationFrame(() => {
					rafRef.current = null;
					onChangingRef.current?.(liveRef.current);
				});
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				ref: inputRef,
				id,
				className,
				type: "range",
				min,
				max,
				step,
				defaultValue: externalValue,
				"aria-label": ariaLabel,
				"aria-valuetext": ariaValuetext,
				onPointerDown: (0, react.useCallback)(() => {
					draggingRef.current = true;
				}, []),
				onPointerCancel: (0, react.useCallback)(() => {
					draggingRef.current = false;
					if (rafRef.current !== null) {
						cancelAnimationFrame(rafRef.current);
						rafRef.current = null;
					}
				}, []),
				onInput: (0, react.useCallback)((event) => {
					reportLive(Number(event.currentTarget.value));
				}, [reportLive]),
				onBlur: (0, react.useCallback)(() => {
					if (draggingRef.current) return;
					commitCurrent();
				}, [commitCurrent]),
				onKeyDown: (0, react.useCallback)((event) => {
					if (event.key !== "Enter" && event.key !== "Escape") return;
					if (draggingRef.current) return;
					commitCurrent();
				}, [commitCurrent])
			});
		}
		//#endregion
		//#region src/client/WallpaperPanel.tsx
		/**
		* The wallpaper panel of the skin-center card: lists the user's local
		* Wallpaper Engine library (video / web / scene wallpapers) with live
		* try-on, one-click apply, local import, and render tuning. Rendering and
		* persistence ride the WallpaperController (wallpaper.ts); the library,
		* media, import and scene-frame bytes come from the host's /we routes.
		*
		* Compliance: wallpapers are the user's own local files (their Workshop
		* subscriptions or manual folders). The panel never downloads or shares
		* content; import only copies files within the user's machine.
		*/
		/** Live-label helper: the shown value follows the in-drag thumb immediately,
		* and falls back to the store value once the store settles (issue #725). */
		function useLiveValue$1(value) {
			const [live, setLive] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setLive(null);
			}, [value]);
			return [live ?? value, setLive];
		}
		/** Host base path of the wallpaper API (mirrors src/we-routes.ts). */
		const WE_API = "/api/skin-center/we";
		/** Post one wallpaper action and return whether it succeeded. */
		async function postWe(path, id) {
			try {
				const response = await fetch(WE_API + path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id })
				});
				const payload = await response.json().catch(() => null);
				if (!response.ok || payload?.ok !== true) return payload?.error ?? "HTTP " + String(response.status);
				return null;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		}
		/** The type badge copy key of one wallpaper. */
		function typeKey(item) {
			switch (item.type) {
				case "video": return "wallpaperTypeVideo";
				case "web": return "wallpaperTypeWeb";
				case "scene": return "wallpaperTypeScene";
				default: return "wallpaperTypeApp";
			}
		}
		/** Render the Wallpaper Engine section of the skin-center card. */
		function WallpaperPanel({ t, wallpaper }) {
			const enabled = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.enabled);
			const selection = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.selection);
			const mode = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.mode);
			const fit = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.fit);
			const dim = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.dim);
			const blur = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.wallpaperBlur);
			const pauseOnHidden = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.pauseOnHidden);
			const sound = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.sound);
			const volume = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.volume);
			const activeId = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.activeId);
			const trying = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.trying);
			const dirs = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.dirs);
			const [shownDim, setShownDim] = useLiveValue$1(dim);
			const [shownBlur, setShownBlur] = useLiveValue$1(blur);
			const [shownVolume, setShownVolume] = useLiveValue$1(volume);
			const [dirInput, setDirInput] = (0, react.useState)("");
			const [items, setItems] = (0, react.useState)(null);
			const [installDir, setInstallDir] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [actionError, setActionError] = (0, react.useState)(null);
			const [workingId, setWorkingId] = (0, react.useState)(null);
			const mounted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			/** Fetch the inventory and reconcile the mounted layer with the selection. */
			const load = (0, react.useCallback)(() => {
				fetch("/api/skin-center/we/inventory").then(async (response) => {
					const payload = await response.json().catch(() => null);
					if (!mounted.current) return;
					if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
						setLoadError(payload?.error ?? "HTTP " + String(response.status));
						setItems([]);
						return;
					}
					setLoadError(null);
					setItems(payload.wallpapers);
					setInstallDir(typeof payload.installDir === "string" ? payload.installDir : null);
					const selected = wallpaper.selection();
					wallpaper.sync(resolveSelection(payload.wallpapers, selected) ?? null);
				}).catch((error) => {
					if (!mounted.current) return;
					setLoadError(error instanceof Error ? error.message : String(error));
					setItems([]);
				});
			}, [wallpaper]);
			(0, react.useEffect)(load, [load]);
			/** Run one import/remove action with the shared busy + error state. */
			const runAction = (id, path, after) => {
				setActionError(null);
				setWorkingId(id);
				postWe(path, id).then((error) => {
					if (!mounted.current) return;
					setWorkingId(null);
					if (error !== null) {
						setActionError(error);
						return;
					}
					after?.();
					load();
				});
			};
			const descriptorOf = (item) => ({
				id: item.id,
				title: item.title,
				type: item.type,
				videoUrl: item.videoUrl,
				webUrl: item.webUrl,
				frameUrl: item.frameUrl,
				sceneUrl: item.sceneUrl,
				previewUrl: item.previewUrl
			});
			/** Whether one entry can be mounted at all in the current mode. */
			const renderable = (item) => item.playable || item.frameUrl !== null || item.previewUrl !== null;
			const activeSelection = selection;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: skin_center_module_css_default.wallpaperSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: skin_center_module_css_default.enableRow,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: skin_center_module_css_default.enableLabel,
							title: t("wallpaperEnable"),
							children: t("wallpaperTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "switch",
							"aria-checked": enabled,
							"aria-label": t("wallpaperEnable"),
							className: enabled ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
							onClick: () => {
								wallpaper.setEnabled(!enabled);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: skin_center_module_css_default.enableHint,
							children: t("wallpaperHint")
						})
					]
				}), enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperStatus,
						children: [loadError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: skin_center_module_css_default.wallpaperStatusError,
							children: [
								t("wallpaperLoadError"),
								": ",
								loadError
							]
						}) : items === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("loading") }) : installDir !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("wallpaperLibraryFound"),
							" · ",
							items.length
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("wallpaperLibraryManual"),
							" · ",
							items.length
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: skin_center_module_css_default.button,
							onClick: load,
							children: t("wallpaperRefresh")
						})]
					}),
					activeSelection !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperControls,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("wallpaperMode")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (mode === "live" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setMode("live");
										},
										children: t("wallpaperModeLive")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (mode === "frame" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setMode("frame");
										},
										children: t("wallpaperModeFrame")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonGhost,
										onClick: () => {
											wallpaper.clearSelection();
										},
										children: t("wallpaperClear")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("wallpaperFit")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "cover" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("cover");
										},
										children: t("wallpaperFitCover")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "contain" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("contain");
										},
										children: t("wallpaperFitContain")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "fill" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("fill");
										},
										children: t("wallpaperFitFill")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.backgroundRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.backgroundHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: skin_center_module_css_default.backgroundLabel,
											children: t("wallpaperDim")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: skin_center_module_css_default.backgroundValue,
											"aria-hidden": "true",
											children: [shownDim, "%"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
										className: skin_center_module_css_default.backgroundRange,
										min: 0,
										max: 90,
										step: 5,
										value: dim,
										ariaValuetext: shownDim + "%",
										ariaLabel: t("wallpaperDim"),
										onChanging: setShownDim,
										onChange: (value) => {
											wallpaper.setDim(value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.backgroundHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: skin_center_module_css_default.backgroundLabel,
											children: t("wallpaperBlur")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: skin_center_module_css_default.backgroundValue,
											"aria-hidden": "true",
											children: [shownBlur, "px"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
										className: skin_center_module_css_default.backgroundRange,
										min: 0,
										max: 60,
										step: 1,
										value: blur,
										ariaValuetext: shownBlur + "px",
										ariaLabel: t("wallpaperBlur"),
										onChanging: setShownBlur,
										onChange: (value) => {
											wallpaper.setBlur(value);
										}
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.enableRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.enableLabel,
									children: t("wallpaperPauseHidden")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": pauseOnHidden,
									"aria-label": t("wallpaperPauseHidden"),
									className: pauseOnHidden ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
									onClick: () => {
										wallpaper.setPauseOnHidden(!pauseOnHidden);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.enableRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.enableLabel,
									title: t("wallpaperSoundHint"),
									children: t("wallpaperSound")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": sound,
									"aria-label": t("wallpaperSound"),
									className: sound ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
									onClick: () => {
										wallpaper.setSound(!sound);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
								})]
							}),
							sound && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.backgroundRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("wallpaperVolume")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownVolume, "%"]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 100,
									step: 5,
									value: volume,
									ariaValuetext: shownVolume + "%",
									ariaLabel: t("wallpaperVolume"),
									onChanging: setShownVolume,
									onChange: (value) => {
										wallpaper.setVolume(value);
									}
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperDirs,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.themeLabel,
								children: t("wallpaperDirs")
							}),
							dirs.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.backgroundHintMuted,
								children: t("wallpaperDirsEmpty")
							}),
							dirs.map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: skin_center_module_css_default.wallpaperDir,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.wallpaperDirPath,
									title: dir,
									children: dir
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: skin_center_module_css_default.wallpaperDirRemove,
									"aria-label": t("wallpaperRemove"),
									onClick: () => {
										wallpaper.removeDir(dir);
										load();
									},
									children: "×"
								})]
							}, dir)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: skin_center_module_css_default.wallpaperDirAdd,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: skin_center_module_css_default.wallpaperDirInput,
									type: "text",
									value: dirInput,
									placeholder: t("wallpaperDirPlaceholder"),
									onChange: (event) => {
										setDirInput(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" && dirInput.trim() !== "") {
											wallpaper.addDir(dirInput);
											setDirInput("");
											load();
										}
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: skin_center_module_css_default.button,
									disabled: dirInput.trim() === "",
									onClick: () => {
										wallpaper.addDir(dirInput);
										setDirInput("");
										load();
									},
									children: t("wallpaperDirAdd")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: skin_center_module_css_default.backgroundHintMuted,
								children: t("wallpaperDirsHint")
							})
						]
					}),
					actionError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.error,
						children: actionError
					}),
					items !== null && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.wallpaperGrid,
						children: items.map((item) => {
							const isApplied = item.id === activeSelection;
							const isMounted = item.id === activeId;
							const busy = workingId === item.id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.wallpaperCard,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.wallpaperThumbWrap,
										children: [
											item.previewUrl !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: skin_center_module_css_default.wallpaperThumb,
												src: item.previewUrl,
												alt: "",
												loading: "lazy"
											}) : item.videoUrl !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
												className: skin_center_module_css_default.wallpaperThumb,
												src: item.videoUrl,
												preload: "metadata",
												muted: true,
												playsInline: true,
												"aria-hidden": "true"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: skin_center_module_css_default.wallpaperThumbEmpty,
												"aria-hidden": "true"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: skin_center_module_css_default.wallpaperType,
												children: t(typeKey(item))
											}),
											isMounted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: skin_center_module_css_default.badge + " " + (trying ? skin_center_module_css_default.badgeTrying : skin_center_module_css_default.badgeActive),
												children: trying ? t("tryingOn") : t("active")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: skin_center_module_css_default.wallpaperName,
										title: item.title,
										children: item.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.wallpaperActions,
										children: [
											isMounted && trying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonPrimary,
												onClick: () => {
													wallpaper.exitTryOn();
												},
												children: t("exitTryOn")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonPrimary,
												disabled: !renderable(item) || isMounted && isApplied || busy,
												onClick: () => {
													wallpaper.tryOn(descriptorOf(item));
												},
												children: t("tryOn")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: !renderable(item) || isApplied || busy,
												onClick: () => {
													wallpaper.applySelection(descriptorOf(item));
												},
												children: isApplied ? t("active") : t("apply")
											}),
											item.source === "imported" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [item.updateAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: busy,
												title: t("wallpaperUpdateAvailable"),
												onClick: () => {
													runAction(item.id, "/reimport");
												},
												children: busy ? t("loading") : t("wallpaperReimport")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonGhost,
												disabled: busy,
												onClick: () => {
													runAction(item.id, "/remove", () => {
														if (wallpaper.selection() === item.id) wallpaper.clearSelection();
													});
												},
												children: t("wallpaperRemove")
											})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: busy,
												title: t("wallpaperImportHint"),
												onClick: () => {
													runAction(item.id, "/import");
												},
												children: busy ? t("loading") : t("wallpaperImport")
											})
										]
									})
								]
							}, item.id);
						})
					}),
					items !== null && items.length === 0 && loadError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.backgroundHintMuted,
						children: t("wallpaperEmpty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.backgroundHintMuted,
						children: t("wallpaperLegal")
					})
				] })]
			});
		}
		//#endregion
		//#region src/client/SkinCenter.tsx
		/**
		* The skin-center card: rendered as the content of a first-level settings
		* section, listing the official stock look plus every skin in the v2 catalog
		* (built-in asset directories inside the skin-center package + user dirs
		* under $DSH_HOME/skins).
		*
		* v2 architecture (issue #506): skins are pure asset directories loaded by
		* the skin-center runtime. Try-on and apply both go through the same atomic
		* switch engine (src/client/runtime/skin-controller.ts) — try-on simply
		* skips persistence, and apply is one click with NO page reload, no
		* cordis.patch.yml rewrite, no boot-graph regeneration. The "trying on"
		* badge tracks the controller's live state, so closing and reopening the
		* settings panel keeps showing the skin that is still being previewed.
		* Copy rides the standard `t` seat; the theme preview control drives the
		* official theme service (persisted, same as the Appearance row).
		*/
		/** The apply target of the official stock-look card. */
		const OFFICIAL = "official";
		/**
		* Live-label helper: the shown value follows the in-drag thumb immediately,
		* and falls back to the store value once the store settles (issue #725).
		*/
		function useLiveValue(value) {
			const [live, setLive] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setLive(null);
			}, [value]);
			return [live ?? value, setLive];
		}
		/**
		* Render the skin-center card: a static header naming the plugin, with the
		* always-visible skin list (official default + every catalog skin; try-on /
		* theme preview / one-click apply) rendered below it.
		* @param props - card props.
		* @returns the plugin card.
		*/
		function SkinCenter({ t, runtime, theme, background, wallpaper, preview, customTheme }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => theme.subscribe(listener), () => theme.getTheme());
			const enabled = (0, react.useSyncExternalStore)(background.subscribe, background.enabled);
			const opacity = (0, react.useSyncExternalStore)(background.subscribe, background.opacity);
			const blurEmpty = (0, react.useSyncExternalStore)(background.subscribe, background.blurEmpty);
			const blurContent = (0, react.useSyncExternalStore)(background.subscribe, background.blurContent);
			const inputCardBlur = (0, react.useSyncExternalStore)(background.subscribe, background.inputCardBlur);
			const bubbleOpacity = (0, react.useSyncExternalStore)(background.subscribe, background.bubbleOpacity);
			const [shownOpacity, setShownOpacity] = useLiveValue(opacity);
			const [shownBlurEmpty, setShownBlurEmpty] = useLiveValue(blurEmpty);
			const [shownBlurContent, setShownBlurContent] = useLiveValue(blurContent);
			const [shownInputCardBlur, setShownInputCardBlur] = useLiveValue(inputCardBlur);
			const [shownBubbleOpacity, setShownBubbleOpacity] = useLiveValue(bubbleOpacity);
			const catalog = (0, react.useSyncExternalStore)(runtime.subscribe, runtime.catalog);
			const state = (0, react.useSyncExternalStore)(runtime.subscribe, runtime.controller.getState);
			const customThemeState = (0, react.useSyncExternalStore)(customTheme.subscribe, customTheme.getState);
			const activeId = state.active;
			const previewing = state.previewing;
			const tryingId = state.trying;
			const backdropActive = (activeId === null ? null : runtime.find(activeId))?.manifest.contributes.backgroundMedia !== void 0;
			const [busyId, setBusyId] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const mounted = (0, react.useRef)(false);
			const requestSeq = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const run = (target, action) => {
				const seq = ++requestSeq.current;
				setError(null);
				setBusyId(target);
				action().catch(() => {
					if (!mounted.current || seq !== requestSeq.current) return;
					setError(t("applyFailed"));
				}).finally(() => {
					if (!mounted.current || seq !== requestSeq.current) return;
					setBusyId(null);
				});
			};
			const tryOn = (entry) => {
				run(entry.manifest.id, () => preview.runSkin(() => runtime.controller.tryOn(entry.manifest.id, entry)));
			};
			const tryOnOfficial = () => {
				run(OFFICIAL, () => preview.runSkin(() => runtime.controller.tryOn(null, null)));
			};
			const exitTryOn = () => {
				run(tryingId ?? OFFICIAL, () => preview.runSkin(() => runtime.controller.exitTryOn()));
			};
			const restoreCommittedSkin = async (state) => {
				const entry = state.active === null ? null : runtime.find(state.active);
				if (state.active !== null && entry === null) throw new Error(`cannot restore skin ${state.active}`);
				if (await runtime.controller.switchTo(state.active, entry) !== state.active) throw new Error(`skin ${state.active ?? "stock"} did not restore`);
			};
			const switchAndDeactivateCustomTheme = async (target, entry) => {
				const previous = { ...runtime.controller.getState() };
				const active = await runtime.controller.switchTo(target, entry);
				if (active !== target) throw new Error(`${target === null ? "stock theme" : `skin ${target}`} did not activate`);
				try {
					await customTheme.deactivate();
					return active;
				} catch (error) {
					try {
						await restoreCommittedSkin(previous);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], "skin switch cleanup and rollback failed");
					}
					throw error;
				}
			};
			const restoreOfficialLook = async () => {
				const active = await switchAndDeactivateCustomTheme(null, null);
				if (wallpaper.selection() !== "") wallpaper.clearSelection();
				return active;
			};
			/**
			* One-click apply: atomic client-side switch + persisted selection. No
			* reload, no boot-graph wait — the tapIndex adapter makes the next page
			* load boot straight into this skin.
			* @param target - skin id, or `official` for the stock look.
			*/
			const applySkin = (target) => {
				if (target === OFFICIAL) {
					run(OFFICIAL, () => preview.runSkin(restoreOfficialLook));
					return;
				}
				const entry = runtime.find(target);
				if (entry === null) {
					setError(t("applyFailed"));
					return;
				}
				run(target, () => preview.runSkin(() => switchAndDeactivateCustomTheme(target, entry)));
			};
			const tryOnCustomTheme = () => {
				run("custom-theme", () => preview.runCustomTheme(async () => {
					const active = await runtime.controller.tryOn(null, null);
					if (active !== null) throw new Error("stock preview did not activate");
					customTheme.tryOn();
					return active;
				}));
			};
			const exitCustomThemeTryOn = () => {
				run("custom-theme", () => preview.runCustomTheme(async () => {
					customTheme.exitTryOn();
					return await runtime.controller.exitTryOn();
				}));
			};
			const applyCustomTheme = () => {
				run("custom-theme", () => preview.runCustomTheme(async () => {
					await customTheme.apply();
					const active = await runtime.controller.switchTo(null, null);
					if (active !== null) {
						await customTheme.deactivate();
						throw new Error("stock theme did not activate");
					}
					return active;
				}));
			};
			const dark = snapshot.active.colorScheme === "dark";
			/** One row: try-on control + apply button. Shared by the official card and every skin card. */
			const actionButtons = (opts) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: skin_center_module_css_default.actions,
				children: [opts.isActive && !opts.isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonGhost}`,
					disabled: true,
					children: t("tryOn")
				}) : opts.isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
					disabled: busyId !== null,
					onClick: exitTryOn,
					children: t("exitTryOn")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
					disabled: busyId !== null,
					onClick: opts.onTryOn,
					children: busyId === opts.key ? t("loading") : t("tryOn")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: skin_center_module_css_default.button,
					disabled: busyId !== null,
					onClick: () => {
						applySkin(opts.key);
					},
					children: busyId === opts.key ? t("applying") : opts.applyLabel
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: skin_center_module_css_default.pluginCard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: skin_center_module_css_default.cardHeaderStatic,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: skin_center_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: skin_center_module_css_default.pluginName,
							children: [t("title"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.titleBadge,
								children: String(catalog?.length ?? 0)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: skin_center_module_css_default.cardDescription,
							title: t("cardDescription"),
							children: t("cardDescription")
						})]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: skin_center_module_css_default.cardBody,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.enableRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.enableLabel,
								title: t("enabled"),
								children: t("enabled")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "switch",
								"aria-checked": enabled,
								"aria-label": t("enabled"),
								className: enabled ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
								onClick: () => {
									background.setEnabled(!enabled);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: skin_center_module_css_default.enableHint,
								children: t("enabledHint")
							})
						]
					}), enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.head,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: skin_center_module_css_default.intro,
								title: t("intro"),
								children: t("intro")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("theme")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${skin_center_module_css_default.themeButton} ${dark ? "" : skin_center_module_css_default.themeButtonActive}`,
										onClick: () => {
											theme.setTheme("light");
										},
										children: t("themeLight")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${skin_center_module_css_default.themeButton} ${dark ? skin_center_module_css_default.themeButtonActive : ""}`,
										onClick: () => {
											theme.setTheme("dark");
										},
										children: t("themeDark")
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundOpacity")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownOpacity, "%"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									id: "skin-center-background-opacity",
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 100,
									step: 5,
									value: opacity,
									ariaValuetext: shownOpacity + "%",
									ariaLabel: t("backgroundOpacity"),
									onChanging: setShownOpacity,
									onChange: (value) => {
										background.set(value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: backdropActive ? skin_center_module_css_default.backgroundHint : skin_center_module_css_default.backgroundHintMuted,
									children: backdropActive ? t("backgroundHint") : t("backgroundHintInert")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundBlurEmpty")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownBlurEmpty, "px"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									id: "skin-center-background-blur-empty",
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 20,
									step: 1,
									value: blurEmpty,
									ariaValuetext: shownBlurEmpty + "px",
									ariaLabel: t("backgroundBlurEmpty"),
									onChanging: setShownBlurEmpty,
									onChange: (value) => {
										background.setBlurEmpty(value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundBlurContent")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownBlurContent, "px"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									id: "skin-center-background-blur-content",
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 20,
									step: 1,
									value: blurContent,
									ariaValuetext: shownBlurContent + "px",
									ariaLabel: t("backgroundBlurContent"),
									onChanging: setShownBlurContent,
									onChange: (value) => {
										background.setBlurContent(value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: backdropActive ? skin_center_module_css_default.backgroundHint : skin_center_module_css_default.backgroundHintMuted,
									children: backdropActive ? t("backgroundBlurHint") : t("backgroundBlurInert")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("inputCardBlur")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownInputCardBlur, "px"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									id: "skin-center-input-card-blur",
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 20,
									step: 1,
									value: inputCardBlur,
									ariaValuetext: shownInputCardBlur + "px",
									ariaLabel: t("inputCardBlur"),
									onChanging: setShownInputCardBlur,
									onChange: (value) => {
										background.setInputCardBlur(value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: skin_center_module_css_default.backgroundHint,
									children: t("inputCardBlurHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("bubbleOpacity")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [shownBubbleOpacity, "%"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SliderControl, {
									id: "skin-center-bubble-opacity",
									className: skin_center_module_css_default.backgroundRange,
									min: 0,
									max: 100,
									step: 5,
									value: bubbleOpacity,
									ariaValuetext: shownBubbleOpacity + "%",
									ariaLabel: t("bubbleOpacity"),
									onChanging: setShownBubbleOpacity,
									onChange: (value) => {
										background.setBubbleOpacity(value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: skin_center_module_css_default.backgroundHint,
									children: t("bubbleOpacityHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WallpaperPanel, {
							t,
							wallpaper
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: skin_center_module_css_default.error,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.list,
							children: [
								(() => {
									const isActive = activeId === null && !previewing && !customThemeState.applied;
									const isTrying = previewing && tryingId === null && !customThemeState.previewing;
									const badge = isActive ? t("active") : isTrying ? t("tryingOn") : null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.card,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: skin_center_module_css_default.cardHead,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: skin_center_module_css_default.swatch,
														style: { background: "#98a1ab" },
														"aria-hidden": "true"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: skin_center_module_css_default.cardName,
														title: t("official"),
														children: t("official")
													}),
													badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
														children: badge
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: skin_center_module_css_default.cardTagline,
												title: t("officialTagline"),
												children: t("officialTagline")
											}),
											actionButtons({
												key: OFFICIAL,
												isActive,
												isTrying,
												onTryOn: tryOnOfficial,
												applyLabel: t("restore")
											})
										]
									}, OFFICIAL);
								})(),
								(catalog ?? []).map((entry) => {
									const id = entry.manifest.id;
									const isActive = id === activeId && !previewing;
									const isTrying = previewing && id === tryingId;
									const badge = isActive ? t("active") : isTrying ? t("tryingOn") : null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.card,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: skin_center_module_css_default.cardHead,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: skin_center_module_css_default.swatch,
														style: { background: entry.manifest.accent ?? "#98a1ab" },
														"aria-hidden": "true"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: skin_center_module_css_default.cardName,
														title: entry.manifest.nameEn,
														children: entry.manifest.nameEn
													}),
													badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
														children: badge
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: skin_center_module_css_default.cardTagline,
												title: entry.manifest.tagline ?? "",
												children: entry.manifest.tagline ?? ""
											}),
											actionButtons({
												key: id,
												isActive,
												isTrying,
												onTryOn: () => {
													tryOn(entry);
												},
												applyLabel: t("apply")
											})
										]
									}, id);
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CustomThemeCard, {
									t,
									customTheme,
									scheme: dark ? "dark" : "light",
									setScheme: (scheme) => {
										theme.setTheme(scheme);
									},
									isActive: customThemeState.applied && activeId === null && !previewing,
									isTrying: customThemeState.previewing,
									busy: busyId === "custom-theme",
									disabled: busyId !== null,
									onTryOn: tryOnCustomTheme,
									onExitTryOn: exitCustomThemeTryOn,
									onApply: applyCustomTheme
								})
							]
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.offNote,
						role: "status",
						children: t("offNote")
					})]
				})]
			});
		}
		/** Render the skin-center card as a first-level settings page. */
		function SkinCenterSection(props) {
			const { t, runtime, theme, background, wallpaper, preview, customTheme } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: skin_center_module_css_default.sectionList,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkinCenter, {
					t,
					runtime,
					theme,
					background,
					wallpaper,
					preview,
					customTheme
				})
			});
		}
		//#endregion
		//#region src/client/background.ts
		/** The namespace string the Host registers (mirrors src/index.ts). */
		const SKIN_BACKGROUND_NS = "skin-background";
		/** Field of the background value inside the namespace section. */
		const OPACITY_FIELD = "backgroundOpacity";
		/** Field of the empty-conversation backdrop blur inside the namespace section. */
		const BLUR_EMPTY_FIELD = "backgroundBlurEmpty";
		/** Field of the with-content backdrop blur inside the namespace section. */
		const BLUR_CONTENT_FIELD = "backgroundBlurContent";
		/** Field of the composer card backdrop blur inside the namespace section. */
		const INPUT_CARD_BLUR_FIELD = "inputCardBlur";
		/** CSS custom property written to document.body and read by backdrop skins. */
		const SCRIM_VAR = "--dsw-skin-scrim";
		/** Field of the message bubble opacity inside the namespace section. */
		const BUBBLE_OPACITY_FIELD = "bubbleOpacity";
		/** CSS custom property consumed by skins that expose translucent bubbles. */
		const BUBBLE_ALPHA_VAR = "--dsh-skin-bubble-alpha";
		/** CSS custom property consumed by the shared composer neutralizer. */
		const INPUT_CARD_BLUR_VAR = "--dsh-input-card-blur";
		/**
		* Selector for a conversation message row inside the shell's center column.
		* Official shell message rows carry `data-chat-anchor-key`; the
		* `data-pane="conversation"` attribute is stamped by the dsh-web-ui-all compat
		* shim on the center column, where the _userRow / _compactionRow /
		* _contextRow / _turnErrorRow suffixes are CSS-module message-row classes
		* (hash prefix varies, suffix is stable).
		*/
		const CONVERSATION_CONTENT_SELECTOR = [
			"[data-chat-anchor-key]",
			"[data-pane=\"conversation\"] [class*=\"_userRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_compactionRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_contextRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_turnErrorRow\"]"
		].join(", ");
		/**
		* Own the skin-background scope: read the latest occlusion + blur strengths,
		* apply them to the body instantly, and persist changes through the settings
		* scope.
		*/
		var BackgroundController = class {
			enabledValue = true;
			opacityValue = 0;
			blurEmptyValue = 0;
			blurContentValue = 0;
			inputCardBlurValue = 10;
			bubbleOpacityValue = 50;
			listeners = /* @__PURE__ */ new Set();
			scope;
			/** The fixed backdrop-filter element, present only while active blur > 0. */
			blurElement = null;
			/** The body MutationObserver, installed lazily once a blur is active. */
			observer = null;
			/** Pending requestAnimationFrame id for a coalesced recheck. */
			rafId = null;
			/** Guard: after dispose no scheduled work may reinstall anything. */
			disposed = false;
			/**
			* @param scope - the bound skin-background settings scope.
			*/
			constructor(scope) {
				this.scope = scope;
				this.enabledValue = this.readEnabled();
				this.opacityValue = this.readOpacity();
				this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD);
				this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD);
				this.inputCardBlurValue = this.readInputCardBlur();
				this.bubbleOpacityValue = this.readBubbleOpacity();
				this.applyOcclusion();
				this.applyInputCardBlur();
				this.applyBubbleOpacity();
				this.syncBlur();
				scope.subscribe(() => {
					this.enabledValue = this.readEnabled();
					this.opacityValue = this.readOpacity();
					this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD);
					this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD);
					this.inputCardBlurValue = this.readInputCardBlur();
					this.bubbleOpacityValue = this.readBubbleOpacity();
					this.applyOcclusion();
					this.applyInputCardBlur();
					this.applyBubbleOpacity();
					this.syncBlur();
					this.publish();
				});
			}
			enabled = () => this.enabledValue;
			setEnabled(value) {
				this.enabledValue = value;
				this.applyOcclusion();
				this.applyInputCardBlur();
				this.syncBlur();
				this.publish();
				this.scope.set("enabled", value);
			}
			opacity = () => this.opacityValue;
			blurEmpty = () => this.blurEmptyValue;
			blurContent = () => this.blurContentValue;
			inputCardBlur = () => this.inputCardBlurValue;
			bubbleOpacity = () => this.bubbleOpacityValue;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			set(opacity) {
				const clamped = Math.max(0, Math.min(100, Math.round(opacity)));
				this.opacityValue = clamped;
				this.applyOcclusion();
				this.publish();
				this.scope.set(OPACITY_FIELD, clamped);
			}
			setBlurEmpty(value) {
				const clamped = this.clampBlur(value);
				this.blurEmptyValue = clamped;
				this.ensureObserver();
				this.syncBlur();
				this.publish();
				this.scope.set(BLUR_EMPTY_FIELD, clamped);
			}
			setBlurContent(value) {
				const clamped = this.clampBlur(value);
				this.blurContentValue = clamped;
				this.ensureObserver();
				this.syncBlur();
				this.publish();
				this.scope.set(BLUR_CONTENT_FIELD, clamped);
			}
			setInputCardBlur(value) {
				const clamped = this.clampBlur(value);
				this.inputCardBlurValue = clamped;
				this.applyInputCardBlur();
				this.publish();
				this.scope.set(INPUT_CARD_BLUR_FIELD, clamped);
			}
			setBubbleOpacity(value) {
				const clamped = this.clampPercent(value);
				this.bubbleOpacityValue = clamped;
				this.applyBubbleOpacity();
				this.publish();
				this.scope.set(BUBBLE_OPACITY_FIELD, clamped);
			}
			dispose() {
				this.disposed = true;
				if (this.rafId !== null) {
					cancelAnimationFrame(this.rafId);
					this.rafId = null;
				}
				this.removeBlurElement();
				document.body.style.removeProperty(INPUT_CARD_BLUR_VAR);
				document.body.style.removeProperty(BUBBLE_ALPHA_VAR);
				if (this.observer !== null) {
					this.observer.disconnect();
					this.observer = null;
				}
			}
			/** The effective master-switch section value, defaulting to true when absent. */
			readEnabled() {
				const raw = this.scope.getSnapshot().value?.enabled;
				return typeof raw !== "boolean" ? true : raw;
			}
			/** The effective occlusion section value, clamped 0-100, defaulting to 0. */
			readOpacity() {
				const raw = this.scope.getSnapshot().value?.backgroundOpacity;
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
				return Math.max(0, Math.min(100, raw));
			}
			readInputCardBlur() {
				const raw = this.scope.getSnapshot().value?.inputCardBlur;
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 10;
				return this.clampBlur(raw);
			}
			readBubbleOpacity() {
				const raw = this.scope.getSnapshot().value?.bubbleOpacity;
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 50;
				return this.clampPercent(raw);
			}
			/** The effective blur section value for one field, clamped 0-20, defaulting to 0. */
			readBlur(field) {
				const raw = this.scope.getSnapshot().value?.[field];
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
				return this.clampBlur(raw);
			}
			clampBlur(value) {
				return Math.max(0, Math.min(20, Math.round(value)));
			}
			clampPercent(value) {
				return Math.max(0, Math.min(100, Math.round(value)));
			}
			applyInputCardBlur() {
				if (!this.enabledValue) {
					document.body.style.removeProperty(INPUT_CARD_BLUR_VAR);
					return;
				}
				document.body.style.setProperty(INPUT_CARD_BLUR_VAR, this.inputCardBlurValue + "px");
			}
			applyBubbleOpacity() {
				if (!this.enabledValue) {
					document.body.style.removeProperty(BUBBLE_ALPHA_VAR);
					return;
				}
				document.body.style.setProperty(BUBBLE_ALPHA_VAR, String(this.bubbleOpacityValue / 100));
			}
			/** Write the current occlusion onto the body CSS variable (0..1 alpha). */
			applyOcclusion() {
				if (!this.enabledValue) {
					document.body.style.removeProperty(SCRIM_VAR);
					return;
				}
				document.body.style.setProperty(SCRIM_VAR, String(this.opacityValue / 100));
			}
			/**
			* Apply the active blur: empty or with-content strength depending on the
			* conversation state. A value > 0 ensures the fixed blur element exists
			* with the matching backdrop-filter; 0 removes it.
			*/
			syncBlur() {
				if (this.disposed) return;
				if (this.hasWallpaper()) {
					this.removeBlurElement();
					return;
				}
				if (!this.enabledValue) {
					this.removeBlurElement();
					return;
				}
				this.ensureObserver();
				const active = this.hasConversationContent() ? this.blurContentValue : this.blurEmptyValue;
				if (active > 0) this.ensureBlurElement(active);
				else this.removeBlurElement();
			}
			/** True when the conversation pane hosts at least one message row. */
			hasConversationContent() {
				return document.querySelector(CONVERSATION_CONTENT_SELECTOR) !== null;
			}
			/** True while a Wallpaper Engine wallpaper is mounted. */
			hasWallpaper() {
				return document.documentElement.hasAttribute("data-dsh-wallpaper-active");
			}
			/** Create (if needed) and size the fixed backdrop-filter element. */
			ensureBlurElement(active) {
				if (this.blurElement === null) {
					const element = document.createElement("div");
					element.style.position = "fixed";
					element.style.inset = "0";
					element.style.zIndex = "-1";
					element.style.pointerEvents = "none";
					element.setAttribute("aria-hidden", "true");
					this.blurElement = element;
					document.body.appendChild(element);
				}
				const blur = "blur(" + active + "px)";
				this.blurElement.style.backdropFilter = blur;
				this.blurElement.style.setProperty("-webkit-backdrop-filter", blur);
			}
			/** Remove the fixed blur element, if present. */
			removeBlurElement() {
				if (this.blurElement === null) return;
				this.blurElement.remove();
				this.blurElement = null;
			}
			/**
			* Install the MutationObserver on document.body only when either blur
			* field is active, so a fully-disabled blur never pays the observation
			* cost. Runs lazily on the first non-zero set.
			*/
			ensureObserver() {
				if (this.disposed || this.observer !== null) return;
				if (this.blurEmptyValue <= 0 && this.blurContentValue <= 0) return;
				this.observer = new MutationObserver(() => this.scheduleRecheck());
				this.observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["class"]
				});
				this.observer.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["data-dsh-wallpaper-active"]
				});
			}
			/** Coalesce burst mutations into one rAF-delayed recheck. */
			scheduleRecheck() {
				if (this.disposed || this.rafId !== null) return;
				this.rafId = requestAnimationFrame(() => {
					this.rafId = null;
					if (this.disposed) return;
					this.syncBlur();
				});
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		const en = {
			title: "Skin Center",
			cardDescription: "Try on any installed skin live in the GUI — exit restores instantly, applying persists in one click.",
			enabled: "Enable skin center",
			enabledHint: "When off, try-on, apply and background controls are disabled; turn it back on to resume.",
			offNote: "The skin center is turned off.",
			intro: "Try on any skin live — it takes effect instantly, exit restores the current look. Apply persists it across restarts.",
			official: "Official default",
			officialTagline: "The stock DSH look with no skin applied.",
			active: "Active",
			tryingOn: "Trying on",
			tryOn: "Try on",
			loading: "Loading…",
			exitTryOn: "Exit try-on",
			apply: "Apply",
			applying: "Applying…",
			restore: "Restore",
			applyFailed: "Apply failed",
			appliedUnconfirmed: "Applied, but the change has not been confirmed — refresh the page in dev mode; packaged installs (DSH Desktop) need an app restart",
			appliedNeedRestart: "Applied and confirmed, but the host did not hot-reload — restart dsh to take effect",
			theme: "Theme preview",
			themeLight: "Light",
			themeDark: "Dark",
			tryOnError: "Try-on failed — see console",
			backgroundOpacity: "Background occlusion",
			backgroundBlurEmpty: "Blur when empty",
			backgroundBlurContent: "Blur with content",
			inputCardBlur: "Input card blur",
			inputCardBlurHint: "Blurs only the area behind the input card while backdrop art is visible; it does not blur the entire wallpaper.",
			bubbleOpacity: "Bubble opacity",
			bubbleOpacityHint: "Controls translucent message bubbles for skins that expose bubble alpha, such as Whale Mom.",
			backgroundBlurHint: "Applies a separate Gaussian blur to the backdrop for the empty conversation and the conversation with content; 0 disables.",
			backgroundBlurInert: "Visible only with skins that paint a backdrop; the official default has none.",
			backgroundHint: "Instantly veils the backdrop behind the panels — higher values obscure the art to help you focus.",
			backgroundHintInert: "Only applies to skins that paint a backdrop (Blue Fantasy / Whale Song). Applies to the official default automatically once such a skin is active.",
			wallpaperTitle: "Wallpaper Engine",
			wallpaperEnable: "Enable wallpapers",
			wallpaperHint: "Use your local Wallpaper Engine library as the GUI backdrop: video, web, and scene wallpapers render live (scene wallpapers need WebGL).",
			wallpaperLoadError: "Wallpaper library failed to load",
			wallpaperLibraryFound: "Wallpaper Engine library detected",
			wallpaperLibraryManual: "Manual folders only (no Wallpaper Engine install found; set folders in the skin-wallpaper settings)",
			wallpaperRefresh: "Refresh",
			wallpaperMode: "Render mode",
			wallpaperModeLive: "Live",
			wallpaperModeFrame: "Static frame",
			wallpaperFit: "Sizing mode",
			wallpaperFitCover: "Cover (fill)",
			wallpaperFitContain: "Fit (entire image)",
			wallpaperFitFill: "Stretch",
			wallpaperClear: "Turn off wallpaper",
			wallpaperDim: "Wallpaper dimming",
			wallpaperBlur: "Wallpaper blur",
			wallpaperPauseHidden: "Pause when window hidden",
			wallpaperSound: "Wallpaper sound",
			wallpaperSoundHint: "Play video wallpaper audio. The browser may keep it silent until you click or press a key once.",
			wallpaperVolume: "Wallpaper volume",
			wallpaperImport: "Import",
			wallpaperImportHint: "Copy this wallpaper into local storage, so it keeps working even if the Steam library moves or changes",
			wallpaperReimport: "Update",
			wallpaperRemove: "Remove",
			wallpaperUpdateAvailable: "The workshop original changed since import — update the local copy",
			wallpaperEmpty: "No wallpapers found. Subscribe in the Wallpaper Engine workshop, or add manual folders to the skin-wallpaper settings.",
			wallpaperLegal: "Wallpapers belong to their Workshop authors. Everything stays on this machine for personal use; nothing is uploaded or shared.",
			wallpaperTypeVideo: "Video",
			wallpaperTypeWeb: "Web",
			wallpaperTypeScene: "Scene (static)",
			wallpaperTypeApp: "Unsupported",
			wallpaperDirs: "Manual folders",
			wallpaperDirsEmpty: "No manual folders yet.",
			wallpaperDirsHint: "No Wallpaper Engine (e.g. macOS)? Point a folder at any .mp4/.webm files, a wallpaper project folder, or a folder of projects — they become your wallpaper library.",
			wallpaperDirPlaceholder: "/path/to/wallpapers or ~/Movies/wallpapers",
			wallpaperDirAdd: "Add",
			customThemeTitle: "Custom theme",
			customThemeTagline: "A separately saved palette derived from the official default theme.",
			customThemeEdit: "Edit",
			customThemeCloseEdit: "Collapse",
			customThemeMode: "Editing mode",
			customThemeLight: "Light",
			customThemeDark: "Dark",
			customThemeAccent: "Accent",
			customThemeBackground: "Background",
			customThemeForeground: "Foreground",
			customThemeContrast: "Contrast",
			customThemeReset: "Restore current mode default",
			customThemeResetHint: "Only resets the selected light or dark profile.",
			customThemeSaveFailed: "Could not save custom theme changes."
		};
		const zh = {
			title: "皮肤中心",
			cardDescription: "在 GUI 内即时试穿任意皮肤，退出即完全还原；应用一键完成并自动刷新。",
			enabled: "启用皮肤中心",
			enabledHint: "关闭后停用试穿、应用与背景控件，重新打开即恢复。",
			offNote: "皮肤中心已关闭。",
			intro: "任意皮肤可即时试穿，退出即完全还原；「应用」一键持久化，页面自动刷新生效。",
			official: "官方默认",
			officialTagline: "还原 DSH 官方默认外观，不应用任何皮肤。",
			active: "当前激活",
			tryingOn: "试穿中",
			tryOn: "试穿",
			loading: "加载中…",
			exitTryOn: "退出试穿",
			apply: "应用",
			applying: "应用中…",
			restore: "恢复默认",
			applyFailed: "应用失败",
			appliedUnconfirmed: "已写入配置但尚未确认生效——开发模式请刷新页面；打包版（DSH Desktop）需重启应用后生效",
			appliedNeedRestart: "已写入配置并确认生效，但宿主未热重载——请重启 dsh 后生效",
			theme: "主题预览",
			themeLight: "亮色",
			themeDark: "暗色",
			tryOnError: "试穿失败，详见控制台",
			backgroundOpacity: "背景遮挡",
			backgroundBlurEmpty: "空对话背景模糊",
			backgroundBlurContent: "有对话背景模糊",
			inputCardBlur: "输入卡模糊",
			inputCardBlurHint: "仅模糊输入卡背后的区域，不会让整张壁纸变糊。",
			bubbleOpacity: "气泡不透明度",
			bubbleOpacityHint: "调节支持气泡 alpha 的皮肤消息气泡，例如鲸鱼妈妈。",
			backgroundBlurHint: "对话为空与有内容时分别应用不同的背景高斯模糊强度，0 为关闭。",
			backgroundBlurInert: "仅对带背景图插画的皮肤可见；官方默认无背景图。",
			backgroundHint: "即时为面板背后的背景加遮罩——数值越高越能弱化插画，帮你集中注意力。",
			backgroundHintInert: "仅对带背景图插画的皮肤（蓝色幻想 / 鲸吟）生效；官方默认无背景图，该滑块对这些皮肤自动生效。",
			wallpaperTitle: "Wallpaper Engine",
			wallpaperEnable: "启用动态壁纸",
			wallpaperHint: "把本机 Wallpaper Engine 壁纸库用作 GUI 背景：视频、网页与场景壁纸均动态渲染（场景壁纸需要 WebGL）。",
			wallpaperLoadError: "壁纸库加载失败",
			wallpaperLibraryFound: "已检测到 Wallpaper Engine 壁纸库",
			wallpaperLibraryManual: "仅手动目录（未检测到 Wallpaper Engine 安装，可在 skin-wallpaper 设置里添加目录）",
			wallpaperRefresh: "刷新",
			wallpaperMode: "渲染模式",
			wallpaperModeLive: "动态",
			wallpaperModeFrame: "静态帧",
			wallpaperFit: "适应方式",
			wallpaperFitCover: "铺满裁剪",
			wallpaperFitContain: "完整缩放",
			wallpaperFitFill: "拉伸铺满",
			wallpaperClear: "关闭壁纸",
			wallpaperDim: "壁纸暗化",
			wallpaperBlur: "壁纸模糊",
			wallpaperPauseHidden: "窗口隐藏时暂停",
			wallpaperSound: "壁纸声音",
			wallpaperSoundHint: "播放视频壁纸的声音。浏览器可能在首次点击或按键前保持静音。",
			wallpaperVolume: "壁纸音量",
			wallpaperImport: "导入",
			wallpaperImportHint: "把该壁纸复制到本地存储，Steam 库迁移或变动后仍可继续使用",
			wallpaperReimport: "更新",
			wallpaperRemove: "移除",
			wallpaperUpdateAvailable: "工坊原件在导入后有更新——同步更新本地副本",
			wallpaperEmpty: "未发现壁纸。可先在 Wallpaper Engine 创意工坊订阅，或在 skin-wallpaper 设置里添加手动目录。",
			wallpaperLegal: "壁纸素材版权归创意工坊作者所有，仅供本机个人使用，不上传、不分享。",
			wallpaperTypeVideo: "视频",
			wallpaperTypeWeb: "网页",
			wallpaperTypeScene: "场景(静态)",
			wallpaperTypeApp: "不支持",
			wallpaperDirs: "手动目录",
			wallpaperDirsEmpty: "还没有手动目录。",
			wallpaperDirsHint: "没有 Wallpaper Engine（如 macOS）？把任意 .mp4/.webm 视频、单个壁纸项目文件夹或项目合集文件夹加进来，就是你的壁纸库。",
			wallpaperDirPlaceholder: "/path/to/wallpapers 或 ~/Movies/wallpapers",
			wallpaperDirAdd: "添加",
			customThemeTitle: "自定义主题",
			customThemeTagline: "基于官方默认主题生成并独立保存的配色方案。",
			customThemeEdit: "编辑",
			customThemeCloseEdit: "收起",
			customThemeMode: "编辑模式",
			customThemeLight: "浅色",
			customThemeDark: "深色",
			customThemeAccent: "强调色",
			customThemeBackground: "背景色",
			customThemeForeground: "前景色",
			customThemeContrast: "对比度",
			customThemeReset: "恢复当前模式默认",
			customThemeResetHint: "只重置当前选择的浅色或深色配置。",
			customThemeSaveFailed: "自定义主题修改保存失败。"
		};
		//#endregion
		//#region src/client/runtime/effect-ledger.ts
		function createEffectLedger(now = () => Date.now()) {
			let seq = 0;
			let nextActivation = 1;
			const log = [];
			const live = /* @__PURE__ */ new Map();
			const disposed = /* @__PURE__ */ new Set();
			function push(activationId, kind, label, replacesSeq) {
				seq += 1;
				log.push({
					seq,
					activationId,
					kind,
					label,
					replacesSeq,
					at: now()
				});
				return seq;
			}
			function release(effect, activationId) {
				if (effect.released) return;
				effect.released = true;
				push(activationId, "release", effect.label);
				try {
					effect.teardown();
				} catch {
					push(activationId, "cleanup-failed", effect.label);
				}
			}
			return {
				beginActivation() {
					const id = nextActivation++;
					live.set(id, []);
					push(id, "create", "activation");
					return id;
				},
				record(activationId, label, teardown) {
					const bucket = live.get(activationId);
					if (!bucket || disposed.has(activationId)) throw new Error(`effect "${label}" recorded on disposed/unknown activation ${activationId}`);
					const entrySeq = push(activationId, "create", label);
					bucket.push({
						seq: entrySeq,
						label,
						teardown,
						released: false
					});
					return entrySeq;
				},
				replace(activationId, label, previousSeq, teardown) {
					const bucket = live.get(activationId);
					if (!bucket || disposed.has(activationId)) throw new Error(`effect "${label}" replaced on disposed/unknown activation ${activationId}`);
					if (previousSeq !== void 0) {
						const previous = bucket.find((e) => e.seq === previousSeq);
						if (previous) release(previous, activationId);
					}
					const entrySeq = push(activationId, "replace", label, previousSeq);
					bucket.push({
						seq: entrySeq,
						label,
						teardown,
						released: false
					});
					return entrySeq;
				},
				disposeActivation(activationId) {
					if (disposed.has(activationId)) return;
					disposed.add(activationId);
					const bucket = live.get(activationId) ?? [];
					for (const effect of [...bucket].reverse()) release(effect, activationId);
				},
				isDisposed(activationId) {
					return disposed.has(activationId);
				},
				entries() {
					return log;
				}
			};
		}
		//#endregion
		//#region src/client/runtime/semantic-adapter.ts
		/**
		* The v1 rule table. Single ownership: only the skin-center edits this.
		* Anchors verified against @deepseek-ai rc.7 (see docs/archive survey).
		*/
		const SEMANTIC_RULES_V1 = [
			{
				selector: "[data-slot=\"root\"]",
				attrs: [["data-dsh-surface", "root"]],
				note: "ui-renderer root outlet"
			},
			{
				selector: "[data-slot=\"sidebar\"]",
				attrs: [["data-dsh-surface", "sidebar"]],
				note: "layout sidebar outlet"
			},
			{
				selector: "[data-slot=\"conversation\"]",
				attrs: [["data-dsh-surface", "conversation"]],
				note: "layout conversation outlet"
			},
			{
				selector: "[data-slot=\"conversation.session.header\"]",
				attrs: [["data-dsh-surface", "session-header"]],
				note: "conversation header outlet"
			},
			{
				selector: "[data-slot=\"conversation.composer\"]",
				attrs: [["data-dsh-surface", "composer"]],
				note: "composer chain outlet"
			},
			{
				selector: "[data-slot=\"details\"]",
				attrs: [["data-dsh-surface", "details"]],
				note: "layout details outlet"
			},
			{
				selector: "[data-shell-overlay]",
				attrs: [["data-dsh-surface", "overlay"]],
				note: "frame overlay attribute"
			},
			{
				selector: "[data-slot=\"shell.overlay\"]",
				attrs: [["data-dsh-surface", "overlay"]],
				note: "shell overlay outlet"
			},
			{
				selector: "[role=\"dialog\"]:has([data-slot=\"settings.section\"])",
				attrs: [["data-dsh-surface", "settings"]],
				note: "settings dialog (composite: dialog containing the section outlet)"
			},
			{
				selector: "[data-chat-flow-kind]",
				attrs: [["data-dsh-part", "message-row"]],
				note: "chat flow item"
			},
			{
				selector: "[data-streaming]",
				attrs: [["data-dsh-part", "message-body"]],
				note: "assistant markdown root"
			},
			{
				selector: "[data-conversation-scroll]",
				attrs: [["data-dsh-part", "scrollport"]],
				note: "conversation scrollport"
			},
			{
				selector: "textarea[data-phase]",
				attrs: [["data-dsh-part", "composer-input"]],
				note: "composer textarea"
			},
			{
				selector: "[data-decoration=\"chip\"]",
				attrs: [["data-dsh-part", "composer-chip"]],
				note: "composer reference chip"
			},
			{
				selector: "[data-queue-dock]",
				attrs: [["data-dsh-part", "queue-dock"]],
				note: "queued turns dock"
			},
			{
				selector: "[data-turn-tail]",
				attrs: [["data-dsh-part", "turn-tail"]],
				note: "turn tail row"
			},
			{
				selector: "[data-side]",
				attrs: [["data-dsh-part", "resize-handle"]],
				note: "column resize handle"
			},
			{
				selector: "[data-dsh-taskboard-view], [data-dsh-taskboard-board], [data-dsh-taskboard-entry]",
				attrs: [["data-dsh-plugin", "task-board"]],
				note: "task-board panel/board/sidebar entry"
			},
			{
				selector: "[data-dsh-ssh-view], [data-dsh-ssh-entry]",
				attrs: [["data-dsh-plugin", "ssh"]],
				note: "ssh panel/sidebar entry"
			},
			{
				selector: "[data-gitgraph-chip-anchor], [data-gitgraph-dialog]",
				attrs: [["data-dsh-plugin", "git-graph"]],
				note: "git-graph chip/dialog"
			},
			{
				selector: "[data-dsh-pet-root]",
				attrs: [["data-dsh-plugin", "pet"]],
				note: "pet global root"
			},
			{
				selector: "[data-dsh-taskboard-entry], [data-dsh-ssh-entry]",
				attrs: [["data-dsh-part", "sidebar-entry"]],
				note: "shared injected sidebar entry rows"
			}
		];
		function createSemanticAdapter(doc) {
			const rules = SEMANTIC_RULES_V1.map((rule) => ({
				rule,
				usable: true,
				matchedInPass: 0
			}));
			let observer = null;
			let stamped = 0;
			let running = false;
			const applyRule = (live, el) => {
				if (!live.usable) return;
				let hit = false;
				try {
					hit = el.matches(live.rule.selector);
				} catch {
					live.usable = false;
					return;
				}
				if (!hit) return;
				live.matchedInPass += 1;
				for (const [name, value] of live.rule.attrs) if (el.getAttribute(name) !== value) {
					el.setAttribute(name, value);
					stamped += 1;
				}
			};
			const applyToTree = (rootEl) => {
				for (const live of rules) {
					if (!live.usable) continue;
					applyRule(live, rootEl);
					let matches = [];
					try {
						matches = Array.from(rootEl.querySelectorAll(live.rule.selector));
					} catch {
						live.usable = false;
						continue;
					}
					for (const el of matches) applyRule(live, el);
				}
			};
			const fullPass = () => {
				for (const live of rules) live.matchedInPass = 0;
				if (doc.documentElement) applyToTree(doc.documentElement);
			};
			return {
				get running() {
					return running;
				},
				start() {
					if (running) return;
					running = true;
					fullPass();
					observer = new doc.defaultView.MutationObserver((records) => {
						try {
							for (const record of records) for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1) applyToTree(node);
						} catch {}
					});
					observer.observe(doc.body ?? doc.documentElement, {
						childList: true,
						subtree: true
					});
				},
				stop() {
					running = false;
					observer?.disconnect();
					observer = null;
				},
				diagnostics() {
					return {
						invalidRules: rules.filter((r) => !r.usable).map((r) => r.rule.selector),
						unmatchedRules: rules.filter((r) => r.usable && r.matchedInPass === 0).map((r) => r.rule.selector),
						stamped
					};
				}
			};
		}
		//#endregion
		//#region src/client/runtime/decoration-layers.ts
		const LAYER_ATTR = "data-dsh-skin-layer";
		/**
		* Per-layer paint order. The background sits at -2: negative z-index
		* elements paint ABOVE the html/body backgrounds (so a skin's own opaque
		* root background-color renders BEHIND its art — the v1 layering) yet below
		* every panel surface. It shares -2 with the WE scrim, which never paints
		* at the same time (an active WE wallpaper suppresses skin media, enforced
		* by the controller). The skin-background blur veil (-1) still samples the
		* art above it. Ambient effects paint above the veils; the strip/foreground
		* layers stay below the official overlay band (>=1000).
		*/
		const LAYER_STYLE = {
			background: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;",
			ambient: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:30;pointer-events:none;",
			top: "position:fixed;top:0;left:0;right:0;z-index:40;pointer-events:none;",
			bottom: "position:fixed;bottom:0;left:0;right:0;z-index:40;pointer-events:none;",
			sidebar: "position:fixed;top:0;bottom:0;left:0;z-index:40;pointer-events:none;",
			foreground: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:41;pointer-events:none;"
		};
		function ensureOne(doc, name) {
			const existing = doc.querySelector(`[${LAYER_ATTR}="${name}"]`);
			if (existing) {
				existing.style.cssText = LAYER_STYLE[name];
				return existing;
			}
			const el = doc.createElement("div");
			el.setAttribute(LAYER_ATTR, name);
			el.setAttribute("aria-hidden", "true");
			el.style.cssText = LAYER_STYLE[name];
			doc.body.appendChild(el);
			return el;
		}
		/**
		* Ensure all six layers exist and return their handles. Idempotent; safe to
		* call on every activation.
		*/
		function ensureDecorationLayers(doc) {
			return {
				background: ensureOne(doc, "background"),
				ambient: ensureOne(doc, "ambient"),
				top: ensureOne(doc, "top"),
				bottom: ensureOne(doc, "bottom"),
				sidebar: ensureOne(doc, "sidebar"),
				foreground: ensureOne(doc, "foreground")
			};
		}
		/** Remove every node an activation left in a layer (used on dispose). */
		function clearLayer(layer) {
			while (layer.firstChild) layer.removeChild(layer.firstChild);
		}
		/**
		* Build the background media element for a manifest backgroundMedia layer.
		* Returns null when the theme variant has no media. The element fills the
		* background layer; the scrim (when declared) is a sibling overlay.
		*/
		function buildBackgroundMedia(doc, layer, assetBase) {
			const nodes = [];
			const fullBleed = "position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;";
			if (layer.type === "image") {
				const img = doc.createElement("img");
				img.src = `${assetBase}/${layer.src}`;
				img.alt = "";
				img.setAttribute("aria-hidden", "true");
				img.style.cssText = fullBleed;
				nodes.push(img);
			} else {
				const video = doc.createElement("video");
				video.src = `${assetBase}/${layer.src}`;
				video.muted = true;
				video.loop = true;
				video.autoplay = true;
				video.playsInline = true;
				video.setAttribute("aria-hidden", "true");
				video.style.cssText = fullBleed;
				nodes.push(video);
			}
			if (layer.scrim) {
				const scrim = doc.createElement("div");
				scrim.setAttribute("aria-hidden", "true");
				scrim.style.cssText = `position:absolute;inset:0;background:${layer.scrim};`;
				nodes.push(scrim);
			}
			return nodes;
		}
		//#endregion
		//#region src/client/runtime/skin-controller.ts
		function createSkinController(deps) {
			const doc = deps.doc;
			const ledger = deps.ledger;
			const apiBase = deps.apiBase ?? "/api/skin-center/v2";
			const fetchImpl = deps.fetchImpl ?? fetch.bind(doc.defaultView);
			const layers = ensureDecorationLayers(doc);
			const onError = deps.onError ?? (() => {});
			const themeGet = deps.themeGet ?? (() => doc.body?.hasAttribute("data-ds-dark-theme") ? "dark" : "light");
			const themeSubscribe = deps.themeSubscribe ?? ((listener) => {
				let last = themeGet();
				const observer = new doc.defaultView.MutationObserver(() => {
					const next = themeGet();
					if (next !== last) {
						last = next;
						listener(next);
					}
				});
				if (doc.body) observer.observe(doc.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				return () => observer.disconnect();
			});
			/**
			* Re-paint the current activation's background media for the live
			* light/dark theme (the controller owns the layer, so a theme flip must
			* swap the variant the same way an activation does). No-op when there is
			* nothing painted or the manifest carries no backgroundMedia.
			*/
			function repaintBackgroundForTheme() {
				if (active === null || currentActivation === null || lastEntry === null) return;
				const media = lastEntry.manifest.contributes.backgroundMedia;
				if (!media) return;
				if (deps.suppressBackgroundMedia?.() === true) return;
				const variant = themeGet() === "dark" ? media.dark ?? media.light : media.light ?? media.dark;
				if (!variant) return;
				const assetBase = `${apiBase}/skins/${lastEntry.manifest.id}`;
				setBackgroundLayer(currentActivation, buildBackgroundMedia(doc, variant, assetBase));
			}
			const unsubscribeTheme = themeSubscribe(() => repaintBackgroundForTheme());
			const loadStylesheet = deps.loadStylesheet ?? ((href) => new Promise((resolveLink, rejectLink) => {
				const link = doc.createElement("link");
				link.rel = "stylesheet";
				link.href = href;
				const timer = setTimeout(() => rejectLink(/* @__PURE__ */ new Error(`stylesheet load timeout: ${href}`)), 15e3);
				link.onload = () => {
					clearTimeout(timer);
					resolveLink();
				};
				link.onerror = () => {
					clearTimeout(timer);
					rejectLink(/* @__PURE__ */ new Error(`stylesheet load failed: ${href}`));
				};
				doc.head.appendChild(link);
			}));
			let latestRequest = 0;
			let currentActivation = null;
			const initialSkinId = doc.documentElement?.getAttribute("data-dsh-skin") || null;
			let active = initialSkinId;
			/** The committed selection try-on restores (component scope). */
			let committed = {
				id: initialSkinId,
				entry: null
			};
			/** Last non-null applied entry, so refresh() can re-activate it. */
			let lastEntry = null;
			/** Last evaluated background-suppression verdict (refresh() skips no-ops). */
			let lastSuppressed = deps.suppressBackgroundMedia?.() === true;
			let trying = null;
			let previewing = false;
			const listeners = /* @__PURE__ */ new Set();
			let stateSnapshot = {
				active: initialSkinId,
				trying: null,
				previewing: false
			};
			const emit = () => {
				stateSnapshot = {
					active,
					trying,
					previewing
				};
				for (const listener of listeners) listener();
			};
			/**
			* Install one stylesheet as a tracked <link> (the load itself happened in
			* loadStylesheet; here we only register the teardown). Links keep relative
			* url() resolution intact — a <style> tag would resolve them against the
			* document and 404 every skin asset.
			*/
			function trackStylesheet(activation, label, href) {
				const link = doc.head.querySelector(`link[href="${href}"]`);
				ledger.record(activation, `style:${label}`, () => link?.remove());
			}
			/**
			* Paint the skin background art into the `background` decoration layer
			* (z-index:-2) with a snapshot for the activation ledger. Only the CURRENT
			* activation may restore: when an older activation is disposed after a
			* newer one already re-painted the layer, restoring its snapshot would
			* clobber the newer paint.
			*
			* Two reasons the art lives in the layer, not on `document.body`:
			*  - Chromium's backdrop-filter does not sample the canvas/body background,
			*    so the skin-center blur layer (z-index:-1) could never blur body-painted
			*    art (issue #732 defect A). A real fixed element IS sampled, so after
			*    this change the same blur + scrim controls work on the skin backdrop
			*    just like they already do on the Wallpaper Engine layers (issue #777).
			*  - dragon-heir hooks expect the art in ctx.layers.background (they swap
			*    the painted img and apply the v1 filter lift); the layer is the v2
			*    contract and body painting was a leftover half-migration.
			* The body's own opaque background is forced transparent while art is
			* mounted, or the shell's static panels would cover the negative-z layer.
			*/
			function setBackgroundLayer(activation, nodes) {
				const style = doc.body.style;
				const previousBackgroundColor = style.getPropertyValue("background-color");
				const previousScrim = style.getPropertyValue("--dsh-skin-scrim");
				const restore = () => {
					if (currentActivation !== activation) return;
					clearLayer(layers.background);
					setSceneBackdropActive(doc, "skin", false);
					if (previousScrim === "") style.removeProperty("--dsh-skin-scrim");
					else style.setProperty("--dsh-skin-scrim", previousScrim);
					if (previousBackgroundColor === "") style.removeProperty("background-color");
					else style.setProperty("background-color", previousBackgroundColor);
				};
				clearLayer(layers.background);
				if (nodes.length > 0) {
					for (const node of nodes) layers.background.appendChild(node);
					style.setProperty("background-color", "transparent");
					style.setProperty("--dsh-skin-scrim", "1");
					setSceneBackdropActive(doc, "skin", true);
				} else {
					setSceneBackdropActive(doc, "skin", false);
					style.setProperty("--dsh-skin-scrim", "0");
					if (previousBackgroundColor === "") style.removeProperty("background-color");
					else style.setProperty("background-color", previousBackgroundColor);
				}
				ledger.record(activation, "background:layer", restore);
			}
			function installBackground(activation, entry) {
				const media = entry.manifest.contributes.backgroundMedia;
				if (!media) {
					setBackgroundLayer(activation, []);
					return;
				}
				if (deps.suppressBackgroundMedia?.() === true) {
					setBackgroundLayer(activation, []);
					return;
				}
				const variant = themeGet() === "dark" ? media.dark ?? media.light : media.light ?? media.dark;
				if (!variant) {
					setBackgroundLayer(activation, []);
					return;
				}
				const assetBase = `${apiBase}/skins/${entry.manifest.id}`;
				setBackgroundLayer(activation, buildBackgroundMedia(doc, variant, assetBase));
			}
			async function installHooks(activation, entry) {
				if (!entry.manifest.facets?.client) return;
				const importHooks = deps.importHooks ?? ((url) => import(
					/* @vite-ignore */
					url
));
				try {
					const factory = (await importHooks(`${apiBase}/skins/${entry.manifest.id}/hooks.mjs`))?.default;
					if (typeof factory !== "function") throw new Error("hooks.mjs must default-export defineSkinHooks()");
					const hooks = factory();
					if (typeof hooks?.apply !== "function") throw new Error("defineSkinHooks() must return { apply }");
					const cleanups = [];
					const ctx = {
						skinId: entry.manifest.id,
						scopeAttr: entry.manifest.id,
						assetBase: `${apiBase}/skins/${entry.manifest.id}`,
						layers,
						theme: {
							get: themeGet,
							subscribe: themeSubscribe
						},
						onCleanup: (fn) => {
							cleanups.push(fn);
						}
					};
					hooks.apply(ctx);
					ledger.record(activation, "hooks", () => {
						try {
							hooks.dispose?.();
						} catch (error) {
							onError(`hooks dispose failed for ${entry.manifest.id}`, error);
						}
						for (const cleanup of cleanups.reverse()) try {
							cleanup();
						} catch (error) {
							onError(`hooks cleanup failed for ${entry.manifest.id}`, error);
						}
					});
				} catch (error) {
					onError(`hooks failed for ${entry.manifest.id}; static skin stays active`, error);
				}
			}
			async function persist(id) {
				if (deps.persist) {
					await deps.persist(id);
					return;
				}
				await fetchImpl(`${apiBase}/active`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ active: id })
				});
			}
			async function switchInternal(id, entry, shouldPersist) {
				const seq = ++latestRequest;
				const activation = ledger.beginActivation();
				try {
					if (id !== null && entry !== null) {
						const stylesheetHref = `${apiBase}/skins/${id}/stylesheet`;
						const patchesHref = entry.manifest.contributes.patches !== void 0 ? `${apiBase}/skins/${id}/patches` : null;
						await loadStylesheet(stylesheetHref);
						trackStylesheet(activation, "stylesheet", stylesheetHref);
						if (patchesHref !== null) {
							await loadStylesheet(patchesHref).catch(() => {});
							trackStylesheet(activation, "patches", patchesHref);
						}
						if (seq !== latestRequest) throw new StaleSwitch();
						installBackground(activation, entry);
						await installHooks(activation, entry);
					} else setBackgroundLayer(activation, []);
					if (seq !== latestRequest) throw new StaleSwitch();
					if (id === null) doc.documentElement.removeAttribute("data-dsh-skin");
					else doc.documentElement.setAttribute("data-dsh-skin", id);
					const previous = currentActivation;
					currentActivation = activation;
					active = id;
					if (entry !== null) lastEntry = entry;
					if (shouldPersist) {
						committed = {
							id,
							entry
						};
						trying = null;
						previewing = false;
					} else {
						previewing = id !== committed.id;
						trying = previewing ? id : null;
					}
					emit();
					if (previous !== null) ledger.disposeActivation(previous);
					if (shouldPersist) await persist(id).catch((error) => onError("failed to persist the skin selection", error));
					return active;
				} catch (error) {
					ledger.disposeActivation(activation);
					if (error instanceof StaleSwitch) return active;
					if (currentActivation === null) {
						active = null;
						committed = {
							id: null,
							entry: null
						};
						doc.documentElement.removeAttribute("data-dsh-skin");
						emit();
					}
					onError(`switch to ${id ?? "stock"} failed; previous skin intact`, error);
					return active;
				}
			}
			return {
				get active() {
					return active;
				},
				get layers() {
					return layers;
				},
				async switchTo(id, entry) {
					return await switchInternal(id, entry, true);
				},
				async tryOn(id, entry) {
					return await switchInternal(id, entry, false);
				},
				async exitTryOn() {
					return await switchInternal(committed.id, committed.entry, false);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				getState() {
					return stateSnapshot;
				},
				async refresh() {
					const suppressed = deps.suppressBackgroundMedia?.() === true;
					if (suppressed === lastSuppressed) return active;
					lastSuppressed = suppressed;
					const id = active;
					if (id !== null && lastEntry === null) return active;
					return await switchInternal(id, id === null ? null : lastEntry, false);
				},
				shutdown() {
					latestRequest += 1;
					unsubscribeTheme();
					if (currentActivation !== null) {
						ledger.disposeActivation(currentActivation);
						currentActivation = null;
					}
					active = null;
					trying = null;
					previewing = false;
					committed = {
						id: null,
						entry: null
					};
					emit();
					doc.documentElement.removeAttribute("data-dsh-skin");
				}
			};
		}
		var StaleSwitch = class extends Error {
			constructor() {
				super("superseded by a newer switch");
			}
		};
		//#endregion
		//#region src/client/runtime/boot.ts
		/**
		* Browser boot wiring for the v2 skin runtime (issue #506): one store per
		* document that owns the effect ledger, the skin controller, the semantic
		* adapter and the catalog snapshot. The settings card consumes the store;
		* the store outlives the card (settings panels unmount on close), so a
		* try-on preview survives closing and reopening the panel.
		*
		* Boot sequence: fetch the catalog snapshot once, read the persisted active
		* selection, and activate it (the tapIndex adapter already stamped the
		* attribute and preloaded the stylesheet for first paint; the controller
		* re-installs under ledger ownership so later switches stay atomic).
		* @module @linxin666/dsh-client-ui-skin-center/runtime/boot
		*/
		function bootSkinRuntime(options = {}) {
			const doc = options.doc ?? document;
			const apiBase = options.apiBase ?? "/api/skin-center/v2";
			const fetchImpl = options.fetchImpl ?? fetch.bind(doc.defaultView);
			const controller = createSkinController({
				doc,
				ledger: createEffectLedger(),
				apiBase,
				fetchImpl,
				suppressBackgroundMedia: options.suppressBackgroundMedia,
				onError: (message, error) => {
					console.error(`[skin-center] ${message}`, error);
				}
			});
			const adapter = createSemanticAdapter(doc);
			adapter.start();
			let catalog = null;
			let diagnostics = [];
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			async function refreshCatalog() {
				const res = await fetchImpl(`${apiBase}/catalog`);
				if (!res.ok) throw new Error(`catalog fetch -> ${res.status}`);
				const payload = await res.json();
				catalog = payload.skins ?? [];
				diagnostics = payload.diagnostics ?? [];
				emit();
			}
			const store = {
				controller,
				adapter,
				catalog: () => catalog,
				diagnostics: () => diagnostics,
				refreshCatalog,
				find(id) {
					return catalog?.find((s) => s.manifest.id === id) ?? null;
				},
				subscribe(listener) {
					const off = controller.subscribe(listener);
					listeners.add(listener);
					return () => {
						off();
						listeners.delete(listener);
					};
				},
				shutdown() {
					adapter.stop();
					controller.shutdown();
				}
			};
			{
				const root = doc.defaultView;
				root.__skinRuntime = store;
			}
			(async () => {
				try {
					await refreshCatalog();
					let active = doc.documentElement?.getAttribute("data-dsh-skin") || null;
					if (!active) {
						const payload = await (await fetchImpl(`${apiBase}/active`)).json();
						active = payload.ok && typeof payload.active === "string" ? payload.active : null;
					}
					if (active === null) return;
					const entry = store.find(active);
					if (entry === null) {
						await controller.switchTo(null, null);
						return;
					}
					await controller.switchTo(active, entry);
				} catch {
					await controller.switchTo(null, null).catch(() => {});
				}
			})();
			return store;
		}
		//#endregion
		//#region src/client/preview-coordinator.ts
		var PreviewCoordinator = class {
			skin;
			wallpaper;
			customTheme;
			tail = Promise.resolve();
			constructor(skin, wallpaper, customTheme) {
				this.skin = skin;
				this.wallpaper = wallpaper;
				this.customTheme = customTheme;
			}
			runSkin(action) {
				return this.enqueue(async () => {
					if (this.wallpaper.trying()) this.wallpaper.exitTryOn();
					if (this.customTheme?.getState().previewing === true) this.customTheme.exitTryOn();
					this.customTheme?.suspend();
					try {
						return await action();
					} finally {
						if (!this.skin.getState().previewing) this.customTheme?.resume();
					}
				});
			}
			runWallpaper(action) {
				return this.enqueue(async () => {
					if (this.customTheme?.getState().previewing === true) this.customTheme.exitTryOn();
					if (this.skin.getState().previewing) await this.skin.exitTryOn();
					this.customTheme?.resume();
					action();
				});
			}
			runCustomTheme(action) {
				return this.enqueue(async () => {
					if (this.wallpaper.trying()) this.wallpaper.exitTryOn();
					if (!(this.customTheme?.getState().previewing === true) && this.skin.getState().previewing) await this.skin.exitTryOn();
					this.customTheme?.resume();
					return await action();
				});
			}
			enqueue(action) {
				const run = this.tail.then(action, action);
				this.tail = run.then(() => void 0, () => void 0);
				return run;
			}
		};
		//#endregion
		//#region src/core/custom-theme.ts
		/** Versioned user theme derived from the official stock theme. */
		const SKIN_CUSTOM_THEME_NS = "skin-custom-theme";
		const CUSTOM_THEME_DEFAULTS = {
			version: 1,
			applied: false,
			light: {
				accent: "#4d6bfe",
				background: "#f7f8fa",
				foreground: "#262626",
				contrast: 50
			},
			dark: {
				accent: "#7c91ff",
				background: "#171719",
				foreground: "#f3f3f3",
				contrast: 50
			}
		};
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function color(value, fallback) {
			return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
		}
		function contrast(value, fallback) {
			if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
			return Math.max(0, Math.min(100, Math.round(value)));
		}
		function normalizeProfile(value, fallback) {
			const source = record(value);
			return {
				accent: color(source.accent, fallback.accent),
				background: color(source.background, fallback.background),
				foreground: color(source.foreground, fallback.foreground),
				contrast: contrast(source.contrast, fallback.contrast)
			};
		}
		/** Normalize untrusted settings data into the current contract version. */
		function normalizeCustomThemeConfig(value) {
			const source = record(value);
			if (source.version !== void 0 && source.version !== 1) return {
				version: 1,
				applied: false,
				light: { ...CUSTOM_THEME_DEFAULTS.light },
				dark: { ...CUSTOM_THEME_DEFAULTS.dark }
			};
			return {
				version: 1,
				applied: source.applied === true,
				light: normalizeProfile(source.light, CUSTOM_THEME_DEFAULTS.light),
				dark: normalizeProfile(source.dark, CUSTOM_THEME_DEFAULTS.dark)
			};
		}
		function mix(a, aPercent, b) {
			return `color-mix(in srgb, ${a} ${aPercent}%, ${b})`;
		}
		function declarations(profile) {
			const { accent, background, foreground } = profile;
			const depth1 = 2 + Math.round(profile.contrast * .12);
			const depth2 = depth1 + 4;
			const depth3 = depth2 + 4;
			const border = 12 + Math.round(profile.contrast * .18);
			const mutedText = 60 + Math.round(profile.contrast * .2);
			return [
				["--dsw-alias-bg-base", background],
				["--dsw-alias-bg-layer-1", mix(background, 100 - depth1, foreground)],
				["--dsw-alias-bg-layer-2", mix(background, 100 - depth2, foreground)],
				["--dsw-alias-bg-layer-3", mix(background, 100 - depth3, foreground)],
				["--dsw-alias-bg-multi-select", mix(background, 84, accent)],
				["--dsw-alias-bg-overlay", mix(background, 90 - Math.round(profile.contrast * .08), foreground)],
				["--dsw-alias-bg-skeleton", mix(background, 82, foreground)],
				["--dsw-alias-border-l1", mix(background, 100 - border, foreground)],
				["--dsw-alias-border-l2", mix(background, 100 - Math.max(8, border - 5), foreground)],
				["--dsw-alias-border-l3", mix(background, 100 - Math.max(5, border - 9), foreground)],
				["--dsw-alias-border-l4", mix(background, 96, foreground)],
				["--dsw-alias-brand-primary", accent],
				["--dsw-alias-brand-primary-invert", background],
				["--dsw-alias-brand-text", accent],
				["--dsw-alias-button-primary-dimmed", mix(accent, 48, background)],
				["--dsw-alias-button-primary-fill", accent],
				["--dsw-alias-button-primary-hover", mix(accent, 82, foreground)],
				["--dsw-alias-interactive-bg-active", mix(background, 78, accent)],
				["--dsw-alias-interactive-bg-hover", mix(background, 100 - depth2, foreground)],
				["--dsw-alias-interactive-bg-hover-accent", mix(background, 84, accent)],
				["--dsw-alias-label-dimmed", mix(foreground, 42, background)],
				["--dsw-alias-label-primary", foreground],
				["--dsw-alias-label-primary-foreground", foreground],
				["--dsw-alias-label-secondary", mix(foreground, mutedText, background)],
				["--dsw-alias-label-tertiary", mix(foreground, Math.max(45, mutedText - 18), background)],
				["--dsw-alias-markdown-code-block", mix(background, 100 - depth2, foreground)],
				["--dsw-alias-markdown-code-block-banner", mix(background, 100 - depth3, foreground)],
				["--dsw-alias-markdown-inline-code", mix(background, 86, accent)],
				["--dsw-alias-scrollbar-bg-l1", mix(background, 94, foreground)],
				["--dsw-alias-scrollbar-hover-l1", mix(background, 76, foreground)],
				["--dsw-alias-toast-bg", mix(background, 100 - depth3, foreground)],
				["--dsw-alias-tooltip-bg", mix(background, 28, foreground)],
				["--dsw-specific-bubble", mix(background, 92, accent)],
				["--dsw-specific-bubble-highlight", mix(background, 82, accent)],
				["--dsw-specific-input-major", mix(background, 100 - depth1, foreground)],
				["--dsw-specific-menu", mix(background, 100 - depth1, foreground)],
				["--dsw-specific-selector", mix(background, 100 - depth2, foreground)],
				["--dsw-specific-sidebar-fill", mix(background, 100 - depth1, foreground)],
				["--dsw-specific-sidebar-nav-item-active", mix(background, 86, accent)],
				["--dsw-specific-sidebar-nav-item-active-accent", accent],
				["--dsw-specific-sidebar-nav-item-hover", mix(background, 100 - depth2, foreground)]
			];
		}
		function block(selector, profile) {
			return `${selector} {\n${declarations(profile).map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}`;
		}
		/** Build stock-only CSS from normalized, fixed token declarations. */
		function buildCustomThemeCss(value) {
			const config = normalizeCustomThemeConfig(value);
			return [block("html[data-dsh-custom-theme]:not([data-dsh-skin]) body", config.light), block("html[data-dsh-custom-theme]:not([data-dsh-skin]) body[data-ds-dark-theme]", config.dark)].join("\n\n");
		}
		//#endregion
		//#region src/client/custom-theme-controller.ts
		/** Owns the custom-theme settings snapshot and its inert-by-default style. */
		var CustomThemeController = class {
			scope;
			doc;
			style;
			unsubscribe;
			listeners = /* @__PURE__ */ new Set();
			config;
			previewingValue = false;
			suspended = false;
			state;
			disposed = false;
			writeQueue = [];
			pendingWrites = 0;
			drainingWrites = false;
			constructor(scope, options = {}) {
				this.scope = scope;
				this.doc = options.doc ?? document;
				this.config = normalizeCustomThemeConfig(scope.getSnapshot().value);
				this.style = this.doc.createElement("style");
				this.style.dataset.dshCustomThemeStyle = "";
				this.doc.head.appendChild(this.style);
				this.state = {
					applied: this.config.applied,
					previewing: false,
					visible: false,
					writeError: null
				};
				this.syncDom();
				this.unsubscribe = scope.subscribe(() => {
					if (this.disposed || this.pendingWrites > 0) return;
					this.syncFromScope();
				});
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getState = () => this.state;
			profile(scheme) {
				return { ...this.config[scheme] };
			}
			setProfileValue(scheme, key, value) {
				const next = normalizeCustomThemeConfig({
					...this.config,
					[scheme]: {
						...this.config[scheme],
						[key]: value
					}
				});
				this.config = next;
				this.clearWriteError();
				this.syncDom();
				this.publish();
				this.queueWrite(scheme, { ...next[scheme] }).catch((error) => {
					this.setWriteError(error);
				});
			}
			reset(scheme) {
				const profile = { ...CUSTOM_THEME_DEFAULTS[scheme] };
				this.config = {
					...this.config,
					[scheme]: profile
				};
				this.clearWriteError();
				this.syncDom();
				this.publish();
				this.queueWrite(scheme, profile).catch((error) => {
					this.setWriteError(error);
				});
			}
			tryOn() {
				this.previewingValue = true;
				this.suspended = false;
				this.syncDom();
				this.publish();
			}
			exitTryOn() {
				this.previewingValue = false;
				this.suspended = false;
				this.syncDom();
				this.publish();
			}
			async apply() {
				this.config = {
					...this.config,
					applied: true
				};
				this.previewingValue = false;
				this.suspended = false;
				this.syncDom();
				this.publish();
				await this.queueWrite("applied", true);
				if (!this.config.applied) throw new Error("custom theme activation was not persisted");
			}
			async deactivate() {
				this.config = {
					...this.config,
					applied: false
				};
				this.previewingValue = false;
				this.suspended = false;
				this.syncDom();
				this.publish();
				await this.queueWrite("applied", false);
				if (this.config.applied) throw new Error("custom theme deactivation was not persisted");
			}
			suspend() {
				if (this.suspended) return;
				this.suspended = true;
				this.syncDom();
				this.publish();
			}
			resume() {
				if (!this.suspended) return;
				this.suspended = false;
				this.syncDom();
				this.publish();
			}
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.unsubscribe();
				this.listeners.clear();
				this.style.remove();
				this.doc.documentElement.removeAttribute("data-dsh-custom-theme");
			}
			syncDom() {
				this.style.textContent = buildCustomThemeCss(this.config);
				const visible = (this.config.applied || this.previewingValue) && !this.suspended;
				if (visible) this.doc.documentElement.setAttribute("data-dsh-custom-theme", "true");
				else this.doc.documentElement.removeAttribute("data-dsh-custom-theme");
				this.state = {
					applied: this.config.applied,
					previewing: this.previewingValue,
					visible,
					writeError: this.state.writeError
				};
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
			syncFromScope() {
				this.config = normalizeCustomThemeConfig(this.scope.getSnapshot().value);
				this.syncDom();
				this.publish();
			}
			clearWriteError() {
				if (this.state.writeError === null) return;
				this.state = {
					...this.state,
					writeError: null
				};
			}
			setWriteError(error) {
				this.state = {
					...this.state,
					writeError: error instanceof Error ? error.message : String(error)
				};
				this.publish();
			}
			queueWrite(field, value) {
				this.pendingWrites += 1;
				const pending = new Promise((resolve, reject) => {
					this.writeQueue.push({
						field,
						value,
						resolve,
						reject
					});
				});
				this.drainWrites();
				return pending;
			}
			async drainWrites() {
				if (this.drainingWrites) return;
				this.drainingWrites = true;
				const settled = [];
				while (this.writeQueue.length > 0) {
					const write = this.writeQueue.shift();
					if (write === void 0) break;
					try {
						await this.scope.set(write.field, write.value);
					} catch (error) {
						settled.push({
							write,
							ok: false,
							error
						});
						continue;
					} finally {
						this.pendingWrites -= 1;
					}
					settled.push({
						write,
						ok: true
					});
				}
				this.drainingWrites = false;
				if (!this.disposed) this.syncFromScope();
				const failure = settled.find((result) => !result.ok);
				if (!this.disposed && failure !== void 0 && !failure.ok) this.setWriteError(failure.error);
				for (const result of settled) if (result.ok) result.write.resolve();
				else result.write.reject(result.error);
			}
		};
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "skinCenter";
		/** Required services: slots + locale (plugin card), theme (preview toggle), and settingsScope + its transport (background scrim). */
		const inject = [
			"slots",
			"locale",
			"theme",
			"settingsScope",
			"connection",
			"remote"
		];
		/**
		* Register the skin-center dictionaries, the body scope attribute, and the
		* Skin Center as a first-level settings section.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-skin-center: dictionaries");
			ctx.effect(() => {
				document.body.dataset.dshSkinCenter = "";
				return () => {
					delete document.body.dataset.dshSkinCenter;
				};
			}, "ui-skin-center: body scope");
			const theme = ctx.get("theme");
			const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
			const background = new BackgroundController(binder.bind({ namespace: SKIN_BACKGROUND_NS }));
			ctx.effect(() => () => background.dispose(), "ui-skin-center: background dispose");
			const customTheme = new CustomThemeController(binder.bind({ namespace: SKIN_CUSTOM_THEME_NS }));
			ctx.effect(() => () => customTheme.dispose(), "ui-skin-center: custom theme dispose");
			const wallpaper = new WallpaperController(binder.bind({ namespace: SKIN_WALLPAPER_NS }));
			ctx.effect(() => () => wallpaper.dispose(), "ui-skin-center: wallpaper dispose");
			installBootRestore(wallpaper);
			const runtime = bootSkinRuntime({ suppressBackgroundMedia: () => wallpaper.enabled() && wallpaper.activeId() !== null && wallpaper.activeId() !== "" });
			ctx.effect(() => () => runtime.shutdown(), "ui-skin-center: runtime shutdown");
			ctx.effect(() => wallpaper.subscribe(() => {
				runtime.controller.refresh();
			}), "ui-skin-center: wallpaper priority refresh");
			const preview = new PreviewCoordinator(runtime.controller, wallpaper, customTheme);
			ctx.effect(() => ctx.on("theme/change", () => wallpaper.recoverScenePlayer()), "ui-skin-center: scene recovery after theme change");
			const injected = () => ({
				runtime,
				preview,
				customTheme,
				theme: {
					getTheme: () => theme.getTheme(),
					subscribe: (listener) => ctx.on("theme/change", listener),
					setTheme: (id) => theme.setTheme(id)
				},
				background: {
					enabled: () => background.enabled(),
					setEnabled: (value) => background.setEnabled(value),
					opacity: () => background.opacity(),
					blurEmpty: () => background.blurEmpty(),
					blurContent: () => background.blurContent(),
					inputCardBlur: () => background.inputCardBlur(),
					bubbleOpacity: () => background.bubbleOpacity(),
					subscribe: (listener) => background.subscribe(listener),
					set: (opacity) => background.set(opacity),
					setBlurEmpty: (value) => background.setBlurEmpty(value),
					setBlurContent: (value) => background.setBlurContent(value),
					setInputCardBlur: (value) => background.setInputCardBlur(value),
					setBubbleOpacity: (value) => background.setBubbleOpacity(value),
					dispose: () => background.dispose()
				},
				wallpaper: {
					enabled: () => wallpaper.enabled(),
					selection: () => wallpaper.selection(),
					mode: () => wallpaper.mode(),
					fit: () => wallpaper.fit(),
					dim: () => wallpaper.dim(),
					wallpaperBlur: () => wallpaper.wallpaperBlur(),
					pauseOnHidden: () => wallpaper.pauseOnHidden(),
					sound: () => wallpaper.sound(),
					volume: () => wallpaper.volume(),
					dirs: () => wallpaper.dirs(),
					addDir: (dir) => wallpaper.addDir(dir),
					removeDir: (dir) => wallpaper.removeDir(dir),
					activeId: () => wallpaper.activeId(),
					trying: () => wallpaper.trying(),
					subscribe: (listener) => wallpaper.subscribe(listener),
					setEnabled: (value) => wallpaper.setEnabled(value),
					setMode: (value) => wallpaper.setMode(value),
					setFit: (fit) => wallpaper.setFit(fit),
					setDim: (value) => wallpaper.setDim(value),
					setBlur: (value) => wallpaper.setBlur(value),
					setPauseOnHidden: (value) => wallpaper.setPauseOnHidden(value),
					setSound: (value) => wallpaper.setSound(value),
					setVolume: (value) => wallpaper.setVolume(value),
					applySelection: (descriptor) => {
						preview.runWallpaper(() => wallpaper.applySelection(descriptor));
					},
					clearSelection: () => wallpaper.clearSelection(),
					sync: (descriptor) => wallpaper.sync(descriptor),
					tryOn: (descriptor) => {
						preview.runWallpaper(() => wallpaper.tryOn(descriptor));
					},
					exitTryOn: () => wallpaper.exitTryOn(),
					recoverScenePlayer: () => wallpaper.recoverScenePlayer(),
					dispose: () => wallpaper.dispose()
				}
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skin-center",
				order: 120,
				label: () => ctx.locale.bind("skinCenter")("title"),
				locale: "skinCenter",
				inject: injected
			}, SkinCenterSection));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.bootSkinRuntime = bootSkinRuntime;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map