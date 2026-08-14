/** The copy-feedback hook's return: the transient flag and the copy handler. */
export interface CopyFeedback {
    /** True for {@link COPIED_FEEDBACK_MS} after a successful write; render the success label off it. */
    copied: boolean;
    /** Copy the hook's text; no-op while `copied` is still true, silent on a refused write. */
    onCopy: () => void;
}
/**
 * Copy `text` to the clipboard with one-second success feedback.
 * @param text - the text to write on copy.
 * @returns the `copied` flag and the `onCopy` handler.
 */
export declare function useCopyFeedback(text: string): CopyFeedback;
//# sourceMappingURL=use-copy-feedback.d.ts.map