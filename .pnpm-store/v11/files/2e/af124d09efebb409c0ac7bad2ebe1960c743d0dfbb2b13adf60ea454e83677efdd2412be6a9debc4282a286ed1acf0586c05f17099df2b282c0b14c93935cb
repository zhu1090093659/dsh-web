declare module 'tsconfck' {
	export interface TSConfckFindOptions {
		/**
		 * A cache to improve performance for multiple calls in the same project
		 *
		 * Warning: You must clear this cache in case tsconfig files are added/removed during it's lifetime
		 */
		cache?: TSConfckCache<TSConfckParseResult | TSConfckParseNativeResult>;

		/**
		 * project root dir, does not continue scanning outside of this directory.
		 *
		 * Improves performance but may lead to different results from native typescript when no tsconfig is found inside root
		 */
		root?: string;

		/**
		 * set to true if you don't want to find tsconfig for files inside node_modules
		 *
		 * This is useful if you want to use the output with esbuild.transform as esbuild itself also ignores node_modules
		 *
		 * @default false
		 */
		ignoreNodeModules?: boolean;

		/**
		 * Override the default name of the config file to find.
		 *
		 * Use `jsconfig.json` in projects that have typechecking for js files with jsconfig.json
		 *
		 * @default tsconfig.json
		 */
		configName?: string;
	}

	export interface TSConfckParseOptions extends TSConfckFindOptions {
		// same as find options
	}

	export interface TSConfckFindAllOptions {
		/**
		 * helper to skip subdirectories when scanning for tsconfig.json
		 *
		 * eg ` dir => dir === 'node_modules' || dir === '.git'`
		 */
		skip?: (dir: string) => boolean;
		/**
		 * list of config filenames to include, use ["tsconfig.json","jsconfig.json"] if you need both
		 *
		 * @default ["tsconfig.json"]
		 */
		configNames?: string[];
	}

	export interface TSConfckParseResult {
		/**
		 * absolute path to parsed tsconfig.json
		 */
		tsconfigFile: string;

		/**
		 * parsed result, including merged values from extended
		 */
		tsconfig: any;

		/**
		 * ParseResult for parent solution
		 */
		solution?: TSConfckParseResult;

		/**
		 * ParseResults for all tsconfig files referenced in a solution
		 */
		referenced?: TSConfckParseResult[];

		/**
		 * ParseResult for all tsconfig files
		 *
		 * [a,b,c] where a extends b and b extends c
		 */
		extended?: TSConfckParseResult[];
	}

	export interface TSConfckParseNativeOptions extends TSConfckParseOptions {
		/**
		 * Set this option to true to force typescript to ignore all source files.
		 *
		 * This is faster - especially for large projects - but comes with 2 caveats
		 *
		 * 1) output tsconfig always has `files: [],include: []` instead of any real values configured.
		 * 2) as a result of 1), it won't be able to resolve solution-style references and always return the closest tsconfig
		 */
		ignoreSourceFiles?: boolean;
	}

	export interface TSConfckParseNativeResult {
		/**
		 * absolute path to parsed tsconfig.json
		 */
		tsconfigFile: string;

		/**
		 * parsed result, including merged values from extended and normalized
		 */
		tsconfig: any;

		/**
		 * ParseResult for parent solution
		 */
		solution?: TSConfckParseNativeResult;

		/**
		 * ParseNativeResults for all tsconfig files referenced in a solution
		 */
		referenced?: TSConfckParseNativeResult[];

		/**
		 * full output of ts.parseJsonConfigFileContent
		 */
		result: any;
	}
	export class TSConfckCache<T> {
		/**
		 * clear cache, use this if you have a long running process and tsconfig files have been added,changed or deleted
		 */
		clear(): void;
		/**
		 * has cached closest config for files in dir
		 * */
		hasConfigPath(dir: string, configName?: string): boolean;
		/**
		 * get cached closest tsconfig for files in dir
		 * @throws {unknown} if cached value is an error
		 */
		getConfigPath(dir: string, configName?: string): Promise<string | null> | string | null;
		/**
		 * has parsed tsconfig for file
		 * */
		hasParseResult(file: string): boolean;
		/**
		 * get parsed tsconfig for file
		 * @throws {unknown} if cached value is an error
		 */
		getParseResult(file: string): Promise<T> | T;
		/**
		 * @param isRootFile a flag to check if current file which involking the parse() api, used to distinguish the normal cache which only parsed by parseFile()
		 * */
		private setParseResult;
		
		private setConfigPath;
		#private;
	}
	/**
	 * find the closest tsconfig.json file
	 *
	 * @param filename - path to file to find tsconfig for (absolute or relative to cwd)
	 * @param options - options
	 * @returns absolute path to closest tsconfig.json or null if not found
	 */
	export function find(filename: string, options?: TSConfckFindOptions): Promise<string | null>;
	/**
	 * find all tsconfig.json files in dir
	 *
	 * @param dir - path to dir (absolute or relative to cwd)
	 * @param options - options
	 * @returns list of absolute paths to all found tsconfig.json files
	 */
	export function findAll(dir: string, options?: TSConfckFindAllOptions): Promise<string[]>;
	/**
	 * convert content of tsconfig.json to regular json
	 *
	 * @param tsconfigJson - content of tsconfig.json
	 * @returns content as regular json, comments and dangling commas have been replaced with whitespace
	 */
	export function toJson(tsconfigJson: string): string;
	/**
	 * find the closest tsconfig.json file using native ts.findConfigFile
	 *
	 * You must have `typescript` installed to use this
	 *
	 * @param filename - path to file to find tsconfig for (absolute or relative to cwd)
	 * @param options - options
	 * @returns absolute path to closest tsconfig.json
	 */
	export function findNative(filename: string, options?: TSConfckFindOptions): Promise<string>;
	/**
	 * parse the closest tsconfig.json file
	 *
	 * @param filename - path to a tsconfig .json or a source file or directory (absolute or relative to cwd)
	 * @param options - options
	 * */
	export function parse(filename: string, options?: TSConfckParseOptions): Promise<TSConfckParseResult>;
	export class TSConfckParseError extends Error {
		/**
		 *
		 * @param message - error message
		 * @param code - error code
		 * @param tsconfigFile - path to tsconfig file
		 * @param cause - cause of this error
		 */
		constructor(message: string, code: string, tsconfigFile: string, cause: Error | null);
		/**
		 * error code
		 * */
		code: string;
		/**
		 * error cause
		 * */
		cause: Error | undefined;
		/**
		 * absolute path of tsconfig file where the error happened
		 * */
		tsconfigFile: string;
	}
	/**
	 * parse the closest tsconfig.json file with typescript native functions
	 *
	 * You need to have `typescript` installed to use this
	 *
	 * @param filename - path to a tsconfig .json or a source file (absolute or relative to cwd)
	 * @param options - options
	 * */
	export function parseNative(filename: string, options?: TSConfckParseNativeOptions): Promise<TSConfckParseNativeResult>;
	export class TSConfckParseNativeError extends Error {
		/**
		 *
		 * @param diagnostic - diagnostics of ts
		 * @param tsconfigFile - file that errored
		 * @param result  - parsed result, if any
		 */
		constructor(diagnostic: TSDiagnosticError, tsconfigFile: string, result: any | null);
		/**
		 * code of typescript diagnostic, prefixed with "TS "
		 * */
		code: string;
		/**
		 * full ts diagnostic that caused this error
		 * */
		diagnostic: TSDiagnosticError;
		/**
		 * native result if present, contains all errors in result.errors
		 * */
		result: any | undefined;
		/**
		 * absolute path of tsconfig file where the error happened
		 * */
		tsconfigFile: string;
	}
	/**
	 * {
	 * code: number;
	 * category: number;
	 * messageText: string;
	 * start?: number;
	 * } TSDiagnosticError
	 */
	type TSDiagnosticError = any;

	export {};
}

//# sourceMappingURL=index.d.ts.map