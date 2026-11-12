/**
 * Russian dictionary for the "browser-view" locale namespace.
 * Source package: packages/dsh-browser-view (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 *
 * The panel is a right-sidebar tab: the shell names the chip, and a page title
 * published by the body replaces the default text once a page is open.
 */

export const ru: Record<string, string> = {
  'tab.title': 'Вид браузера',
  'guide.description': 'Смотреть страницу, которой управляет агент',
  'panel.tab.untitled': 'Без названия',
  'panel.url.empty': 'Страница ещё не открыта',
  'panel.address.label': 'Адрес страницы',
  'panel.toolbar.refresh': 'Обновить изображение',
  'panel.frame.alt': 'Живое изображение страницы, которой управляет агент',
  'panel.empty.title': 'Изображения пока нет',
  'panel.empty.hint': 'Когда агент откроет страницу, здесь будет видно страницу, которую он смотрит.',
  'panel.error.title': 'Ошибка вида браузера',
  'panel.trace.idle': 'Действий инструментов пока нет',
  'panel.status.connecting': 'Подключение',
  'panel.status.loading': 'Загрузка',
  'panel.status.live': 'В реальном времени',
  'panel.mode.isolated': 'Изолированный браузер',
  'panel.mode.real': 'Реальный браузер',
  'config.summary': 'Настройки подключения CDP к реальному браузеру',
  'config.realBrowserEnabled': 'Использовать реальный браузер (CDP)',
  'config.realBrowserEnabled.hint': 'Когда включено, каждый сеанс DSH может управлять всеми вкладками этого браузера.',
  'config.cdpEndpoint': 'Адрес CDP',
  'config.cdpEndpoint.hint': 'Только loopback. Chrome 136+ не разрешает удалённую отладку для профиля по умолчанию.',
  'config.idleCloseDays': 'Закрытие неактивных (дней)',
  'config.idleCloseDays.hint': 'Страницы, открытые самим DSH, закрываются, если ни один инструмент браузера не касался их столько дней. Перенятые страницы реального браузера не закрываются; 0 отключает.',
  'config.unavailable': 'Настройки недоступны',
  'config.failed': 'Не удалось сохранить настройки. Повторите попытку.',
  'settings.title': 'Реальный браузер',
  'settings.description': 'Использовать состояние входа и все вкладки Chrome или Edge на этом компьютере.',
  'settings.enabled': 'Включить управление через CDP',
  'settings.enabledHint': 'Когда включено, каждый сеанс DSH может читать и управлять всеми вкладками этого браузера.',
  'settings.cdpEndpoint': 'Адрес CDP',
  'settings.cdpEndpointHint': 'Только loopback. Chrome 136+ не разрешает удалённую отладку для профиля по умолчанию.',
  'settings.idleCloseDays': 'Автозакрытие неактивных страниц (дней)',
  'settings.idleCloseDaysHint': 'Страницы, открытые самим DSH, закрываются, если ни один инструмент браузера не касался их столько дней. Перенятые страницы реального браузера не закрываются; 0 отключает.',
  'settings.inherit': 'Наследовать',
  'settings.on': 'Вкл.',
  'settings.off': 'Выкл.',
  'settings.overridden': 'Переопределено',
  'settings.reset': 'Сбросить',
  'settings.invalidValue': 'Недопустимое значение',
  'settings.collapse': 'Свернуть',
  'settings.expand': 'Развернуть',
  'settings.notExposed': 'В этом развёртывании настройки плагина недоступны.',
  'settings.readOnly': 'Только чтение',
  'settings.saveFailed': 'Ошибка сохранения',
}
