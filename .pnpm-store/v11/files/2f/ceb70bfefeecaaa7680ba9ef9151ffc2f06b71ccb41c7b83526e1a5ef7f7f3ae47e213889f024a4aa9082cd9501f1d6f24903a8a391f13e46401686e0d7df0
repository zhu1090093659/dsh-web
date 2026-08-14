//#region src/utils.ts
function createPromiseWithResolvers() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
const _cacheMap = /* @__PURE__ */ new WeakMap();
function cachedMap(items, fn) {
	return items.map((i) => {
		let r = _cacheMap.get(i);
		if (!r) {
			r = fn(i);
			_cacheMap.set(i, r);
		}
		return r;
	});
}
const random = Math.random.bind(Math);
const urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
function nanoid(size = 21) {
	let id = "";
	let i = size;
	while (i--) id += urlAlphabet[random() * 64 | 0];
	return id;
}
//#endregion
export { createPromiseWithResolvers as n, nanoid as r, cachedMap as t };
