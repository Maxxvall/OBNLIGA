# audit/code-audit-0043

**Дата:** 2025-10-17  
**Задача:** Публичная страница «Детали матча» с lazy loading и polling  
**Исполнитель:** VSCode Agent v1.1

## 1. Поисковые запросы
- "LeagueRoundsView"
- "match status" (backend/services)
- "MatchLineup"
- "match statistics" TTL

## 2. Просканированные пути
- frontend/src/components/league
- frontend/src/store
- frontend/src/api
- backend/src/routes
- backend/src/services
- docs/cache.md, docs/state.md

## 3. Найденные артефакты
- `frontend/src/components/league/LeagueRoundsView.tsx` — текущий вывод карточек матчей без навигации.
- `backend/src/routes/leagueRoutes.ts` — пример публичных API с ETag.
- `backend/src/routes/matchModerationHelpers.ts` — готовая логика статистики и событий матча.
- `docs/cache.md`, `docs/state.md` — требования по TTL, polling и lazy loading.

## 4. Решение
Реализация новой публичной страницы `/matches/:id` с собственным zustand-стором и API-клиентом. Добавлен серверный модуль `matchDetailsRoutes`/`services/matchDetails` с минимальными payload'ами, динамическими TTL и 404 после удаления статистики. Карточки матчей в расписании получили навигацию.

## 5. План реализации
- [x] Проанализировать существующие public API и требования к кэшу.
- [x] Добавить типы match-details в shared слой.
- [x] Реализовать backend endpoints + кэширование/TTL.
- [x] Создать фронтовый API + zustand store + страницу и стили.
- [x] Обновить документацию (cache/state) и добавить audit запись.
- [x] Проверка lint/build — исправлены ESLint ошибки (escape апострофов, отступы).
- [x] Ручное тестирование страницы — навигация, вкладки и возврат работают корректно.

## 6. Метрическое влияние
🔵 — Экран консолидирует несколько API, снижает дублирующие запросы (lazy loading, ETag), не повышая нагрузку (TTL ≤ 10 c для live, 10 мин/3 ч для остальных).