"use strict";import{createLookaroundAssertion as o}from"../../parser/parse.js";const a={NamedCallout({node:r,replaceWith:i}){const{arguments:e,kind:n}=r;if(n==="fail"){i(o({negate:!0}));return}if(!e)return;const s=e.filter(t=>t!=="").map(t=>typeof t=="string"&&/^[+-]?\d+$/.test(t)?+t:t);r.arguments=s.length?s:null}};export{a as simplifyCallouts};
//# sourceMappingURL=simplify-callouts.js.map
