/**
 * Russian dictionary for the "dsh-perf" locale namespace.
 * Source package: packages/dsh-perf (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'hud.alert.both': 'Превышены пороги и по сессиям, и по событиям',
  'hud.alert.events': 'События: {count}/с ≥ порога {max}',
  'hud.alert.sessions': 'Сессий: {count} ≥ порога {max}',
  'settings.alertPreset': 'Порог оповещений',
  'settings.alertPresetHint': 'Лёгкий (10 сессий / 1000 ev/s) / Стандартный (5 / 300) / Строгий (3 / 150).',
  'settings.alertPresetLight': 'Лёгкий',
  'settings.alertPresetStandard': 'Стандартный',
  'settings.alertPresetStrict': 'Строгий',
  'settings.collapse': 'Скрыть настройки',
  'settings.description': 'Движок производительности для потокового режима и одновременной работы с несколькими сессиями: метрики, регулирование темпа пакетной записи, пороги оповещений и ограничение рендеринга.',
  'settings.discard': 'Отменить',
  'settings.enabled': 'Включить наблюдение за производительностью',
  'settings.enabledHint': 'Когда выключено, хост перестаёт подписываться на события и вести выборку (в HUD не остаётся данных).',
  'settings.expand': 'Показать настройки',
  'settings.hudEnabled': 'Панель HUD',
  'settings.hudEnabledHint': 'Плавающая панель производительности в правом нижнем углу (events/s, задержка цикла событий, FPS и т. д.). По умолчанию выключена; включайте при необходимости.',
  'settings.inherit': 'Наследовать',
  'settings.invalidNumber': 'Введите число или оставьте поле пустым, чтобы использовать значение по умолчанию.',
  'settings.mode': 'Режим',
  'settings.modeAggressive': 'Агрессивный',
  'settings.modeBalanced': 'Сбалансированный',
  'settings.modeHint': 'Уровень наблюдения и выборки: off (только маршруты) / balanced (по умолчанию) / aggressive. Задержка пакетной записи задаётся bundle-патчем и составляет 500ms.',
  'settings.modeOff': 'Выкл',
  'settings.notExposed': 'Текущая версия DSH не передаёт на страницу конфигурации пространство имён настроек этого плагина, поэтому форма недоступна. Отредактируйте ~/.dsh/settings.yaml напрямую или попросите администратора открыть белый список настроек Host, а затем перезапустите.',
  'settings.off': 'Выкл',
  'settings.on': 'Вкл',
  'settings.overridden': 'Переопределено',
  'settings.readOnly': 'Настройки этого развёртывания доступны только для чтения.',
  'settings.renderDegrade': 'Разгрузка рендеринга сообщений',
  'settings.renderDegradeHint': 'Обновления списка сессий, меняющие только проекции (счётчики токенов и т. п.), объединяются до частоты около 1 Гц, при этом изменения видимых полей по-прежнему публикуются сразу; при включении к строкам сообщений применяется внеэкранная разгрузка через content-visibility.',
  'settings.reset': 'Восстановить по умолчанию',
  'settings.save': 'Сохранить',
  'settings.saveFailed': 'Развёртывание не приняло эти значения; они сохранены, чтобы вы могли их исправить.',
  'settings.saving': 'Сохранение…',
  'settings.title': 'Движок производительности',
  'settings.unsaved': 'Не сохранено',
}
