import{s as c,b as s}from"./index-DGS2ur_Y.js";import"./git-DJDr4heb.js";const i=["light","dark","system"],E="ui-theme",a="preference",n="system",m=s.object({[a]:s.union([...i]).default(n)});function d(e){return`(() => {
  const preference = ${JSON.stringify(e)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
})()`}function f(e=n){return{kind:"script",placement:"body",text:d(e)}}const o=c(E);function u(e){const t=e.get("settings");if(t===void 0)return n;const r=t.get(o);return r===void 0?n:r.preference}function g(e){e.inject(["settings"],t=>{t.settings.register(o,m)}),e.on("webserver/index-inject",t=>{t.push(f(u(e)))})}export{n as DEFAULT_PREFERENCE,i as THEME_PREFERENCES,a as THEME_PREFERENCE_FIELD,E as THEME_SETTINGS_NAMESPACE,g as apply};
