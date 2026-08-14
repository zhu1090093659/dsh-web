/** @template T */
export class TSConfckCache {
	/**
	 * clear cache, use this if you have a long running process and tsconfig files have been added,changed or deleted
	 */
	clear() {
		this.#configPaths.clear();
		this.#parsed.clear();
	}

	/**
	 * has cached closest config for files in dir
	 * @param {string} dir
	 * @param {string} [configName=tsconfig.json]
	 * @returns {boolean}
	 */
	hasConfigPath(dir, configName = 'tsconfig.json') {
		return this.#configPaths.has(`${dir}/${configName}`);
	}

	/**
	 * get cached closest tsconfig for files in dir
	 * @param {string} dir
	 * @param {string} [configName=tsconfig.json]
	 * @returns {Promise<string|null>|string|null}
	 * @throws {unknown} if cached value is an error
	 */
	getConfigPath(dir, configName = 'tsconfig.json') {
		const key = `${dir}/${configName}`;
		const value = this.#configPaths.get(key);
		if (value == null || value.length || value.then) {
			return value;
		} else {
			throw value;
		}
	}

	/**
	 * has parsed tsconfig for file
	 * @param {string} file
	 * @returns {boolean}
	 */
	hasParseResult(file) {
		return this.#parsed.has(file);
	}

	/**
	 * get parsed tsconfig for file
	 * @param {string} file
	 * @returns {Promise<T>|T}
	 * @throws {unknown} if cached value is an error
	 */
	getParseResult(file) {
		const value = this.#parsed.get(file);
		if (value.then || value.tsconfig) {
			return value;
		} else {
			throw value; // cached error, rethrow
		}
	}

	/**
	 * @internal
	 * @private
	 * @param file
	 * @param {boolean} isRootFile a flag to check if current file which involking the parse() api, used to distinguish the normal cache which only parsed by parseFile()
	 * @param {Promise<T>} result
	 */
	setParseResult(file, result, isRootFile = false) {
		// _isRootFile_ is a temporary property for Promise result, used to prevent deadlock with cache
		Object.defineProperty(result, '_isRootFile_', {
			value: isRootFile,
			writable: false,
			enumerable: false,
			configurable: false
		});
		this.#parsed.set(file, result);
		result
			.then((parsed) => {
				if (this.#parsed.get(file) === result) {
					this.#parsed.set(file, parsed);
				}
			})
			.catch((e) => {
				if (this.#parsed.get(file) === result) {
					this.#parsed.set(file, e);
				}
			});
	}

	/**
	 * @internal
	 * @private
	 * @param {string} dir
	 * @param {Promise<string|null>} configPath
	 * @param {string} [configName=tsconfig.json]
	 */
	setConfigPath(dir, configPath, configName = 'tsconfig.json') {
		const key = `${dir}/${configName}`;
		this.#configPaths.set(key, configPath);
		configPath
			.then((path) => {
				if (this.#configPaths.get(key) === configPath) {
					this.#configPaths.set(key, path);
				}
			})
			.catch((e) => {
				if (this.#configPaths.get(key) === configPath) {
					this.#configPaths.set(key, e);
				}
			});
	}

	/**
	 * map directories to their closest tsconfig.json
	 * @internal
	 * @private
	 * @type{Map<string,(Promise<string|null>|string|null)>}
	 */
	#configPaths = new Map();

	/**
	 * map files to their parsed tsconfig result
	 * @internal
	 * @private
	 * @type {Map<string,(Promise<T>|T)> }
	 */
	#parsed = new Map();
}
