# audit/code-audit-0038

**Дата:** 2025-10-13  
**Задача:** Публичная вкладка «Лига» — реализация подвкладки статистики с таблицами лидеров (Г+П, бомбардиры, ассистенты) и realtime-обновлениями.  
**Исполнитель:** VSCode Agent v1.1

## 1. Поисковые запросы
- "league.stats"
- "playerSeasonStats"
- "LeagueSubTab stats"
- "public:league:top-scorers"

## 2. Просканированные пути
- backend/src/routes/leagueRoutes.ts
- backend/src/services/matchAggregation.ts
- backend/src/services/leagueTable.ts
- prisma/schema.prisma
- frontend/src/store/appStore.ts
- frontend/src/pages/LeaguePage.tsx
- admin/src/components/tabs/StatsTab.tsx
- docs/cache.md, docs/state.md, docs/style.md

## 3. Найденные артефакты
- `backend/src/routes/leagueRoutes.ts` — эндпоинты таблицы/календаря/results, статистики ещё нет.
- `backend/src/services/matchAggregation.ts` — пересборка таблиц и публикация WS-событий после финализации матчей; можно расширить для лидеров.
- `prisma/schema.prisma` (модель `PlayerSeasonStats`) — источник данных для топов игроков.
- `admin/src/components/tabs/StatsTab.tsx` — образец UI и правил сортировки для бомбардиров/ассистов.
- `docs/cache.md` — TTL и ключи `public:league:top-scorers`, `league:stats`.
- `frontend/src/store/appStore.ts` — Zustand-стор вкладки «Лига», пока без статистики.

## 4. Решение
Адаптировать сервер: получить данные из `player_season_stats`, подготовить сервис `leagueStats` с кэшированием (TTL 300 с) и публикацией WS-сообщений по топикам `public:league:top-scorers`, `...top-assists`, `...goal-contributors`. Добавить HTTP `/api/league/stats`. На фронте расширить `appStore` (TTL 5 мин, версии, realtime), реализовать компонент `LeagueStatsView` с отдельным CSS и переключением таблиц стрелками. Синхронизировать типы в `shared/types.ts`, обновить документацию `docs/state.md`, `docs/cache.md` и журнал изменений.

## 5. План реализации
- [x] Реализовать сервис и HTTP-эндпоинт статистики на backend + кэш/WS.
- [x] Обновить Zustand-стор и API клиента на frontend, добавить обработку realtime.
- [x] Создать компонент `LeagueStatsView` и стили, интегрировать в `LeaguePage.tsx`.
- [x] Обновить документацию (`docs/state.md`, `docs/cache.md`) и журнал `audit/changes/*`.
- [ ] Проверить сборку/линт (npm run build, npm run lint) и описать шаги запуска — фронтенд `npm run lint` сейчас падает на прежних ошибках индентации в `frontend/src/components/NewsSection.tsx` (файл не трогали), нужно либо согласовать фиксы, либо обновить конфиг.

## 6. Метрическое влияние
⚪ — Улучшение актуальности статистики для пользователей без заметного роста нагрузки: кэширование и reuse уже рассчитанных агрегатов, публикации в существующую WS-шину.
