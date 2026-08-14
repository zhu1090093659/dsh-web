import path from 'node:path';
import { readdir } from 'node:fs';

/**
 * @typedef WalkState
 * @interface
 * @property {string[]} files - files
 * @property {number} calls - number of ongoing calls
 * @property {(dir: string)=>boolean} skip - function to skip dirs
 * @property {boolean} err - error flag
 * @property {string[]} configNames - config file names
 */

const sep = path.sep;

/**
 * find all tsconfig.json files in dir
 *
 * @param {string} dir - path to dir (absolute or relative to cwd)
 * @param {import('./public.d.ts').TSConfckFindAllOptions} [options] - options
 * @returns {Promise<string[]>} list of absolute paths to all found tsconfig.json files
 */
export async function findAll(dir, options) {
	/** @type WalkState */
	const state = {
		files: [],
		calls: 0,
		skip: options?.skip,
		err: false,
		configNames: options?.configNames ?? ['tsconfig.json']
	};
	return new Promise((resolve, reject) => {
		walk(path.resolve(dir), state, (err, files) => (err ? reject(err) : resolve(files)));
	});
}

/**
 *
 * @param {string} dir
 * @param {WalkState} state
 * @param {(err: NodeJS.ErrnoException | null, files?: string[]) => void} done
 */
function walk(dir, state, done) {
	if (state.err) {
		return;
	}
	state.calls++;
	readdir(dir, { withFileTypes: true }, (err, entries = []) => {
		if (state.err) {
			return;
		}
		// skip deleted or inaccessible directories
		if (err && !(err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM')) {
			state.err = true;
			done(err);
		} else {
			for (const ent of entries) {
				if (ent.isDirectory() && !state.skip?.(ent.name)) {
					walk(`${dir}${sep}${ent.name}`, state, done);
				} else if (ent.isFile() && state.configNames.includes(ent.name)) {
					state.files.push(`${dir}${sep}${ent.name}`);
				}
			}
			if (--state.calls === 0) {
				if (!state.err) {
					done(null, state.files);
				}
			}
		}
	});
}
