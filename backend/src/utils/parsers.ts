export const parseNumericId = (value: string | number | undefined, field: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${field}_invalid`)
  }
  return numeric
}

export const parseBigIntId = (
  value: string | number | bigint | undefined,
  field: string
): bigint => {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    return BigInt(value ?? '')
  } catch (err) {
    throw new Error(`${field}_invalid`)
  }
}

export const parseOptionalNumericId = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return parseNumericId(value as number, field)
}
