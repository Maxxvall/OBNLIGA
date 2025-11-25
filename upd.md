Цель: внедрить достижение "Streak" за ежедневный вход с уровнями (0/бронза/серебро/золото), компактной иконкой на фронте и начислением очков только в годовой сезон.

Коротко (факты):
- Уровни и пороги: 0 (locked), 1 — Bronze (7 дней), 2 — Silver (60 дней), 3 — Gold (180 дней).
- Иконки (путь): `frontend/public/achievements/streak-locked.png`, `streak-bronze.png`, `streak-silver.png`, `streak-gold.png`.
- Начисление очков: при достижении уровня начислять очки только в годовой сезон: lvl1 +20, lvl2 +200, lvl3 +1000.

Название достижения и уровни (футбольная тематика)
- Общее название (RU): **"Игровая серия — Ежедневный вход"** (коротко: "Игровая серия").
- Уровни (RU) — креативные, футбольные:
  - Уровень 0 (locked): **"Скамейка"** — пока не достигнут первый порог (иконка `streak-locked.png`).
  - Уровень 1 (Bronze, 7 дней): **"Запасной"** — бронзовая роль, первые шаги в серии (иконка `streak-bronze.png`).
  - Уровень 2 (Silver, 60 дней): **"Основной"** — игрок стартового состава, стабильность (иконка `streak-silver.png`).
  - Уровень 3 (Gold, 180 дней): **"Капитан"** — лидер, долгосрочная дисциплина и вклад (иконка `streak-gold.png`).

  Эти названия короткие, связаны с футбольной терминологией и хорошо читаются в UI рядом с иконкой.

  Короткий текст для UI: `Игровая серия — поддерживайте ежедневный вход и поднимайтесь от "Скамейки" до "Капитана".`

Требования/ограничения:
- Гарантировать идемпотентность начислений — не начислять дважды при гонках/ретраях.
- Минимизировать latency в пользовательском запросе `/api/users/me/daily-reward/claim` и/или `/api/checkin`.
- Обрабатывать нагрузки безопасно (Redis locking / atomic ops / фоновые воркеры).
- Сохранять совместимость с существующей схемой достижений (`AchievementType`, `AchievementLevel`, `UserAchievementProgress`, `UserAchievement`).

1) Изменения в базе данных (Prisma миграция)
- Создать новую таблицу логов начислений (idempotency + контекст сезона): `user_achievement_rewards`.
  Prisma-пример (schema snippet):

  model UserAchievementReward {
    id        BigInt   @id @default(autoincrement()) @map("user_achievement_reward_id")
    userId    Int      @map("user_id")
    group     String   @map("group") // e.g. 'streak'
    tier      Int      @map("tier")
    seasonId  Int?     @map("season_id") // если null — глобально
    points    Int      @map("points")
    createdAt DateTime @default(now()) @map("created_at")

    user AppUser @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@unique([userId, group, tier, seasonId], name: "user_achievement_reward_unique")
    @@map("user_achievement_rewards")
  }

2) Backend — логика выдачи и архитектура (подход для render.com без платных воркеров)
- Общая идея: не выполнять тяжёлые начисления синхронно в HTTP handler, но и не требовать платных background-сервисов. Для render.com и небольшой нагрузки используем DB-backed очередь + opportunistic processing:
  1) Быстрый путь: при `claimDailyReward` и/или `incrementAchievementProgress` определить, что уровень разблокирован (unlockedLevel > currentLevel). В транзакции обновить `userAchievementProgress.currentLevel` и вставить запись в таблицу задач `achievement_jobs` (см. ниже). Не выполнять тяжёлое начисление в основном запросе.
  2) Таблица задач `achievement_jobs` (DB): хранит job payload JSON, статус (`pending`, `processing`, `done`, `failed`), attempts, createdAt. Запись job — дешёвая операция в БД и не требует внешних сервисов.
  3) Opportunistic processor: реализация обработки job'ов без отдельного платного воркера:
     - На каждом `claim` или другом активном запросе (или при заходе в админку) вызывается `processPendingAchievementJobs(limit)` — функция пытается обработать небольшой батч (например, 5–20) задач в фоне в том же процессе сервера.
     - Внутри `processPendingAchievementJobs` использовать транзакцию + `SELECT ... FOR UPDATE SKIP LOCKED` или `UPDATE ... RETURNING` чтобы атомарно «захватить» ряд job'ов и пометить их как `processing` (или использовать Postgres advisory locks). Это предотвращает гонки между параллельными инстансами.
     - Для каждого захваченного job'а в транзакции выполнить idempotent upsert в `user_achievement_rewards` (unique по user, group, tier, seasonId). Если upsert создал новую запись → создать `adminPointAdjustment`/увеличить рейтинг и пометить job как `done`.
     - Если обработка занимает немного времени (несколько миллисекунд/сотен) — это допустимо при низкой нагрузке; при увеличении нагрузки можно расширить стратегию (см. рекомендации ниже).

Пояснение: этот подход работает на render.com при 1–100 активных пользователей в день: нет необходимости платить за отдельный воркер, всё работает на обычных HTTP-инстансах, при этом DB обеспечивает устойчивость задач.

Где менять код:
  - `backend/src/services/achievementProgress.ts`: при `unlockedLevel > progress.currentLevel` — обновить progress и вставить строку в `achievement_jobs` (payload с userId, group, tier, points, seasonId). Не ждать обработки.
  - `backend/src/services/dailyRewards.ts`: оставить вызов `incrementAchievementProgress` — он создаёт job при разблокировании.
  - `backend/src/routes/userRoutes.ts`: `claimDailyReward` возвращает результат сразу; перед ответом можно опционально вызвать `processPendingAchievementJobs` с малым лимитом, но не блокировать основной поток надолго.
  - `backend/src/routes/adminRoutes.ts`: реализовать endpoint `POST /api/admin/process-achievement-jobs` чтобы вручную запускать обработку (админ может вызвать из UI). Также `recomputeAchievementsForType` переписать на set-based SQL / батчи.

Дополнительно: реализация `processPendingAchievementJobs` должна учитывать таймауты и попытки (attempts) — при ошибках делать incremental backoff и помечать job как `failed` после N попыток.

3) Redis locking / atomic increment (защита от гонок)
- Для `POST /claim` использовать либо:
  - `SETNX lock:checkin:{userId} <token> PX 3000` + проверка; либо
  - Lua-скрипт, исполняющий атомарную логику: проверить lastDate, инкрементить count, вернуть newCount и флаг unlock.

4) Recompute / Admin bulk operations
- Не делать full-scan в памяти; для `TOTAL_PREDICTIONS`/`CORRECT_PREDICTIONS` использовать set-based SQL, например:

  INSERT INTO user_achievement (user_id, achievement_type_id, achieved_date)
  SELECT p.user_id, :achievementTypeId, now()
  FROM (
    SELECT user_id, COUNT(*) as cnt FROM prediction GROUP BY user_id HAVING COUNT(*) >= :requiredValue
  ) p
  LEFT JOIN user_achievement ua ON ua.user_id = p.user_id AND ua.achievement_type_id = :achievementTypeId
  WHERE ua.user_id IS NULL;

5) Фронтенд — отображение компактной иконки и поведение в профиле
- Иконки: `frontend/public/achievements/streak-locked.png`, `streak-bronze.png`, `streak-silver.png`, `streak-gold.png`.
- Поведение: показывать иконку по `currentLevel` (0..3). Размер ~40x40, иконка высокого уровня заменяет/перекрывает предыдущую.

Layout в профиле (существующая вкладка «Достижения»):
- Карточки: компактные аккуратные блоки, в каждом — иконка сверху и шкала прогресса под ней.
- Сетка: по 2 карточки в строке.
- Пагинация/ленивая загрузка: показываем первые 4 карточки (2 строки). Под ними — кнопка `Ещё`.
  - При нажатии `Ещё` загружаем следующие 4 карточки и так далее (батчами по 4).
  - Это ограничит начальную нагрузку на API и улучшит TTI.

Минимальный API-пэйлоуд для первичной ленты (экономичный запрос):
- Путь: `GET /api/users/me/achievements?limit=4&offset=0&summary=true`
- Поля (минимум): `achievementId, group, currentLevel, currentProgress, nextThreshold, iconSrc, shortTitle`.
  - Эти поля позволяют быстро отрисовать иконку и прогресс без загрузки лишних деталей.

Поведение при клике на иконку (modal):
- При клике на карточку делаем отдельный запрос за полной информацией: `GET /api/users/me/achievements/:id`.
  - Полный пэйлоуд включает: `fullDescription, createdAt, unlockedAt, history (последние N событий), currentProgress, thresholds[] (с уровнями и очками), seasonContext`.
- Модальное окно отображает:
  - Крупная иконка достижения и футбол-ярусный заголовок (например, `Капитан`).
  - Текущее состояние: "Сегодня: X дней подряд" (или другое численное значение).
  - Что требуется до следующего уровня: "Нужно Y дней" (или "Вы уже на максимуме").
  - Список уровней/порогов и что даёт каждый уровень (коротко: +20 / +200 / +1000 очков — только в годовой сезон).
  - Кнопки/действия: `Закрыть`, опционально — `Поделиться` или `Подробнее`.

Как минимум реализовать модальное поведение без грузного стейта в главном запросе:
- Первичный запрос возвращает summary.
- При открытии модала делаем отдельный fetch (SWR/React Query) и показываем skeleton, пока идёт загрузка.

Оптимистические UI-обновления и инвалидация кеша:
- Когда пользователь получает награду (например, при claim), делаем локальное обновление summary (увеличить `currentLevel`/`currentProgress`) и сразу показывать обновлённую иконку.
- После подтверждения на сервере инвалидируем SWR/ETag кэш: `fetchMyAchievements()` и рейтинг.

Доступность и UX:
- Иконки с `alt`-текстом: `alt="Игровая серия — ${shortTitle}"`.
- Модал должен быть фокус-трапом (focus trap) и иметь aria-метки: `aria-labelledby`, `aria-describedby`.
- Клавиатурная и сенсорная навигация: карточки кликабельны и имеют `role="button"`.

Код-псевдо (рисунок поведения):

const levelToIcon = (level) => {
  switch (level) {
    case 0: return '/achievements/streak-locked.png'
    case 1: return '/achievements/streak-bronze.png'
    case 2: return '/achievements/streak-silver.png'
    case 3: return '/achievements/streak-gold.png'
    default: return '/achievements/streak-locked.png'
  }
}

// Render: grid of 2 columns, limit initial 4
<div className="achievements-grid">
  {achievements.map(a => (
    <div key={a.achievementId} role="button" onClick={() => openModal(a.achievementId)} className="achievement-card">
      <img src={levelToIcon(a.currentLevel)} alt={`Игровая серия — ${a.shortTitle}`} width={40} height={40} />
      <div className="progress-row">
        <div className="progress-bar" style={{ width: `${Math.min(100, Math.round(a.currentProgress / a.nextThreshold * 100))}%` }} />
      </div>
      <div className="level-label">{levelName(a.currentLevel)}</div>
    </div>
  ))}
</div>
<button onClick={loadMore}>Ещё</button>

При открытии модала:
- fetch(`/api/users/me/achievements/${id}`) — показать skeleton → подставить реальные значения.

Кэш и сетевые оптимизации:
- На стороне клиента использовать SWR/React Query с ETag, чтобы primary-list был максимально лёгким, а детали — запрашивались по-need.
- Серверные эндпоинты должны поддерживать `?summary=true` и возвращать минимальный набор полей.

Это позволяет:
- экономить пропускную способность и снизить latency на главной вкладке профиля;
- показывать быстрый отзыв пользователю и запрашивать тяжёлые данные только при необходимости;
- поддерживать пагинацию/ленивую подгрузку (батчи по 4) для масштабирования.

5.1) Анимация при получении уровня (праздничный момент)
- Цель: воспроизвести праздничную анимацию ровно один раз при получении нового уровня (7/60/180 дней), показать увеличенную иконку, конфетти и поздравление.

Триггер и вариант хранения состояния:
- Серверный (рекомендуется): при создании строки в `user_achievement_rewards` сохранять `notified = false`.
  - API `GET /api/users/me/achievements?summary=true` может возвращать для каждой записи поле `shouldPlayAnimation: true` если связанный reward имеет `notified = false` и `createdAt` в разумном окне (например, 24 часа).
  - После показа фронтенд вызывает `POST /api/users/me/achievements/:rewardId/mark-notified`, сервер выставляет `notified = true`.
- Клиентский (fallback): пометить в `localStorage` ключ `achievement_anim_shown:{rewardId}` — если ключ есть, не показывать повторно.

UX/поведение анимации:
- В момент получения анимация должна:
  - показать overlay поверх UI (полупрозрачный тёмный фон) с фокус-трапом;
  - в центре — увеличенная иконка достижения (примерно 120x120), с анимацией `transform: scale(0.8) -> scale(1.4) -> scale(1)` и плавным easing;
  - рядом/под иконкой — заголовок `Поздравляем!` и подпись `Вы достигли уровня "${levelName}" — +{points} очков (в сезон)`;
  - запустить лёгкую конфетти-анимацию (например, `canvas-confetti`) или CSS/SVG-эффекты; на слабых устройствах конфетти упрощать или отключать.

- Завершение анимации:
  - по таймауту (например, 5–6 секунд) — автоматически скрыть overlay;
  - при клике в любом месте overlay — немедленно завершить анимацию и скрыть;
  - после первого показа фронтенд помечает запись как показанную (через API или `localStorage`).

Технические рекомендации:
- Использовать `canvas-confetti` или лёгкую SVG-анимацию; предоставлять конфигурацию для уменьшения эффекта на мобильных устройствах.
- Анимация должна быть non-blocking и не мешать основному UI — overlay поверх, но без остановки фоновых операций.
- Для кросс-девайс согласованности лучше пометить `notified` на сервере сразу после показа.

6) Начисление очков только в годовой сезон
- Определять `seasonId` (если есть модель `Season`) или вычислять calendarYear.
- В воркере при создании `UserAchievementReward` создавать `adminPointAdjustment` с delta = points, и помечать reason/metadata о сезонности.

7) ETag/кеш-инвалидация
- После успешного начисления воркер должен инвалидировать:
  - `defaultCache.invalidate(user:achievements:${telegramId})`
  - `defaultCache.invalidate(user:rating:${userId})` и публичные рейтинги.


9) Пример job payload
  {
    type: 'achievement_reward',
    userId: 123,
    group: 'streak',
    tier: 2,
    points: 200,
    seasonId: 2025
  }

