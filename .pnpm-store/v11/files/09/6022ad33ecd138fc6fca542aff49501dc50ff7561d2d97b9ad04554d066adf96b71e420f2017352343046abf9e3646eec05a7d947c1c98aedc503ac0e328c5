"use strict";import{hasOnlyChild as n}from"../../parser/node-utils.js";const s={Quantifier({node:t}){const{body:r,max:o}=t;if(o!==1/0||r.type!=="Group"||r.atomic)return;const e=r.body[0];if(!n(e,{type:"Quantifier"}))return;const i=e.body[0];i.kind==="possessive"||i.min>1||i.max<2||(i.min?i.min===1&&(e.body[0]=i.body):i.max=1)}};export{s as preventReDoS};
//# sourceMappingURL=prevent-redos.js.map
