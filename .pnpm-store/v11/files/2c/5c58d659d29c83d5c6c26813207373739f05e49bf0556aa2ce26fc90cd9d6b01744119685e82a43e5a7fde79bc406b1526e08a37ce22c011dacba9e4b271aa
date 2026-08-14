import type { OnigurumaRegex } from '../generator/generate.js';
import type { OptimizationName } from './optimizations.js';
type OptimizationStates = {
    [key in OptimizationName]: boolean;
};
type OptimizeOptions = {
    flags?: string;
    override?: Partial<OptimizationStates>;
    rules?: {
        allowOrphanBackrefs?: boolean;
        captureGroup?: boolean;
        singleline?: boolean;
    };
};
/**
Returns an optimized Oniguruma pattern and flags.
*/
declare function optimize(pattern: string, options?: OptimizeOptions): OnigurumaRegex;
declare function getOptionalOptimizations(options?: {
    disable?: boolean;
}): OptimizationStates;
export { type OptimizeOptions, getOptionalOptimizations, optimize, };
//# sourceMappingURL=optimize.d.ts.map