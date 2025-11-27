# Настройка уведомлений через cron-job.org

Для корректной работы системы уведомлений о матчах необходимо настроить внешний cron-сервис, который будет периодически вызывать эндпоинт обработки очереди уведомлений.

## Требования

- Аккаунт на [cron-job.org](https://cron-job.org) (бесплатный тариф поддерживает до 50 заданий)
- Развёрнутый backend с доступом по HTTPS
- Секретный ключ `CRON_SECRET` (добавить в переменные окружения)

## Переменные окружения

Добавьте в `.env` файл backend'а:

```env
CRON_SECRET=ваш-секретный-ключ-минимум-32-символа
```

Сгенерировать случайный ключ можно командой:
```powershell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()))
```

Или на bash:
```bash
openssl rand -base64 48
```

## Настройка задания на cron-job.org

### 1. Создайте аккаунт

Перейдите на [cron-job.org](https://cron-job.org/en/signup/) и зарегистрируйтесь.

### 2. Создайте новое задание (Cronjob)

1. Нажмите **Create cronjob**
2. Заполните поля:

| Поле | Значение |
|------|----------|
| **Title** | OBNLIGA Notifications |
| **URL** | `https://ваш-домен.com/api/cron/notifications` |
| **Execution schedule** | Every 1 minute |
| **Request method** | GET |
| **Request timeout** | 30 seconds |

### 3. Добавьте заголовок авторизации

В разделе **Advanced** → **Request headers** добавьте:

| Header | Value |
|--------|-------|
| `X-Cron-Secret` | Ваш `CRON_SECRET` из переменных окружения |

### 4. Настройки уведомлений (опционально)

В разделе **Notifications** можно включить:
- **Failure notification** — получать email при ошибках
- **Success notification** — получать email при успешном выполнении (не рекомендуется для частых заданий)

### 5. Сохраните задание

Нажмите **Create** или **Save**.

## Проверка работы

### Проверка эндпоинта вручную

```powershell
# Windows PowerShell
$headers = @{ "X-Cron-Secret" = "ваш-секретный-ключ" }
Invoke-RestMethod -Uri "https://ваш-домен.com/api/cron/notifications" -Headers $headers
```

```bash
# Linux/Mac
curl -H "X-Cron-Secret: ваш-секретный-ключ" https://ваш-домен.com/api/cron/notifications
```

### Проверка статистики

```powershell
$headers = @{ "X-Cron-Secret" = "ваш-секретный-ключ" }
Invoke-RestMethod -Uri "https://ваш-домен.com/api/cron/notifications/stats" -Headers $headers
```

### Ожидаемый ответ

```json
{
  "ok": true,
  "processed": 0,
  "sent": 0,
  "failed": 0,
  "skipped": 0
}
```

## Эндпоинты Cron API

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/cron/notifications` | Обработка очереди уведомлений |
| GET | `/api/cron/notifications/stats` | Статистика очереди |
| DELETE | `/api/cron/notifications/cleanup` | Очистка старых записей (7+ дней) |

## Рекомендуемый график

| Задание | Интервал | Описание |
|---------|----------|----------|
| Обработка очереди | Каждую минуту | Отправка запланированных уведомлений |
| Очистка старых | Раз в день | Удаление записей старше 7 дней |

### Очистка старых записей

Создайте дополнительное задание для очистки:

| Поле | Значение |
|------|----------|
| **Title** | OBNLIGA Cleanup Notifications |
| **URL** | `https://ваш-домен.com/api/cron/notifications/cleanup` |
| **Execution schedule** | Daily at 04:00 |
| **Request method** | DELETE |

Не забудьте добавить заголовок `X-Cron-Secret`.

## Безопасность

- **Никогда** не коммитьте `CRON_SECRET` в репозиторий
- Используйте разные секреты для development и production
- Рекомендуемая длина секрета: минимум 32 символа
- При подозрении на утечку — немедленно смените секрет

## Отладка

### Логи на cron-job.org

В разделе **History** каждого задания можно посмотреть:
- Статус ответа (200, 403, 500 и т.д.)
- Время выполнения
- Тело ответа

### Типичные ошибки

| Код | Причина | Решение |
|-----|---------|---------|
| 403 | Неверный `X-Cron-Secret` | Проверьте совпадение с `CRON_SECRET` в .env |
| 500 | Ошибка сервера | Проверьте логи backend'а |
| Timeout | Долгая обработка | Увеличьте timeout или проверьте базу данных |

## Render.com

Если backend размещён на Render.com, URL будет выглядеть примерно так:
```
https://obnliga-backend.onrender.com/api/cron/notifications
```

> ⚠️ На бесплатном тарифе Render сервис может "засыпать". Cron-запросы будут его будить, но первый запрос может занять до 30 секунд.

## Альтернативные сервисы

Помимо cron-job.org можно использовать:
- [EasyCron](https://www.easycron.com/)
- [Cron-to-Go](https://www.crontogo.com/) (для Heroku)
- GitHub Actions (scheduled workflows)
- Внутренний cron сервера (если есть доступ к серверу)
