# Анализ системы уведомлений и подписок на матчи

**Дата:** 27 ноября 2025  
**Статус:** Анализ и проектирование

---

## 1. Описание функционала

Пользователи смогут:
1. **Подписаться на команду** — получать уведомления о всех матчах любимой команды
2. **Подписаться на конкретный матч** — разовое напоминание перед началом
3. **Настроить время напоминания** — за 30 мин, 1 час, 1 день до начала

Уведомления приходят **в Telegram** через бота (Telegram Bot API).

---

## 2. Архитектура решения

### 2.1 Схема БД (Prisma)

```prisma
// Подписки на команды
model ClubSubscription {
  id        Int      @id @default(autoincrement())
  userId    Int
  clubId    Int
  createdAt DateTime @default(now())
  
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  club      Club     @relation(fields: [clubId], references: [id], onDelete: Cascade)
  
  @@unique([userId, clubId])
  @@index([clubId])
}

// Подписки на конкретные матчи
model MatchSubscription {
  id        Int      @id @default(autoincrement())
  userId    Int
  matchId   BigInt
  createdAt DateTime @default(now())
  
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  match     Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  
  @@unique([userId, matchId])
  @@index([matchId])
}

// Настройки уведомлений пользователя
model NotificationSettings {
  id                  Int      @id @default(autoincrement())
  userId              Int      @unique
  enabled             Boolean  @default(true)
  remindBefore        Int      @default(30) // минуты до матча
  matchStartEnabled   Boolean  @default(true)
  matchEndEnabled     Boolean  @default(false)
  goalEnabled         Boolean  @default(false)
  
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Очередь уведомлений (для отложенной отправки)
model NotificationQueue {
  id            Int      @id @default(autoincrement())
  userId        Int
  telegramId    BigInt
  matchId       BigInt
  scheduledAt   DateTime // когда отправить
  sentAt        DateTime? // когда реально отправлено
  status        NotificationStatus @default(PENDING)
  messageType   NotificationMessageType
  errorMessage  String?
  retryCount    Int      @default(0)
  createdAt     DateTime @default(now())
  
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  match         Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  
  @@index([status, scheduledAt])
  @@index([userId])
  @@index([matchId])
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}

enum NotificationMessageType {
  MATCH_REMINDER   // напоминание перед матчем
  MATCH_STARTED    // матч начался
  MATCH_FINISHED   // матч завершён
  GOAL_SCORED      // забит гол (опционально)
}
```

### 2.2 API Endpoints

```typescript
// Подписки на команды
POST   /api/subscriptions/clubs/:clubId       // подписаться на команду
DELETE /api/subscriptions/clubs/:clubId       // отписаться от команды
GET    /api/subscriptions/clubs               // мои подписки на команды

// Подписки на матчи
POST   /api/subscriptions/matches/:matchId    // подписаться на матч
DELETE /api/subscriptions/matches/:matchId    // отписаться от матча
GET    /api/subscriptions/matches             // мои подписки на матчи

// Настройки уведомлений
GET    /api/notifications/settings            // получить настройки
PATCH  /api/notifications/settings            // обновить настройки
```

### 2.3 Сервис отправки уведомлений

```typescript
// backend/src/services/notificationService.ts

import TelegramBot from 'node-telegram-bot-api'

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!)

export async function sendMatchReminder(
  telegramId: bigint,
  match: MatchDetails,
  minutesBefore: number
): Promise<boolean> {
  const timeLabel = minutesBefore >= 60 
    ? `${Math.round(minutesBefore / 60)} ч.`
    : `${minutesBefore} мин.`
    
  const message = `⚽ Напоминание!\n\n` +
    `${match.homeClub.name} vs ${match.awayClub.name}\n` +
    `🏟 ${match.locationName || 'Место не указано'}\n` +
    `⏰ Начало через ${timeLabel}\n\n` +
    `Открыть матч: ${process.env.WEBAPP_URL}/match/${match.id}`

  try {
    await bot.sendMessage(telegramId.toString(), message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '📱 Открыть матч', web_app: { url: `${process.env.WEBAPP_URL}/match/${match.id}` } }
        ]]
      }
    })
    return true
  } catch (err) {
    console.error('Failed to send notification:', err)
    return false
  }
}
```

### 2.4 Cron Job для обработки очереди

**Варианты реализации:**

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **GitHub Actions (scheduled)** | Бесплатно, надёжно | Минимальный интервал 5 мин |
| **cron-job.org** | Бесплатно, интервал 1 мин | Внешняя зависимость |
| **setInterval в Node.js** | Точный тайминг | Падает при рестарте сервера |
| **BullMQ + Redis** | Надёжные delayed jobs | Требует Redis connections |

**Рекомендация:** Использовать **cron-job.org** (бесплатный tier, 1 мин интервал) + endpoint `/api/cron/notifications`

```typescript
// backend/src/routes/cronRoutes.ts

// Защита: проверяем секретный токен
fastify.get('/api/cron/notifications', async (request, reply) => {
  const cronSecret = request.headers['x-cron-secret']
  if (cronSecret !== process.env.CRON_SECRET) {
    return reply.status(401).send({ error: 'unauthorized' })
  }

  const now = new Date()
  const pendingNotifications = await prisma.notificationQueue.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: { lte: now }
    },
    take: 50, // batch size
    include: {
      match: { include: { homeClub: true, awayClub: true } },
      user: true
    }
  })

  let sent = 0
  let failed = 0

  for (const notification of pendingNotifications) {
    const success = await sendMatchReminder(
      notification.telegramId,
      notification.match,
      notification.messageType
    )

    await prisma.notificationQueue.update({
      where: { id: notification.id },
      data: {
        status: success ? 'SENT' : 'FAILED',
        sentAt: success ? now : undefined,
        retryCount: success ? undefined : { increment: 1 },
        errorMessage: success ? undefined : 'Failed to send'
      }
    })

    success ? sent++ : failed++
  }

  return { processed: pendingNotifications.length, sent, failed }
})
```

---

## 3. Логика создания уведомлений

### 3.1 При подписке на команду

```typescript
async function subscribeToClub(userId: number, clubId: number) {
  // 1. Создаём подписку
  await prisma.clubSubscription.create({
    data: { userId, clubId }
  })

  // 2. Находим предстоящие матчи этой команды
  const upcomingMatches = await prisma.match.findMany({
    where: {
      status: 'SCHEDULED',
      matchDateTime: { gt: new Date() },
      OR: [
        { homeClubId: clubId },
        { awayClubId: clubId }
      ]
    }
  })

  // 3. Создаём уведомления в очередь
  const settings = await getUserNotificationSettings(userId)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  
  for (const match of upcomingMatches) {
    const scheduledAt = new Date(match.matchDateTime)
    scheduledAt.setMinutes(scheduledAt.getMinutes() - settings.remindBefore)

    if (scheduledAt > new Date()) {
      await prisma.notificationQueue.create({
        data: {
          userId,
          telegramId: user.telegramId,
          matchId: match.id,
          scheduledAt,
          messageType: 'MATCH_REMINDER'
        }
      })
    }
  }
}
```

### 3.2 При создании нового матча (в админке)

```typescript
// В adminRoutes.ts после создания матча
async function scheduleNotificationsForMatch(matchId: bigint) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeClub: true, awayClub: true }
  })

  // Находим всех подписчиков на эти команды
  const subscribers = await prisma.clubSubscription.findMany({
    where: {
      clubId: { in: [match.homeClubId, match.awayClubId] }
    },
    include: {
      user: { include: { notificationSettings: true } }
    }
  })

  // Создаём уведомления для каждого
  for (const sub of subscribers) {
    const settings = sub.user.notificationSettings
    if (!settings?.enabled) continue

    const scheduledAt = new Date(match.matchDateTime)
    scheduledAt.setMinutes(scheduledAt.getMinutes() - (settings.remindBefore ?? 30))

    if (scheduledAt > new Date()) {
      await prisma.notificationQueue.upsert({
        where: {
          userId_matchId_messageType: {
            userId: sub.userId,
            matchId: match.id,
            messageType: 'MATCH_REMINDER'
          }
        },
        create: {
          userId: sub.userId,
          telegramId: sub.user.telegramId,
          matchId: match.id,
          scheduledAt,
          messageType: 'MATCH_REMINDER'
        },
        update: { scheduledAt }
      })
    }
  }
}
```

---

## 4. Оценка нагрузки

### 4.1 Сценарий: 500 пользователей, 20 матчей в неделю

| Ресурс | Нагрузка | Оценка |
|--------|----------|--------|
| **БД (записи)** | ~2000 подписок + ~10000 уведомлений/мес | ✅ Минимальная |
| **БД (запросы)** | ~200 SELECT/день (cron) | ✅ Минимальная |
| **Redis** | Не используется | ✅ Нет влияния |
| **Telegram API** | ~500 msg/день max | ✅ В пределах лимитов |
| **Сервер** | +1 cron запрос/мин | ✅ Незначительно |

### 4.2 Лимиты Telegram Bot API

- **30 сообщений/сек** в один чат
- **1 сообщение/сек** при массовой рассылке (разным пользователям)
- **Не более 20 сообщений/мин** в группы

**Вывод:** Для 500 пользователей лимиты не проблема.

### 4.3 Масштабирование (если 5000+ пользователей)

1. **Batch processing** — отправляем пачками по 30 msg/sec
2. **Rate limiter** — добавляем p-limit или bottleneck
3. **Retry queue** — повторная отправка при ошибках 429

---

## 5. UI в приложении

### 5.1 Страница команды — кнопка подписки

```tsx
// frontend/src/components/team/TeamView.tsx

const [isSubscribed, setIsSubscribed] = useState(false)

const handleSubscribe = async () => {
  if (isSubscribed) {
    await unsubscribeFromClub(clubId)
    setIsSubscribed(false)
  } else {
    await subscribeToClub(clubId)
    setIsSubscribed(true)
  }
}

return (
  <button 
    className={`subscribe-btn ${isSubscribed ? 'subscribed' : ''}`}
    onClick={handleSubscribe}
  >
    {isSubscribed ? '🔔 Подписан' : '🔕 Подписаться'}
  </button>
)
```

### 5.2 Настройки в профиле

```tsx
// frontend/src/components/NotificationSettings.tsx

<div className="notification-settings">
  <h3>🔔 Уведомления</h3>
  
  <label className="setting-row">
    <span>Включены</span>
    <input 
      type="checkbox" 
      checked={settings.enabled}
      onChange={e => updateSettings({ enabled: e.target.checked })}
    />
  </label>
  
  <label className="setting-row">
    <span>Напоминать за</span>
    <select 
      value={settings.remindBefore}
      onChange={e => updateSettings({ remindBefore: Number(e.target.value) })}
    >
      <option value={15}>15 минут</option>
      <option value={30}>30 минут</option>
      <option value={60}>1 час</option>
      <option value={1440}>1 день</option>
    </select>
  </label>
</div>
```

---

## 6. План реализации

### Фаза 1: MVP (2-3 дня)
- [ ] Схема БД + миграции
- [ ] API endpoints для подписок
- [ ] Сервис отправки через Telegram Bot
- [ ] Cron endpoint + настройка cron-job.org

### Фаза 2: UI (1-2 дня)
- [ ] Кнопка подписки на странице команды
- [ ] Настройки уведомлений в профиле
- [ ] Список подписок пользователя

### Фаза 3: Улучшения (по желанию)
- [ ] Уведомления о голах в реальном времени
- [ ] Уведомления о завершении матча
- [ ] Статистика отправленных уведомлений в админке

---

## 7. Риски и решения

| Риск | Вероятность | Решение |
|------|-------------|---------|
| Telegram блокирует бота за спам | Низкая | Rate limiting, opt-in |
| Пользователь отключил бота | Средняя | Обрабатываем 403 ошибку |
| Cron не успевает | Низкая | Увеличить batch size |
| Дубликаты уведомлений | Средняя | UNIQUE constraint + upsert |

---

## 8. Альтернативные подходы

### 8.1 Web Push (PWA)
- **Плюс:** Не зависит от Telegram
- **Минус:** Требует Service Worker, не все браузеры поддерживают
- **Вердикт:** Можно добавить как дополнение

### 8.2 Firebase Cloud Messaging
- **Плюс:** Надёжная инфраструктура
- **Минус:** Требует Firebase проект, усложняет setup
- **Вердикт:** Overkill для текущего масштаба

---

## 9. Заключение

Система уведомлений через Telegram Bot — **оптимальное решение** для мини-приложения внутри Telegram:

✅ **Нагрузка минимальная** — ~200 запросов/день к БД  
✅ **Redis не требуется** — очередь хранится в PostgreSQL  
✅ **Масштабируемо** — легко увеличить до 5000+ пользователей  
✅ **Простая реализация** — 2-3 дня на MVP  
✅ **Пользовательский опыт** — уведомления прямо в Telegram

**Рекомендуемый стек:**
- PostgreSQL для хранения подписок и очереди
- cron-job.org для scheduled tasks (бесплатно)
- Telegram Bot API для отправки сообщений
