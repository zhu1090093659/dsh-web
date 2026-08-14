export type ToRegExpOptions = {
    accuracy?: "default" | "strict";
    avoidSubclass?: boolean;
    flags?: string;
    global?: boolean;
    hasIndices?: boolean;
    lazyCompileLength?: number;
    rules?: {
        allowOrphanBackrefs?: boolean;
        asciiWordBoundaries?: boolean;
        captureGroup?: boolean;
        recursionLimit?: number;
        singleline?: boolean;
    };
    target?: "auto" | "ES2025" | "ES2024" | "ES2018";
    verbose?: boolean;
};
import { EmulatedRegExp } from './subclass.js';
/**
@import {EmulatedRegExpOptions} from './subclass.js';
*/
/**
@typedef {{
  accuracy?: keyof Accuracy;
  avoidSubclass?: boolean;
  flags?: string;
  global?: boolean;
  hasIndices?: boolean;
  lazyCompileLength?: number;
  rules?: {
    allowOrphanBackrefs?: boolean;
    asciiWordBoundaries?: boolean;
    captureGroup?: boolean;
    recursionLimit?: number;
    singleline?: boolean;
  };
  target?: keyof Target;
  verbose?: boolean;
}} ToRegExpOptions
*/
/**
Accepts an Oniguruma pattern and returns an equivalent JavaScript `RegExp`.
@param {string} pattern Oniguruma regex pattern.
@param {ToRegExpOptions} [options]
@returns {RegExp | EmulatedRegExp}
*/
export function toRegExp(pattern: string, options?: ToRegExpOptions): RegExp | EmulatedRegExp;
/**
Accepts an Oniguruma pattern and returns the details for an equivalent JavaScript `RegExp`.
@param {string} pattern Oniguruma regex pattern.
@param {ToRegExpOptions} [options]
@returns {{
  pattern: string;
  flags: string;
  options?: EmulatedRegExpOptions;
}}
*/
export function toRegExpDetails(pattern: string, options?: ToRegExpOptions): {
    pattern: string;
    flags: string;
    options?: EmulatedRegExpOptions;
};
import type { EmulatedRegExpOptions } from './subclass.js';
export { EmulatedRegExp };
