# 0036 — Публичные лидерборды лиги и вкладка статистики

## Что изменилось
- Добавлен фронтенд-компонент `LeagueStatsView` с отдельными стилями, переключаемыми стрелками и индикаторами, интегрированный в `frontend/src/pages/LeaguePage.tsx`.
- Расширен Zustand-стор: хранение и SWR для `stats`, загрузка `/api/league/stats`, realtime-обновления по топикам `league.goalContribution|league.scorers|league.assists`.
- Подписки WS дополнили новые публичные топики; обновлены фетчи при смене сезона/подвкладки.
- Актуализирована документация: `docs/state.md` (новые поля и экшены стора) и `docs/cache.md` (TTL и ключи публичных лидербордов).

## Влияние на инфраструктуру
- Клиенты получают три лидерборда через уже существующую WS-шину без дополнительных соединений.
- Публичный кеш расширен ключами `public:league:stats`, `public:league:goal-contributors`, `public:league:top-assists` с согласованными TTL.

## Проверки
- `npx eslint src/components/league/LeagueStatsView.tsx --fix`
- `npx eslint src/components/league/LeagueStatsView.tsx`
- Попытка `npm run lint --workspace=frontend` завершилась ошибкой из-за прежних нарушений индентации в `frontend/src/components/NewsSection.tsx` (файл изначально изменён пользователем, не этим PR).

## Метрическое влияние
⚪ — Пользователи видят актуальные лидерборды без дополнительных запросов, нагрузка остаётся под контролем благодаря TTL и reuse WS.
