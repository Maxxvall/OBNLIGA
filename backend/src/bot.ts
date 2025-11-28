import { Bot, BotError, Context } from 'grammy'
import dotenv from 'dotenv'

dotenv.config({ path: `${__dirname}/../.env` })

const token = process.env.TELEGRAM_BOT_TOKEN
const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173'

let botInstance: Bot | null = null

const extractTelegramErrorCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const direct = (error as { error_code?: unknown }).error_code
  if (typeof direct === 'number') {
    return direct
  }
  const nested = (error as { error?: unknown }).error
  if (nested && typeof nested === 'object') {
    const nestedCode = (nested as { error_code?: unknown }).error_code
    if (typeof nestedCode === 'number') {
      return nestedCode
    }
  }
  return undefined
}

if (token) {
  botInstance = new Bot(token)

  // Global error catcher for grammy — prevents unhandled rejections from crashing the process.
  botInstance.catch((err: BotError<Context>) => {
    // err is a GrammyError wrapper; original error info available at err.error
    try {
      const code = extractTelegramErrorCode(err.error)
      if (code === 409) {
        // Conflict: another getUpdates instance is running (common on PaaS). Log and ignore.
        console.warn(
          'Telegram getUpdates conflict (409) — another bot instance likely running. Ignoring.'
        )
        return
      }
    } catch (e) {
      // ignore
    }
    console.error('Unhandled bot error', err)
  })

  botInstance.command('start', async ctx => {
    const name = ctx.from?.first_name || 'игрок'
    const keyboard = {
      inline_keyboard: [[{ text: 'Открыть Приложение', web_app: { url: webAppUrl } }]]
    } as const
    await ctx.reply(`Привет, ${name}! Добро пожаловать в Футбольную Лига.`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.reply('Нажмите кнопку, чтобы открыть Приложение:', { reply_markup: keyboard as any })
  })

  botInstance.on('message', async ctx => {
    if (ctx.message && 'text' in ctx.message) {
      const text = ctx.message.text
      if (text === '/help') {
        await ctx.reply('Отправьте /start чтобы получить ссылку на Приложение')
      } else {
        await ctx.reply('Я пока маленький бот — отправьте /start')
      }
    }
  })
} else {
  console.warn('TELEGRAM_BOT_TOKEN not set — bot will not start')
}

export const startBot = async () => {
  if (!botInstance) {
    console.warn('startBot: bot instance not configured (no token)')
    return
  }
  try {
    await botInstance.init()
    // Start polling but don't let an unhandled rejection bubble up: catch and log.
    botInstance
      .start()
      .then(() => {
        console.log('Telegram bot started (long polling)')
      })
      .catch(err => {
        // If getUpdates was claimed by another instance, it's safe to continue without crashing.
        const code = extractTelegramErrorCode(err)
        if (code === 409) {
          console.warn(
            'Telegram getUpdates conflict on start (409) — another instance running. Bot will not poll.'
          )
        } else {
          console.error('Bot start failed', err)
        }
      })
  } catch (err) {
    console.error('Failed to start bot', err)
  }
}
