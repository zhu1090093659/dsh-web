/**
 * Russian dictionary for the "provider-signin" locale namespace.
 * Source package: packages/dsh-provider-signin (its zh dictionary is the key
 * source). Maintained centrally by the dsh-i18n language pack; when a zh key
 * is added or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'status.none': 'Не выполнен вход',
  'status.oauth': 'Вход выполнен (подписка OAuth)',
  'status.apikey': 'API-ключ сохранён',
  'signIn': 'Войти',
  'cancel': 'Отмена',
  'close': 'Закрыть',
  'answer': 'Отправить',
  'pickMethod': 'Выберите способ входа',
  'inputPrompt': 'Введите значение',
  'secretPrompt': 'Введите значение (скрыто)',
  'running': 'Выполняется вход…',
  'authorized': 'Вход выполнен',
  'cancelled': 'Отменено',
  'failed': 'Ошибка входа',
  'openPage': 'Открыть страницу авторизации',
  'enterCode': 'Введите этот код на странице:',
  'transport': 'Нет связи с хостом',
}
