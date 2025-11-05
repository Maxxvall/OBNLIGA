# История реализации функций

**Дата обновления:** 5 ноября 2025 г.  
**Назначение:** Консолидированная история ключевых изменений и реализованных функций

---

## Модуль: Система управления составами (Lineup Management)

### Реализация капитанского портала
**Дата:** Октябрь 2025  
**Связанные изменения:** 0011, 0022, 0031

**Что реализовано:**
- Публичный портал для капитанов (`frontend/src/LineupPortal.tsx`)
- Админский просмотр составов (`admin/src/components/LineupPortalView.tsx`)
- Backend API: `POST /api/lineup/:matchId` с валидацией
- Мобильная адаптация с full-width карточками
- Валидация: игроки из заявки, не дисквалифицированы, уникальные номера
- Предупреждения о дисквалификациях с визуальными индикаторами
- Синхронизация UX между админ-панелью и капитанским порталом

**Ключевые особенности:**
- CSS Grid с `repeat(auto-fill, minmax(120px, 1fr))`
- Aria-checkbox паттерн для доступности
- Валидация на клиенте и сервере
- WebSocket обновления для админки

**Файлы:**
- `backend/src/routes/lineupRoutes.ts`
- `frontend/src/LineupPortal.tsx`
- `admin/src/components/LineupPortalView.tsx`
- `admin/src/lineup.css`

---

## Модуль: Прогнозы и рейтинги (Predictions & Ratings)

### Запуск новой модели прогнозов
**Дата:** Ноябрь 2025  
**Связанные изменения:** predictions-v2, schema-20251102

**Что реализовано:**
- Новая схема Prisma: `PredictionTemplate`, `PredictionEntry`, `PredictionStreak`, `AchievementLevel`, `UserAchievementProgress`, `UserRating`, `RatingSnapshot`, `AdminPointAdjustment`, `AdminActionLog`.
- Бэкенд-эндпоинты: `GET /api/predictions/active` (фильтр ближайшие 6 дней, статус `SCHEDULED`) и `GET /api/predictions/my` с проверкой сессии и объединением старой модели.
- Кэширование: ключи `predictions:active:6d`, `predictions:user:{user_id}`, ETag/304, TTL 5 минут, SWR 2 минуты.
- Клиентская вкладка `PredictionsPage` с подвкладками "Активные" и "Мои", локальный кеш + ETag, интеграция в главную навигацию.
- Документация: обновлены `docs/BD.md`, `docs/cache.md`, чек-лист аудита.
- Админ-панель: `GET /api/admin/predictions/matches` теперь возвращает только матчи на ближайшие шесть дней и дополнительно отдаёт `alternatives` (±1 гол) в подсказках калькулятора тоталов; UI показывает полные названия клубов.

**Оптимизации:**
- Ограничение выборки до 6 суток вперёд, исключение статусов `CANCELLED/FINISHED` для экономии трафика.
- Унификация токенов/сессий через `resolveSessionSubject` (переиспользование в `userRoutes`).
- Нормализация legacy-прогнозов в новый формат без даунтайма.

**Файлы:**
- `prisma/schema.prisma`
- `backend/src/routes/predictionRoutes.ts`
- `backend/src/utils/session.ts`
- `backend/src/server.ts`
- `shared/types.ts`
- `frontend/src/api/predictionsApi.ts`
- `frontend/src/pages/PredictionsPage.tsx`
- `frontend/src/styles/predictions.css`
- `docs/BD.md`, `docs/cache.md`

---

## Модуль: Новости и публикации (News & Content)

### Админское управление новостями
**Дата:** Октябрь 2025  
**Связанные изменения:** 0023, 0025, 0026

**Что реализовано:**
- Вкладка "Новости" в админ-панели (`admin/src/components/tabs/NewsTab.tsx`)
- CRUD операции: создание, редактирование, удаление новостей
- Backend API: `/api/admin/news/*` с валидацией
- Кеширование с ETag (TTL 60s)
- WebSocket broadcast при изменениях (топик `home`)

**Файлы:**
- `backend/src/routes/newsRoutes.ts`
- `admin/src/components/tabs/NewsTab.tsx`
- `admin/src/api/adminClient.ts` (методы `adminFetchNews`, `adminCreateNews`, etc.)

### Публичная карусель новостей
**Дата:** Октябрь 2025  
**Связанные изменения:** 0024, 0026

**Что реализовано:**
- Карусель на главной странице (`frontend/src/components/NewsSection.tsx`)
- Локальный кеш в `localStorage` (TTL 30 минут)
- HTTP polling (60s) с ETag/304
- Авто-прокрутка и свайп-навигация
- Модальное окно для детального просмотра
- Защита от дублирующихся запросов через `fetchingRef`

**Оптимизации:**
- Убрана проверка `canSendConditionalHeader` для cross-origin
- `If-None-Match` отправляется всегда при наличии ETag
- Lock для предотвращения параллельных запросов

**Файлы:**
- `frontend/src/components/NewsSection.tsx`
- `frontend/src/api/newsApi.ts`
- `frontend/src/styles/news.css`

---

## Модуль: Рекламные баннеры (Advertising)

### Управление баннерами в админке
**Дата:** Октябрь 2025  
**Связанные изменения:** 0044, 0045, 0046

**Что реализовано:**
- CRUD баннеров в вкладке "Новости" (`admin/src/components/tabs/NewsTab.tsx`)
- Backend API: `/api/admin/news/ads` с валидацией изображения и расписания
- Публичный эндпоинт: `/api/ads` с кешированием (TTL 600s)
- WebSocket broadcast при изменениях (топик `home`, события `ads.full`/`ads.remove`)
- Предпросмотр баннера в форме редактирования

**Файлы:**
- `backend/src/routes/adsRoutes.ts`
- `admin/src/api/adminClient.ts` (методы `adminFetchAds`, `adminCreateAd`, etc.)
- `prisma/schema.prisma` (модель `AdBanner`)

### Публичная карусель баннеров
**Дата:** Ноябрь 2025  
**Связанные изменения:** 0045, 0046

**Что реализовано:**
- Карусель на главной странице (`frontend/src/components/AdCarousel.tsx`)
- Локальный кеш в `localStorage` (TTL 2 недели)
- HTTP polling (60s) с ETag/304
- Авто-ротация каждые 7 секунд
- Индикаторы и ручная навигация
- Убран заголовок "Баннеры" для компактности

**Исправления:**
- Автоматический запуск миграций в `render.yaml` перед стартом сервера
- Убран заголовок из карусели согласно дизайну

**Файлы:**
- `frontend/src/components/AdCarousel.tsx`
- `frontend/src/api/adsApi.ts`
- `frontend/src/styles/ads.css`

---

## Модуль: Достижения (Achievements)

### Система достижений и прогресс пользователей
**Дата:** Ноябрь 2025  
**Связанные изменения:** predictions-phase1, 20251103_predictions_tables, 20251105-cleanup-userstab

**Что реализовано:**
- Модели Prisma: `AchievementType`, `AchievementLevel`, `UserAchievementProgress` с метриками (DAILY_LOGIN, TOTAL_PREDICTIONS, CORRECT_PREDICTIONS)
- Backend API: `GET /api/users/me/achievements` с Redis-кешированием (TTL 5 мин), возвращает прогресс по всем достижениям с уровнями
- Frontend API клиент: `achievementsApi.ts` с SWR паттерном (5m fresh / 15m stale), localStorage кеш, ETag support
- UI в профиле: отдельная вкладка "Достижения" с карточками, progress bars (X/Y — Уровень Z), индикация максимального уровня
- Админ-панель: отдельная вкладка "Достижения" (`AchievementsTab.tsx`) для CRUD типов достижений, просмотра прогресса пользователей
- Рефакторинг: удалено 354 строки (~40%) дублирующего кода из `UsersTab.tsx` — формы создания/редактирования достижений перенесены в `AchievementsTab`

**Ключевые особенности:**
- Многоуровневые достижения с порогами (threshold) для каждого уровня
- Автоматический трекинг прогресса пользователей по метрикам
- Адаптивная сетка карточек в профиле (320px min)
- Разделение ответственности: UsersTab → управление пользователями, AchievementsTab → управление достижениями

**Файлы:**
- `prisma/schema.prisma` (AchievementType, AchievementLevel, UserAchievementProgress)
- `backend/src/routes/userRoutes.ts` (GET /users/me/achievements)
- `frontend/src/api/achievementsApi.ts`
- `frontend/src/Profile.tsx` (вкладка достижений)
- `frontend/src/profile.css` (стили карточек и progress bars)
- `admin/src/components/tabs/AchievementsTab.tsx` (NEW)
- `admin/src/components/tabs/UsersTab.tsx` (cleanup: -354 lines)
- `shared/types.ts` (UserAchievementsSummary, UserAchievementProgress, UserAchievementLevel)
- `audit/changes/20251105-cleanup-userstab-achievements.md`

---

## Модуль: Статистика и турнирная таблица (League & Stats)

### Публичная вкладка "Лига"
**Дата:** Октябрь 2025  
**Связанные изменения:** 0036, 0038, 0042

**Что реализовано:**
- Вкладка "Лига" с подвкладками: Таблица, Расписание, Результаты, Статистика
- Backend API: `/api/league/*` с adaptive TTL
- Frontend store: `appStore.ts` с HTTP polling и ETag
- Lazy loading — данные загружаются только для активной подвкладки
- Карточка клуба (`TeamView`) с вкладками: Обзор, Матчи, Состав

**Оптимизации:**
- Adaptive TTL через `matchWindowHelper` (10-30s в матч-окне, часы/дни вне окна)
- Merge helpers для минимизации перерисовок React
- Polling только для активной подвкладки (снижение трафика на ~70%)
- Приостановка polling при `document.hidden`

**Файлы:**
- `backend/src/routes/leagueRoutes.ts`
- `frontend/src/pages/LeaguePage.tsx`
- `frontend/src/store/appStore.ts`
- `frontend/src/styles/teamView.css`

### Карьерная статистика игроков
**Дата:** Октябрь 2025  
**Связанные изменения:** 0013, 0021, 0043

**Что реализовано:**
- Таблица карьерной статистики в профиле (`Profile.tsx`)
- Backend агрегация: `PlayerClubCareerStats` (по клубам и годам)
- Эффективность (коэффициент полезности): `(goals + assists) / matches`
- Кеширование профиля в `localStorage` (TTL 5 минут)
- HTTP polling (90s) с ETag/304

**Файлы:**
- `backend/src/services/matchAggregation.ts` (функция `aggregatePlayerCareerStats`)
- `frontend/src/Profile.tsx`
- `frontend/src/profile.css`
- `prisma/schema.prisma` (модель `PlayerClubCareerStats`)

---

## Модуль: Кеширование и производительность (Caching)

### Многоуровневый кеш с SWR
**Дата:** Сентябрь-Октябрь 2025  
**Связанные изменения:** базовая архитектура

**Что реализовано:**
- LRU (quick-lru) + Redis два слоя
- Stale-While-Revalidate: отдаём устаревшие данные, регенерируем в фоне
- SETNX lock для защиты от cache stampede
- Версионирование с ETag: `W/"{cacheKey}:{version}"`
- API: `getWithMeta`, `set`, `invalidate`

**Файлы:**
- `backend/src/cache/multilevelCache.ts`

### Adaptive TTL и Match-Window Helper
**Дата:** Октябрь 2025  
**Связанные изменения:** 0039, 0040

**Что реализовано:**
- `matchWindowHelper.ts` — вычисление "матчевого окна"
- Pre-warm за 45 минут до матчей
- Адаптивный TTL: короткий в окне, длинный вне окна
- Кеширование расчёта окна (30s)
- Интеграция с `defaultCache`

**Параметры ENV:**
```bash
MATCH_WINDOW_LOOKAHEAD_DAYS=7
MATCH_WINDOW_PREWARM_MINUTES=45
MATCH_WINDOW_POST_GRACE_MINUTES=30
```

**Файлы:**
- `backend/src/cache/matchWindowHelper.ts`
- `backend/src/services/cachePrewarm.ts`

### ETag и CORS исправления
**Дата:** Октябрь 2025  
**Связанные изменения:** 0040, 0041

**Что исправлено:**
- ETag не перезаписывался в `etag.ts` плагине
- CORS не возвращал ETag в `exposedHeaders`
- 304 ответы не работали для cross-origin запросов
- Локальный кеш новостей сбрасывался при 304 без payload

**Решение:**
- Добавлен `exposedHeaders: ['ETag', 'X-Resource-Version', 'Cache-Control']`
- Плагин проверяет наличие ETag перед добавлением
- Клиент сохраняет ETag из любого источника (meta.version, ETag, X-Resource-Version)

**Файлы:**
- `backend/src/plugins/etag.ts`
- `backend/src/server.ts` (CORS конфигурация)
- `frontend/src/api/httpClient.ts`

### Миграция на HTTP Polling
**Дата:** Октябрь 2025  
**Связанные изменения:** 0038, 0042

**Что изменилось:**
- Публичный фронт отказался от WebSocket
- HTTP polling с ETag для всех live-данных
- Adaptive intervals: 10s для Лиги, 20s для карточки клуба, 60s для новостей
- Приостановка при `document.hidden`

**Причины:**
- Проще горизонтальное масштабирование
- Меньше нагрузка на сервер (нет постоянных соединений)
- ETag минимизирует трафик (304 без body)
- Telegram WebApp убивает соединения в фоне

**Файлы:**
- `frontend/src/store/appStore.ts` (функции `ensureLeaguePolling`, `ensureTeamPolling`)
- `docs/state.md`, `docs/cache.md` (обновлённая документация)

### Исправление кеширования и дублирующихся запросов
**Дата:** Октябрь 2025  
**Связанные изменения:** 0042

**Что исправлено:**
- Множественные запросы к `/api/news` со статусом 200 вместо 304
- `canSendConditionalHeader` блокировал `If-None-Match` для cross-origin
- Отсутствие защиты от параллельных запросов в `fetchNews`
- При повторном входе на "Лигу" запросы шли ко всем подвкладкам
- После перезагрузки все запросы возвращали 200 вместо 304

**Решение:**
- Убрана проверка `canSendConditionalHeader`
- Добавлен `fetchingRef` lock в `NewsSection`
- `startLeaguePolling` запрашивает только активную подвкладку
- Данные лиги сохраняются в `localStorage` (версии + TTL)

**Эффект:**
- Снижение трафика на 80% (304 вместо 200)
- Нет дублирующихся запросов
- Instant load при перезагрузке страницы

**Файлы:**
- `frontend/src/components/NewsSection.tsx`
- `frontend/src/store/appStore.ts`

---

## Модуль: Управление матчами (Match Management)

### Панель судьи (Judge Panel)
**Дата:** Октябрь 2025  
**Связанные изменения:** 0032

**Что реализовано:**
- Панель создания/редактирования событий матча (`admin/src/components/JudgePanel.tsx`)
- Backend: `/api/judge/*` с валидацией и broadcast
- Типы событий: гол, автогол, жёлтая/красная, замена, удар, угловой, фол
- Live-обновление статистики через WebSocket
- Подбор игроков из составов команд

**Файлы:**
- `backend/src/routes/judgeRoutes.ts`
- `backend/src/routes/matchModerationHelpers.ts`
- `admin/src/components/JudgePanel.tsx`

### Панель ассистента (Assistant Panel)
**Дата:** Октябрь 2025  
**Связанные изменения:** 0031

**Что реализовано:**
- Управление счётом, временем, статусом матча
- Удаление событий, блокировка редактирования
- WebSocket broadcast изменений
- Backend: `/api/assistant/*`

**Файлы:**
- `backend/src/routes/assistantRoutes.ts`
- `admin/src/components/AssistantPanel.tsx`
- `admin/src/store/assistantStore.ts`

### Финализация матча и блокировка статистики
**Дата:** Октябрь 2025  
**Связанные изменения:** 0027, 0030

**Что реализовано:**
- Блокировка счёта через 3 часа после окончания матча
- Автоудаление статистики через 3 часа (освобождение RAM)
- Атомарная финализация: счёт, статус, broadcast, инвалидация кеша
- Сохранение финального счёта в `Match.homeScore`/`awayScore`

**Файлы:**
- `backend/src/routes/matchModerationHelpers.ts` (`hasMatchStatisticsExpired`, `cleanupExpiredMatchStatistics`)
- `backend/src/routes/assistantRoutes.ts` (endpoint финализации)

### Серии матчей и пенальти
**Дата:** Октябрь 2025  
**Связанные изменения:** 0029, 0033

**Что реализовано:**
- Поддержка форматов: `SINGLE_MATCH`, `TWO_LEGGED`, `BEST_OF_N`, `PLAYOFF_BRACKET`
- Серия пенальти для best-of: до двух побед (учитывается победа 2:1 в матче)
- Расчёт победителя серии на основе `homeWins`/`awayWins`
- Bracket автоматически показывает сетку плей-офф

**Файлы:**
- `backend/src/routes/bracketRoutes.ts`
- `admin/src/components/PlayoffBracket.tsx`
- `prisma/schema.prisma` (enum `SeriesFormat`, модель `MatchSeries`)

### Комментарии к трансляции
**Дата:** Ноябрь 2025  
**Связанные изменения:** 0051

**Что реализовано:**
- Публичный API для временных комментариев: `GET/POST /api/public/matches/:id/comments` с ETag и Redis TTL 4 часа.
- Хранение до 120 последних сообщений в ключе `md:{matchId}:comments`, версия обновляется через `defaultCache`.
- Клиентская вкладка «Трансляция» показывает список комментариев, индикаторы загрузки и форму отправки с локальным кешем имени.
- Отправка комментария обновляет store и кэш `matchDetailsCache`, UI работает оптимистично.

**Файлы:**
- `backend/src/services/matchDetailsPublic.ts`
- `backend/src/routes/matchPublicRoutes.ts`
- `frontend/src/api/matchApi.ts`
- `frontend/src/pages/MatchDetailsPage.tsx`
- `frontend/src/styles/matchDetails.css`

---

## Модуль: Профиль и авторизация (Auth & Profile)

### Telegram авторизация
**Дата:** Сентябрь 2025  
**Связанные изменения:** базовая архитектура

**Что реализовано:**
- Верификация `initData` через `crypto.createHmac`
- JWT cookie (HttpOnly, Secure в production)
- Backend: `POST /api/auth/telegram-init`
- Автоматическое создание/обновление `AppUser`

**Файлы:**
- `backend/src/routes/authRoutes.ts`
- `backend/src/utils/telegramAuth.ts` (планируется)

### Профиль пользователя
**Дата:** Октябрь 2025  
**Связанные изменения:** 0001, 0002, 0008, 0043

**Что реализовано:**
- Отображение имени, фото, статистики
- Карьерная таблица по клубам и годам
- HTTP polling (90s) с ETag/304
- Локальный кеш в `localStorage` (TTL 5 минут)
- Привязка к игроку лиги (`leaguePlayerId`)

**Файлы:**
- `frontend/src/Profile.tsx`
- `frontend/src/profile.css`
- `backend/src/routes/authRoutes.ts` (endpoint `/api/auth/me`)

---

## Модуль: Администрирование (Admin Dashboard)

### Вкладки админ-панели
**Дата:** Октябрь 2025  
**Связанные изменения:** 0004, 0015, 0016

**Что реализовано:**
- `DashboardLayout` с навигацией между вкладками
- **Teams:** управление клубами и игроками
- **Matches:** создание, редактирование, финализация матчей
- **Stats:** просмотр статистики и лидербордов
- **Seasons:** создание сезонов, настройка формата
- **News:** CRUD новостей и баннеров

**Файлы:**
- `admin/src/components/DashboardLayout.tsx`
- `admin/src/components/tabs/TeamsTab.tsx`
- `admin/src/components/tabs/MatchesTab.tsx`
- `admin/src/components/tabs/StatsTab.tsx`
- `admin/src/components/tabs/SeasonsTab.tsx`
- `admin/src/components/tabs/NewsTab.tsx`

### Оптимизация кеша админки
**Дата:** Октябрь 2025  
**Связанные изменения:** 0015, 0016

**Что реализовано:**
- TTL timestamps для каждого типа данных
- Версионирование кеша (`adminStore.cacheVersion`)
- Функция `runCachedFetch` с TTL check
- WebSocket обновления инвалидируют кеш автоматически

**Файлы:**
- `admin/src/store/adminStore.ts`

---

## Модуль: База данных (Database)

### Очистка схемы
**Дата:** Сентябрь 2025  
**Связанные изменения:** 0006

**Что изменилось:**
- Удалена модель `AdminLog` (не использовалась)
- Унификация `User` → `AppUser`
- Добавлено поле `photoUrl` в `AppUser`
- Убраны обходы типизации (`prisma as any`)

**Файлы:**
- `prisma/schema.prisma`

### Трансферы игроков и история клубов
**Дата:** Октябрь 2025  
**Связанные изменения:** 0028

**Что реализовано:**
- Модель `ClubPlayer` для привязки игроков к клубам
- Поле `defaultShirtNumber` для автозаполнения
- Связь с `SeasonRoster` для исторической регистрации

**Файлы:**
- `prisma/schema.prisma` (модель `ClubPlayer`)

### Групповая стадия турниров
**Дата:** Октябрь 2025  
**Связанные изменения:** 0019

**Что реализовано:**
- Модели `SeasonGroup` и `SeasonGroupSlot`
- Ручная настройка групп в админке
- Фильтрация матчей по группам

**Файлы:**
- `prisma/schema.prisma`
- `admin/src/components/tabs/SeasonsTab.tsx`

---

## Известные ограничения и технический долг

### Временные реализации (temporary stubs)

1. **Playoff Bracket API** (0012)
   - Текущая реализация без кеша/WS
   - Требуется сверка с контекстом `bracket-flow.md` из context7
   - Помечено как stub до получения артефактов

2. **Player Career Aggregation** (0013, 0021)
   - Текущая реализация на Prisma `groupBy`
   - Требуется оптимизация для больших объёмов данных
   - Планируется миграция на материализованные представления

3. **Context7 артефакты**
   - Отсутствуют референсы по некоторым подсистемам
   - Зафиксировано в `mcp-context7-summary.md`
   - План синхронизации после получения доступа

### Технический долг

1. **Отсутствие тестов** — юнит/интеграционные/e2e не реализованы
2. **TypeScript strict mode** — не включён полностью
3. **Линт warnings** — `@typescript-eslint/no-explicit-any` в нескольких файлах
4. **Отсутствие CDN** — static assets на Render без CDN
5. **Redis single-instance** — нет репликации на бесплатном плане

---

Документ обновляется при значительных изменениях функциональности.
