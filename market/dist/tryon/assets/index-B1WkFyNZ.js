import{s as c,a as s}from"./index-Cp438i9e.js";import"./git-DJDr4heb.js";const i=["light","dark","system"],a="ui-theme",E="preference",n="system",m=s.object({[E]:s.union([...i]).default(n)});function d(e){return`(() => {
  const preference = ${JSON.stringify(e)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
})()`}function f(e=n){return{kind:"script",placement:"body",text:d(e)}}const o=c(a);function u(e){const t=e.get("settings");if(t===void 0)return n;const r=t.get(o);return r===void 0?n:r.preference}function g(e){e.inject(["settings"],t=>{t.settings.register(o,m)}),e.on("webserver/index-inject",t=>{t.push(f(u(e)))})}export{n as DEFAULT_PREFERENCE,i as THEME_PREFERENCES,E as THEME_PREFERENCE_FIELD,a as THEME_SETTINGS_NAMESPACE,g as apply};
