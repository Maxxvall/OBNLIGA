# Архитектура проекта OBNLIGA

**Дата обновления:** 1 ноября 2025 г.  
**Статус:** Актуальная документация текущей реализации

## Обзор

OBNLIGA — Telegram WebApp для футбольной лиги г. Обнинск с live-обновлениями, управлением матчами, новостями, статистикой и администрированием.

### Технологический стек

#### Backend
- **Runtime:** Node.js ≥20, TypeScript 5
- **Framework:** Fastify 4 + плагины (@fastify/cors, @fastify/compress, @fastify/websocket, @fastify/cookie)
- **ORM:** Prisma 5.x с PostgreSQL
- **Кеширование:** Redis (ioredis 5.8) + LRU (quick-lru)
- **Очереди:** BullMQ 5.61 (для фоновых задач и уведомлений)
- **Telegram:** grammy для бота и верификации initData
- **Realtime:** WebSocket с Redis pub/sub для админ-панелей

#### Frontend (публичный)
- **Framework:** React 18 + TypeScript 5
- **Bundler:** Vite 5
- **State:** Zustand 4.5.2 + localStorage для офлайн-кеша
- **Стили:** Кастомные CSS с переменными, неокубистская стилистика
- **API:** HTTP Polling + ETag/304 для live-данных (без WebSocket)

#### Admin
- **Framework:** React 18 + TypeScript 5 (отдельный Vite-проект)
- **State:** Zustand с TTL-кешем и WebSocket-подписками
- **Компоненты:** DashboardLayout, вкладки (Teams, Matches, Stats, News), JudgePanel, AssistantPanel, LineupPortalView

#### Инфраструктура
- **Хостинг:** Render.com (web service + static sites + migration job)
- **База данных:** PostgreSQL (Render managed)
- **Redis:** Render Redis для кеширования и pub/sub
- **CI/CD:** GitHub + Render auto-deploy

---

## Структура проекта

```
OBNLIGA/
├── backend/           # Fastify сервер
│   ├── src/
│   │   ├── routes/    # API маршруты (auth, admin, lineup, judge, assistant, bracket, news, ads, league, club, matchPublic)
│   │   ├── services/  # Бизнес-логика (matchAggregation, cachePrewarm)
│   │   ├── cache/     # multilevelCache, matchWindowHelper
│   │   ├── realtime/  # WebSocket + Redis pub/sub
│   │   ├── queue/     # BullMQ воркеры
│   │   ├── plugins/   # ETag, validators
│   │   ├── utils/     # Общие утилиты
│   │   ├── db/        # Prisma client
│   │   ├── bot.ts     # Telegram бот
│   │   └── server.ts  # Точка входа
│   └── package.json
│
├── frontend/          # Публичный Telegram WebApp
│   ├── src/
│   │   ├── pages/     # LeaguePage, NewsSection
│   │   ├── components/# NewsSection, AdCarousel, TeamView, MatchCard
│   │   ├── store/     # appStore.ts (Zustand)
│   │   ├── api/       # httpClient, типы API
│   │   ├── styles/    # app.css, profile.css, teamView.css, ads.css
│   │   ├── Profile.tsx
│   │   ├── LineupPortal.tsx
│   │   ├── App.tsx
│   │   └── wsClient.ts # (не используется публичным, только админкой)
│   └── package.json
│
├── admin/             # Админ-панель (отдельное приложение)
│   ├── src/
│   │   ├── components/
│   │   │   ├── DashboardLayout.tsx
│   │   │   ├── LoginForm.tsx
│   │   │   ├── LineupPortalView.tsx
│   │   │   ├── JudgePanel.tsx
│   │   │   ├── AssistantPanel.tsx
│   │   │   ├── PlayoffBracket.tsx
│   │   │   └── tabs/ # TeamsTab, MatchesTab, StatsTab, SeasonsTab, NewsTab
│   │   ├── store/     # adminStore.ts (Zustand с WebSocket)
│   │   ├── api/       # adminClient.ts
│   │   ├── lineup.css, theme.css, app.css
│   │   └── App.tsx
│   └── package.json
│
├── prisma/
│   ├── schema.prisma  # Модели БД
│   └── migrations/
│
├── shared/
│   ├── types.ts       # Общие типы (News, AdBanner, League, Match)
│   └── utils/         # Словоформы, валидаторы
│
├── docs/              # Документация
│   ├── project.md     # Обзор проекта
│   ├── roadmap.md     # План развития
│   ├── cache.md       # Политика кеширования
│   ├── state.md       # Store контракты
│   ├── style.md       # UI гайдлайн
│   ├── BD.md          # Схема базы данных
│   ├── TTL.md         # TTL конфигурация
│   └── prisma.md      # Prisma миграции
│
├── audit/             # История изменений (консолидирована)
│   ├── ARCHITECTURE.md      # Этот файл
│   ├── CACHE_AND_PERFORMANCE.md
│   ├── FEATURES_CHANGELOG.md
│   └── CURRENT_STATE.md
│
└── render.yaml        # Конфигурация деплоя
```

---

## Ключевые модули Backend

### 1. Routes (API маршруты)

#### authRoutes
- `POST /api/auth/telegram-init` — верификация Telegram initData
- `GET /api/auth/me` — получение профиля с ETag
- `PATCH /api/auth/me` — обновление профиля
- Возвращает JWT cookie для авторизованных запросов

#### adminRoutes
- Управление сезонами, клубами, игроками, матчами
- CRUD новостей и рекламных баннеров
- WebSocket broadcast при изменениях
- Требует токен админа/судьи/ассистента

#### lineupRoutes
- `POST /api/lineup/:matchId` — отправка состава от капитана
- Валидация: игроки из заявки, не дисквалифицированы, номера корректны

#### judgeRoutes
- Создание/редактирование событий матча
- Управление статистикой в реальном времени
- Broadcast через WebSocket `match:{id}:*` топики

#### assistantRoutes
- Изменение счета, времени, статуса матча
- Удаление событий, блокировка редактирования
- Broadcast изменений

#### newsRoutes & adsRoutes
- `GET /api/news` — список новостей с ETag (TTL 60s)
- `GET /api/ads` — баннеры с ETag (TTL 600s)
- Публичные эндпоинты с кешированием

#### leagueRoutes
- `GET /api/league/seasons` — список сезонов
- `GET /api/league/table?seasonId={id}` — турнирная таблица
- `GET /api/league/schedule?seasonId={id}` — расписание
- `GET /api/league/results?seasonId={id}` — результаты
- `GET /api/league/stats?seasonId={id}` — статистика бомбардиров
- Adaptive TTL через match-window helper

#### clubRoutes
- `GET /api/clubs/:id/summary` — сводка клуба
- `GET /api/clubs/:id/matches` — все матчи клуба

#### matchPublicRoutes
- `GET /api/matches/:id` — детали матча для публичного просмотра

#### bracketRoutes
- `GET /api/bracket/seasons/:id` — плей-офф сетка
- Автоматическая генерация на основе настроек сезона

### 2. Cache (многоуровневое кеширование)

**Файлы:** `backend/src/cache/multilevelCache.ts`, `matchWindowHelper.ts`

#### multilevelCache
- **Два слоя:** LRU (in-memory) + Redis
- **TTL:** Каждый ключ имеет `expiresAt` и `staleUntil`
- **SWR (Stale-While-Revalidate):** Отдаёт устаревшие данные, пока новые генерируются
- **SETNX lock:** Защита от stampede — только один процесс регенерирует данные
- **Версионирование:** ETag = `W/"{cacheKey}:{version}"`
- **API:**
  - `getWithMeta(key, loader, options)` — получить с автоподгрузкой
  - `set(key, value, options)` — записать
  - `invalidate(pattern)` — удалить по паттерну

#### matchWindowHelper
- Определяет "матчевое окно" (prewarm + live + post-grace)
- Читает ближайшие матчи на 7 дней вперёд
- Кеширует расчёт окна на 30 секунд
- Выдаёт adaptive TTL для league ресурсов:
  - **В окне:** короткие TTL (10-30s)
  - **Вне окна:** длинные TTL (часы/дни)

#### cachePrewarm
- `maybePrewarmPublicLeagueCaches()` — прогрев перед матчами
- Вызывается вручную через `/api/cache/prewarm` или по расписанию

### 3. Realtime (WebSocket)

**Файл:** `backend/src/realtime/index.ts`

- **Только для админских панелей** (требует JWT)
- **Топики:**
  - `match:{id}:*` — события матча
  - `season:{id}:*` — изменения сезона
  - `home` — новости/баннеры
  - `admin:stats` — обновления статистики
- **Pub/Sub через Redis** для горизонтального масштабирования
- **Публичный фронт НЕ использует WebSocket** — только HTTP polling + ETag

### 4. Services

#### matchAggregation
- Пересчёт турнирной таблицы
- Агрегация статистики игроков и клубов
- Генерация карьерной статистики

#### cachePrewarm
- Прогрев кеша перед матчами
- Интеграция с matchWindowHelper

---

## Ключевые модули Frontend

### 1. Store (Zustand)

#### appStore (публичный)
**Файл:** `frontend/src/store/appStore.ts`

**Состояние:**
- `currentTab`: активная вкладка (home/league/predictions/leaderboard/shop/profile)
- `leagueSubTab`: подвкладка Лиги (table/schedule/results/stats)
- `seasons`, `tables`, `schedules`, `results`, `stats` — кешированные данные
- `teamView` — карточка клуба (открыта/закрыта, активная вкладка)
- TTL timestamps: `seasonsFetchedAt`, `tableFetchedAt`, etc.
- Версии: `seasonsVersion`, `tableVersions[seasonId]`, etc.

**HTTP Polling:**
- `ensureLeaguePolling()` — запускает интервал 10s для вкладки "Лига"
- `ensureTeamPolling()` — интервал 20s для карточки клуба
- Приостановка при `document.hidden === true`
- Адаптивные запросы: только для активной подвкладки

**Merge helpers:**
- `mergeLeagueTable`, `mergeRoundCollection`, `mergeStatsResponse`
- Переиспользуют ссылки на неизменившиеся объекты → минимизация перерисовок React

#### adminStore (админка)
**Файл:** `admin/src/store/adminStore.ts`

**Состояние:**
- `activeTab`: admin/judge/assistant/lineup
- `role`: текущая роль пользователя
- `seasons`, `clubs`, `players`, `matches`, `news`, `ads`
- WebSocket подписки и обработка патчей

**WebSocket Integration:**
- Подписка на топики `match:*`, `season:*`, `home`
- Обработка патчей: `full`, `patch`, `remove`
- Автоматическая синхронизация данных в реальном времени

### 2. API клиенты

#### httpClient (публичный)
**Файл:** `frontend/src/api/httpClient.ts`

- Добавляет `If-None-Match` при наличии версии
- Обрабатывает `304 Not Modified` — продлевает TTL, не меняет данные
- Возвращает `{ ok, data?, version?, notModified?, error? }`
- Нормализует версии из `meta.version`, `ETag`, `X-Resource-Version`

#### adminClient
**Файл:** `admin/src/api/adminClient.ts`

- CRUD операции с envelope `{ data, meta }`
- Словари локализованных ошибок
- Методы: `adminFetchSeasons`, `adminCreateMatch`, `adminUpsertAd`, etc.

### 3. Компоненты

#### NewsSection
- Локальный кеш в `localStorage` (TTL 30 мин)
- ETag + HTTP polling (60s)
- Карусель с авто-прокруткой
- Модальное окно для детального просмотра

#### AdCarousel
- Баннеры из `/api/ads`
- Авто-ротация каждые 7 секунд
- Индикаторы и ручная навигация

#### LeaguePage
- Табы: Таблица, Расписание, Результаты, Статистика
- Lazy loading — данные загружаются только для активного таба
- Интеграция с `appStore` и HTTP polling

#### TeamView
- Карточка клуба с вкладками: Обзор, Матчи, Состав
- Polling summary и matches при открытии
- Фильтрация матчей: расписание/результаты

#### LineupPortal (публичный)
- Капитан отправляет состав до матча
- Валидация: игроки из заявки, не дисквалифицированы
- Mobile-first дизайн

#### DashboardLayout (админ)
- Навигация между вкладками: Teams, Matches, Stats, Seasons, News
- Роль-based доступ (admin/judge/assistant)

#### JudgePanel
- Создание/редактирование событий матча
- Live-статистика
- Broadcast через WebSocket

#### AssistantPanel
- Управление счётом, временем, статусом
- Финализация матча

---

## База данных (Prisma)

### Основные модели

**Файл:** `prisma/schema.prisma`

- **Competition** — турниры (лига, кубок)
- **Season** — сезоны с форматами (single_match, playoff_bracket, best_of_n)
- **Club** — клубы
- **Person** — игроки и судьи
- **Match** — матчи с датой, счётом, статусом
- **MatchSeries** — серии матчей (best-of, two-legged)
- **MatchLineup** — составы команд
- **MatchEvent** — события (гол, автогол, жёлтая/красная, замена)
- **MatchStatistic** — статистика (удары, угловые, фолы)
- **PlayerSeasonStats** — статистика игрока за сезон
- **ClubSeasonStats** — статистика клуба
- **PlayerClubCareerStats** — карьерная статистика по клубам
- **AppUser** — пользователи Telegram
- **NewsItem** — новости
- **AdBanner** — рекламные баннеры
- **Disqualification** — дисквалификации игроков
- **SeasonGroup**, **SeasonGroupSlot** — групповая стадия

---

## Deployment (Render)

### Services

**Файл:** `render.yaml`

1. **Backend** (web service)
   - Билд: `npm install && npm run prisma:migrate:deploy && npm run build`
   - Старт: `npm run start`
   - ENV: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `ADMIN_TOKEN`

2. **Frontend** (static site)
   - Билд: `npm install && npm run build`
   - Путь: `dist/`

3. **Admin** (static site)
   - Билд: `npm install && npm run build`
   - Путь: `dist/`

### Migration Job

- Выполняется при каждом deploy
- Команда: `npm run prisma:migrate:deploy`
- Гарантирует актуальность схемы БД

---

## Паттерны и Best Practices

### 1. ETag + SWR
- Сервер отдаёт `ETag: W/"{cacheKey}:{version}"`
- Клиент отправляет `If-None-Match`
- При `304` данные не передаются, TTL продлевается
- SWR: отдаём stale данные, пока новые генерируются в фоне

### 2. Adaptive TTL
- Match-window helper определяет "горячий" период
- В матчевом окне: короткие TTL (10-30s)
- Вне окна: длинные TTL (часы/дни)
- Минимизация нагрузки при сохранении актуальности

### 3. HTTP Polling вместо WebSocket (публичный фронт)
- Проще масштабируется
- Меньше нагрузка на сервер
- ETag обеспечивает минимальный трафик
- Интервалы адаптируются под `document.hidden`

### 4. Merge helpers для минимизации перерисовок
- Сравниваем входящие данные с предыдущими
- Переиспользуем ссылки на неизменившиеся объекты
- React `memo` не триггерит перерисовку, если ссылки не изменились

### 5. SETNX lock для защиты от stampede
- При промахе кеша проверяем локальный lock
- Если занят — ждём освобождения
- Если свободен — захватываем и регенерируем
- Только один процесс выполняет тяжёлую работу

### 6. Lazy loading и targeted polling
- Данные загружаются только для активной вкладки
- Polling запускается только когда нужно
- Минимизация трафика и нагрузки

---

## Безопасность

1. **Telegram initData верификация** — проверка подписи через crypto.createHmac
2. **JWT cookies** — HttpOnly, Secure в production
3. **RBAC** — роли admin/judge/assistant с разными правами
4. **CORS** — exposedHeaders для ETag/версий
5. **Rate limiting** — планируется (roadmap Phase 9)
6. **Input validation** — Fastify schemas, runtime guards
7. **Env secrets** — DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_TOKEN, CACHE_PREWARM_TOKEN

---

## Метрики и мониторинг

**Текущее состояние:**
- Health check: `/health` (базовый)
- Логирование: Fastify logger
- Ошибки: try/catch с логированием

**Планируется (Phase 9):**
- Sentry для frontend + backend
- Prometheus metrics (`/metrics`)
- Расширенный health check (DB, Redis, BullMQ)
- Алерты на критичные метрики

---

## Известные ограничения и технический долг

1. **Отсутствие тестов** — юнит/интеграционные тесты не реализованы (roadmap Phase 8)
2. **Context7 артефакты** — некоторые временные реализации (bracket, playoff) помечены как stub до получения исходных материалов
3. **TypeScript strict mode** — не включён полностью (roadmap Phase 10)
4. **Линт warnings** — `@typescript-eslint/no-explicit-any` в adminRoutes и matchDetailsPublic
5. **E2E тесты** — Playwright не настроен (roadmap Phase 8)

---

## Roadmap

См. `docs/roadmap.md` для детального плана развития.

**Ближайшие приоритеты:**
- Фаза 8: Тестирование и CI/CD
- Фаза 9: Мониторинг и безопасность
- Фаза 10: Оптимизация и релиз v1

---

Документ обновляется при значительных архитектурных изменениях.
