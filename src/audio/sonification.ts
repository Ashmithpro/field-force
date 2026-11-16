import type { DatasetKey, WeatherMode } from '../types'

const beepDuration = 0.42
export const mapSoundDurationMs = beepDuration * 1000
let audioContext: AudioContext | null = null
let activeSources: AudioScheduledSourceNode[] = []
let playRequest = 0
let activeOutputGain: GainNode | null = null
let outputVolume = 0.8

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null
  audioContext ??= new window.AudioContext()
  return audioContext
}

/** Call directly from a click handler so browsers allow the later data sound. */
export function unlockMapSound(): void {
  const context = getAudioContext()
  if (context?.state === 'suspended') void context.resume().catch(() => undefined)
}

export function pauseMapSound(): void {
  if (audioContext?.state === 'running') void audioContext.suspend().catch(() => undefined)
}

export function resumeMapSound(): void {
  const context = getAudioContext()
  if (context?.state === 'suspended') void context.resume().catch(() => undefined)
}

export function stopMapSound(): void {
  playRequest += 1
  if (audioContext) {
    for (const source of activeSources) {
      try { source.stop(audioContext.currentTime) } catch { /* It has already finished. */ }
    }
  }
  activeSources = []
  activeOutputGain = null
}

export function setMapSoundVolume(volume: number): void {
  outputVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.8))
  if (audioContext && activeOutputGain) {
    activeOutputGain.gain.setTargetAtTime(outputVolume, audioContext.currentTime, 0.025)
  }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function readingLevel(dataset: DatasetKey, mode: WeatherMode, value: number, windSpeed?: number): number {
  if (dataset === 'weather') {
    if (mode === 'storm') return clamp((value + (windSpeed ?? 0)) / 30)
    return clamp(value / 20)
  }
  if (dataset === 'temperature') return clamp((value + 2) / 4)
  if (['ocean', 'land-temperature', 'air-temperature', 'min-air-temperature', 'max-air-temperature', 'wet-bulb-temperature', 'dew-point'].includes(dataset)) {
    return clamp((value + 10) / 50)
  }
  if (dataset === 'snow' || dataset === 'humidity' || dataset === 'cloud-cover') return clamp(value / 100)
  if (dataset === 'vegetation') return clamp(value)
  if (dataset === 'productivity') return clamp(value / 0.4)
  if (dataset === 'transpiration-energy' || dataset === 'longwave-radiation') return clamp(value / 35)
  if (dataset === 'solar-radiation') return clamp(value / 30)
  if (dataset === 'co2') return clamp((value - 380) / 120)
  if (dataset === 'aerosol-depth') return clamp(value / 0.8)
  if (dataset === 'surface-pressure') return clamp((value - 80) / 26)
  if (dataset === 'wind-speed-2m') return clamp(value / 15)
  if (dataset === 'specific-humidity') return clamp(value / 20)
  if (dataset === 'precipitable-water') return clamp(value / 5)
  if (dataset === 'soil-wetness') return clamp(value)
  if (dataset === 'land-evaporation') return clamp(value / 8)
  return clamp(value / 100)
}

function renderBeep(context: AudioContext, dataset: DatasetKey, mode: WeatherMode, value: number, windSpeed?: number): void {
  for (const source of activeSources) {
    try { source.stop(context.currentTime) } catch { /* It has already finished. */ }
  }
  activeSources = []

  const start = context.currentTime + 0.015
  const end = start + beepDuration
  const level = readingLevel(dataset, mode, value, windSpeed)
  const frequency = 420 + level * 520
  const oscillator = context.createOscillator()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.025, start + beepDuration * 0.52)

  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(0.17, start + 0.012)
  envelope.gain.setValueAtTime(0.17, end - 0.095)
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)

  const output = context.createGain()
  output.gain.setValueAtTime(outputVolume, start)
  oscillator.connect(envelope).connect(output).connect(context.destination)
  oscillator.start(start)
  oscillator.stop(end)
  activeSources = [oscillator]
  activeOutputGain = output
}

/** Play a short data-pitched beep after the clicked point has loaded. */
export function playMapReadingSound(dataset: DatasetKey, mode: WeatherMode, value: number, windSpeed?: number): void {
  const context = getAudioContext()
  if (!context || !Number.isFinite(value)) return
  const request = ++playRequest
  void context.resume().then(() => {
    if (request === playRequest) renderBeep(context, dataset, mode, value, windSpeed)
  }).catch(() => undefined)
}
