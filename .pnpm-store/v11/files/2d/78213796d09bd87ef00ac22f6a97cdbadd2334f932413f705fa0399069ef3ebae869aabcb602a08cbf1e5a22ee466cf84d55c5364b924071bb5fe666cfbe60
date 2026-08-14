import { TSConfckCache } from './cache.js';

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

// eslint-disable-next-line n/no-missing-import
export * from './index.js';
