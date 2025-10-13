# audit/code-audit-0035

**Дата:** 2025-10-12  
**Задача:** Реализация календаря и результатов во вкладке «Лига» с live-индикаторами и синхронизацией  
**Исполнитель:** GitHub Copilot

## 1. Поисковые запросы
- "leagueSubTab"
- "league/schedule"
- "PUBLIC_LEAGUE_TABLE_KEY"
- "fetchMatches"
- "MatchStatus"

## 2. Просканированные пути
- frontend/src/pages
- frontend/src/store
- frontend/src/components/league
- backend/src/routes
- backend/src/services
- admin/src/store
- shared/
- docs/
- prisma/

## 3. Найденные артефакты
- `frontend/src/pages/LeaguePage.tsx` — текущие подвкладки лиги с заглушками для расписания и результатов.
- `frontend/src/store/appStore.ts` — Zustand-стор с TTL и WebSocket-подпиской на `public:league:table`.
- `backend/src/routes/leagueRoutes.ts` — публичные эндпоинты `/api/league/seasons` и `/api/league/table` с multi-level кэшем.
- `backend/src/services/leagueTable.ts` — вычисление турнирной таблицы, определение типов `LeagueTableResponse`.
- `docs/cache.md` — TTL и ключи `league:schedule`, `league:results` для расписания и результатов.
- `docs/state.md` — контракт стора, перечень подвкладок и требования к realtime.
- `backend/src/routes/adminRoutes.ts` — выдача и обновление матчей (`admin.get('/matches')`, `admin.put('/matches/:matchId')`), включение стадиона и раунда.
- `admin/src/store/adminStore.ts` — кеширование загрузки матчей админки.
- `prisma/schema.prisma` — структура `Match`, `SeasonRound`, `Stadium` (город/название) для формирования календаря.
- `backend/src/services/matchAggregation.ts` — инвалидация кэша/публикация таблицы после финализации матча.

## 4. Решение
Сформировать единый слой расписания/результатов: на бэкенде добавить сервис агрегации матчей по турам, публичные эндпоинты `/api/league/schedule` и `/api/league/results` с кэшем и публикацией топиков `public:league:schedule`/`public:league:results`. Интегрировать обновление в админские операции (изменение статуса, финализация) и matchAggregation для единообразной инвалидации. На фронте расширить shared-типы, обновить API-клиент и Zustand-стор (TTL, версии, realtime). Реализовать компоненты календаря и результатов с сортировкой по турам, отображением города/стадиона, бейджем «МАТЧ ИДЁТ» и синхронизацией счёта. Обновить админ-панель для отображения города/стадиона в списке матчей и документацию (`docs/state.md`, `docs/cache.md`, `audit/changes`).

## 5. План реализации
- [ ] Реализовать сервис агрегации расписания/результатов и публичные эндпоинты с кэшем/WS.
- [ ] Инвалидировать и публиковать расписание/результаты при изменении матчей (админ-апдейты, финализация).
- [ ] Расширить shared-типы и API-клиент фронтенда для работы с расписанием и результатами.
- [ ] Обновить Zustand-стор и добавить realtime-подписки для новых подвкладок.
- [ ] Создать UI-компоненты календаря/результатов с отображением локации и live-индикатора.
- [ ] Синхронизировать админ-панель (отображение города/стадиона, правки кеша) и документацию.
- [ ] Прогнать lint/build для backend и frontend, проверить визуально в dev.

## 6. Метрическое влияние
⚪ — Улучшение: оперативный календарь и результаты повышают вовлечённость пользователей без негативного влияния на стабильность.
