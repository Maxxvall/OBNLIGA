Введение — Prisma для проекта (без prisma сейчас)

Этот документ помогает аккуратно начать использование Prisma в вашем проекте (текущий стек — Python + SQLAlchemy). Он учитывает, что проект развёрнут на Render.com, и что вы хотите использовать бесплатные инструменты Prisma (CLI, Prisma Client). Здесь — два безопасных пути миграции: 1) интроспекция существующей базы (наиболее безопасно для уже работающей БД) и 2) новая схема и миграции (подход для чистого старта).

Важно: Prisma — это ORM/клиент для Node/TypeScript (официальный JS/TS клиент). Для Python есть независимый проект `prisma` (prisma-client-py), но он отличается по функциональности и зрелости. Рекомендации ниже покрывают оба варианта и даёт вариант с отдельным Node-микросервисом для миграций/DB API, если вы не хотите переписывать всё на TypeScript.

## Короткая сводка шагов

- Решите стратегию: интроспекция (existing DB) или новая схема (greenfield).
- Установите Node.js (локально) и Prisma CLI в папку проекта или в отдельную подпапку `/prisma`.
- Если у вас уже есть Postgres на Render: добавьте `DATABASE_URL` в переменные окружения Render.
- Инспектируйте базу или создайте `schema.prisma` вручную (вставлен образец ниже, соответствующий моделям SQLAlchemy).
- Для локальной разработки используйте `npx prisma migrate dev --name init` или `prisma db pull` для интроспекции. Для продакшена на Render — используйте `npx prisma migrate deploy` (не требует shadow DB) в post-deploy шаге.

## Почему Prisma?

- Быстрый и удобный TypeScript-клиент для Postgres с автогенерацией типов.
- Бесплатные инструменты CLI и client покрывают большинство нужд.
- Хорошо подходит, если вы хотите завести отдельный сервис API на Node/TS или постепенно мигрировать логику данных.

## Стратегии внедрения (рекомендации)

1) Интроспекция (рекомендуется при работающей БД с данными)

- Подходит, если вы хотите минимально вмешиваться сейчас и получить `schema.prisma` автоматически.
- Последовательность:
  - Установить Prisma CLI: `npm i -D prisma @prisma/client`.
  - Создать `prisma` (или в корне) и запустить `npx prisma init`.
  - Установить `DATABASE_URL` (локально — в `.env`, на Render — в переменных окружения).
  - Выполнить `npx prisma db pull` — Prisma создаст `schema.prisma` по текущей схеме БД.
  - Внимательно проверить `schema.prisma`, поправить типы и связи, добавить @@map/@map для имен таблиц/полей при необходимости.
  - Создать миграцию-«baseline»: на чистой локальной базе выполнить `npx prisma migrate dev --name init` (этот шаг создаст миграцию в `prisma/migrations`).

2) Полная миграция (greenfield)

- Подходит при новой базе или если вы готовы заместить SQLAlchemy и писать миграции заново.
- Создаёте `schema.prisma` вручную (в примере ниже есть заготовка для ваших таблиц), запускаете `npx prisma migrate dev --name init`.

3) Гибрид (миграция с переносом данных)

- Интроспекция + рефакторинг схемы в `schema.prisma` + создание миграций, затем перенос данных (если нужно) через SQL или ETL.

## Образец схемы — schema.prisma (стартер)

Ниже — предложенная начальная версия `schema.prisma`, отражающая модели из `database/database_models.py`. Скопируйте в `prisma/schema.prisma` и отредактируйте по необходимости.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Tournament {
  id         Int       @id @default(autoincrement())
  name       String    @db.VarChar(255)
  season     String    @db.VarChar(100)
  status     String    @db.VarChar(50) @default("active")
  startDate  DateTime? @map("start_date") @db.Date
  endDate    DateTime? @map("end_date") @db.Date
  description String?  @db.Text
  createdAt  DateTime  @map("created_at") @default(now())
  updatedAt  DateTime  @map("updated_at") @updatedAt

  matches    Match[]
  playerStatistics PlayerStatistics[] @map("player_statistics")

  @@map("tournaments")
}

model Team {
  id           Int      @id @default(autoincrement())
  name         String   @db.VarChar(255)
  logoUrl      String?  @map("logo_url") @db.VarChar(500)
  description  String?  @db.Text
  foundedYear  Int?     @map("founded_year")
  city         String?  @db.VarChar(100)
  isActive     Boolean  @map("is_active") @default(true)
  createdAt    DateTime @map("created_at") @default(now())
  updatedAt    DateTime @map("updated_at") @updatedAt

  homeMatches Match[]  @relation("homeMatches")
  awayMatches Match[]  @relation("awayMatches")
  teamCompositions TeamComposition[] @map("team_compositions")
  matchEvents MatchEvent[] @map("match_events")
  rosterEntries TeamPlayer[] @map("team_players")

  @@map("teams")
}

model Player {
  id           Int      @id @default(autoincrement())
  telegramId   BigInt?  @unique @map("telegram_id") @db.BigInt
  firstName    String   @map("first_name") @db.VarChar(100)
  lastName     String?  @map("last_name") @db.VarChar(100)
  username     String?  @db.VarChar(100)
  position     String?  @db.VarChar(50)
  birthDate    DateTime? @map("birth_date") @db.Date
  phone        String?  @db.VarChar(20)
  isActive     Boolean  @map("is_active") @default(true)
  createdAt    DateTime @map("created_at") @default(now())
  updatedAt    DateTime @map("updated_at") @updatedAt

  teamCompositions TeamComposition[] @map("team_compositions")
  matchEvents MatchEvent[] @map("match_events")
  playerStatistics PlayerStatistics[] @map("player_statistics")
  assistedEvents MatchEvent[] @map("assisted_events")
  teamLinks TeamPlayer[] @map("team_players")

  @@map("players")
}

model TeamPlayer {
  id           Int     @id @default(autoincrement())
  teamId       Int     @map("team_id")
  playerId     Int     @map("player_id")
  jerseyNumber Int?    @map("jersey_number")
  position     String? @db.VarChar(50)
  status       String? @db.VarChar(20) @default("active")
  isCaptain    Boolean @map("is_captain") @default(false)
  joinedAt     DateTime? @map("joined_at")
  leftAt       DateTime? @map("left_at")
  createdAt    DateTime  @map("created_at") @default(now())
  updatedAt    DateTime  @map("updated_at") @updatedAt

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([teamId, playerId], name: "uq_team_player_unique")
  @@map("team_players")
}

model TeamRoster {
  id        Int      @id @default(autoincrement())
  team      String   @db.VarChar(255)
  player    String   @db.Text
  createdAt DateTime @map("created_at") @default(now())

  @@map("team_roster")
}

model Match {
  id            Int      @id @default(autoincrement())
  tournamentId  Int?     @map("tournament_id")
  homeTeamId    Int?     @map("home_team_id")
  awayTeamId    Int?     @map("away_team_id")
  matchDate     DateTime @map("match_date")
  tour          Int?
  venue         String?  @db.VarChar(255)
  homeScore     Int      @map("home_score") @default(0)
  awayScore     Int      @map("away_score") @default(0)
  status        String   @db.VarChar(50) @default("scheduled")
  referee       String?  @db.VarChar(100)
  durationMinutes Int?   @map("duration_minutes")
  weatherConditions String? @map("weather_conditions") @db.VarChar(100)
  attendance    Int?
  notes         String?  @db.Text
  createdAt     DateTime @map("created_at") @default(now())
  updatedAt     DateTime @map("updated_at") @updatedAt

  tournament Tournament? @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  homeTeam Team? @relation("homeMatches", fields: [homeTeamId], references: [id], onDelete: SetNull)
  awayTeam Team? @relation("awayMatches", fields: [awayTeamId], references: [id], onDelete: SetNull)
  teamCompositions TeamComposition[]
  matchEvents MatchEvent[]

  @@map("matches")
}

model TeamComposition {
  id                Int     @id @default(autoincrement())
  matchId           Int     @map("match_id")
  teamId            Int     @map("team_id")
  playerId          Int     @map("player_id")
  position          String? @db.VarChar(50)
  jerseyNumber      Int?    @map("jersey_number")
  isCaptain         Boolean @map("is_captain") @default(false)
  substitutedInMinute  Int? @map("substituted_in_minute")
  substitutedOutMinute Int? @map("substituted_out_minute")
  yellowCards       Int?    @map("yellow_cards") @default(0)
  redCards          Int?    @map("red_cards") @default(0)
  createdAt         DateTime @map("created_at") @default(now())

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  team  Team  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([matchId, playerId], name: "unique_player_per_match")
  @@unique([matchId, teamId, jerseyNumber], name: "unique_jersey_per_team_match")
  @@map("team_compositions")
}

model MatchEvent {
  id                  Int      @id @default(autoincrement())
  matchId             Int      @map("match_id")
  playerId            Int      @map("player_id")
  teamId              Int      @map("team_id")
  eventType           String   @map("event_type") @db.VarChar(50)
  minute              Int
  additionalTime      Int?     @map("additional_time") @default(0)
  description         String?  @db.Text
  assistedByPlayerId  Int?     @map("assisted_by_player_id")
  createdAt           DateTime @map("created_at") @default(now())

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)
  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  assistedBy Player? @relation("assisted_by", fields: [assistedByPlayerId], references: [id], onDelete: SetNull)

  @@map("match_events")
}

model PlayerStatistics {
  id           Int      @id @default(autoincrement())
  playerId     Int      @map("player_id")
  tournamentId Int      @map("tournament_id")
  matchesPlayed Int?    @map("matches_played") @default(0)
  goalsScored  Int?     @map("goals_scored") @default(0)
  assists      Int?     @default(0)
  yellowCards  Int?     @map("yellow_cards") @default(0)
  redCards     Int?     @map("red_cards") @default(0)
  lastUpdated  DateTime @map("last_updated") @default(now())

  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)
  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)

  @@unique([playerId, tournamentId], name: "unique_player_tournament_stats")
  @@map("player_statistics")
}

model AdminLog {
  id              Int      @id @default(autoincrement())
  adminId         BigInt?  @map("admin_id") @db.BigInt
  action          String   @db.VarChar(100)
  description     String   @db.Text
  endpoint        String?  @db.VarChar(200)
  requestData     String?  @map("request_data") @db.Text
  resultStatus    String   @map("result_status") @db.VarChar(20)
  resultMessage   String?  @map("result_message") @db.Text
  affectedEntities String? @map("affected_entities") @db.Text
  executionTimeMs Int?    @map("execution_time_ms")
  ipAddress       String? @map("ip_address") @db.VarChar(45)
  userAgent       String? @map("user_agent") @db.Text
  createdAt       DateTime @map("created_at") @default(now())

  @@map("admin_logs")
}

model News {
  id         Int      @id @default(autoincrement())
  title      String   @db.VarChar(500)
  content    String   @db.Text
  authorId   BigInt?  @map("author_id") @db.BigInt
  isPublished Boolean @map("is_published") @default(true)
  newsType   String?  @map("news_type") @db.VarChar(50)
  createdAt  DateTime @map("created_at") @default(now())
  updatedAt  DateTime @map("updated_at") @updatedAt

  @@map("news")
}
```

Примечания к схеме:
- Имена таблиц и полей сопоставлены с текущими snake_case именами через @@map/@map — это позволяет плавно переходить без переименования БД сразу.
- Некоторые SQL-ограничения (CheckConstraint для minute, additional_time) не выражены в Prisma-уровне. Их можно добавить вручную как raw SQL в миграции (см. раздел «ручные миграции»).
- Для полей типа Date (в исходнике использовался Date) в Prisma используется DateTime с @db.Date декоратором.

## Команды (локально, PowerShell)

# Установка (в корне или в подпапке `prisma`)

```powershell
npm init -y
npm install -D prisma
npm install @prisma/client
npx prisma init
```

# Интроспекция существующей БД

```powershell
# Убедитесь, что в .env содержится правильная DATABASE_URL (postgres://...)
npx prisma db pull
npx prisma generate
```

# Создание миграции для локальной разработки (создаёт миграцию и применяет её к локальной БД)

```powershell
npx prisma migrate dev --name init
npx prisma generate
```

# Применение миграций в production (Render) — использовать deploy

```powershell
npx prisma migrate deploy
```

## Запуск миграций на Render.com — рекомендации

1. Не добавляйте SHADOW_DATABASE_URL на бесплатном плане Render — shadow DB не всегда доступен. Вместо этого используйте `prisma migrate deploy` в процессе развертывания.
2. В Render Dashboard -> Service -> Environment -> добавьте `DATABASE_URL` (Postgres) — Render выдаёт строку подключения для вашего Postgres add-on.
3. В разделе Build / Start commands:
   - Build Command (если у вас есть Node-сервис): `npm ci && npm run build || true`
   - Start Command: `npx prisma migrate deploy && npm run start` — это применит миграции перед запуском.

Альтернативный (без Node в основном приложении): создайте отдельный Render Job / Service "migrations" или добавьте "deploy hook" (Post-deploy script) который вызывает `npx prisma migrate deploy` в приватном репозитории/сервисе с установленным Node и правами на DATABASE_URL. Это изолирует миграции и не смешивает с Python runtime.

## Seed и перенос данных

- Если вы создаёте новую схему и нужно перенести данные: экспортируйте данные из старой БД (pg_dump или SELECT в CSV) и сделайте импорты после применения миграций. Для сложных трансформаций лучше написать скрипт на Python или Node, который подключится к БД и перенесёт/нормализует данные.
- Если вы использовали `prisma db pull`, `schema.prisma` уже отражает текущую структуру — тогда миграции можно пометить как baseline, чтобы Prisma не пытался пересоздать таблицы.

## Использование Prisma Client (Node/TS) — пример

Простой пример в JS/TS после `npx prisma generate`:

```js
// example/prisma-example.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const teams = await prisma.team.findMany({ take: 10 });
  console.log('Teams:', teams);

  // Создать игрока
  const player = await prisma.player.create({ data: { firstName: 'Ivan', lastName: 'Ivanov' } });
  console.log('Player created', player.id);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
```

Если вы не хотите добавлять Node-сервис в основной кодовую базу, можно сделать небольшой `prisma/` подпроект, который будет содержать только миграции, `schema.prisma` и скрипты для одноразовых задач (seed, миграции). Это безопасный и минималистичный путь.

## Использование Prisma из Python — варианты и предостережения

- `prisma-client-py` (пакет `prisma`) существует и позволяет генерировать Python-клиент из `schema.prisma`. Это отдельный проект (неофициальный относительно JS Prisma). Он может покрыть большинство CRUD сценариев, но может отличаться по функциональностью/производительности. Команда по использованию:

  - Установить: `pip install prisma` и `pip install prisma-client` (проверьте актуальное имя пакета в PyPI).
  - Сгенерировать клиент: `prisma generate` (JS CLI) или использовать инструменты клиента для python.

- Если критична зрелость и экосистема (миграции, генерация типов), лучше оставить Python/SQLAlchemy и использовать Prisma в виде отдельного Node-сервиса (API или worker) или полностью мигрировать бэкенд на Node/TS.

## Ручные миграции и ограничения

- Некоторые вещи, определённые в SQLAlchemy (например, CheckConstraint или сложные DEFAULT/ON UPDATE выражения), Prisma не создаёт автоматически. Рекомендуется:
  - Добавить raw SQL прямо в миграции (Prisma позволяет редактировать SQL-файлы миграций).
  - Или применить эти ограничения вручную через `npx prisma migrate dev` + правка SQL миграции перед её применения.

Пример добавления CHECK constraint для `match_events.minute` в миграции SQL:

```sql
ALTER TABLE match_events
ADD CONSTRAINT check_minute_range CHECK (minute >= 0 AND minute <= 120);
```

## Контроль версий миграций

- Храните папку `prisma/migrations` в репозитории.
- Для командной работы согласуйте стратегию: кто и когда запускает `prisma migrate dev` и кто применяет миграции в продакшен (`prisma migrate deploy`).

## Минимизация рисков при применении в продакшене

- Всегда делайте бэкап базы перед применением миграций: `pg_dump`.
- На больших таблицах избегайте операций, блокирующих таблицу (добавление NOT NULL без default и т.п.).
- Используйте `prisma migrate deploy` в продакшене — он не использует shadow DB и применяется последовательно.

## Полезные команды/скрипты для package.json (пример)

```json
{
  "scripts": {
    "prisma:init": "prisma init",
    "prisma:pull": "prisma db pull",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio"
  }
}

## Резюме и следующий шаг

- Если вы хотите — могу:
  1) Сгенерировать `prisma/schema.prisma` через интроспекцию прямо сейчас (нужен доступ к DATABASE_URL из окружения или вы можете временно прислать URL для локальной работы). Или
  2) Добавить `prisma/` подпроект с приведённой выше схемой и создать первую миграцию `init` в репозитории (локально), и затем показать, как запускать её на Render.

Выберите подход (интроспекция текущей БД или ручное создание новой схемы) и я выполню следующий шаг: либо выполню `prisma db pull`, либо добавлю стартовую структуру в папку `prisma/` и создам миграцию.

## Telegram WebApp: initData и получение данных пользователя

Рекомендуемый flow из официальной документации Telegram Web Apps:

- Клиент (Web App) получает `window.Telegram.WebApp.initData` (строка) и `initDataUnsafe` (объект).

Дополнение — текущая реализация в проекте

- Добавлена модель `User` в `prisma/schema.prisma` с полями: `id` (автоинкремент), `userId` (BigInt, `@map("user_id")`), `tgUsername` (`@map("tg_username")`), `photoUrl` (`@map("photo_url")`), `createdAt` (`@map("created_at")`), `updatedAt` (`@map("updated_at")`).
- Для локальной разработки была создана отдельная локальная схема `prisma/schema.local.prisma` и применена миграция к локальной sqlite базе `prisma/dev.db`. В продакшне используется Postgres и миграции следует применять с `prisma migrate deploy`.

Хранение времён и отображение

- В базе все временные метки сохраняются в UTC (тип DateTime). Для отображения в UI используется форматирование в МСК (UTC+3) и формат `dd.MM.yyyy`.

Security / initData verification

- Сервер реализует проверку `initData` согласно документации Telegram: сортировка параметров по ключу, построение `data_check_string`, вычисление `secret_key = SHA256(TELEGRAM_BOT_TOKEN)` и сравнение HMAC-SHA256. После валидного входа сервер создаёт/обновляет запись `User` и возвращает JWT. JWT может быть установлен в httpOnly cookie (если fastify-cookie активен) и также возвращается в JSON для fallback (frontend сохраняет в localStorage при отсутствии cookie).

Dev notes — Redis и realtime

- Реализация realtime: WebSocket endpoint на `/realtime` и серверная интеграция с Redis pub/sub для доставки сообщений между инстансами. Для локальной отладки требуется запущенный Redis (по умолчанию `redis://127.0.0.1:6379`) или указать `REDIS_URL`.
- Если Redis не доступен, сервер логирует `ECONNREFUSED` и realtime не будет работать; HTTP и auth endpoints продолжают работать без Redis.

Команды полезные локально

```powershell
# если используете docker (рекомендуется для Redis локально)
docker run -d --name obnliga-redis -p 6379:6379 redis:7-alpine

# применить локальную миграцию (если используете sqlite локально)
npx prisma migrate dev --schema=prisma/schema.local.prisma --name add_users_local
npx prisma generate
```
- Никогда не доверяйте `initDataUnsafe` на сервере: сервер должен принять `initData` строку и проверить её целостность, используя shared secret (бот токен) и метод проверки hash, описанный в документации: `auth_date`, `id`, `username`, `photo_url` и `hash`.
- Сервер валидирует `initData` и затем создаёт/обновляет запись пользователя в БД (upsert по `user.id`).

Краткая инструкция серверу:

1. Клиент передаёт `initData` на endpoint, например `POST /api/auth/telegram-init { initData }`.
2. Сервер парсит `initData` в ключ:значение, формирует строку из параметров в алфавитном порядке и вычисляет HMAC-SHA256 с секретом `bot_token` (в документации есть точная формула). Сравнивает полученный hash с `hash` в initData.
3. При совпадении — считает данные валидными и может создать/обновить пользователя (tg user id, username, photo_url, auth_date).

Примечание по датам и часовому поясу:
- Во всех таблицах даты/время храним в UTC в типе DateTime. Для отображения пользователям используем приведение в МСК (UTC+3) и формат dd.mm.yyyy.
- На фронтенде в компоненте профиля применён простая коррекция +3 часа перед форматированием (см. `frontend/src/Profile.tsx`). Это достаточная мера для пользователей из России, но лучше делать форматирование на клиенте с Intl.DateTimeFormat и указанием 'Europe/Moscow' при наличии серверной поддержки часовых поясов.

