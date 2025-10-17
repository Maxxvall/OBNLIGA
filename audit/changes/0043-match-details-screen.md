# 0043 — Страница «Детали матча»

**Дата:** 17 октября 2025  
**Автор:** VSCode Agent

## Изменения

### Backend
- Добавлен сервис `services/matchDetails.ts`, формирующий минимальные payload'ы (header/lineups/events/stats/broadcast) и динамические TTL.
- Новый роут `matchDetailsRoutes` с ключами `pub:md:{id}:*`, поддержкой ETag и 404 для статистики спустя 1 час после финала.
- Регистрация роутов в `server.ts`, расширение `cacheKeys.ts` и настройка `tsconfig` для импорта общих типов.

### Frontend
- Новый API-клиент `matchDetailsApi` и zustand-стор `matchDetailsStore` с ленивыми запросами и polling по спецификации.
- Страница `MatchDetailsPage` (/matches/:id) с вкладками «Составы / События / Статистика / Трансляция», форматированием шапки и адаптивной версткой (`matchDetails.css`).
- Карточки матчей в `LeagueRoundsView` стали кликабельными и открывают детали; логотипы команд не прерывают навигацию (stopPropagation).

### Документация
- Обновлены `docs/cache.md` (новые ключи, TTL, правило 404) и `docs/state.md` (описан `matchDetailsStore`, интервалы polling).
- Добавлен audit/code-audit-0043.md и текущая запись.

## Проверки
- [ ] npm run lint --workspace frontend
- [ ] npm run lint --workspace backend
- [ ] npm run build --workspace frontend
- [ ] npm run build --workspace backend
- [ ] Ручные проверки UI
