/**
 * Display copy for the tree's copy affordance; the owner passes localized
 * labels (this package is cordis-free, so copy arrives via props). Every
 * field defaults to the current built-in value, so existing consumers render
 * unchanged.
 */
export interface JsonTreeLabels {
    /** Menu item: copy the raw primitive value. */
    copyValue: string;
    /** Menu item: copy the value as compact JSON (primitive rows). */
    copyJson: string;
    /** Menu item: copy the property path. */
    copyPath: string;
    /** Menu item: copy the value as pretty-printed JSON. */
    copyPrettyJson: string;
    /** Menu item: copy the value as compact JSON (object rows). */
    copyCompactJson: string;
    /** Copy-button state label after a successful copy. */
    copied: string;
    /** Copy-button state label after a failed copy. */
    copyFailed: string;
    /** Expander aria label while expanded. */
    collapseNode: string;
    /** Expander aria label while collapsed. */
    expandNode: string;
    /** Copy-button tooltip, given the current action label. */
    copyButtonTitle: (action: string) => string;
}
/** Props for the read-only, token-themed JSON tree. */
export interface JsonTreeProps {
    /** Parsed JSON object or array. */
    data: object | unknown[];
    /** Accessible label for the tree. */
    label?: string;
    /** Optional positioning class owned by the caller. */
    className?: string | undefined;
    /** Whether JSON rows expose copy actions. */
    copyable?: boolean;
    /** Whether the top-level object or array is always expanded. */
    expandTopLevel?: boolean;
    /** Localized display copy; omitted fields keep the built-in defaults. */
    labels?: Partial<JsonTreeLabels> | undefined;
}
/**
 * Render parsed JSON as a compact, keyboard-accessible inspector tree.
 * @param props - Parsed data, accessible label, and display options.
 * @returns A read-only JSON tree with an optionally fixed-open top level.
 */
export declare function JsonTree({ data, label, className, copyable, expandTopLevel, labels, }: JsonTreeProps): import("react").JSX.Element;
//# sourceMappingURL=JsonTree.d.ts.map