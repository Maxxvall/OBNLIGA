import { PrismaClient } from '@prisma/client'

// Стандартная инициализация Prisma Client.
// Не используем незнакомые конструкторные опции, чтобы сохранить совместимость
// с установленной версией `@prisma/client` в проекте.
const prisma = new PrismaClient()

export default prisma
