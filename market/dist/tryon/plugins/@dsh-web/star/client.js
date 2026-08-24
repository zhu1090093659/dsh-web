window.__ModuleLoader__.load({
	id: "@dsh-web/star",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// packages/dsh-web-star/src/client.tsx
		var client_exports = {};
		__export(client_exports, {
		  apply: () => apply,
		  default: () => client_default,
		  inject: () => inject
		});
		module.exports = __toCommonJS(client_exports);
		var import_react = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		var REPO = "zhu1090093659/dsh-web";
		var REPO_URL = `https://github.com/${REPO}`;
		var API_URL = `https://api.github.com/repos/${REPO}`;
		var CACHE_KEY = "dsh-web-star:count";
		var CACHE_TTL = 24 * 60 * 60 * 1e3;
		function cachedCount() {
		  try {
		    const raw = localStorage.getItem(CACHE_KEY);
		    if (raw === null) return void 0;
		    const entry = JSON.parse(raw);
		    if (typeof entry.count !== "number" || typeof entry.at !== "number") return void 0;
		    return Date.now() - entry.at < CACHE_TTL ? entry.count : void 0;
		  } catch {
		    return void 0;
		  }
		}
		function useStarCount() {
		  const [count, setCount] = (0, import_react.useState)(cachedCount);
		  (0, import_react.useEffect)(() => {
		    if (count !== void 0) return;
		    let live = true;
		    void (async () => {
		      try {
		        const response = await fetch(API_URL, { headers: { accept: "application/vnd.github+json" } });
		        if (!response.ok) return;
		        const body = await response.json();
		        if (typeof body.stargazers_count !== "number") return;
		        try {
		          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: body.stargazers_count, at: Date.now() }));
		        } catch {
		        }
		        if (live) setCount(body.stargazers_count);
		      } catch {
		      }
		    })();
		    return () => {
		      live = false;
		    };
		  }, [count]);
		  return count;
		}
		function StarIcon() {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		    "svg",
		    {
		      className: "dsh-web-star-icon",
		      width: "16",
		      height: "16",
		      viewBox: "0 0 16 16",
		      fill: "none",
		      stroke: "currentColor",
		      strokeWidth: "1.3",
		      strokeLinejoin: "round",
		      "aria-hidden": "true",
		      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 1.6l1.86 3.78 4.17.6-3.02 2.94.71 4.15L8 11.13l-3.72 1.94.71-4.15L1.97 5.98l4.17-.6L8 1.6Z" })
		    }
		  );
		}
		function StarAction({ wide }) {
		  const count = useStarCount();
		  const reading = count === void 0 ? void 0 : new Intl.NumberFormat(void 0, { notation: "compact" }).format(count);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		    "a",
		    {
		      className: "dsh-web-star",
		      ...wide ? {} : { "data-rail": "" },
		      href: REPO_URL,
		      target: "_blank",
		      rel: "noreferrer noopener",
		      title: `${REPO} is open source and free to run. A star helps other people find it.`,
		      "aria-label": `Star ${REPO} on GitHub`,
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StarIcon, {}),
		        wide && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-web-star-label", children: "Star on GitHub" }),
		          reading !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-web-star-count", children: reading })
		        ] })
		      ]
		    }
		  );
		}
		var STYLE = `
		.dsh-web-star{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:0 0 calc(100% + 8px);
		 width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;border-radius:12px;
		 color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:22px;
		 text-decoration:none;cursor:pointer;overflow:hidden}
		.dsh-web-star:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
		.dsh-web-star-icon{flex:none}
		.dsh-web-star-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.dsh-web-star-count{flex:none;margin-left:auto;padding-right:6px;font-size:12px;line-height:16px;
		 font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,inherit)}
		.dsh-web-star[data-rail]{flex:0 0 36px;justify-content:center;gap:0;width:36px;height:36px;
		 margin:4px 0;padding:0;border-radius:50%}
		:has(> .dsh-web-star),:has(> * > .dsh-web-star){flex-wrap:wrap}
		`;
		var inject = ["slots"];
		function apply(ctx) {
		  if (document.getElementById("dsh-web-star-chrome") === null) {
		    const style = document.createElement("style");
		    style.id = "dsh-web-star-chrome";
		    style.textContent = STYLE;
		    document.head.append(style);
		  }
		  const slots = ctx.get("slots");
		  if (slots === void 0) return;
		  slots.inject("sidebar.footer.action", () => slots.register(
		    { name: "sidebar.footer.action", id: "web-star", order: 100, label: "Star on GitHub" },
		    StarAction
		  ));
		}
		var client_default = { apply, inject };

		return module.exports;
	}
});
