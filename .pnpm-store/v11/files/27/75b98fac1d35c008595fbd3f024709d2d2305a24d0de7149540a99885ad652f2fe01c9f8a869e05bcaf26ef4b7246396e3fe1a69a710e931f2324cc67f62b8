import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region lib/types/theme-settings.js
/** Theme preferences stored in the Host user-settings document. */
/** Built-in preferences accepted at the registry and settings boundaries. */
const THEME_PREFERENCES = [
	"light",
	"dark",
	"system"
];
/** Settings namespace owned by the theme plugin. */
const THEME_SETTINGS_NAMESPACE = "ui-theme";
/** Field carrying the selected built-in theme preference. */
const THEME_PREFERENCE_FIELD = "preference";
/** Default preference when the user-settings document has no override. */
const DEFAULT_PREFERENCE = "system";
/** Durable theme schema; also the wire envelope the browser scope validates against. */
const ThemeSettingsSchema = z.object({ [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE) });
//#endregion
//#region lib/types/boot-theme.js
/**
* Host-rendered theme bootstrap for the browser's pre-plugin interval. Each
* index response embeds the current durable built-in preference; the browser
* resolves only `system`, then writes the same DOM fields ui-layout's
* ThemePresenter owns after the client plugin tree activates.
*/
/** Build the inline script for one schema-validated built-in preference. */
function bootThemeScript(preference) {
	return `<script>(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
})()<\/script>`;
}
/**
* Insert the theme bootstrap immediately after the opening body tag, before
* the shell mount and module script. Body-less fragments receive it at the
* end, where the HTML parser has already synthesized a body.
* @param html - Raw application index HTML.
* @param preference - Current Host-backed built-in preference.
* @returns HTML containing the theme bootstrap.
*/
function injectBootTheme(html, preference = DEFAULT_PREFERENCE) {
	const script = bootThemeScript(preference);
	const body = /<body(?:\s[^>]*)?>/i.exec(html);
	if (body === null) return `${html}${script}`;
	const at = body.index + body[0].length;
	return `${html.slice(0, at)}${script}${html.slice(at)}`;
}
//#endregion
//#region lib/types/index.js
/** Host registration for the browser theme preference and pre-plugin palette. */
const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE);
/** Read the registered preference or use the schema default without a settings provider. */
function readPreference(ctx) {
	const settings = ctx.get("settings");
	if (settings === void 0) return DEFAULT_PREFERENCE;
	const section = settings.get(THEME_NAMESPACE);
	if (section === void 0) return DEFAULT_PREFERENCE;
	return section.preference;
}
/**
* Register the durable theme section and initial-theme index transform when
* their optional Host services are composed.
* @param ctx - Host context that may acquire settings and HTTP services.
*/
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema);
	});
	ctx.inject(["webServer"], (httpCtx) => {
		httpCtx.effect(() => httpCtx.webServer.tapIndex((html) => injectBootTheme(html, readPreference(ctx))), "client-ui-theme: initial theme bootstrap");
	});
}
//#endregion
export { DEFAULT_PREFERENCE, THEME_PREFERENCES, THEME_PREFERENCE_FIELD, THEME_SETTINGS_NAMESPACE, apply };
