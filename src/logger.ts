/**
 * Simple logger utility with timestamp support
 */

/**
 * Format current timestamp for logs
 */
const getTimestamp = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  
  return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}]`
}

/**
 * Log levels
 */
export const logger = {
  log: (...args: unknown[]): void => {
    console.log(getTimestamp(), ...args)
  },
  
  error: (...args: unknown[]): void => {
    console.error(getTimestamp(), ...args)
  },
  
  warn: (...args: unknown[]): void => {
    console.warn(getTimestamp(), ...args)
  },
  
  info: (...args: unknown[]): void => {
    console.info(getTimestamp(), ...args)
  },
  
  debug: (...args: unknown[]): void => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(getTimestamp(), ...args)
    }
  },
}

// Export as default for convenience
export default logger