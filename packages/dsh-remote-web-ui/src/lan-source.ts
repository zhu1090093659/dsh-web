/**
 * The landing page's network-source decision: which origin a paired phone
 * should keep using.
 *
 * The QR link can only name one base, and the server cannot know whether the
 * scanning phone sits on this machine's own network: the public (relayed)
 * base is the only one that is always reachable, so the QR names it and the
 * phone decides at connect time. The device-gated landing (/pair-app) is the
 * plugin's own page already rendered ahead of the official shell's boot, so it
 * is the natural place to probe: after the page is served, a short
 * cross-origin `fetch` per LAN candidate (a no-cors GET at
 * {@link LAN_PING_PATH}) tells the browser whether that LAN origin answers,
 * and the first one that does becomes the new origin. A probe that finds
 * nothing, or that runs out of budget, changes nothing — the page the phone
 * already holds stays paired and usable, so the probe can never block pairing.
 *
 * Browsers do not block this probe. An https page may not normally fetch
 * `http://` subresources, but a host that is an IP literal is exempt from both
 * the block and the automatic upgrade (verified against Chrome: the console
 * reports "This request was not upgraded to HTTPS because its URL's host is an
 * IP address" and delivers the response), which is exactly the shape every LAN
 * candidate has.
 *
 * @module @linxin666/dsh-remote-web-ui/lan-source
 */

/** sessionStorage key holding this session's source decision. */
export const LAN_SOURCE_STORAGE_KEY = 'dsh-remote-lan-source'

/**
 * Probe budget for the whole candidate set. Long enough for a LAN round trip,
 * short enough that a phone on another network never waits on it — the probe
 * is fire-and-forget and the page it runs on is already usable.
 */
export const LAN_SOURCE_PROBE_TIMEOUT_MS = 800

/**
 * How recently a LAN hop must have been taken for a return to a non-LAN origin
 * to read as "the hop did not stick". A phone that fails to load the LAN page
 * re-scans the QR (which always names the public base) within seconds, and the
 * landing then has to choose the public source instead of hopping again into
 * the same black hole; a deliberate return much later is a fresh decision and
 * re-probes.
 */
export const LAN_SOURCE_RETRY_WINDOW_MS = 120_000

/** One probe payload: everything the injected script needs, JSON-serializable. */
export interface LanSourceHop {
  /**
   * The LAN origins the probe may hop to, normalized (`https://host:port` with
   * a default port dropped) so they compare equal to `location.origin`.
   */
  candidates: readonly string[]
  /** The path the hop targets on the winning origin. */
  path: string
  /** The path the probe itself requests, on each candidate. */
  pingPath: string
  /** The one-time grant the hop consumes on the winning origin. */
  grant: string
}

/**
 * Build the inline script that runs the source decision on the landing page.
 * Reads every browser global through `window`, so a test can run it against
 * one fake object (the same seam the parse-time boot patch uses).
 * @param hop - the probe payload for this landing render.
 * @returns the `<script>` element to splice into the landing's head.
 */
export function appShellLanSwitchScript(hop: LanSourceHop): string {
  const payload = JSON.stringify({
    key: LAN_SOURCE_STORAGE_KEY,
    candidates: hop.candidates,
    path: hop.path,
    ping: hop.pingPath,
    grant: hop.grant,
    timeout: LAN_SOURCE_PROBE_TIMEOUT_MS,
    retry: LAN_SOURCE_RETRY_WINDOW_MS,
  })
  const body = '(function(){try{' +
    'var w=window,loc=w.location;' +
    'var P=' + payload + ';' +
    'var S=w.sessionStorage;' +
    // The candidate set is the decision's identity: a host whose interfaces
    // changed hands the landing a different signature, which forces a re-probe.
    'P.sig=P.candidates.join(",");' +
    // The stored decision: which source this session settled on, the candidate
    // set it was made against (so a host whose interfaces changed re-decides),
    // and when. Anything unreadable is treated as "no decision".
    'function rd(){try{' +
    'var raw=S.getItem(P.key);' +
    'if(typeof raw!=="string"||raw==="")return undefined;' +
    'var d=JSON.parse(raw);' +
    'if(typeof d!=="object"||d===null)return undefined;' +
    'if(d.src!=="lan"&&d.src!=="public")return undefined;' +
    'if(typeof d.sig!=="string"||typeof d.at!=="number")return undefined;' +
    'return d' +
    '}catch(e){return undefined}}' +
    'function wr(d){try{S.setItem(P.key,JSON.stringify(d))}catch(e){}}' +
    // Already on a LAN candidate: nothing to decide, and a hop back to it
    // would be the same origin. Recording the fact keeps a reload from probing.
    'function own(){for(var i=0;i<P.candidates.length;i++){if(P.candidates[i]===loc.origin)return true}return false}' +
    'function go(base){try{loc.replace(base+P.path+"?grant="+encodeURIComponent(P.grant))}catch(e){}}' +
    'function probe(){' +
    'if(typeof w.fetch!=="function")return;' +
    'var settled=false;' +
    'var timer=w.setTimeout(function(){finish(undefined)},P.timeout);' +
    'function finish(base){' +
    'if(settled)return;' +
    'settled=true;' +
    'try{w.clearTimeout(timer)}catch(e){}' +
    // The first answer wins: one reachable candidate is all the hop needs, and
    // the losers keep running their own no-cors GETs harmlessly.
    'if(base===undefined){wr({src:"public",sig:P.sig,at:Date.now()});return}' +
    'wr({src:"lan",sig:P.sig,base:base,at:Date.now()});' +
    'go(base)}' +
    'for(var i=0;i<P.candidates.length;i++){(function(base){' +
    'var sent;' +
    'try{sent=w.fetch(base+P.ping,{mode:"no-cors",cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"})}catch(e){sent=undefined}' +
    'if(sent===undefined||typeof sent.then!=="function")return;' +
    'sent.then(function(){finish(base)},function(){})' +
    '})(P.candidates[i])}}' +
    'var d=rd();' +
    'if(own()){if(d===undefined||d.sig!==P.sig)wr({src:"lan",sig:P.sig,base:loc.origin,at:Date.now()});return}' +
    'if(d!==undefined&&d.sig===P.sig){' +
    'if(d.src==="public")return;' +
    // A LAN decision taken moments ago, on a page that is not a LAN candidate,
    // is a hop that did not stick. Fall back rather than hop again.
    'if(Date.now()-d.at<P.retry){wr({src:"public",sig:P.sig,at:Date.now()});return}}' +
    'probe()' +
    '}catch(e){}})();'
  return `<script>${body}</script>`
}
