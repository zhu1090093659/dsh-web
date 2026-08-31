/**
 * Russian dictionary for the "dsh-web-ui-usage" locale namespace.
 * Source package: packages/dsh-usage (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'usage.balance': 'Баланс',
  'usage.balance.noCredential': 'Учётные данные не настроены',
  'usage.balance.unsupported': 'Запрос баланса не поддерживается',
  'usage.calls': 'Вызовов: {n}',
  'usage.config.bubbleMode': 'Пузырь питомца',
  'usage.config.bubbleMode.always': 'Показывать всегда',
  'usage.config.bubbleMode.change': 'Только при изменении',
  'usage.config.bubbleMode.off': 'Выключено',
  'usage.config.enabled': 'Включить плагин',
  'usage.config.pollIntervalSec': 'Интервал опроса (в секундах)',
  'usage.config.title': 'Настройки',
  'usage.current': 'Текущий',
  'usage.error': 'Не удалось загрузить: {error}',
  'usage.errorListSeparator': '; ',
  'usage.loading': 'Загрузка данных об использовании…',
  'usage.noData': 'Данных об использовании пока нет (учёт ведётся с момента включения плагина).',
  'usage.oauth': 'OAuth-учётные данные, баланс не запрашивается',
  'usage.peak.off': 'Непиковые часы DeepSeek: половина пиковой цены, пик вернётся в {time}',
  'usage.peak.on': 'Пиковые часы DeepSeek: цена ×2, завершатся в {time}',
  'usage.plan.noPlan': 'Данные тарифа не обнаружены',
  'usage.plan.noneConfigured': 'Нет настроенных провайдеров с тарифами (например, Kimi, GLM, OpenCode Go, MiniMax, подписка Codex)',
  'usage.plan.reset': 'Сброс {date}',
  'usage.plan.windows.5h': '5 часов',
  'usage.plan.windows.month': 'Месяц',
  'usage.plan.windows.week': 'Неделя',
  'usage.provider.error': 'Не удалось выполнить запрос: {error}',
  'usage.refresh': 'Обновить',
  'usage.refreshing': 'Обновление…',
  'usage.tab.plans': 'Тарифы',
  'usage.tab.usage': 'Использование',
  'usage.title': 'Статистика использования',
  'usage.today': 'Сегодня',
  'usage.today.cost': 'Расход за сегодня (оценка)',
  'usage.tokens.cacheRead': 'Чтение из кеша',
  'usage.tokens.cacheWrite': 'Запись в кеш',
  'usage.tokens.input': 'Ввод',
  'usage.tokens.output': 'Вывод',
  'usage.tokens.total': 'Всего токенов',
  'usage.trend': 'За 30 дней',
  'usage.updated': 'Обновлено: {time}',
}
