/*
 this file contains code from strip-bom and strip-json-comments by Sindre Sorhus
 https://github.com/sindresorhus/strip-json-comments/blob/v4.0.0/index.js
 https://github.com/sindresorhus/strip-bom/blob/v5.0.0/index.js
 licensed under MIT, see ../LICENSE
*/

/**
 * convert content of tsconfig.json to regular json
 *
 * @param {string} tsconfigJson - content of tsconfig.json
 * @returns {string} content as regular json, comments and dangling commas have been replaced with whitespace
 */
export function toJson(tsconfigJson) {
	const stripped = stripDanglingComma(stripJsonComments(stripBom(tsconfigJson)));
	if (stripped.trim() === '') {
		// only whitespace left after stripping, return empty object so that JSON.parse still works
		return '{}';
	} else {
		return stripped;
	}
}

/**
 * replace dangling commas from pseudo-json string with single space
 * implementation heavily inspired by strip-json-comments
 *
 * @param {string} pseudoJson
 * @returns {string}
 */
function stripDanglingComma(pseudoJson) {
	let insideString = false;
	let offset = 0;
	let result = '';
	let danglingCommaPos = null;
	for (let i = 0; i < pseudoJson.length; i++) {
		const currentCharacter = pseudoJson[i];
		if (currentCharacter === '"') {
			const escaped = isEscaped(pseudoJson, i);
			if (!escaped) {
				insideString = !insideString;
			}
		}
		if (insideString) {
			danglingCommaPos = null;
			continue;
		}
		if (currentCharacter === ',') {
			danglingCommaPos = i;
			continue;
		}
		if (danglingCommaPos) {
			if (currentCharacter === '}' || currentCharacter === ']') {
				result += pseudoJson.slice(offset, danglingCommaPos) + ' ';
				offset = danglingCommaPos + 1;
				danglingCommaPos = null;
			} else if (!currentCharacter.match(/\s/)) {
				danglingCommaPos = null;
			}
		}
	}
	return result + pseudoJson.substring(offset);
}

// start strip-json-comments
/**
 *
 * @param {string} jsonString
 * @param {number} quotePosition
 * @returns {boolean}
 */
function isEscaped(jsonString, quotePosition) {
	let index = quotePosition - 1;
	let backslashCount = 0;

	while (jsonString[index] === '\\') {
		index -= 1;
		backslashCount += 1;
	}

	return Boolean(backslashCount % 2);
}

/**
 *
 * @param {string} string
 * @param {number?} start
 * @param {number?} end
 */
function strip(string, start, end) {
	return string.slice(start, end).replace(/\S/g, ' ');
}

const singleComment = Symbol('singleComment');
const multiComment = Symbol('multiComment');

/**
 * @param {string} jsonString
 * @returns {string}
 */
function stripJsonComments(jsonString) {
	let isInsideString = false;
	/** @type {false | symbol} */
	let isInsideComment = false;
	let offset = 0;
	let result = '';

	for (let index = 0; index < jsonString.length; index++) {
		const currentCharacter = jsonString[index];
		const nextCharacter = jsonString[index + 1];

		if (!isInsideComment && currentCharacter === '"') {
			const escaped = isEscaped(jsonString, index);
			if (!escaped) {
				isInsideString = !isInsideString;
			}
		}

		if (isInsideString) {
			continue;
		}

		if (!isInsideComment && currentCharacter + nextCharacter === '//') {
			result += jsonString.slice(offset, index);
			offset = index;
			isInsideComment = singleComment;
			index++;
		} else if (isInsideComment === singleComment && currentCharacter + nextCharacter === '\r\n') {
			index++;
			isInsideComment = false;
			result += strip(jsonString, offset, index);
			offset = index;
		} else if (isInsideComment === singleComment && currentCharacter === '\n') {
			isInsideComment = false;
			result += strip(jsonString, offset, index);
			offset = index;
		} else if (!isInsideComment && currentCharacter + nextCharacter === '/*') {
			result += jsonString.slice(offset, index);
			offset = index;
			isInsideComment = multiComment;
			index++;
		} else if (isInsideComment === multiComment && currentCharacter + nextCharacter === '*/') {
			index++;
			isInsideComment = false;
			result += strip(jsonString, offset, index + 1);
			offset = index + 1;
		}
	}

	return result + (isInsideComment ? strip(jsonString.slice(offset)) : jsonString.slice(offset));
}
// end strip-json-comments

// start strip-bom
/**
 * @param {string} string
 * @returns {string}
 */
function stripBom(string) {
	// Catches EFBBBF (UTF-8 BOM) because the buffer-to-string
	// conversion translates it to FEFF (UTF-16 BOM).
	if (string.charCodeAt(0) === 0xfeff) {
		return string.slice(1);
	}
	return string;
}
// end strip-bom
