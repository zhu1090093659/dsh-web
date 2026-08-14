#!/usr/bin/env node
import { parse, find, findAll } from '../src/index.js';
import * as process from 'node:process';

const HELP_TEXT = `
Usage: tsconfck <command> <file> [args]

Commands: find, find-all, parse, parse-result
Args:
  -js : find/parse jsconfig.json instead of tsconfig.json

Examples:
find tsconfig.json for a file
> tsconfck find src/index.ts

find all tsconfig files in current dir
> tsconfck find-all .

parse tsconfig for a file
> tsconfck parse src/index.ts
`;

const HELP_ARGS = ['-h', '--help', '-?', 'help'];
const JS_ARG = '-js';
const COMMANDS = ['find', 'find-all', 'find-all', 'parse', 'parse-result'];
function needsHelp(args) {
	if (args.some((arg) => HELP_ARGS.includes(arg))) {
		return HELP_TEXT;
	}
	const expectedLength = args.includes(JS_ARG) ? 3 : 2;
	if (args.length !== expectedLength) {
		return 'invalid number of arguments\n' + HELP_TEXT;
	} else if (!COMMANDS.includes(args[0])) {
		return 'invalid command ' + args[0] + '\n' + HELP_TEXT;
	}
}
async function main() {
	const args = process.argv.slice(2);
	const help = needsHelp(args);
	if (help) {
		return help;
	}

	const command = args[0];
	const file = args[1];
	const isJS = args[2] === JS_ARG;
	const findOptions = isJS ? { configName: 'jsconfig.json' } : undefined;
	if (command === 'find') {
		return find(file, findOptions).then((found) => {
			if (!found) {
				throw new Error(`no tsconfig found for ${file}`);
			}
			return found;
		});
	} else if (command === 'parse') {
		return JSON.stringify((await parse(file, findOptions)).tsconfig, null, 2);
	} else if (command === 'parse-result') {
		return JSON.stringify(await parse(file, findOptions), null, 2);
	} else if (command === 'find-all') {
		return (
			await findAll(file || '.', { configNames: [isJS ? 'jsconfig.json' : 'tsconfig.json'] })
		).join('\n');
	}
}

main().then(
	(result) => {
		process.stdout.write(result);
		process.stdout.write('\n');
	},
	(err) => {
		console.error(err.message, err);
		// eslint-disable-next-line n/no-process-exit
		process.exit(1);
	}
);
