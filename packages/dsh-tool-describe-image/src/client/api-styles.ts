/**
 * The protocol choices the describe-image settings card offers. Single source
 * of truth: the form's choiceField spec, the rendered dropdown, and the
 * settings shape's apiStyle union all derive from it, so a choice the UI
 * offers can never be rejected by the form (which would block the Save
 * button) or be missing from the stored-value type.
 * @module @linxin666/dsh-tool-describe-image/client/api-styles
 */

/** Every apiStyle the settings card can stage. */
export const API_STYLE_CHOICES = ['chat-completions', 'responses', 'anthropic-messages'] as const

/** One storable apiStyle value. */
export type ClientApiStyle = typeof API_STYLE_CHOICES[number]

import type { DescribeImageClientKey } from './locales.ts'

/** Locale key of each choice's label, in the same order as {@link API_STYLE_CHOICES}. */
export const API_STYLE_LABEL_KEYS: Record<ClientApiStyle, DescribeImageClientKey> = {
  'chat-completions': 'field.apiStyle.chatCompletions',
  responses: 'field.apiStyle.responses',
  'anthropic-messages': 'field.apiStyle.anthropicMessages',
}
