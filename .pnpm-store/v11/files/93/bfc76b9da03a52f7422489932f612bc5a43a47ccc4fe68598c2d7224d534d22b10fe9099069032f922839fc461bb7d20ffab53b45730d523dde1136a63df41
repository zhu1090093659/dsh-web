import { n as __toESM, t as require_binding } from "./binding-Zhafd14U.mjs";
import { f as __decorate, h as PlainObjectLike, m as lazyProp, u as transformToRollupOutput } from "./bindingify-input-options-C-Zsy1EG.mjs";
import { l as PluginDriver, s as validateOption, t as createBundlerOptions } from "./create-bundler-option-wRiQzEJ3.mjs";
import { i as unwrapBindingResult } from "./error-CVc7IgvG.mjs";
//#region src/types/rolldown-output-impl.ts
var import_binding = /* @__PURE__ */ __toESM(require_binding(), 1);
var RolldownOutputImpl = class extends PlainObjectLike {
	bindingOutputs;
	constructor(bindingOutputs) {
		super();
		this.bindingOutputs = bindingOutputs;
	}
	get output() {
		return transformToRollupOutput(this.bindingOutputs).output;
	}
	__rolldown_external_memory_handle__(keepDataAlive) {
		const results = this.output.map((item) => item.__rolldown_external_memory_handle__(keepDataAlive));
		if (!results.every((r) => r.freed)) {
			const reasons = results.filter((r) => !r.freed).map((r) => r.reason).filter(Boolean);
			return {
				freed: false,
				reason: `Failed to free ${reasons.length} item(s): ${reasons.join("; ")}`
			};
		}
		return { freed: true };
	}
};
__decorate([lazyProp], RolldownOutputImpl.prototype, "output", null);
//#endregion
//#region src/api/rolldown/rolldown-build.ts
Symbol.asyncDispose ??= Symbol("Symbol.asyncDispose");
/**
* The bundle object returned by {@linkcode rolldown} function.
*
* @category Programmatic APIs
*/
var RolldownBuild = class {
	#inputOptions;
	#bundler;
	#stopWorkers;
	#asyncRuntimeReleased = false;
	/** @hidden should not be used directly */
	constructor(inputOptions) {
		this.#inputOptions = inputOptions;
		this.#bundler = new import_binding.BindingBundler();
		(0, import_binding.startAsyncRuntime)();
	}
	/**
	* Whether the bundle has been closed.
	*
	* If the bundle is closed, calling other methods will throw an error.
	*/
	get closed() {
		return this.#bundler.closed;
	}
	/**
	* Generate bundles in-memory.
	*
	* If you directly want to write bundles to disk, use the {@linkcode write} method instead.
	*
	* @param outputOptions The output options.
	* @returns The generated bundle.
	* @throws {@linkcode BundleError} When an error occurs during the build.
	*/
	async generate(outputOptions = {}) {
		return this.#build(false, outputOptions);
	}
	/**
	* Generate and write bundles to disk.
	*
	* If you want to generate bundles in-memory, use the {@linkcode generate} method instead.
	*
	* @param outputOptions The output options.
	* @returns The generated bundle.
	* @throws {@linkcode BundleError} When an error occurs during the build.
	*/
	async write(outputOptions = {}) {
		return this.#build(true, outputOptions);
	}
	/**
	* Close the bundle and free resources.
	*
	* This method should be called even if the {@linkcode generate} method
	* or the {@linkcode write} method threw an error. It should be called
	* even if neither of the methods are called.
	*
	* This method is called automatically when using `using` syntax.
	*
	* @example
	* ```js
	* import { rolldown } from 'rolldown';
	*
	* {
	*   using bundle = await rolldown({ input: 'src/main.js' });
	*   const output = await bundle.generate({ format: 'esm' });
	*   console.log(output);
	*   // bundle.close() is called automatically here
	* }
	* ```
	*/
	async close() {
		const shouldRelease = !this.#asyncRuntimeReleased;
		this.#asyncRuntimeReleased = true;
		try {
			await this.#stopWorkers?.();
			await this.#bundler.close();
			this.#stopWorkers = void 0;
		} finally {
			if (shouldRelease) (0, import_binding.shutdownAsyncRuntime)();
		}
	}
	/** @hidden documented in close method */
	async [Symbol.asyncDispose]() {
		await this.close();
	}
	/**
	* @experimental
	* @hidden not ready for public usage yet
	*/
	get watchFiles() {
		return Promise.resolve(this.#bundler.getWatchFiles());
	}
	async #build(isWrite, outputOptions) {
		validateOption("output", outputOptions);
		await this.#stopWorkers?.();
		const option = await createBundlerOptions(this.#inputOptions, outputOptions, false, true);
		try {
			this.#stopWorkers = option.stopWorkers;
			let output;
			if (isWrite) output = await this.#bundler.write(option.bundlerOptions);
			else output = await this.#bundler.generate(option.bundlerOptions);
			return new RolldownOutputImpl(unwrapBindingResult(output));
		} catch (e) {
			await option.stopWorkers?.();
			throw e;
		}
	}
};
//#endregion
//#region src/api/rolldown/index.ts
/**
* The API compatible with Rollup's `rollup` function.
*
* Unlike Rollup, the module graph is not built until the methods of the bundle object are called.
*
* @param input The input options object.
* @returns A Promise that resolves to a bundle object.
*
* @example
* ```js
* import { rolldown } from 'rolldown';
*
* let bundle, failed = false;
* try {
*   bundle = await rolldown({
*     input: 'src/main.js',
*   });
*   await bundle.write({
*     format: 'esm',
*   });
* } catch (e) {
*   console.error(e);
*   failed = true;
* }
* if (bundle) {
*   await bundle.close();
* }
* process.exitCode = failed ? 1 : 0;
* ```
*
* @category Programmatic APIs
*/
const rolldown = async (input) => {
	validateOption("input", input);
	return new RolldownBuild(await PluginDriver.callOptionsHook(input));
};
//#endregion
export { rolldown as t };
