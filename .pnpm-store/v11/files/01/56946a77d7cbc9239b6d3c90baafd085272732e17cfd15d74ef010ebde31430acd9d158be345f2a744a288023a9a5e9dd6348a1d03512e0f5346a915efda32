import { r as TscContext } from "./context-_3g_7Eca.mjs";
import { SourceMapInput } from "rolldown";
import { TsconfigJson } from "get-tsconfig";
import ts from "typescript";

//#region src/tsc/types.d.ts
interface TscModule {
  program: ts.Program;
  file: ts.SourceFile;
}
interface TscOptions {
  tsconfig?: string;
  tsconfigRaw: TsconfigJson;
  cwd: string;
  build: boolean;
  incremental: boolean;
  entries?: string[];
  id: string;
  sourcemap: boolean;
  vue?: boolean;
  tsMacro?: boolean;
  context?: TscContext;
}
interface TscResult {
  code?: string;
  map?: SourceMapInput;
  error?: string;
}
//#endregion
//#region src/tsc/index.d.ts
declare function tscEmit(tscOptions: TscOptions): TscResult;
//#endregion
export { TscResult as i, TscModule as n, TscOptions as r, tscEmit as t };