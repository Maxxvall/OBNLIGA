# audit/code-audit-0036

**Дата:** 2025-10-13  
**Задача:** Исправление ошибки 500 при создании клуба в админ-панели  
**Исполнитель:** GitHub Copilot

## 1. Поисковые запросы
- "admin.post('/clubs'"
- "Prisma P2002 club"
- "TeamsTab adminPost('/api/admin/clubs'"
- "ERROR_DICTIONARY club"

## 2. Просканированные пути
- backend/src/routes/adminRoutes.ts
- admin/src/components/tabs/TeamsTab.tsx
- admin/src/api/adminClient.ts
- prisma/schema.prisma
- docs/project.md

## 3. Найденные артефакты
- `backend/src/routes/adminRoutes.ts` — обработчики CRUD для клубов, отсутствует перехват Prisma-ошибок при создании.
- `admin/src/components/tabs/TeamsTab.tsx` — форма создания/редактирования клуба, отправляет POST `/api/admin/clubs` и показывает текст ошибки.
- `admin/src/api/adminClient.ts` — словарь кодов ошибок админ-API, нет сообщений для дубликатов клубов.
- `prisma/schema.prisma` — модель `Club` с полями name/shortName/logoUrl, подтверждает требования к данным.
- `docs/project.md` — архитектурная схема, подтверждает разделение ответственности.

## 4. Решение
Добавить строгую валидацию входных данных (trim и проверка пустых значений) и перехват ошибок Prisma в `POST /api/admin/clubs`, чтобы возвращать осмысленные коды (`409 club_duplicate`, `400 club_field_too_long`, `500 create_failed`). Обновить переводчик ошибок админ-клиента для новых кодов, чтобы пользователь увидел понятное сообщение вместо общего 500.

## 5. План реализации
- [ ] Обновить обработчик `admin.post('/clubs')` с дополнительной валидацией и перехватом ошибок Prisma.
- [ ] Вернуть корректные HTTP-статусы/коды ошибок для коллизий и других сбоев.
- [ ] Расширить `ERROR_DICTIONARY` на клиенте сообщениями о конфликте и ограничениях.
- [ ] Прогнать сборку для backend и admin, убедиться в отсутствии ошибок.
- [ ] Зафиксировать изменения в `audit/changes`.

## 6. Метрическое влияние
⚪ — Улучшение стабильности: администраторы получают понятные ошибки без 500, повышается надёжность CRUD клубов.
