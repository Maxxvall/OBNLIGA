# Исправление settlement для прогнозов

**Дата**: 2025-11-30

## Проблема

После внедрения экспресс-прогнозов, при завершении матча:
- Одинарные прогнозы (PredictionEntry) оставались в статусе PENDING
- Элементы экспрессов (ExpressBetItem) оставались в статусе PENDING
- Экспрессы (ExpressBet) не рассчитывались

## Диагностика

При анализе данных в Prisma Studio обнаружено:
- Match 21 (FINISHED 1:0) имел 2 PENDING PredictionEntry и 2 PENDING ExpressBetItem
- Match 22 (FINISHED 0:2) имел 2 PENDING ExpressBetItem
- Match 81 (FINISHED 3:3) имел 1 PENDING PredictionEntry

Код settlement (`predictionSettlement.ts`, `expressService.ts`) был проверен и работал корректно при ручном запуске.

## Вероятная причина

Settlement не запускался автоматически из-за отсутствия логирования и невозможности отследить причину. Возможные причины:
1. Ошибка в транзакции которая откатывалась без логирования
2. `handleMatchFinalization` не вызывалась при изменении статуса матча

## Решение

### 1. Добавлено детальное логирование

**matchAggregation.ts**:
- Логирование при старте `handleMatchFinalization`
- Логирование загруженного матча с его статусом и счётом
- Логирование количества найденных шаблонов и pending entries
- Логирование результата settlement

### 2. Добавлен админский endpoint для ручного re-settlement

**adminRoutes.ts**:
```typescript
POST /api/admin/matches/:matchId/resettle
```

Позволяет администратору вручную перезапустить settlement для завершенного матча если что-то пошло не так.

### 3. Ручной settlement был выполнен

Все pending прогнозы на завершенных матчах были обработаны:
- Match 21: 2 entries → WON/LOST, 2 express items → LOST/WON
- Match 22: 2 express items → LOST, Express 2 → LOST
- Match 81: 1 entry → WON

## Измененные файлы

1. `backend/src/services/matchAggregation.ts`
   - Добавлено логирование в `handleMatchFinalization`
   - Добавлено логирование в `updatePredictions`

2. `backend/src/routes/adminRoutes.ts`
   - Добавлен POST `/api/admin/matches/:matchId/resettle`

## Рекомендации

1. При возникновении проблем с settlement проверять логи сервера
2. Использовать endpoint `/resettle` для ручного перезапуска settlement
3. Мониторить логи на наличие ошибок в `handleMatchFinalization`
