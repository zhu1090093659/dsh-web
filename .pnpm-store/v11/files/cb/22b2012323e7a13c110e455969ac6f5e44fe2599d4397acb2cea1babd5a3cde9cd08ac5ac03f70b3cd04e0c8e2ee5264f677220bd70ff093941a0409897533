/**
Apply transformations for atomic groups: `(?>…)`.
@param {string} expression
@param {PluginData} [data]
@returns {Required<PluginResult>}
*/
export function atomic(expression: string, data?: PluginData): Required<PluginResult>;
/**
Transform posessive quantifiers into atomic groups. The posessessive quantifiers are:
`?+`, `*+`, `++`, `{N}+`, `{N,}+`, `{N,N}+`.
This follows Java, PCRE, Perl, and Python.
Possessive quantifiers in Oniguruma and Onigmo are only: `?+`, `*+`, `++`.
@param {string} expression
@returns {PluginResult}
*/
export function possessive(expression: string): PluginResult;
import type { PluginData } from './regex.js';
import type { PluginResult } from './regex.js';
