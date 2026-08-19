/**
 * Thin store re-export so the client imports the annotation model from one
 * place (the core module stays the single source of truth).
 * @module @linxin666/dsh-page-annotate/client/annotate-model
 */

export { clampUnitRect, createAnnotationStore, hitTest, normalizeRect } from '../core/annotate.ts'
export type { Annotation, AnnotationStore, DraftAnnotation, PendingAnnotation, ShapeKind } from '../core/annotate.ts'
