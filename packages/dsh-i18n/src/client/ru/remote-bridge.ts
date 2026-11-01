/**
 * Russian dictionary for the "remote-bridge" locale namespace.
 * Source package: packages/dsh-remote-bridge (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'entry.label': 'Сопряжение с iPhone',
  'title': 'Сопряжение с приложением для iOS',
  'subtitle': 'Отсканируйте QR-код приложением для iOS (бета-версия), чтобы подключить iPhone к этому компьютеру. Код показывается только на этой машине.',
  'state.reading': 'Запрашиваю код сопряжения…',
  'pair.qrLabel': 'QR-код сопряжения',
  'pair.countdown': 'Осталось {s} с',
  'pair.expired': 'Код сопряжения просрочен',
  'pair.refresh': 'Новый код',
  'pair.usedHint': 'Код одноразовый: как только iPhone начинает сопряжение, код расходуется, а запрос нового аннулирует предыдущий.',
  'origin.located': 'iPhone подключится к {origin}',
  'origin.missing': 'Публичный адрес не найден: сначала укажите в приложении в качестве адреса подключения ваш публичный ретранслятор, затем сканируйте код. {host} (эта страница) доступен только с этой машины.',
  'community.invite': 'Приложение для iOS пока в бета-версии — заходите пообщаться с нами в Discord',
  'forbidden.title': 'Эта страница открыта не на этой машине',
  'forbidden.body': 'Код сопряжения можно получить только на самой машине. Откройте http://127.0.0.1:<порт> в браузере на этой машине и повторите.',
  'failed.title': 'Не удалось получить код сопряжения',
  'failed.body': 'Хост ответил HTTP {status}. Перезагрузите страницу и повторите.',
  'unreachable.title': 'Не удаётся связаться с локальным хостом',
  'unreachable.body': 'Запрос не дошёл до хоста. Проверьте, что dsh web всё ещё запущен, и повторите.',
  'action.close': 'Закрыть',
  'action.copy': 'Скопировать код сопряжения',
  'action.copied': 'Скопировано',
  'action.copyFailed': 'Не удалось скопировать',
  'action.retry': 'Повторить',
  'card.waiting': 'Ждёт вашего действия',
  'card.settled': 'Завершено',
  'card.answerOnPhone': 'Ответ на телефоне',
  'card.interacted': 'Страница отправила действие, но настольный клиент не отвечает: ответ на телефоне',
  'card.frameLabel': 'Карточка страницы',
  'card.empty': 'В этом вызове нет страницы для показа',
  'card.oversize': 'Страница превышает размерный лимит и не показана',
}
