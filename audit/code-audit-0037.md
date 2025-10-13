# audit/code-audit-0037

**Дата:** 2025-10-13  
**Задача:** Устранение уязвимых зависимостей и миграция на пакет @tma.js  
**Исполнитель:** GitHub Copilot

## 1. Поисковые запросы
- "@telegram-apps init-data-node"
- "node-telegram-bot-api form-data"
- "tough-cookie request"
- "newsWorker TelegramBot"

## 2. Просканированные пути
- backend/package.json
- backend/package-lock.json
- backend/src/routes/authRoutes.ts
- backend/src/queue/newsWorker.ts
- docs/project.md

## 3. Найденные артефакты
- `backend/src/routes/authRoutes.ts` — импортирует `@telegram-apps/init-data-node`, что не соответствует обновлённой политике и блокирует переход на TMA.
- `backend/src/queue/newsWorker.ts` — использует `node-telegram-bot-api`, который подтягивает устаревший `request` с уязвимыми версиями `form-data` и `tough-cookie`.
- `backend/package-lock.json` — фиксирует `@telegram-apps/*` и `node-telegram-bot-api`, что удерживает уязвимости в дереве зависимостей.

## 4. Решение
Заменить `@telegram-apps/*` на `@tma.js/*` в коде и зависимостях, переписать почтовый воркер на использование API `grammy` вместо `node-telegram-bot-api`, после чего обновить lock-файлы, чтобы исключить уязвимые версии `form-data` и `tough-cookie`.

## 5. План реализации
- [ ] Перевести обработчик Telegram-init на `@tma.js/init-data-node` и актуальные трансформеры.
- [ ] Удалить `node-telegram-bot-api`, внедрить отправку через `grammy` API в `newsWorker`.
- [ ] Обновить `package.json` и lock-файлы, убедившись в отсутствии старых пакетов.
- [ ] Прогнать `npm run build --workspace=backend` и убедиться в чистоте.
- [ ] Задокументировать изменения в `audit/changes`.

## 6. Метрическое влияние
⚪ — Устранение уязвимостей повышает техническую стабильность, не затрагивая пользовательские метрики напрямую.
