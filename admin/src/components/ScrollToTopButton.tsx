import { useEffect, useState } from 'react'

export const ScrollToTopButton = () => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleScroll = () => {
      const { scrollHeight, clientHeight } = document.documentElement
      const totalScrollable = scrollHeight - clientHeight
      if (totalScrollable <= 0) {
        setVisible(false)
        return
      }
      setVisible(window.scrollY >= totalScrollable / 3)
    }

    handleScroll()

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [])

  if (typeof window === 'undefined') {
    return null
  }

  return (
    <button
      type="button"
      className={`scroll-to-top${visible ? ' visible' : ''}`}
      aria-label="Вернуться наверх"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M8 3.333 2.667 8.667l1.2 1.2L7 6.733V13h2V6.733l3.133 3.134 1.2-1.2z"
          fill="currentColor"
        />
      </svg>
    </button>
  )
}
