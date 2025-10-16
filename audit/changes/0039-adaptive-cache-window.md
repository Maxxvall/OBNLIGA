# 0039 — Динамический TTL и матчевое окно

## План
- [x] Добавить match-window helper и кеширование окна (Redis + память)
- [x] Переработать `backend/src/cache/multilevelCache.ts` под TTL, SWR и SETNX-блокировки без Redis pub/sub
- [x] Подключить adaptive TTL в публичных маршрутах/сервисах лиги, убрать фиксированные константы
- [x] Реализовать pre-warm (cron endpoint/утилита) и связать его с helper
- [x] Обновить документацию (`docs/cache.md` и при необходимости `docs/project.md`) и описать изменения в этом файле
- [ ] Прогнать проверки сборки/линта для backend (и затронутых пакетов)

## Статус
- Линт падает из-за существующих предупреждений `@typescript-eslint/no-explicit-any` в `backend/src/routes/adminRoutes.ts`

## Проверки
- `npm run build` (backend) — ✅
- `npm run lint` (backend) — ⚠️ (сыпятся существующие `no-explicit-any` в `backend/src/routes/adminRoutes.ts`)

## Дополнительно
- Обновлён `backend/src/plugins/etag.ts`, чтобы не перезаписывать версионные ETag и корректно возвращать `304 Not Modified`.
- **См. также:** [`0040-etag-304-cors-fix.md`](./0040-etag-304-cors-fix.md) — исправление CORS и fetch options для работы 304 ответов.
