/**
 * Russian dictionary for the "settings.pluginManager" locale namespace.
 * Source package: packages/dsh-plugin-manager (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'checkUpdates': 'Проверить обновления',
  'checking': 'Проверка…',
  'downloading': 'Скачивание…',
  'downloadingPercent': 'Скачивание: {percent}%',
  'extracting': 'Распаковка…',
  'failed': 'Не удалось выполнить операцию: {reason}.',
  'fetching': 'Получение сведений о плагине…',
  'latest': 'Последняя версия: {version}',
  'localOnlyBody': 'Для защиты конфигурации хоста управление плагинами доступно только из локального браузера.',
  'localOnlyTitle': 'Только на этом компьютере',
  'noUpdates': 'Установлена последняя версия.',
  'restartHint': 'Изменения плагинов вступят в силу после перезапуска приложения.',
  'updatesAvailable': 'Доступно обновлений: {count}',
  'updateAll': 'Обновить все ({count})',
  'updatingAll': 'Обновление {name} ({index}/{total})',
  'updateAllDone': 'Обновлено; перезапустите, чтобы изменения вступили в силу.',
  'updatesPanelTitle': 'Обновления плагинов',
  'thirdPartyOnly': 'Проверяются только сторонние плагины; пакеты @deepseek-ai/ обновляются вместе с DSH.',
  'restartNow': 'Перезапустить сейчас',
  'restarting': 'Перезапуск…',
  'restartConfirm': 'Перезапустить',
  'restartPlanRelaunch': 'Служба DSH перезапустится; выполняющиеся задачи будут прерваны.',
  'restartPlanShell': 'Настольное приложение перезапускается через системный диалог: после подтверждения появится официальный диалог «приложение остановлено» — нажмите в нём «Перезапустить».',
  'restartPlanManual': 'Этот процесс не может перезапуститься сам; перезапустите DSH вручную.',
  'restartShellWarning': 'Он также создаёт отчёт о сбое. Можно перезапустить вручную: выйдите из DeepSeek Harness (Cmd+Q) и откройте его снова.',
  'restartDesktopHint': 'Выберите «Перезапустить» в появившемся системном диалоге.',
  'restartRelaunchHint': 'Перезапуск запрошен; обновите страницу, когда сервер вернётся.',
  'restartManualHint': 'Этот процесс не может перезапуститься сам; перезапустите DSH вручную.',
  'cancel': 'Отмена',
  'update': 'Обновить',
  'updateBlockedDsh': 'Требуется DSH ≥ {min}; сначала обновите DSH, затем повторите попытку.',
  'updateRequiresDsh': 'Требуется DSH ≥ {min}',
  'updateUnverifiedDsh': 'Не удалось определить версию DSH на этом компьютере (требуется DSH ≥ {min}); обновление приостановлено',
  'updateSection': 'Обновление',
  'updating': 'Обновление…',
  'writing': 'Запись конфигурации…',
}
