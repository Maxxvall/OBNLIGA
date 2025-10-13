import { timingSafeEqual } from 'crypto'

export const secureEquals = (left: string, right: string): boolean => {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) {
    return false
  }
  return timingSafeEqual(leftBuf, rightBuf)
}
