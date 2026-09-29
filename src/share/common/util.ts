import detectOs from 'licia/detectOs'

export function isDev() {
  // @ts-ignore
  return import.meta.env.MODE === 'development'
}

export function getPlatform() {
  const os = detectOs()
  if (os === 'os x') {
    return 'mac'
  }
  return os
}
