/** Browser preferences should never prevent the observatory from rendering. */
export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function savePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Preferences are optional; keep the app usable if storage is unavailable.
  }
}

export function removePreference(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Reload recovery still works when the browser blocks storage access.
  }
}

