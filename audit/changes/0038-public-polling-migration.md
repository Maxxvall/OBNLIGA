# 0038 — Перевод публичного клиента на HTTP-polling

## Изменения
- доработан `frontend/src/store/appStore.ts`: добавлены таймеры `ensureLeaguePolling`/`ensureTeamPolling`, очищение при выгрузке и обновлённые TTL для таблиц и резюме клубов;
- обновлена `frontend/src/pages/LeaguePage.tsx` — старт/остановка интервального обновления при монтировании страницы лиги;
- задокументированы новые интервалы и отсутствие WebSocket в публичном фронте (`docs/cache.md`, `docs/state.md`, `docs/project.md`), добавлен лог по polling-интервалам;
- ужесточён `backend/src/realtime/index.ts`: теперь соединение требует валидный токен, а подписки на `public:*` топики запрещены;
- зафиксировано поведение профиля и новостей в документации с учётом фонового polling.

## Проверки
- `npm run build` (frontend) — ✅
- `npm run build` (backend) — ✅
