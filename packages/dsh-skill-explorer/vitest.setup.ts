// Vitest setup: jsdom environment already provides DOM globals; nothing
// extra is needed for the skill-explorer test surface.
//
// React 18 act() requires the act-environment flag; without it every act call
// in panel interaction tests warns (and the warning pollutes CI output).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export {}
