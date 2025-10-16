# audit/code-audit-0042

**Дата:** 2025-10-16  
**Задача:** Привести серверное кеширование к политике из docs/cache.md: match-window helper, динамический TTL, SWR+SETNX, pre-warm и отказ от Redis pub/sub  
**Исполнитель:** GitHub Copilot

## 1. Поисковые запросы
- "MultiLevelCache"
- "PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS"
- "If-None-Match"
- "matchWindow"
- "SETNX|lock|swr|stale"

## 2. Просканированные пути
- backend/src/cache/
- backend/src/routes/leagueRoutes.ts
- backend/src/services/leagueSchedule.ts
- backend/src/services/matchAggregation.ts
- frontend/src/store/appStore.ts

## 3. Найденные артефакты
- `backend/src/cache/multilevelCache.ts` — in-memory + Redis LRU без TTL и с pub/sub
- `backend/src/routes/leagueRoutes.ts` — фиксированные TTL для таблицы/расписания/результатов/статистики
- `backend/src/services/leagueSchedule.ts` и `matchAggregation.ts` — ручные `defaultCache.set` с фиксированным TTL
- `frontend/src/store/appStore.ts` — клиент отправляет `If-None-Match`, но зависит от ETag/TTL сервера
- Отсутствует реализация match-window helper, adaptive TTL и pre-warm, отсутствует SWR/SETNX

## 4. Решение
Реализовать модуль match-window helper, который вычисляет окна матчей, кеширует результат в Redis/памяти и отдаёт статусы/TTL. Расширить `MultiLevelCache` поддержкой экспирации, SWR и блокировки на основе Redis `SET key value NX EX 30` (с локальным резервом), убрать pub/sub. Обновить серверные маршруты и сервисы для использования адаптивных TTL и новой логики pre-warm, добавить HTTP endpoint/воркер для прогрева. Обновить документацию и план изменений.

## 5. План реализации
- [ ] Реализовать match-window helper + хранение окна в Redis с коротким TTL
- [ ] Обновить `MultiLevelCache`: TTL в памяти, SWR, SETNX-lock, без pub/sub, опции `staleWhileRevalidate`
- [ ] Интегрировать adaptive TTL в маршруты лиги и сервисы, заменить фиксированные TTL
- [ ] Добавить pre-warm (endpoint/утилиту) и связать с helper
- [ ] Обновить документацию и `audit/changes/0039-*.md`, описать фактическое поведение
- [ ] Прогнать `npm run lint`/`build` для backend и актуализировать план

## 6. Метрическое влияние
🔵 — Динамический TTL и SWR снижают нагрузку на БД/Redis под пиковую активность и уменьшают время ответа за счёт 304/стейла.
