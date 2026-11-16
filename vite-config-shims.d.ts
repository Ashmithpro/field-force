// Minimal declarations for Vite's Node-only API route fallback.
// Keeping these local avoids adding @types/node solely for this config.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: string[],
    options: { encoding: string; maxBuffer: number },
    callback?: (...args: unknown[]) => void,
  ): unknown
}

declare module 'node:util' {
  export function promisify<T extends (...args: any[]) => any>(fn: T): (...args: any[]) => Promise<any>
}

declare const process: { platform: string; env: Record<string, string | undefined> }
