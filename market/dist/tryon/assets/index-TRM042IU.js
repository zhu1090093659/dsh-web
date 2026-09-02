import{b as u,ca as w,aS as b,cb as m,b8 as v,bi as g,bV as S,aV as E}from"./index-DGS2ur_Y.js";import{F as R}from"./index-CzwKD20B.js";import"./git-DJDr4heb.js";const N="web-app",y=E(new URL("../../../..",import.meta.url)),U="webRuntime",j=["webServer"],A=u.object({openBrowser:u.boolean().default(!0),printUrl:u.boolean().default(!0),surfaceContext:u.boolean().default(!0),trustedHosts:u.array(String).default([])}),h="DSH_WEB_URL",O="127.0.0.1",_="0.0.0.0";function L(e){const r=v(e);return["SSH_CONNECTION","SSH_TTY"].some(n=>{const t=r.getFrom(n,["process"])?.value;return t!==void 0&&t!==""})}const T=import.meta.resolve("open"),C=`
try {
  const { default: open } = await import(${JSON.stringify(T)})
  const launcher = await open(process.argv[1])
  if (process.platform === 'win32') {
    // open resolves at PowerShell spawn; keep it referenced until that launcher hands the URL to Windows.
    const code = launcher.exitCode ?? await new Promise((resolve, reject) => {
      function onError(error) {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code) {
        launcher.off('error', onError)
        resolve(code)
      }
      launcher.ref()
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
    if (code !== 0) throw new Error('browser operating-system launcher exited with code ' + String(code))
  }
  process.exitCode = 0
} catch (error) {
  // The parent turns this exit into the manual-URL warning.
  console.error(error)
  process.exitCode = 1
}
`;function H(e,r){const n=e===_?Object.values(m()).flat().filter(t=>t!==void 0&&t.family==="IPv4"&&!t.internal).map(t=>t.address):[];return{lanAddresses:n,trustedHosts:[...n,...r]}}function I(e){return`You are interacting with the user through the DeepSeek Harness Web GUI at ${e}. When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while \`pnpm run dev:web\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`}function d(e){const r=e.get("webServer")?.port;if(r===void 0)throw new Error("web-app: webServer service missing while resolving Web runtime");return`http://${O}:${String(r)}`}function P(){const e=b(import.meta.url);try{return e.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html")}catch{throw new Error("web-app: frontend dist not built; run pnpm run build from the repository root first")}}function B(e){return g(process.execPath,["--input-type=module","--eval",C,"--",e],{env:S(),stdio:["ignore","inherit","pipe"]})}async function W(e){const r=B(e);let n="";r.stderr?.setEncoding("utf8"),r.stderr?.on("data",t=>{n+=t}),await new Promise((t,o)=>{function i(s){r.off("close",a),o(s)}function a(s){if(r.off("error",i),s!==0){const c=n.trim().split(/\r?\n/u)[0],l=c===void 0||c===""?`browser launcher exited with code ${String(s)}`:c.replace(/^(?:[A-Za-z]*Error):\s*/u,"");o(new Error(l));return}n!==""&&process.stderr.write(n),t()}r.once("error",i),r.once("close",a)})}const p={resolveDistIndex:P,openBrowser:W};function x(e,r){const n=H(e.webServer.host,r.trustedHosts),t=r.openBrowser&&!L(e);if(e.provide(U,n),e.plugin(R,{distIndex:p.resolveDistIndex()}),r.surfaceContext&&(e.inject(["systemPrompt"],o=>{w(o,y),o.systemPrompt.section({name:"app:web-surface",order:-98,text:()=>I(d(o))})}),e.inject(["shellEnv"],o=>{o.shellEnv.register({name:"web-runtime",variables:{[h]:{description:"Canonical local URL of the DeepSeek Harness Web GUI serving this session."}},resolve:()=>({[h]:d(o)})})})),r.printUrl||t){const o=()=>{const a=d(e),s=n.lanAddresses[0],c=e.webServer.port;r.printUrl&&console.log(`dsh web: ${a}${s===void 0?"":` (LAN: http://${s}:${String(c)})`}`),t&&(console.log("dsh web: opening the default browser; pass --no-open to disable"),p.openBrowser(a).catch(l=>{const f=l instanceof Error?l.message:String(l);console.error(`web-app: could not open the default browser because ${f}; visit ${a} manually`)}))},i=e.get("loader")?.await();i===void 0?o():i.then(()=>{e.get("webServer")!==void 0&&o()},()=>{})}}export{A as Config,x as apply,j as inject,p as internals,N as name,H as resolveLanTrust};
