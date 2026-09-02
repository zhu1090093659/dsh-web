import{b as s,b6 as y}from"./index-DGS2ur_Y.js";import"./git-DJDr4heb.js";const _="tool-ralph",F=["tools","workflowEngine","subagents","systemPrompt"],L=s.object({subagentProvider:s.string().default("spawn"),maxRounds:s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256),maxHandoffChars:s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384),maxResultChars:s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384)}),k={name:"ralph-loop",description:"Iterate toward one objective with a fresh child and bounded structured handoff per round.",phases:[{title:"Fresh-agent rounds",detail:"One clean child context per Ralph round."}]},v=String.raw`
const reportSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'nextSteps', 'blocker'],
  additionalProperties: false,
}

function normalizedText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function normalizedList(value) {
  return Array.isArray(value) && value.every(normalizedText)
}

function validateReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Ralph child returned no structured round report')
  }
  if (!normalizedText(report.summary)) {
    throw new Error('Ralph round report summary must be non-empty and normalized')
  }
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error('Ralph round report evidence and nextSteps must contain only non-empty normalized strings')
  }
  if (typeof report.blocker !== 'string' || report.blocker !== report.blocker.trim()) {
    throw new Error('Ralph round report blocker must be a normalized string')
  }
  switch (report.status) {
    case 'continue':
      if (report.nextSteps.length === 0 || report.blocker !== '') {
        throw new Error('a continuing Ralph report needs nextSteps and an empty blocker')
      }
      break
    case 'complete':
      if (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '') {
        throw new Error('a complete Ralph report needs evidence, no nextSteps, and an empty blocker')
      }
      break
    case 'blocked':
      if (!normalizedText(report.blocker)) {
        throw new Error('a blocked Ralph report needs a concrete blocker')
      }
      break
    default:
      throw new Error('Ralph round report status is invalid')
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > args.maxHandoffChars) {
    throw new Error('Ralph round report exceeds maxHandoffChars (' + serialized.length + ' > ' + args.maxHandoffChars + ')')
  }
  return report
}

let previous
phase('Fresh-agent rounds')
for (let round = 1; round <= args.maxRounds; round += 1) {
  const prior = previous === undefined ? '(none — this is the first round)' : JSON.stringify(previous)
  const prompt = [
    'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
    'Immutable objective:\n' + args.objective,
    'Ralph round: ' + round + ' of ' + args.maxRounds + '.',
    'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
    'Previous structured handoff:\n' + prior,
    'Return one report with exact normalized strings. Use status continue with at least one nextSteps entry while useful work remains; complete only with concrete evidence and no nextSteps; blocked only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.',
  ].join('\n\n')
  const rawReport = await agent(prompt, {
    label: 'Ralph round ' + round,
    phase: 'Fresh-agent rounds',
    schema: reportSchema,
  })
  if (rawReport === null) {
    return { status: 'round-failed', roundsStarted: round, lastReport: previous ?? null }
  }
  const report = validateReport(rawReport)
  if (report.status === 'complete') return { status: 'complete', roundsStarted: round, report }
  if (report.status === 'blocked') return { status: 'blocked', roundsStarted: round, report }
  previous = report
}
return { status: 'budget-limited', roundsStarted: args.maxRounds, report: previous }
`,E="Run a foreground fresh-agent Ralph loop toward one immutable objective. Use only when the direct human explicitly asks for Ralph or fresh-agent iteration. Each round opens a new child with no parent conversation or prior child session; the shared workspace is long-term memory, and only a bounded structured report crosses rounds. The call returns when a worker reports completion or a concrete blocker, or at the round limit. Ordinary long-running same-session work belongs to goal tools.";function S(r){const t=r.subagentProvider??"spawn",e=r.maxRounds??256,o=r.maxHandoffChars??16384,n=r.maxResultChars??16384;if(t.length===0||t!==t.trim())throw new TypeError("subagentProvider must be a non-empty normalized string");if(!Number.isSafeInteger(e)||e<1)throw new TypeError("maxRounds must be a positive safe integer");if(!Number.isSafeInteger(o)||o<1)throw new TypeError("maxHandoffChars must be a positive safe integer");if(!Number.isSafeInteger(n)||n<1)throw new TypeError("maxResultChars must be a positive safe integer");return{subagentProvider:t,maxRounds:e,maxHandoffChars:o,maxResultChars:n}}function x(r,t){const e=r??t;if(!Number.isSafeInteger(e)||e<1)throw new TypeError("Ralph maxRounds must be a positive safe integer");if(e>t)throw new TypeError(`Ralph maxRounds ${e} exceeds the deployment ceiling ${t}`);return e}function j(r,t){const e=r.subagents.getProvider(t);if(e===void 0)throw new Error(`Ralph subagent provider "${t}" is not registered`);if(!e.capabilities.outputSchema)throw new Error(`Ralph subagent provider "${t}" does not support structured output`);if(e.inheritsParentContext)throw new Error(`Ralph subagent provider "${t}" inherits parent context; Ralph requires a fresh provider`);return e}function g(r){return typeof r=="object"&&r!==null&&!Array.isArray(r)}function p(r){return typeof r=="string"&&r.length>0&&r===r.trim()}function w(r){return Array.isArray(r)&&r.every(p)}function i(r,t,e){if(!g(r)||Object.keys(r).sort().join(",")!=="blocker,evidence,nextSteps,status,summary"||r.status!==t||!p(r.summary)||!w(r.evidence)||!w(r.nextSteps)||typeof r.blocker!="string"||r.blocker!==r.blocker.trim())throw new Error("Ralph workflow returned a malformed round report");const o={status:t,summary:r.summary,evidence:r.evidence,nextSteps:r.nextSteps,blocker:r.blocker};if(t==="continue"&&(o.nextSteps.length===0||o.blocker!==""))throw new Error("Ralph workflow returned an invalid continuing report");if(t==="complete"&&(o.evidence.length===0||o.nextSteps.length!==0||o.blocker!==""))throw new Error("Ralph workflow returned an invalid completion report");if(t==="blocked"&&!p(o.blocker))throw new Error("Ralph workflow returned an invalid blocked report");const n=JSON.stringify(o).length;if(n>e)throw new Error(`Ralph workflow returned an oversized handoff (${n} > ${e})`);return o}function T(r,t,e){if(!g(r)||typeof r.roundsStarted!="number"||!Number.isSafeInteger(r.roundsStarted)||r.roundsStarted<1||r.roundsStarted>t)throw new Error("Ralph workflow returned a malformed terminal result");const o=r.roundsStarted;switch(r.status){case"complete":if(Object.keys(r).sort().join(",")!=="report,roundsStarted,status")throw new Error("Ralph workflow returned a malformed terminal result");return{status:"complete",roundsStarted:o,report:i(r.report,"complete",e)};case"blocked":if(Object.keys(r).sort().join(",")!=="report,roundsStarted,status")throw new Error("Ralph workflow returned a malformed terminal result");return{status:"blocked",roundsStarted:o,report:i(r.report,"blocked",e)};case"budget-limited":if(Object.keys(r).sort().join(",")!=="report,roundsStarted,status")throw new Error("Ralph workflow returned a malformed terminal result");if(o!==t)throw new Error("Ralph workflow returned budget-limited before the round limit");return{status:"budget-limited",roundsStarted:o,report:i(r.report,"continue",e)};case"round-failed":if(Object.keys(r).sort().join(",")!=="lastReport,roundsStarted,status")throw new Error("Ralph workflow returned a malformed terminal result");if(o===1){if(r.lastReport!==null)throw new Error("Ralph workflow returned an invalid first-round failure");return{status:"round-failed",roundsStarted:o}}if(r.lastReport===null)throw new Error("Ralph workflow returned a round failure without its last handoff");return{status:"round-failed",roundsStarted:o,lastReport:i(r.lastReport,"continue",e)};default:throw new Error("Ralph workflow returned an unknown terminal status")}}function $(r){switch(r.stopReason){case"completed":return;case"cancelled":return`Ralph workflow was cancelled${r.error===void 0?"":` (${r.error})`}`;case"error":return`Ralph workflow failed: ${r.error??"unknown error"}`;default:return`Ralph workflow ended abnormally (${String(r.stopReason)})`}}const b=`
… [truncated]`;function R(r,t){return r.length<=t?r:t<=14?b.slice(0,t):`${r.slice(0,t-14)}${b}`}function N(r,t){const e=`${r.roundsStarted} round${r.roundsStarted===1?"":"s"}`;let o;switch(r.status){case"complete":o=`Ralph worker reported completion after ${e}.
Final report:
${JSON.stringify(r.report,null,2)}`;break;case"blocked":o=`Ralph worker reported a blocker after ${e}.
Final report:
${JSON.stringify(r.report,null,2)}`;break;case"budget-limited":o=`Ralph reached its ${e} limit; the worker reported work remaining.
Final report:
${JSON.stringify(r.report,null,2)}`;break}return R(o,t)}const P={runId:{type:"string",required:!0},agentsStarted:{type:"integer",required:!0},result:{type:"json",required:!0}};function A(r,t){const e=`Ralph round ${r.roundsStarted} child failed before producing a structured report.`;return R(r.lastReport===void 0?`${e}
No previous handoff was available.`:`${e}
Last successful handoff:
${JSON.stringify(r.lastReport,null,2)}`,t)}function O(r){return{card:"generic",title:"ralph",rawInput:r.objective}}function I(r,t){return{card:"generic"}}function H(r,t){const e=S(t);r.systemPrompt.section({name:"tool:ralph",order:116,text:"Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflows for bounded delegation and fan-out."}),r.tools.register(y({name:"ralph",description:E,parameters:{objective:{type:"string",required:!0,description:"The immutable completion objective for every fresh Ralph round."},maxRounds:{type:"number",description:"Optional positive safe-integer round cap, bounded by the deployment ceiling."}},output:{schema:{type:"object",additionalProperties:!1,properties:P},render:(o,n)=>[{type:"text",text:N(n.result,e.maxResultChars)}]},async execute(o,n){const c=n.agent;if(c===void 0)throw new Error("Ralph tool requires a calling agent (exec.agent was undefined)");const h=o.objective.trim();if(h.length===0)throw new Error("Ralph objective must be a non-empty string");const d=x(o.maxRounds,e.maxRounds);j(r,e.subagentProvider);const a=r.workflowEngine.start({script:v,meta:k,args:{objective:h,maxRounds:d,maxHandoffChars:e.maxHandoffChars},subagentProvider:e.subagentProvider,maxTotalAgents:d,parent:c,signal:n.signal}),f=()=>{a.cancel("parent step aborted")};n.signal.addEventListener("abort",f,{once:!0}),n.signal.aborted&&a.cancel("parent step aborted");try{const l=await a.result,m=$(l);if(m!==void 0)throw new Error(m);const u=T(l.value,d,e.maxHandoffChars);if(u.status==="round-failed")throw new Error(A(u,e.maxResultChars));return{runId:a.id,agentsStarted:l.agentsStarted,result:u}}finally{n.signal.removeEventListener("abort",f),await a.dispose()}},presentCall:O,presentResult:I}))}export{L as Config,H as apply,F as inject,_ as name};
