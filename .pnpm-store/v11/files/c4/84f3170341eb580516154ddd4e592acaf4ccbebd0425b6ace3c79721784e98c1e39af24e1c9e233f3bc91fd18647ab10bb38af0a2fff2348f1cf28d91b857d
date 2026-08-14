import { setDefaultWasmLoader } from "@shikijs/engine-oniguruma";
export * from "@shikijs/core";
//#region src/core-unwasm.ts
/**
* In environments where WebAssembly can be treated as native ESM and https://github.com/unjs/unwasm,
* We add the wasm file as the dependency so users don't need to call `loadWasm` manually.
*/
setDefaultWasmLoader(() => import("shiki/wasm"));
//#endregion
export {};
