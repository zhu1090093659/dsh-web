window.__ModuleLoader__.load({
	id: "@linxin666/dsh-web-ui-all",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		/** Column shims: element selector → attribute to stamp. */
		const COLUMN_SHIMS = [
			["[class*=\"sidebarCol\"]", "data-pane=\"sidebar\""],
			["[class*=\"centerCol\"]", "data-pane=\"conversation\""],
			["[class*=\"detailsCol\"]", "data-pane=\"details\""]
		];
		/** Stamp one attribute of the form `name="value"` onto an element, if found. */
		function stamp(el, attribute) {
			if (el === null) return;
			const eq = attribute.indexOf("=");
			const name = attribute.slice(0, eq);
			const value = attribute.slice(eq + 1).replace(/^"|"$/g, "");
			el.setAttribute(name, value);
		}
		/** One pass over the current DOM. */
		function applyShims() {
			for (const [selector, attribute] of COLUMN_SHIMS) stamp(document.querySelector(selector), attribute);
			stamp(document.querySelector("[class*=\"sidebarCol\"]")?.parentElement ?? null, "data-dsh-frame=\"\"");
		}
		/** Required services: none — the shim must run before any DOM mount waits. */
		const inject = [];
		/**
		* Register the shim for the page lifetime.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				applyShims();
				const observer = new MutationObserver(applyShims);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map