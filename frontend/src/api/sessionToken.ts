const SESSION_STORAGE_KEY = 'session'
const SESSION_COOKIE_NAME = 'session'

export const readSessionToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const storedToken = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (storedToken && storedToken.length > 0) {
    return storedToken
  }

  if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
    return null
  }

  const cookieValue = document.cookie
    .split(';')
    .map(chunk => chunk.trim())
    .find(chunk => chunk.startsWith(`${SESSION_COOKIE_NAME}=`))

  if (!cookieValue) {
    return null
  }

  const token = cookieValue.slice(`${SESSION_COOKIE_NAME}=`.length)
  return token.length > 0 ? decodeURIComponent(token) : null
}

export const authHeader = (): Record<string, string> | undefined => {
  const token = readSessionToken()
  if (!token) {
    return undefined
  }
  return { Authorization: `Bearer ${token}` }
}
