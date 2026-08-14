window.__ModuleLoader__.load({
	id: "@linxin666/dsh-web-auth-gateway",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:/root/codes/dsh-web-ui/packages/dsh-web-auth-gateway/src/client/gateway-settings.module.css.mjs
		const css = ".NA9o5a_card{gap:18px;padding:4px 0;display:grid}.NA9o5a_row{justify-content:space-between;align-items:center;gap:24px;display:flex}.NA9o5a_row p,.NA9o5a_field small{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;display:block}.NA9o5a_row input{width:18px;height:18px}.NA9o5a_field{gap:6px;display:grid}.NA9o5a_field>span{font-weight:600}.NA9o5a_field input{box-sizing:border-box;width:180px;max-width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:8px 10px}.NA9o5a_actions{justify-content:flex-end;gap:8px;display:flex}.NA9o5a_actions button{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:7px 14px}.NA9o5a_actions button:disabled{opacity:.5}.NA9o5a_actions .NA9o5a_primary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-color:#0000}.NA9o5a_error{color:var(--dsw-alias-state-error-primary)}";
		const tagId = "@linxin666/dsh-web-auth-gateway/gateway-settings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-web-auth-gateway";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var gateway_settings_module_css_default = {
			"actions": "NA9o5a_actions",
			"card": "NA9o5a_card",
			"error": "NA9o5a_error",
			"field": "NA9o5a_field",
			"primary": "NA9o5a_primary",
			"row": "NA9o5a_row"
		};
		//#endregion
		//#region src/client/GatewaySettingsCard.tsx
		const defaults = {
			enabled: true,
			port: 3090,
			sessionTtlHours: 12
		};
		function GatewaySettingsCard({ t }) {
			const [value, setValue] = (0, react.useState)(defaults);
			const [saved, setSaved] = (0, react.useState)(defaults);
			const [writable, setWritable] = (0, react.useState)(false);
			const [state, setState] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				fetch("/api/web-auth-gateway/config", { credentials: "same-origin" }).then(async (response) => await response.json()).then((result) => {
					if (!result.ok || result.value === void 0) throw new Error(result.error ?? "load-failed");
					const next = {
						...defaults,
						...result.value
					};
					setValue(next);
					setSaved(next);
					setWritable(result.writable === true);
					setState("ready");
				}).catch((reason) => {
					setError(reason instanceof Error ? reason.message : "load-failed");
					setState("error");
				});
			}, []);
			const dirty = JSON.stringify(value) !== JSON.stringify(saved);
			const save = async () => {
				setState("saving");
				setError("");
				try {
					const response = await fetch("/api/web-auth-gateway/config", {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(value)
					});
					const result = await response.json();
					if (!response.ok || !result.ok) throw new Error(result.error ?? "save-failed");
					const next = {
						...defaults,
						...result.value
					};
					setValue(next);
					setSaved(next);
					setState("ready");
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : "save-failed");
					setState("error");
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: gateway_settings_module_css_default.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: gateway_settings_module_css_default.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.enabled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.enabledHint") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": t("settings.enabled"),
							type: "checkbox",
							checked: value.enabled,
							disabled: !writable || state === "loading",
							onChange: (event) => setValue((current) => ({
								...current,
								enabled: event.target.checked
							}))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: gateway_settings_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.port") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("settings.portHint") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "1",
								max: "65535",
								value: value.port,
								disabled: !writable || state === "loading",
								onChange: (event) => setValue((current) => ({
									...current,
									port: Number(event.target.value)
								}))
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: gateway_settings_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.ttl") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("settings.ttlHint") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "1",
								max: "720",
								value: value.sessionTtlHours,
								disabled: !writable || state === "loading",
								onChange: (event) => setValue((current) => ({
									...current,
									sessionTtlHours: Number(event.target.value)
								}))
							})
						]
					}),
					state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: gateway_settings_module_css_default.error,
						children: [
							t("settings.saveFailed"),
							": ",
							error
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: gateway_settings_module_css_default.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: !dirty || state === "saving",
							onClick: () => setValue(saved),
							children: t("settings.discard")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: gateway_settings_module_css_default.primary,
							disabled: !writable || !dirty || state === "saving",
							onClick: () => void save(),
							children: state === "saving" ? t("settings.saving") : t("settings.save")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			"settings.title": "登录网关",
			"settings.description": "在独立端口提供登录页，并代理 DSH Web 的 HTTP 与 WebSocket 请求。",
			"settings.enabled": "启用登录网关",
			"settings.enabledHint": "关闭后停止监听网关端口；DSH 原始端口不受影响。",
			"settings.port": "网关端口",
			"settings.portHint": "用户通过此端口登录。不能与 DSH Web 原始端口相同。",
			"settings.ttl": "会话有效期（小时）",
			"settings.ttlHint": "登录会话最长有效时间，修改后新会话生效。",
			"settings.overridden": "已覆盖",
			"settings.reset": "恢复默认",
			"settings.notExposed": "当前 DSH 版本未向设置页暴露本插件的配置命名空间。",
			"settings.readOnly": "当前部署的设置只读。",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.save": "保存",
			"settings.saving": "保存中...",
			"settings.discard": "放弃",
			"settings.unsaved": "未保存",
			"settings.saveFailed": "配置保存失败。",
			"settings.invalidNumber": "请输入有效数字。"
		};
		const en = {
			"settings.title": "Login gateway",
			"settings.description": "Serve a login page on a separate port and proxy DSH Web HTTP and WebSocket traffic.",
			"settings.enabled": "Enable login gateway",
			"settings.enabledHint": "When off, the gateway port stops listening; the original DSH port remains available.",
			"settings.port": "Gateway port",
			"settings.portHint": "Users log in through this port. It must differ from the DSH Web port.",
			"settings.ttl": "Session lifetime (hours)",
			"settings.ttlHint": "Maximum login session lifetime; changes apply to new sessions.",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset to default",
			"settings.notExposed": "This DSH version does not expose this settings namespace.",
			"settings.readOnly": "Settings are read-only.",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.save": "Save",
			"settings.saving": "Saving...",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved",
			"settings.saveFailed": "Failed to save configuration.",
			"settings.invalidNumber": "Enter a valid number."
		};
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("web-auth-gateway", {
				zh,
				en
			}), "web-auth-gateway: dictionaries");
			ctx.slots.inject("web-ui.plugin.item", () => ctx.slots.register({
				name: "web-ui.plugin.item",
				id: "web-auth-gateway",
				order: 105,
				locale: "web-auth-gateway"
			}, GatewaySettingsCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map