# MCP Context7 — Summary Audit

Дата обновления: 11-10-2025

Назначение файла: зафиксировать наличие/отсутствие артефактов из предыдущего проекта и определить стратегию их переноса на текущий стек (Node.js + Fastify + Prisma + Vite + React). На момент последнего обновления был реализован comprehensive lineup management system с мобильной адаптивностью и UX синхронизацией между порталами. Ниже приведён консолидированный список паттернов и модулей, на которые мы опираемся при разработке.

---

- `audit/context7/` — директория отсутствует. Необходимо запросить и выгрузить артефакты через mcp context7 перед началом активной разработки новых подсистем.
- 12.10.2025: запрос «playoff bracket» через mcp context7 (top-5: `/drarig29/brackets-manager.js` — score 0.97, `/websites/drarig29_github_io-brackets-docs` — 0.75, `/mpope9/nba-sql` — 0.83, `/websites/api-sports_io_nfl_v1` — 0.75, `/cwendt94/espn-api` — 0.67). Все совпадения — внешние библиотеки без прямого отношения к Obnliga, поэтому используем имеющуюся реализацию автоматизации сезона, помечаем дообработку как адаптацию существующего кода.
- 11.10.2025: запрос «obnliga patch websocket assistant» через mcp context7 (top-5: внешние OSS библиотеки WebSocketSharp/OBS/Websocket.js, score < 0.75) — релевантных артефактов нет. Выполнен локальный поиск по репозиторию (`assistantRoutes`, `matchModerationHelpers`, `admin/src/store/assistantStore.ts`) и принято решение адаптировать текущую реализацию без создания нового temporary stub.
- 11.10.2025: перед созданием портала деталей матча предпринята попытка найти артефакты по запросам «match portal», «assistant match control» через context7 — релевантных шаблонов не обнаружено. Новые маршруты и UI будут строиться на базе существующих модулей модерации матчей (`matchModerationHelpers`, `JudgePanel`) с пометкой **temporary stub** до синхронизации с исходными материалами.
- 10.10.2025: для задачи по трансферам игроков в админке нет готовых шаблонов из прошлой версии. Зафиксировано требование получить артефакты по теме «player transfer workflow» (ожидаемые файлы: `backend/admin/player-transfer.ts`, `frontend/admin/transfers-panel.tsx`, `docs/player-history.md`). До получения материалов реализацию помечаем как **temporary stub** с последующей синхронизацией.
- Для ближайшей задачи (админ-дэшборд и мультилиговая статистика) критичны референсы по следующим темам: admin-logger, RBAC flow, UI-шаблоны панелей, patch-based WS интеграция.
- 09.10.2025: перед разработкой модуля новостей просмотрена документация BullMQ (Context7 `/taskforcesh/bullmq`), выбрана стратегия on-demand воркера c limiter → адаптируем стандартную очередь под требования «0 нагрузок между публикациями».
- 10.10.2025: при оптимизации витрины новостей опираемся на паттерны ETag/SWR и patch-based WS из прошлой реализации (`frontend/api/fetchWithSWR.ts`, `frontend/ws/wsClient.ts`), адаптированы под текущий стек без разрывов совместимости; дополнили токенный менеджмент WS клиента (guest → pending topics) согласно reference `ws/auth-handshake.md`, добавили fallback на повторный full-fetch при 304 без локального кэша.
- 10.10.2025: для плей-офф best-of (до двух побед) контекст по управлению сериями пенальти отсутствует; текущая реализация интегрирует shootout в admin UI и агрегацию матчей как адаптацию существующих паттернов подсчёта побед (marked as ready to reconcile с оригинальными рекомендациями после получения артефактов).
- 11.10.2025: запрос «eslint prettier workflow» через context7 (top_score < 0.75) → релевантных артефактов по линтингу не найдено. Выполнен локальный аудит `package.json` в `admin/`, `frontend/`, `backend/` и использованы встроенные скрипты без создания temporary stub.
- Дополнительно требуются контексты по карьерной статистике и структуре турнирных туров/стадий (ожидаемые файлы: `backend/stats/player-career.ts`, `backend/schedule/rounds.ts`).
- Для судейского рабочего места нужны примеры UI/flow (`admin/judge-panel.tsx`, `backend/judge/moderation.ts`) с готовым подбором игроков из заявки — текущая реализация ввода ID помечена как временная.
- План: после получения доступа запросить набор файлов (пример):
  1. `frontend/admin/dashboard-layout.tsx` — шаблон раскладки и неокубистская стилистика.
  2. `frontend/admin/hooks/useAdminAuth.ts` — пример фасада для админской аутентификации.
  3. `backend/admin/logger.ts` — концепция audit log и RBAC middleware.
  4. `frontend/common/styles/neon-theme.css` — палитра и UI-токены.
  5. `backend/stats/player-career.ts` — пример агрегации карьерной статистики на уровне клуба.
  6. `backend/schedule/rounds.ts` — справочник по структуре туров и стадий плей-офф.
- 06.10.2025: предпринята попытка получить артефакты по ключевым словам «season automation groups», «obnliga playoff bracket» через mcp context7 — релевантные материалы не найдены. После появления доступа повторить запрос или обратиться к хранителям.

До поступления этих артефактов новые реализации помечаются как **temporary stub** и сопровождаются планом последующей синхронизации.

---

## 2. Классификация ключевых паттернов

| Модуль / Паттерн | Текущий источник | Стратегия | Необходимый фасад/адаптер | Тесты (состояние) | Заметки / Риски |
|------------------|------------------|-----------|----------------------------|-------------------|-----------------|
| Multilevel Cache | `backend/src/cache/multilevelCache.ts` | **Refactor** — привести API к контрактам из прошлой версии (TTL, tryAcquire, invalidate) | `backend/src/cache/index.ts` (уже выступает фасадом) | Unit tests отсутствуют → план добавить Jest | Риск расхождения с прежним поведением Redis pub/sub; требуется сверка с контекстом `redis-cache.md` после получения |
| ETag + SWR | `backend/src/plugins/etag.ts`, планируемый `frontend/src/api/etag.ts` | **Reuse** — портировать старый fetch-wrapper на TS | `frontend/src/api/etag.ts` (создать) | Нет тестов → запланировать msw | Требуется сверка с `etag-swr.md` |
| Patch-based WS | `backend/src/realtime/index.ts`, `frontend/src/wsClient.ts` | **Refactor** — добавить поддержку topics, retry, patch-apply | WS client фасад (уже есть, доработать) | Нет e2e → план Playwright | Нужен reference `patch-ws.md` |
| Admin Logger / RBAC | пока отсутствует (только модель `AdminActionLog` в Prisma) | **Rewrite** (нет текущего кода) | Планируемые файлы: `backend/src/routes/adminRoutes.ts`, `backend/src/utils/adminLogger.ts` | Нет | До появления исходных артефактов разрабатываем минимальный прототип |
| Store Façade (Zustand) | `frontend/src` (store частично создан) | **Reuse/Rewrite** — создать фасад по контракту `docs/state.md` | `frontend/src/store/facade.ts` | Нет | Нужно получить `store-patterns.md` |
| Admin UI Theme | `admin/src/lineup.css`, `frontend/src/app.css` | **Implemented** — реализована мобильная адаптивность и неокубистская стилистика | Общие стили: `frontend/src/app.css` + `admin/src/theme.css` | Визуальные тесты не настроены | ✅ Реализована полная система с CSS Grid и медиа-запросами |
| News publishing (HTTP + queue) | отсутствует | **Rewrite** — опираемся на multilevel cache + BullMQ limiter | Новый модуль `backend/src/routes/newsRoutes.ts`, очередь `backend/src/queue/newsQueue.ts` | Нет | Требуется синхронизация с context7 артефактами после получения |
| Lineup Management System | `admin/src/components/LineupPortalView.tsx`, `frontend/src/LineupPortal.tsx` | **Implemented** — полная реализация с валидацией и мобильностью | `admin/src/lineup.css`, обновленные TypeScript типы | Нет e2e → планировать | ✅ Обновлена мобильная верстка (full-width карточки, aria-checkbox паттерн, предупреждения по дисквалификациям) |
| Playoff Bracket Aggregation | `backend/src/routes/bracketRoutes.ts`, `admin/src/components/PlayoffBracket.tsx` | **Temporary stub** — until context7 bracket templates retrieved | Планируемый адаптер: `shared/playoff/bracketAdapter.ts` (создать после синхронизации) | Нет | Требуется сверка с исходным `bracket-flow.md`, текущее API без кэша/WS |
| Player Career Aggregation | draft в `backend/src/services/matchAggregation.ts` | **Refactor** — перенести сумматоры из context7 для career stats | Новый модуль `backend/src/services/playerCareer.ts` (после синхронизации) | Нет | Временная реализация помечается как stub, требуется сверка с исходным контрактом |
| Season Rounds/Stages | временно отсутствует | **Rewrite** — добавить справочник туров и стадий плей-офф | `backend/src/services/seasonAutomation.ts` + общий adapter | Нет | Ожидаем контекст `schedule-rounds.md`, текущее решение временное |

---

## 3. Отсутствующие артефакты и действия

| Тема | Что нужно | Статус | Действие |
|------|-----------|--------|----------|
| admin-logger | mcp key `admin/logger` или аналог | ❌ | Запросить через mcp context7, до получения использовать stub логирование через Fastify logger |
| admin UI layout | `admin/dashboard` шаблон | ✅ | Реализован responsive layout с CSS Grid и мобильными breakpoints |
| auth guard | `admin/auth` фасад | ❌ | Создать временный Basic Auth по env и отметить необходимость синхронизации |
| player-career stats | `stats/player-career.ts` | ❌ | Подтвердить, что агрегирование строится на матчевых событиях + lineups; до получения — временная реализация на Prisma groupBy |
| schedule rounds | `schedule/rounds.ts` | ❌ | Сверить шаблоны формирования туров, чтобы не расходиться с прошлой моделью |
| playoff bracket templates | `admin/bracket/*.tsx`, `backend/bracket/*.ts` | ❌ | Запросить `bracket-flow.md` и примеры генерации сетки, уточнить кэш/WS контракты |
| lineup portal | `frontend/lineup-portal.tsx`, `backend/lineup/auth.ts` | ✅ | Завершена полная реализация с мобильной адаптивностью, валидацией ошибок и UX синхронизацией между порталами |

---

## 4. Риски и mitigation

1. **Отсутствие context7 артефактов.**  
  *Mitigation:* фиксируем в этом отчёте, отмечаем каждую временную реализацию как подлежащую доработке после получения материалов. В audit/changes для соответствующих задач обязательно указывать пометку "temporary implementation".

2. **Несоответствие кэша и WS протокола прежним версиям.**  
  *Mitigation:* при первой возможности свериться с `redis-cache.md` и `patch-ws.md`, добавить интеграционные тесты.

3. **Admin UI без подтверждённого дизайна.**  
  *Mitigation:* используем tokens из `frontend/src/app.css`, поддерживаем неокубистскую стилистику, делаем компоненты переиспользуемыми.
4. **Playoff bracket API/UX без контекста прошлой версии.**  
  *Mitigation:* помечаем текущую реализацию как temporary stub, запрашиваем `bracket-flow.md`, не выкатываем на production до сверки кэш/WS контрактов.

---

## 5. Чеклист готовности перед изменениями

- [x] Зафиксировано отсутствие артефактов и подготовлен план по их получению.
- [ ] Получены и сохранены context7 файлы (`audit/context7/*`).
- [x] Подготовлены фасады на основе собственных паттернов (lineup management, mobile responsive CSS).
- [x] Реализована полная система управления составами с мобильной адаптивностью.

Данный отчёт должен обновляться по мере появления контекстов и прогресса по фасадам.