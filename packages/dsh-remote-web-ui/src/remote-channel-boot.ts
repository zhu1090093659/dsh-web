/**
 * Parse-time remote-channel boot patch (issue #987): the browser-half patch
 * (client/remote-channel.ts) installs when this plugin's boot entry runs,
 * but `dsh-client-connection` boots earlier and opens its event streams
 * unrewritten — on a non-loopback origin the SDK fence rejects them and the
 * workspace list never loads. The host therefore inlines this classic script
 * right after the opening <head> tag (webserver/index-inject), so the
 * fetch/WebSocket/EventSource/src rewrite is active before ANY boot entry
 * executes. The plugin's client apply later adopts the installed seat
 * (hooks + pending unpaired signal) instead of patching twice.
 *
 * The rewrite decisions are generated from REMOTE_CHANNEL_RULES, the same
 * data the browser patch consumes — the two cannot drift apart. On this
 * 0.1.2-alpha.1 line the "configuration plane is local" behavior lives in
 * the browser (client plugins branch on connection.isLoopback), so the
 * script also flips the official UI into host mode by installing the
 * transport hook `__DSH_TRANSPORT__ = { ownsHost: true }` before the
 * connection plugin reads it: the paired remote desktop gets the full
 * settings/credentials/presets surface, and every call still rides the
 * gated /remote channel. The script self-skips on loopback origins and
 * never throws.
 * @module @linxin666/dsh-remote-web-ui/remote-channel-boot
 */

import { REMOTE_CHANNEL_BOOT_GLOBAL, REMOTE_CHANNEL_RULES, type RemoteChannelRules } from './remote-channel-rules.ts'

/**
 * Build the inline boot script. The result contains no `</script` sequence
 * (the injection contract) and installs a {@link RemoteChannelBootSeat} on
 * the window global.
 */
export function buildRemoteChannelBootScript(rules: RemoteChannelRules = REMOTE_CHANNEL_RULES): string {
  const json = JSON.stringify(rules)
  const seat = JSON.stringify(REMOTE_CHANNEL_BOOT_GLOBAL)
  // Modern syntax is fine: module scripts already gate the GUI to current
  // browsers. Keep everything inside the IIFE and fail closed.
  return '(function(){' +
    'try{' +
    'var w=window,loc=w.location,h=loc.hostname;' +
    // Loopback origins keep the original paths (mirrors isLoopbackHostname).
    "if(h==='localhost'||h==='::1'||/^127(\\.\\d{1,3}){3}$/.test(h))return;" +
    // Host mode: the paired remote desktop presents itself as the machine
    // owner, so the official UI keeps its full configuration surface (the
    // settings mirror, document controller, and deliverables open actions
    // all branch on connection.isLoopback). Must run before any boot entry.
    'try{if(w.__DSH_TRANSPORT__===undefined)w.__DSH_TRANSPORT__={};w.__DSH_TRANSPORT__.ownsHost=true}catch(e){}' +
    'var R=' + json + ';' +
    // The cookieless device credential: read lazily per call - the
    // /pair-app capture script sets it in head AFTER this boot script ran,
    // so a parse-time read would always see null.
    'function rdv(){try{return w.sessionStorage.getItem(R.deviceKey)}catch(e){return null}}' +
    'function att(init){' +
    'var dv=rdv();' +
    'if(dv===null)return init;' +
    'var h=init&&init.headers;' +
    'if(typeof Headers!=="undefined"&&h instanceof Headers){try{h.set(R.deviceHeader,dv)}catch(e){}return init}' +
    'if(typeof h==="object"&&h!==null){var o={};for(var k in h)o[k]=h[k];o[R.deviceHeader]=dv;return Object.assign({},init,{headers:o})}' +
    'return init}' +
    'function sf(p){' +
    'if(p.indexOf(R.pairPrefix)===0)return false;' +
    'if(p.indexOf(R.updatePrefix)===0)return false;' +
    'if(p===R.desktopLauncherPrefix||p.indexOf(R.desktopLauncherPrefix+"/")===0)return false;' +
    'if(p===R.settingsBridgePrefix||p.indexOf(R.settingsBridgePrefix+"/")===0)return false;' +
    'if(p.indexOf(R.apiPrefix)===0)return true;' +
    'if(p.indexOf(R.sidebarPrefix)===0||p==="/sidebar")return true;' +
    'if(p.indexOf(R.gitPrefix)===0||p==="/git")return true;' +
    'if(p.indexOf(R.petPrefix)===0||p==="/pet")return true;' +
    'return false}' +
    'function sw(p){return R.wsPaths.indexOf(p)!==-1}' +
    'function rp(p){return R.remotePrefix+p}' +
    'function so(u){return u.origin===loc.origin}' +
    'function rr(raw){var u;try{u=new URL(raw,loc.href)}catch(e){return raw}' +
    'if(u.origin!==loc.origin)return raw;' +
    'if(!sf(u.pathname))return raw;' +
    'u.pathname=rp(u.pathname);' +
    'if(raw.charAt(0)==="/"&&raw.charAt(1)!=="/")return u.pathname+u.search+u.hash;' +
    'return u.href}' +
    // The unpaired code reader mirrors isUnpairedDenied's envelope shapes.
    'function uc(v){' +
    'if(typeof v!=="object"||v===null)return undefined;' +
    'var n=v.result;' +
    'if(typeof n==="object"&&n!==null){' +
    'var e=n.error;' +
    'if(typeof e==="object"&&e!==null&&typeof e.code==="string")return e.code}' +
    'var t=v.error;' +
    'if(typeof t==="object"&&t!==null&&typeof t.code==="string")return t.code;' +
    'return undefined}' +
    'var seat={onUnpaired:null,onPaired:null,pendingUnpaired:false,restore:function(){}};' +
    'function denied(res){' +
    'if(res.status!==403)return false;' +
    'return res.clone().json().then(function(b){return uc(b)==="unpaired"}).catch(function(){return false})}' +
    'function signal(unpaired){' +
    'if(unpaired){' +
    'if(seat.onUnpaired)seat.onUnpaired();else seat.pendingUnpaired=true' +
    '}else{' +
    'seat.pendingUnpaired=false;' +
    'if(seat.onPaired)seat.onPaired()}}' +
    'var of=w.fetch;' +
    'w.fetch=function(input,init){' +
    'var raw=typeof input==="string"||input instanceof URL?input.toString():input.url;' +
    'var url=new URL(raw,loc.href);' +
    'if(so(url)&&sf(url.pathname)){' +
    'var next=new URL(url);' +
    'next.pathname=rp(url.pathname);' +
    'var target=typeof input==="string"||input instanceof URL?next.toString():new Request(next,input);' +
    'return Promise.resolve(of.call(w,target,att(init))).then(function(res){' +
    // denied() is sync-false for non-403 and a promise otherwise.
    'void Promise.resolve(denied(res)).then(signal);' +
    'return res})}' +
    'return of.call(w,input,init)};' +
    'var OW=w.WebSocket;' +
    'w.WebSocket=function(url,protocols){' +
    'var p=new URL(url.toString(),loc.href);' +
    'var o=p.protocol==="wss:"?"https://"+p.host:p.protocol==="ws:"?"http://"+p.host:"";' +
    'if(o!==""&&o===loc.origin&&sw(p.pathname)){' +
    'var nx=new URL(p);' +
    'nx.pathname=rp(p.pathname);' +
    'var dvv=rdv();' +
    'if(dvv!==null)nx.searchParams.set(R.deviceQuery,dvv);' +
    'return protocols!==undefined?new OW(nx,protocols):new OW(nx)}' +
    'return protocols!==undefined?new OW(url,protocols):new OW(url)};' +
    'w.WebSocket.prototype=OW.prototype;' +
    'w.WebSocket.CONNECTING=OW.CONNECTING;w.WebSocket.OPEN=OW.OPEN;w.WebSocket.CLOSING=OW.CLOSING;w.WebSocket.CLOSED=OW.CLOSED;' +
    'var OE=w.EventSource;' +
    'if(OE!==undefined){' +
    'w.EventSource=function(url,cfg){' +
    'var p=new URL(url.toString(),loc.href);' +
    'if(so(p)&&sf(p.pathname)){' +
    'var nx=new URL(p);' +
    'nx.pathname=rp(p.pathname);' +
    'var dvv=rdv();' +
    'if(dvv!==null)nx.searchParams.set(R.deviceQuery,dvv);' +
    'return new OE(nx,cfg)}' +
    'return new OE(url,cfg)};' +
    'w.EventSource.prototype=OE.prototype}' +
    // Resource src accessors (img/script/iframe), mirroring patchSrcAccessor.
    'var restores=[];' +
    'function patchSrc(C){' +
    'if(C===undefined)return;' +
    'var d=Object.getOwnPropertyDescriptor(C.prototype,"src");' +
    'if(d===undefined||d.configurable===false||d.set===undefined)return;' +
    'var os=d.set;' +
    'Object.defineProperty(C.prototype,"src",{configurable:true,enumerable:d.enumerable!==false,get:d.get,set:function(v){os.call(this,rr(String(v)))}});' +
    'restores.push(function(){Object.defineProperty(C.prototype,"src",d)})}' +
    'patchSrc(w.HTMLImageElement);patchSrc(w.HTMLScriptElement);patchSrc(w.HTMLIFrameElement);' +
    'seat.restore=function(){' +
    'w.fetch=of;' +
    'w.WebSocket=OW;' +
    'if(OE!==undefined)w.EventSource=OE;' +
    'for(var i=0;i<restores.length;i++)restores[i]();' +
    'try{delete w[' + seat + ']}catch(e){w[' + seat + ']=undefined}};' +
    'w[' + seat + ']=seat' +
    // The boot watchdog rides the same IIFE and skip conditions: it needs
    // the non-loopback gate above (the desktop boots over loopback without
    // a tunnel in the path) and the try/catch fail-closed envelope.
    buildBootWatchdogScript() +
    '}catch(e){}' +
    '})();'
}

/** Boot-watchdog latch: one self-reload per session while the boot is broken. */
export const BOOT_WATCHDOG_KEY = 'dsh-remote-boot-reload'

/** Total wait for the app's first conversation surface before the reload. */
const BOOT_WATCHDOG_WAIT_MS = 15_000

/** Watchdog poll cadence. */
const BOOT_WATCHDOG_POLL_MS = 1_000

/**
 * Build the boot-watchdog script fragment. A remote boot has no recovery
 * path of its own: the SPA mounts nothing when a boot-critical request dies
 * (a tunnel-edge 429 under burst, a dropped stream, a boot-order race), and
 * the phone then shows a permanently blank shell. The watchdog polls for the
 * app's conversation surface and reloads once when it never appears; the
 * sessionStorage latch keeps a genuinely broken deployment from looping,
 * and a successful boot clears the latch so a later failure can recover.
 */
export function buildBootWatchdogScript(waitMs = BOOT_WATCHDOG_WAIT_MS, pollMs = BOOT_WATCHDOG_POLL_MS): string {
  const key = JSON.stringify(BOOT_WATCHDOG_KEY)
  return (
    // Leading semicolon: the preceding seat assignment ends without one,
    // and the fragment must parse when spliced into the IIFE.
    ';function wBoot(){try{return !!(w.document&&w.document.querySelector&&(w.document.querySelector("[data-conversation-scroll]")||w.document.querySelector("[data-slot=\\"conversation\\"]")))}catch(e){return false}}' +
    'function wTick(n){try{' +
    'if(wBoot()){try{w.sessionStorage.removeItem(' + key + ')}catch(e){}return}' +
    'if(n<' + waitMs + '){w.setTimeout(function(){wTick(n+' + pollMs + ')},' + pollMs + ');return}' +
    'var done=false;try{done=w.sessionStorage.getItem(' + key + ')==="1"}catch(e){}' +
    'if(done)return;' +
    'try{w.sessionStorage.setItem(' + key + ',"1")}catch(e){}' +
    'w.location.reload()' +
    '}catch(e){}}' +
    'if(typeof w.setTimeout==="function")w.setTimeout(function(){wTick(0)},' + pollMs + ');'
  )
}

/** The script this plugin contributes; built once from the live rules. */
export const REMOTE_CHANNEL_BOOT_SCRIPT: string = buildRemoteChannelBootScript()
