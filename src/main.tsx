import { Component, StrictMode, Suspense, lazy, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight, ArrowUpDown, ArrowUpRight, Atom, ChevronDown, CloudRain, Compass, Database, Download, ExternalLink, Eye,
  Cloud, Droplets, Gauge, Info, Languages, Leaf, Maximize2, Pause, Play, RotateCcw, Search, Settings2, Share2, Shuffle, Snowflake, Sprout, Square, Sun, Thermometer, Volume2, Waves, Wind, X,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import WeatherControls from './components/WeatherControls'
import { mapSoundDurationMs, pauseMapSound, playMapReadingSound, resumeMapSound, setMapSoundVolume, stopMapSound, unlockMapSound } from './audio/sonification'
import { cityLocations, convertTemperatureValue, datasets, formatValue, weatherDefinitions, weatherLocations } from './data/datasets'
import { loadDataset, loadLatestPointAirTemperature } from './services/dataService'
import { LanguageProvider, languages, useLanguage } from './i18n'
import { readPreference, removePreference, savePreference } from './storage'
import type { DatasetKey, DatasetPayload, GeoPoint, Measurement, TemperatureUnit, WeatherMode } from './types'
import './styles.css'

const Earth = lazy(() => import('./components/Earth'))
const coreDatasetOrder: DatasetKey[] = ['temperature', 'weather', 'ocean', 'co2']
const powerAtmosphereOrder: DatasetKey[] = ['humidity', 'specific-humidity', 'precipitable-water', 'cloud-cover', 'solar-radiation', 'longwave-radiation', 'aerosol-depth', 'surface-pressure', 'wind-speed-2m']
const powerTemperatureOrder: DatasetKey[] = ['air-temperature', 'min-air-temperature', 'max-air-temperature', 'temperature-range', 'wet-bulb-temperature', 'dew-point']
const powerLandOrder: DatasetKey[] = ['soil-wetness', 'land-evaporation', 'transpiration-energy']
const powerDatasetOrder: DatasetKey[] = [...powerAtmosphereOrder, ...powerTemperatureOrder, ...powerLandOrder]
const extraDatasetOrder: DatasetKey[] = [...powerDatasetOrder]
const datasetOrder: DatasetKey[] = [...coreDatasetOrder, ...extraDatasetOrder]
type SoundPlayerTrack = { dataset: DatasetKey; mode: WeatherMode; point: GeoPoint; value: number | null; windSpeed?: number }
type SoundPlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'stopped' | 'unavailable'
const datasetLabels: Partial<Record<DatasetKey, string>> = {
  weather: 'Weather',
  humidity: 'Humidity',
  'specific-humidity': 'Specific humidity',
  'cloud-cover': 'Cloud cover',
  'solar-radiation': 'Solar radiation',
  'longwave-radiation': 'Longwave radiation',
  'aerosol-depth': 'Aerosol depth',
  'surface-pressure': 'Surface pressure',
  'air-temperature': 'Air temperature',
  'min-air-temperature': 'Daily low',
  'max-air-temperature': 'Daily high',
  'temperature-range': 'Daily temperature range',
  'wet-bulb-temperature': 'Wet-bulb temp',
  'dew-point': 'Dew / frost point',
  'precipitable-water': 'Precipitable water',
  'soil-wetness': 'Soil wetness',
  'land-evaporation': 'Land evaporation',
  'transpiration-energy': 'Transpiration energy',
  'wind-speed-2m': '2 m wind speed',
}
interface PowerMapContext {
  legend: string
  description: string
  firstYear?: number
  lastYear?: number
}
const powerMapContexts: Partial<Record<DatasetKey, PowerMapContext>> = {
  humidity: { legend: 'NASA AIRS L3 Â· surface humidity monthly grid', description: 'The monthly AIRS Level 3 image is a 1Â° global humidity grid; the selected reading is the separate daily NASA POWER value.', firstYear: 2002 },
  'specific-humidity': { legend: 'NASA POWER QV2M Â· vapor rings at selected point', description: 'Concentric vapor rings show the selected daily NASA POWER 2 m specific-humidity value; this is point data, not a global image.' },
  'cloud-cover': { legend: 'NASA MERRA-2 ISCCP Â· cloud albedo monthly', description: 'The gridded image shows monthly cloud albedo for global context; the selected point value is daily CERES cloud amount from NASA POWER.' },
  'precipitable-water': { legend: 'NASA MERRA-2 water vapor Â· monthly', description: 'The NASA MERRA-2 precipitable-water image is a monthly column-moisture context layer.', firstYear: 1980 },
  'solar-radiation': { legend: 'NASA MERRA-2 sunlight Â· monthly', description: 'The NASA MERRA-2 land shortwave image is monthly visual context for the daily POWER radiation record.', firstYear: 1980 },
  'longwave-radiation': { legend: 'NASA CERES SYN1deg Â· longwave map through July 2021', description: 'July 2021 is the latest monthly NASA CERES longwave map tile; the colored marker shows the separate, newer daily NASA POWER value.', firstYear: 2001 },
  'aerosol-depth': { legend: 'NASA MERRA-2 aerosol image Â· monthly', description: 'The NASA MERRA-2 aerosol image is a separate monthly atmospheric-column context layer.', firstYear: 1980 },
  'surface-pressure': { legend: 'NASA MERRA-2 pressure Â· monthly', description: 'The NASA MERRA-2 monthly pressure image is global visual context for the selected daily point.', firstYear: 1980 },
  'wind-speed-2m': { legend: 'NASA MERRA-2 wind image Â· 10 m Â· monthly', description: 'The NASA MERRA-2 map shows monthly 10-meter wind; the selected NASA POWER reading is daily wind at 2 meters.', firstYear: 1980 },
  'air-temperature': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The NASA MERRA-2 monthly 2-meter temperature image is context for the selected daily POWER reading.', firstYear: 1980 },
  'min-air-temperature': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The map shows monthly mean air temperature; the marker reports the distinct daily minimum.', firstYear: 1980 },
  'max-air-temperature': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The map shows monthly mean air temperature; the marker reports the distinct daily maximum.', firstYear: 1980 },
  'temperature-range': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The map shows monthly mean air temperature; the marker reports a daily high-to-low range.', firstYear: 1980 },
  'wet-bulb-temperature': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The map shows monthly mean air temperature, not wet-bulb temperature; the marker identifies the POWER value.', firstYear: 1980 },
  'dew-point': { legend: 'NASA MERRA-2 air temperature Â· monthly', description: 'The map shows monthly mean air temperature, not dew point; the marker identifies the POWER value.', firstYear: 1980 },
  'soil-wetness': { legend: 'NASA MERRA-2 root-zone water Â· monthly', description: 'The NASA image shows root-zone soil water; the POWER point is surface-layer wetness, so the depths differ.', firstYear: 1980 },
  'land-evaporation': { legend: 'NASA MERRA-2 land evaporation Â· monthly', description: 'The NASA MERRA-2 monthly land-evaporation image is global visual context for the daily point series.', firstYear: 1980 },
}
powerMapContexts['transpiration-energy'] = {
  legend: 'NASA POWER · MERRA-2 EVPTRNS',
  description: 'NASA POWER · MERRA-2 EVPTRNS',
}
const powerVisualSignatures: Partial<Record<DatasetKey, string>> = {
  humidity: 'MOISTURE RIPPLE',
  'specific-humidity': 'VAPOR WAVE',
  'precipitable-water': 'COLUMN WAVE',
  'cloud-cover': 'CLOUD VEIL',
  'solar-radiation': 'SUN RADIANCE',
  'longwave-radiation': 'HEAT RADIANCE',
  'aerosol-depth': 'AEROSOL HAZE',
  'surface-pressure': 'PRESSURE CONTOUR',
  'wind-speed-2m': 'AIRFLOW STREAM',
  'air-temperature': 'THERMAL BLOOM',
  'min-air-temperature': 'FROST BLOOM',
  'max-air-temperature': 'HEAT BLOOM',
  'temperature-range': 'RANGE CONTOUR',
  'wet-bulb-temperature': 'THERMAL MOISTURE',
  'dew-point': 'DEW RIPPLE',
  'soil-wetness': 'SOIL RIPPLE',
  'land-evaporation': 'EVAPORATION FLOW',
  'transpiration-energy': 'PLANT FLUX',
}
const thermalPointDatasets: DatasetKey[] = ['air-temperature', 'min-air-temperature', 'max-air-temperature', 'wet-bulb-temperature', 'dew-point']
function powerMapContextNote(dataset: DatasetKey, year: number): string {
  const context = powerMapContexts[dataset]
  if (!context) return 'No matching NASA GIBS global image is paired with this series; the colored marker shows the selected point reading.'
  if (dataset === 'transpiration-energy') return context.description
  if (context.firstYear && year < context.firstYear || context.lastYear && year > context.lastYear) {
    return `${context.legend} is not available for the latest data period; the colored marker still shows the selected point reading.`
  }
  return `${context.description} The colored marker shows the selected point reading.`
}
function powerMapLegend(dataset: DatasetKey, year: number): string {
  const context = powerMapContexts[dataset]
  if (!context) return 'Point reading only Â· no paired global NASA image'
  if (context.firstYear && year < context.firstYear || context.lastYear && year > context.lastYear) return 'Point reading - latest NASA map context unavailable'
  return context.legend
}
const accentPalette = { cyan: '#5bd4f2', violet: '#b8a1ff', mint: '#79dfbc', amber: '#ffcb7a' } as const
type ThemeChoice = 'dark' | 'light' | 'system'
function initialDataset(): DatasetKey {
  const requested = new URLSearchParams(window.location.search).get('dataset')
  return datasetOrder.includes(requested as DatasetKey) ? requested as DatasetKey : 'temperature'
}
function initialWeatherMode(): WeatherMode {
  const requested = new URLSearchParams(window.location.search).get('mode')
  return ['rain', 'wind', 'storm'].includes(requested ?? '') ? requested as WeatherMode : 'rain'
}
function initialLocationPin(): GeoPoint | null {
  const query = new URLSearchParams(window.location.search)
  const latitude = Number(query.get('lat'))
  const longitude = Number(query.get('lon'))
  return query.has('lat') && query.has('lon') && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null
}
const temperatureDatasetKeys: DatasetKey[] = ['temperature', 'ocean', 'air-temperature', 'min-air-temperature', 'max-air-temperature', 'temperature-range', 'wet-bulb-temperature', 'dew-point']
const isTemperatureDataset = (key: DatasetKey) => temperatureDatasetKeys.includes(key)
const displayedUnit = (key: DatasetKey, temperatureUnit: TemperatureUnit) => {
  if (!isTemperatureDataset(key)) return datasets[key].unit
  const degree = temperatureUnit === 'fahrenheit' ? '°F' : '°C'
  if (key === 'temperature') return `${degree} anomaly`
  if (key === 'temperature-range') return `${degree} range`
  return degree
}
const chartFormatter = (value: number, key: DatasetKey, temperatureUnit: TemperatureUnit) => {
  const displayValue = convertTemperatureValue(value, key, temperatureUnit)
  if (key === 'co2') return `${value.toFixed(0)}`
  if (key === 'aerosol-depth') return value.toFixed(2)
  if (key === 'humidity' || key === 'cloud-cover' || key === 'solar-radiation') return value.toFixed(0)
  if (key === 'longwave-radiation') return value.toFixed(1)
  if (key === 'specific-humidity') return value.toFixed(1)
  if (key === 'precipitable-water') return value.toFixed(2)
  if (key === 'soil-wetness') return value.toFixed(2)
  if (key === 'land-evaporation' || key === 'transpiration-energy') return value.toFixed(1)
  if (key === 'wind-speed-2m') return value.toFixed(1)
  if (isTemperatureDataset(key)) return displayValue.toFixed(1)
  return value.toFixed(1)
}
const localizedMonthName = (month: number, width: 'short' | 'long' = 'short') => new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2020, month, 1)))
const measurementPeriod = (point?: Measurement) => point?.periodMonths ? `latest mean · Jan–${localizedMonthName(Math.max(0, Math.min(11, point.periodMonths - 1)))}` : null
const formatPointLabel = (point?: Measurement, translate: (text: string) => string = (text) => text) => {
  if (!point) return '—'
  if (point.periodMonths) return translate(`${point.year} YTD · Jan–${localizedMonthName(point.periodMonths - 1)}`)
  const rawDate = point.date ?? (/^\d{4}-\d{2}-\d{2}$/.test(point.label ?? '') ? point.label : undefined)
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const parsed = new Date(rawDate + 'T00:00:00Z')
    if (Number.isFinite(parsed.getTime())) return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed)
  }
  if (point.label && /[A-Za-z]/.test(point.label) && !/\bYTD\b/.test(point.label)) {
    const parsedLabel = new Date(point.label)
    if (Number.isFinite(parsedLabel.getTime())) return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsedLabel)
  }
  return translate(point.label ?? String(point.year))
}
const coordinateLabel = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(1)}Â° ${value >= 0 ? positive : negative}`
const formatMeasurement = (point: Measurement, dataset: DatasetKey, weatherMode: WeatherMode, temperatureUnit: TemperatureUnit) => `${point.lowerBound ? 'â‰¥' : ''}${formatValue(point.value, dataset, weatherMode, temperatureUnit)}`

const countryRegionCodes: Record<string, string> = { 'United States': 'US', 'United Kingdom': 'GB', Egypt: 'EG', India: 'IN', Philippines: 'PH', Japan: 'JP', Australia: 'AU' }

function cityDisplayName(city: typeof cityLocations[number]): string {
  const code = countryRegionCodes[city.country]
  const country = code ? new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(code) ?? city.country : city.country
  return `${city.city}, ${country}`
}

function locationName(point: GeoPoint, pinned: boolean, city: typeof cityLocations[number] | null): string {
  if (city) return cityDisplayName(city)
  const nearest = cityLocations.map((candidate) => {
    const lat1 = point.latitude * Math.PI / 180
    const lat2 = candidate.latitude * Math.PI / 180
    const deltaLat = (candidate.latitude - point.latitude) * Math.PI / 180
    const deltaLon = (candidate.longitude - point.longitude) * Math.PI / 180
    const distance = 6371 * 2 * Math.asin(Math.sqrt(
      Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2,
    ))
    return { city: candidate, distance }
  }).sort((a, b) => a.distance - b.distance)[0]
  if (nearest && nearest.distance < 80) return `Near ${nearest.city.city}`
  return pinned ? 'Pinned map point' : 'Globe view center'
}

function DatasetIcon({ dataset, size = 17 }: { dataset: DatasetKey; size?: number }) {
  if (dataset === 'temperature') return <Thermometer size={size} />
  if (dataset === 'weather') return <CloudRain size={size} />
  if (dataset === 'ocean') return <Waves size={size} />
  if (dataset === 'co2') return <Atom size={size} />
  if (dataset === 'humidity') return <Droplets size={size} />
  if (dataset === 'specific-humidity') return <Droplets size={size} />
  if (dataset === 'cloud-cover') return <Cloud size={size} />
  if (dataset === 'solar-radiation') return <Sun size={size} />
  if (dataset === 'longwave-radiation') return <Waves size={size} />
  if (dataset === 'aerosol-depth') return <Wind size={size} />
  if (dataset === 'surface-pressure') return <Gauge size={size} />
  if (dataset === 'air-temperature') return <Thermometer size={size} />
  if (dataset === 'min-air-temperature') return <Snowflake size={size} />
  if (dataset === 'max-air-temperature') return <Sun size={size} />
  if (dataset === 'temperature-range') return <ArrowUpDown size={size} />
  if (dataset === 'wet-bulb-temperature') return <Thermometer size={size} />
  if (dataset === 'dew-point') return <Droplets size={size} />
  if (dataset === 'precipitable-water') return <Droplets size={size} />
  if (dataset === 'soil-wetness') return <Droplets size={size} />
  if (dataset === 'land-evaporation') return <Waves size={size} />
  if (dataset === 'transpiration-energy') return <Sprout size={size} />
  if (dataset === 'wind-speed-2m') return <Wind size={size} />
  return <Leaf size={size} />
}

function DatasetOption({ dataset, selected, onSelect, temperatureUnit }: { dataset: DatasetKey; selected: boolean; onSelect: (key: DatasetKey) => void; temperatureUnit: TemperatureUnit }) {
  const { datasetName, tx } = useLanguage()
  const item = datasets[dataset]
  const label = datasetName(dataset)
  const sourceFamily = dataset === 'weather' || powerDatasetOrder.includes(dataset)
    ? 'NASA POWER'
    : item.source.split('Â·')[0].trim()
  const unitLabel = dataset === 'weather' ? 'rain mm/day Â· wind m/s' : displayedUnit(dataset, temperatureUnit)
  const subtitle = dataset === 'weather'
    ? tx('NASA POWER Â· rain Â· wind')
    : powerDatasetOrder.includes(dataset)
      ? `${tx(sourceFamily)} · ${tx('latest point')}`
      : tx(sourceFamily)
  return (
    <button type="button" className={`dataset-option ${selected ? 'selected' : ''}`} onClick={() => onSelect(dataset)} aria-pressed={selected} title={`${label} ${tx(unitLabel)} ${tx(item.source)}`} aria-label={`${label} ${tx(unitLabel)} ${tx(sourceFamily)}`} style={{ '--dataset-color': item.color } as React.CSSProperties}>
      <span className="dataset-icon"><DatasetIcon dataset={dataset} /></span>
      <span className="dataset-option-copy"><strong>{label}</strong><small>{subtitle}</small></span>
      <span className="dataset-indicator" />
    </button>
  )
}

function CustomTooltip({ active, payload, label, dataset, weatherMode, temperatureUnit }: {
  active?: boolean
  payload?: Array<{ payload: Measurement }>
  label?: number
  dataset: DatasetKey
  weatherMode: WeatherMode
  temperatureUnit: TemperatureUnit
}) {
  if (!active || !payload?.[0]) return null
  const { t, tx } = useLanguage()
  const labelText = payload[0].payload.label ?? label
  return (
    <div className="chart-tooltip">
      <span>{typeof labelText === 'string' ? formatPointLabel(payload[0].payload, tx) : labelText}</span>
      <strong>{formatMeasurement(payload[0].payload, dataset, weatherMode, temperatureUnit)}</strong>
      {dataset === 'weather' && weatherMode === 'storm' && payload[0].payload.windSpeed !== undefined ? <small>{t('wind')} {payload[0].payload.windSpeed.toFixed(1)} m/s</small> : null}
    </div>
  )
}

function App() {
  const { language, setLanguage, t, tx, datasetName } = useLanguage()
  const heroTitleWords = 'FIELD FORCE'.split(/\s+/)
  const [datasetKey, setDatasetKey] = useState<DatasetKey>(initialDataset)
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(() => readPreference('earth-jukebox.temperature-unit') === 'fahrenheit' ? 'fahrenheit' : 'celsius')
  const [datasetSearch, setDatasetSearch] = useState('')
  const [activeNav, setActiveNav] = useState(() => {
    const requested = window.location.hash.slice(1)
    return ['explorer', 'how-it-works', 'about'].includes(requested) ? requested : 'explorer'
  })
  const [powerGroupOpen, setPowerGroupOpen] = useState(() => powerAtmosphereOrder.includes(initialDataset()))
  const [powerTemperatureGroupOpen, setPowerTemperatureGroupOpen] = useState(() => powerTemperatureOrder.includes(initialDataset()))
  const [powerLandGroupOpen, setPowerLandGroupOpen] = useState(() => powerLandOrder.includes(initialDataset()))
  const [payloads, setPayloads] = useState<Partial<Record<DatasetKey, DatasetPayload>>>({})
  const [temperaturePointMeasurement, setTemperaturePointMeasurement] = useState<Measurement | null>(null)
  const [temperaturePointLoading, setTemperaturePointLoading] = useState(false)
  const [temperaturePointError, setTemperaturePointError] = useState<string | null>(null)
  const [climateLoading, setClimateLoading] = useState(true)
  const [weatherMode, setWeatherMode] = useState<WeatherMode>(initialWeatherMode)
  const [weatherLocationId, setWeatherLocationId] = useState('miami')
  const [focusCityId, setFocusCityId] = useState<string | null>(() => {
    if (initialLocationPin()) return null
    const requestedCity = new URLSearchParams(window.location.search).get('city')
    return cityLocations.some((city) => city.id === requestedCity) ? requestedCity : null
  })
  const [mapCenter, setMapCenter] = useState<GeoPoint>({ latitude: 18, longitude: -20 })
  const [locationPin, setLocationPin] = useState<GeoPoint | null>(initialLocationPin)
  const [locationSource, setLocationSource] = useState<'gps' | 'map' | 'shared' | null>(() => initialLocationPin() ? 'shared' : null)
  const [cameraRequest, setCameraRequest] = useState<{ id: number; point: GeoPoint } | null>(null)
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [datasetLoading, setDatasetLoading] = useState(false)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [weatherRetry, setWeatherRetry] = useState(0)
  const [highContrast, setHighContrast] = useState(() => readPreference('earth-jukebox.high-contrast') === 'true')
  const [reducedMotion, setReducedMotion] = useState(() => readPreference('earth-jukebox.reduced-motion') === 'true')
  const [coordinatesVisible, setCoordinatesVisible] = useState(() => readPreference('earth-jukebox.coordinates') !== 'false')
  const [globeHeight, setGlobeHeight] = useState(() => {
    const stored = Number(readPreference('earth-jukebox.globe-height'))
    return Number.isFinite(stored) && stored >= 300 && stored <= 700 ? stored : 430
  })
  const [shareMessage, setShareMessage] = useState('')
  const [mapSoundRequest, setMapSoundRequest] = useState<{ id: number; dataset: DatasetKey; mode: WeatherMode; point: GeoPoint } | null>(null)
  const [soundTrack, setSoundTrack] = useState<SoundPlayerTrack | null>(null)
  const [soundPlayerStatus, setSoundPlayerStatus] = useState<SoundPlayerStatus>('idle')
  const [soundVolume, setSoundVolume] = useState(0.8)
  const [soundProgress, setSoundProgress] = useState(0)
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const stored = readPreference('earth-jukebox.theme')
    return stored === 'light' || stored === 'system' ? stored : 'dark'
  })
  const [accent, setAccent] = useState<keyof typeof accentPalette>(() => {
    const stored = readPreference('earth-jukebox.accent') as keyof typeof accentPalette | null
    return stored && stored in accentPalette ? stored : 'cyan'
  })
  const [globeShouldLoad, setGlobeShouldLoad] = useState(false)
  const cameraRequestIdRef = useRef(0)
  const mapSoundRequestIdRef = useRef(0)
  const playbackStartedAtRef = useRef<number | null>(null)
  const playbackElapsedRef = useRef(0)
  const playbackIntervalRef = useRef<number | null>(null)
  const explorerRef = useRef<HTMLElement>(null)
  const globePanelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const panel = globePanelRef.current
    if (!panel || typeof IntersectionObserver === 'undefined') {
      setGlobeShouldLoad(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setGlobeShouldLoad(true)
      observer.disconnect()
    }, { rootMargin: '640px 0px' })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const sections = ['explorer', 'how-it-works', 'about']
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null)
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0]
      if (visible) setActiveNav(visible.target.id)
    }, { rootMargin: '-18% 0px -66% 0px', threshold: [0, 0.15, 0.35, 0.6] })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  const definition = datasetKey === 'weather' ? weatherDefinitions[weatherMode] : datasets[datasetKey]
  const displayDatasetName = datasetKey === 'weather'
    ? `${datasetName(datasetKey)} Â· ${t(weatherMode)}`
    : datasetName(datasetKey)
  const weatherLocation = weatherLocations.find((location) => location.id === weatherLocationId) ?? weatherLocations[0]
  const focusCity = cityLocations.find((city) => city.id === focusCityId) ?? null
  const activePoint: GeoPoint = mapSoundRequest?.dataset === datasetKey && mapSoundRequest.mode === weatherMode
    ? mapSoundRequest.point
    : locationPin ?? focusCity ?? mapCenter
  const temperatureLocation = locationPin ?? focusCity
  const matchingTemperaturePoint = datasetKey === 'temperature' && temperatureLocation && temperaturePointMeasurement
    && Math.abs(temperaturePointMeasurement.latitude! - temperatureLocation.latitude) < 0.001
    && Math.abs(temperaturePointMeasurement.longitude! - temperatureLocation.longitude) < 0.001
    ? temperaturePointMeasurement
    : undefined
  const activeLocationName = locationSource === 'gps' && locationPin
      ? t('myLocation')
      : tx(locationName(activePoint, locationPin !== null, focusCity))
  const payload = payloads[datasetKey]
  const currentYearNumber = new Date().getUTCFullYear()
  const climateRecords = payloads.temperature?.measurements ?? []
  const latestAvailableYear = datasetKey === 'temperature' && climateRecords.length
    ? climateRecords[climateRecords.length - 1].year
    : Math.min(currentYearNumber, definition.yearEnd ?? currentYearNumber)
  const selectedYear = latestAvailableYear
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('year')) return
    url.searchParams.delete('year')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
  const series = useMemo(
    () => (payload?.measurements ?? []).filter((point) => point.year === selectedYear),
    [payload?.measurements, selectedYear],
  )
  const datasetSearchQuery = datasetSearch.trim().toLocaleLowerCase()
  const matchingDatasets = datasetSearchQuery
    ? datasetOrder.filter((key) => {
      const item = datasets[key]
      return [key, datasetName(key), datasetLabels[key], item.name, item.shortName, item.unit, item.source, item.description]
        .some((value) => value?.toLocaleLowerCase().includes(datasetSearchQuery))
    })
    : []
  const selectedIndex = series.length - 1
  const measurement = selectedIndex >= 0 ? series[selectedIndex] : undefined
  const currentYear = measurement ? formatPointLabel(measurement, tx) : t('latest')
  const partialPeriod = measurementPeriod(measurement)
  const localizedPartialPeriod = partialPeriod ? tx(partialPeriod) : null
  const dataIsLoading = climateLoading || weatherLoading || datasetLoading
  const chartSeries = useMemo(() => series.map((point) => ({ ...point, chartX: point.chartX ?? point.year })), [series])
  const alternativeDataset = datasetOrder.find((key) => key !== datasetKey)

  const clearPlaybackInterval = () => {
    if (playbackIntervalRef.current !== null) window.clearInterval(playbackIntervalRef.current)
    playbackIntervalRef.current = null
  }

  const startPlaybackClock = (elapsed = 0) => {
    clearPlaybackInterval()
    playbackElapsedRef.current = elapsed
    playbackStartedAtRef.current = performance.now() - elapsed
    setSoundProgress(Math.min(elapsed / mapSoundDurationMs, 1))
    playbackIntervalRef.current = window.setInterval(() => {
      const startedAt = playbackStartedAtRef.current
      if (startedAt === null) return
      const played = Math.min(performance.now() - startedAt, mapSoundDurationMs)
      playbackElapsedRef.current = played
      setSoundProgress(played / mapSoundDurationMs)
      if (played >= mapSoundDurationMs) {
        clearPlaybackInterval()
        playbackStartedAtRef.current = null
        setSoundPlayerStatus('finished')
      }
    }, 60)
  }

  const resetPlaybackClock = () => {
    clearPlaybackInterval()
    playbackStartedAtRef.current = null
    playbackElapsedRef.current = 0
    setSoundProgress(0)
  }

  useEffect(() => {
    if (datasetKey !== 'temperature' || !temperatureLocation) {
      setTemperaturePointLoading(false)
      return
    }
    let active = true
    setTemperaturePointLoading(true)
    setTemperaturePointError(null)
    loadLatestPointAirTemperature(temperatureLocation)
      .then((pointMeasurement) => {
        if (active) setTemperaturePointMeasurement(pointMeasurement)
      })
      .catch((error: unknown) => {
        if (!active) return
        setTemperaturePointMeasurement(null)
        setTemperaturePointError(error instanceof Error ? error.message : 'NASA POWER air temperature could not be loaded.')
      })
      .finally(() => { if (active) setTemperaturePointLoading(false) })
    return () => { active = false }
  }, [datasetKey, locationPin?.latitude, locationPin?.longitude, focusCity?.latitude, focusCity?.longitude])

  useEffect(() => {
    const request = mapSoundRequest
    if (!request || request.dataset !== 'temperature') return
    if (datasetKey !== 'temperature' || request.mode !== weatherMode) {
      setMapSoundRequest(null)
      setSoundPlayerStatus('idle')
      return
    }
    let active = true
    setTemperaturePointLoading(true)
    setTemperaturePointError(null)
    loadLatestPointAirTemperature(request.point)
      .then((pointMeasurement) => {
        if (!active || mapSoundRequestIdRef.current !== request.id) return
        setTemperaturePointMeasurement(pointMeasurement)
        setTemperaturePointError(null)
        setTemperaturePointLoading(false)
        setSoundTrack({ dataset: 'air-temperature', mode: request.mode, point: request.point, value: pointMeasurement.value })
        setSoundPlayerStatus('playing')
        startPlaybackClock()
        playMapReadingSound('air-temperature', request.mode, pointMeasurement.value)
        setMapSoundRequest(null)
      })
      .catch((error: unknown) => {
        if (!active || mapSoundRequestIdRef.current !== request.id) return
        const message = error instanceof Error ? error.message : 'NASA POWER air temperature could not be loaded.'
        setTemperaturePointMeasurement(null)
        setTemperaturePointError(message)
        setTemperaturePointLoading(false)
        setMapSoundRequest(null)
        setSoundPlayerStatus('unavailable')
      })
    return () => { active = false }
  }, [datasetKey, mapSoundRequest, weatherMode])

  useEffect(() => {
    const request = mapSoundRequest
    if (!request) return
    if (request.dataset === 'temperature') return
    if (request.dataset !== datasetKey || request.mode !== weatherMode) {
      setMapSoundRequest(null)
      setSoundPlayerStatus('idle')
      return
    }
    const loading = request.dataset === 'weather' ? weatherLoading : datasetLoading
    if (loading) return
    if (request.dataset === 'weather' && weatherError) {
      setMapSoundRequest(null)
      setSoundPlayerStatus('unavailable')
      return
    }
    const soundPayload = payloads[request.dataset]
    if (!soundPayload) return
    if (!measurement || !soundPayload.measurements.length) {
      setMapSoundRequest(null)
      setSoundPlayerStatus('unavailable')
      return
    }
    setSoundTrack({ dataset: request.dataset, mode: request.mode, point: request.point, value: measurement.value, windSpeed: measurement.windSpeed })
    setSoundPlayerStatus('playing')
    startPlaybackClock()
    playMapReadingSound(request.dataset, request.mode, measurement.value, measurement.windSpeed)
    setMapSoundRequest(null)
  }, [climateLoading, datasetKey, datasetLoading, mapSoundRequest, measurement, payloads, weatherError, weatherLoading, weatherMode])

  const requestMapSound = (point: GeoPoint) => {
    unlockMapSound()
    stopMapSound()
    resetPlaybackClock()
    if (datasetKey === 'temperature') {
      setTemperaturePointMeasurement(null)
      setTemperaturePointLoading(true)
      setTemperaturePointError(null)
    }
    setSoundTrack({ dataset: datasetKey, mode: weatherMode, point, value: null })
    setSoundPlayerStatus('loading')
    setMapSoundRequest({ id: ++mapSoundRequestIdRef.current, dataset: datasetKey, mode: weatherMode, point })
    const readingPointUnchanged = Math.abs(point.latitude - activePoint.latitude) < 0.00001
      && Math.abs(point.longitude - activePoint.longitude) < 0.00001
    if (datasetKey !== 'temperature' && !readingPointUnchanged) {
      setPayloads((current) => ({ ...current, [datasetKey]: undefined }))
    }
  }

  const toggleSoundPlayer = () => {
    if (soundPlayerStatus === 'loading') return
    unlockMapSound()
    if (soundPlayerStatus === 'playing') {
      if (playbackStartedAtRef.current !== null) playbackElapsedRef.current = performance.now() - playbackStartedAtRef.current
      clearPlaybackInterval()
      playbackStartedAtRef.current = null
      pauseMapSound()
      setSoundPlayerStatus('paused')
      return
    }
    if (soundPlayerStatus === 'paused' && soundTrack?.value !== null && soundTrack) {
      resumeMapSound()
      startPlaybackClock(playbackElapsedRef.current)
      setSoundPlayerStatus('playing')
      return
    }
    if (soundTrack && soundTrack.value !== null) {
      playMapReadingSound(soundTrack.dataset, soundTrack.mode, soundTrack.value, soundTrack.windSpeed)
      startPlaybackClock()
      setSoundPlayerStatus('playing')
      return
    }
    requestMapSound(activePoint)
  }

  const stopSoundPlayer = () => {
    stopMapSound()
    setMapSoundRequest(null)
    resetPlaybackClock()
    setSoundPlayerStatus(soundTrack && soundTrack.value !== null ? 'stopped' : 'idle')
  }

  useEffect(() => {
    let mounted = true
    setClimateLoading(true)
    loadDataset('temperature').then((result) => {
      if (!mounted) return
      setPayloads((current) => ({ ...current, temperature: result }))
    }).finally(() => { if (mounted) setClimateLoading(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!['ocean', 'co2'].includes(datasetKey) && !powerDatasetOrder.includes(datasetKey)) {
      setDatasetLoading(false)
      return
    }
    let active = true
    setDatasetLoading(true)
    setPayloads((current) => ({ ...current, [datasetKey]: undefined }))
    const timer = window.setTimeout(() => {
      loadDataset(datasetKey, { year: selectedYear, point: activePoint })
        .then((result) => {
          if (active) setPayloads((current) => ({ ...current, [datasetKey]: result }))
        })
        .catch((error: unknown) => {
          if (active) setPayloads((current) => ({ ...current, [datasetKey]: {
            measurements: [], source: datasets[datasetKey].source, sourceUrl: datasets[datasetKey].sourceUrl,
            status: datasets[datasetKey].status, note: error instanceof Error ? error.message : 'The selected point could not be loaded.',
          } }))
        })
        .finally(() => { if (active) setDatasetLoading(false) })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [activePoint.latitude, activePoint.longitude, datasetKey, selectedYear])

  useEffect(() => {
    if (datasetKey !== 'weather') return
    let active = true
    setWeatherLoading(true)
    setWeatherError(null)
    setPayloads((current) => current.weather ? { ...current, weather: undefined } : current)
    loadDataset('weather', { mode: weatherMode, locationId: weatherLocationId, year: selectedYear, point: activePoint })
      .then((result) => {
        if (!active) return
        setPayloads((current) => ({ ...current, weather: result }))
      })
      .catch((error: unknown) => {
        if (!active) return
        setWeatherError(error instanceof Error ? error.message : 'Weather data could not be loaded.')
      })
      .finally(() => { if (active) setWeatherLoading(false) })
    return () => { active = false }
  }, [activePoint.latitude, activePoint.longitude, datasetKey, selectedYear, weatherMode, weatherLocationId, weatherRetry])

  useEffect(() => {
    if (readPreference('earth-jukebox.reduced-motion') === null && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setReducedMotion(true)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast)
    savePreference('earth-jukebox.high-contrast', String(highContrast))
  }, [highContrast])

  useEffect(() => {
    savePreference('earth-jukebox.temperature-unit', temperatureUnit)
  }, [temperatureUnit])

  useEffect(() => {
    savePreference('earth-jukebox.reduced-motion', String(reducedMotion))
  }, [reducedMotion])

  useEffect(() => {
    savePreference('earth-jukebox.coordinates', String(coordinatesVisible))
  }, [coordinatesVisible])

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => root.classList.toggle('theme-light', theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches))
    applyTheme()
    const media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', applyTheme)
    savePreference('earth-jukebox.theme', theme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--cyan', accentPalette[accent])
    savePreference('earth-jukebox.accent', accent)
  }, [accent])

  const chooseDataset = (key: DatasetKey) => {
    setDatasetKey(key)
    setDatasetSearch('')
    setPowerGroupOpen(powerAtmosphereOrder.includes(key))
    setPowerTemperatureGroupOpen(powerTemperatureOrder.includes(key))
    setPowerLandGroupOpen(powerLandOrder.includes(key))
    const url = new URL(window.location.href)
    url.searchParams.set('dataset', key)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    if (key !== 'weather') {
      setWeatherLoading(false)
      setWeatherError(null)
    }
  }

  const chooseAlternativeDataset = () => {
    if (!alternativeDataset) return
    if (alternativeDataset === 'weather') setWeatherMode('rain')
    chooseDataset(alternativeDataset)
  }

  const changeWeatherMode = (mode: WeatherMode) => {
    setWeatherMode(mode)
    const url = new URL(window.location.href)
    url.searchParams.set('mode', mode)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const changeWeatherLocation = (locationId: string) => {
    setWeatherLocationId(locationId)
    if (!locationPin && !focusCity) {
      const location = weatherLocations.find((item) => item.id === locationId)
      if (location) setMapCenter({ latitude: location.latitude, longitude: location.longitude })
    }
  }

  const downloadCurrentCsv = () => {
    if (!series.length) return
    const columns = [
      'dataset_key', 'dataset', 'date', 'year', 'label', 'value', 'unit', 'latitude', 'longitude',
      'wind_speed_m_s', 'sample_count', 'period_months', 'is_lower_bound', 'dataset_description', 'sample_note', 'source', 'source_url',
    ]
    const csvCell = (value: string | number | boolean | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = series.map((point) => [
      datasetKey,
      displayDatasetName,
      point.date,
      point.year,
      point.label,
      point.value,
      definition.unit,
      point.latitude?.toFixed(4),
      point.longitude?.toFixed(4),
      point.windSpeed?.toFixed(2),
      point.sampleCount,
      point.periodMonths,
      point.lowerBound,
      definition.description,
      payload?.note,
      payload?.source ?? definition.source,
      payload?.sourceUrl ?? definition.sourceUrl,
    ].map(csvCell).join(','))
    const blob = new Blob(['\uFEFF', [columns.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const years = series.map((point) => point.year)
    const firstYear = Math.min(...years)
    const lastYear = Math.max(...years)
    anchor.href = url
    anchor.download = `field-force-${datasetKey}-${firstYear}${firstYear === lastYear ? '' : `-${lastYear}`}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const changeFocusCity = (id: string | null) => {
    const city = cityLocations.find((item) => item.id === id)
    if (city) requestMapSound(city)
    setFocusCityId(id)
    setLocationPin(null)
    setLocationSource(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('lat')
    url.searchParams.delete('lon')
    if (id) url.searchParams.set('city', id)
    else url.searchParams.delete('city')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const pinLocation = (point: GeoPoint, source: 'map' | 'gps' = 'map') => {
    if (source === 'map') requestMapSound(point)
    setLocationError(null)
    changeFocusCity(null)
    setLocationPin(point)
    setLocationSource(source)
    const url = new URL(window.location.href)
    url.searchParams.delete('lat')
    url.searchParams.delete('lon')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const requestMyLocation = () => {
    unlockMapSound()
    setLocationError(null)
    if (!navigator.geolocation) {
      setLocationError('unsupported')
      return
    }
    setLocationBusy(true)
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setLocationBusy(false)
      setLocationError(null)
      setMapCenter(point)
      setCameraRequest({ id: ++cameraRequestIdRef.current, point })
      pinLocation(point, 'gps')
      requestMapSound(point)
      setLocationError('found')
    }, (error) => {
      setLocationBusy(false)
      setLocationError(error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable')
    }, { enableHighAccuracy: false, maximumAge: 120000, timeout: 15000 })
  }

  const clearLocationPin = () => {
    setLocationPin(null)
    setLocationSource(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('lat')
    url.searchParams.delete('lon')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const randomLocation = () => {
    const latitude = Math.asin(Math.random() * 2 - 1) * 180 / Math.PI
    const longitude = Math.random() * 360 - 180
    pinLocation({ latitude, longitude })
  }

  const shareCurrentView = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('dataset', datasetKey)
    url.searchParams.delete('year')
    url.searchParams.set('mode', weatherMode)
    url.searchParams.delete('lat')
    url.searchParams.delete('lon')
    if (focusCity && !locationPin) url.searchParams.set('city', focusCity.id)
    else url.searchParams.delete('city')
    try {
      await navigator.clipboard.writeText(url.toString())
      setShareMessage('View link copied')
    } catch {
      window.prompt('Copy this view link:', url.toString())
      setShareMessage('Share link ready')
    }
    window.setTimeout(() => setShareMessage(''), 2200)
  }

  const toggleGlobeFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await globePanelRef.current?.requestFullscreen()
    } catch (error) {
      console.warn('Fullscreen is unavailable in this browser.', error)
    }
  }

  const updateGlobeHeight = (height: number) => {
    const next = Math.max(300, Math.min(700, Math.round(height)))
    setGlobeHeight(next)
    savePreference('earth-jukebox.globe-height', String(next))
  }

  const statusLabel = payload?.status ?? definition.status
  const readingSource = matchingTemperaturePoint ? datasets['air-temperature'].source : payload?.source ?? (weatherError ?? t('loading'))
  const readingSourceUrl = matchingTemperaturePoint ? datasets['air-temperature'].sourceUrl : payload?.sourceUrl ?? definition.sourceUrl
  const activeColor = definition.color
  const readingIntensity = matchingTemperaturePoint
    ? Math.max(0, Math.min(1, (matchingTemperaturePoint.value + 50) / 100))
    : measurement
      ? Math.max(0, Math.min(1, (measurement.value - definition.min) / Math.max(0.000001, definition.max - definition.min)))
      : 0
  const readingColor = matchingTemperaturePoint
    ? matchingTemperaturePoint.value < 0 ? '#90c9ff' : '#ff9873'
    : measurement && thermalPointDatasets.includes(datasetKey)
      ? measurement.value < 0 ? '#90c9ff' : measurement.value === 0 ? '#ead69c' : datasetKey === 'dew-point' ? '#78d9cf' : '#ff9873'
      : activeColor
  const freezingLabel = temperatureUnit === 'fahrenheit' ? '32 °F' : '0 °C'
  const readingColorNote = thermalPointDatasets.includes(datasetKey)
    ? datasetKey === 'dew-point' ? 'frost blue â†” dew aqua' : `ice blue <${freezingLabel} Â· fire orange >${freezingLabel}`
    : 'dataset color Â· size = low â†’ high'
  const latestDisplay = measurement ? formatMeasurement(measurement, datasetKey, weatherMode, temperatureUnit) : (payload || weatherError) && !dataIsLoading ? t('noData') : t('loading')
  const temperaturePointDisplay = matchingTemperaturePoint ? formatValue(matchingTemperaturePoint.value, 'air-temperature', 'rain', temperatureUnit) : null
  const temperaturePointPending = datasetKey === 'temperature' && Boolean(temperatureLocation) && (temperaturePointLoading || mapSoundRequest?.dataset === 'temperature')
  const readingPanelDisplay = datasetKey === 'temperature' && temperatureLocation
    ? temperaturePointPending ? t('updating') : temperaturePointDisplay ?? (temperaturePointError ? t('noData') : t('loading'))
    : latestDisplay
  const readingPanelName = datasetKey === 'temperature' && temperatureLocation
    ? `${datasetName('air-temperature')} · NASA POWER${matchingTemperaturePoint ? ` · ${formatPointLabel(matchingTemperaturePoint, tx)}` : ''}`
    : datasetKey === 'co2' ? 'NASA OCO-2 · global swath sample' : datasetKey === 'temperature' ? 'NASA GISTEMP · global anomaly' : measurement?.latitude !== undefined ? `Map point ${coordinateLabel(measurement.latitude, 'N', 'S')} · ${coordinateLabel(measurement.longitude ?? 0, 'E', 'W')}` : definition.shortName
  const missingData = !measurement && (Boolean(payload) || Boolean(weatherError) || datasetKey === 'ocean') && !dataIsLoading
  const weatherWindDisplay = measurement?.windSpeed
  const isPowerMetric = powerDatasetOrder.includes(datasetKey)
  const isLiveWeatherGlobe = datasetKey === 'weather' && selectedYear === currentYearNumber
  const globeStateLabel = isPowerMetric
    ? 'NASA POWER POINT SERIES'
    : datasetKey !== 'weather'
      ? 'NASA DATA LAYER'
    : weatherMode === 'rain'
        ? 'NASA SATELLITE FIELD'
        : 'NASA POWER + MERRA-2'
  const globeLatitude = activePoint.latitude
  const globeLongitude = activePoint.longitude
  const globeTitle = locationPin
    ? activeLocationName
    : focusCity
      ? cityDisplayName(focusCity)
      : datasetKey === 'weather'
        ? weatherMode === 'rain' ? 'Satellite precipitation' : weatherMode === 'wind' ? 'Surface wind' : 'Rain + wind conditions'
        : datasetKey === 'temperature' ? 'Global surface temperature'
          : datasetKey === 'ocean' ? 'Ocean temperature'
            : datasetKey === 'co2' ? 'Atmospheric COâ‚‚'
              : datasetKey === 'humidity' ? 'Relative humidity'
                        : datasetKey === 'specific-humidity' ? 'Specific humidity'
                        : datasetKey === 'cloud-cover' ? 'Cloud amount'
                          : datasetKey === 'solar-radiation' ? 'Surface solar radiation'
                            : datasetKey === 'aerosol-depth' ? 'Aerosol optical depth'
                              : datasetKey === 'surface-pressure' ? 'Surface pressure'
                                : datasetKey === 'wind-speed-2m' ? 'Wind speed at 2 meters'
                                  : datasetKey === 'air-temperature' ? 'Air temperature'
                                  : datasetKey === 'min-air-temperature' ? 'Daily minimum air temperature'
                                    : datasetKey === 'max-air-temperature' ? 'Daily maximum air temperature'
                                      : datasetKey === 'wet-bulb-temperature' ? 'Wet-bulb temperature'
                                        : datasetKey === 'dew-point' ? 'Dew / frost point'
                                            : datasetKey === 'soil-wetness' ? 'Surface soil wetness'
                                              : datasetKey === 'land-evaporation' ? 'Land evaporation'
                                                : datasetKey === 'transpiration-energy' ? 'Transpiration energy flux'
                                                  : definition.shortName
  const globeTag = locationPin
    ? 'PINNED MAP POINT'
    : focusCity && datasetKey !== 'weather' && !isPowerMetric
      ? 'CITY DETAIL Â· SATELLITE'
      : datasetKey === 'weather'
        ? 'NASA POWER Â· MERRA-2'
        : datasetKey === 'temperature' ? 'NASA GISTEMP Â· GLOBAL ANOMALY'
          : datasetKey === 'ocean' ? 'NASA/JPL MUR Â· DAILY SST'
            : datasetKey === 'co2' ? 'NASA OCO-2 Â· GLOBAL SWATHS'
              : datasetKey === 'humidity' ? 'NASA POWER Â· RH2M DAILY'
                        : datasetKey === 'specific-humidity' ? 'NASA POWER Â· QV2M DAILY'
                        : datasetKey === 'cloud-cover' ? 'NASA POWER Â· CERES CLOUDS'
                          : datasetKey === 'solar-radiation' ? 'NASA POWER Â· ALL-SKY SOLAR'
                            : datasetKey === 'aerosol-depth' ? 'NASA POWER Â· AOD 550 NM'
                              : datasetKey === 'surface-pressure' ? 'NASA POWER Â· SURFACE PRESSURE'
                                : datasetKey === 'wind-speed-2m' ? 'NASA POWER Â· 2 M WIND'
                                  : datasetKey === 'air-temperature' ? 'NASA POWER Â· 2 M AIR TEMP'
                                  : datasetKey === 'min-air-temperature' ? 'NASA POWER Â· DAILY MIN TEMP'
                                    : datasetKey === 'max-air-temperature' ? 'NASA POWER Â· DAILY MAX TEMP'
                                      : datasetKey === 'wet-bulb-temperature' ? 'NASA POWER Â· WET-BULB TEMP'
                                        : datasetKey === 'dew-point' ? 'NASA POWER Â· DEW / FROST POINT'
                                          : datasetKey === 'soil-wetness' ? 'NASA POWER Â· GWETTOP'
                                            : datasetKey === 'land-evaporation' ? 'NASA POWER Â· EVLAND'
                                              : datasetKey === 'transpiration-energy' ? 'NASA POWER Â· EVPTRNS'
                                                : `NASA POWER Â· ${(datasetLabels[datasetKey] ?? displayDatasetName).toUpperCase()}`
  const globeCaption = locationPin
    ? `Pinned point Â· ${coordinateLabel(activePoint.latitude, 'N', 'S')} Â· ${coordinateLabel(activePoint.longitude, 'E', 'W')}`
    : datasetKey === 'weather'
      ? weatherMode === 'rain'
          ? 'NASA POWER daily precipitation drives the reading; NASA GPM imagery is a separate satellite layer.'
          : weatherMode === 'wind'
            ? 'NASA POWER daily wind drives the reading; the globe overlay is a separate NASA MERRA-2 monthly wind analysis.'
            : 'NASA POWER daily rain and wind drive the displayed reading; the GPM precipitation image is a separate satellite layer.'
      : focusCity && !isPowerMetric
        ? `Satellite city view Â· ${focusCity.city}`
        : datasetKey === 'temperature'
          ? `NASA GISTEMP ${localizedPartialPeriod ?? 'annual'} global mean; NASA AIRS monthly satellite imagery is a separate map layer available from 2002.`
          : datasetKey === 'ocean'
            ? `NASA/JPL MUR ${localizedPartialPeriod ?? 'annual sample mean'} from monthly map samples at the selected ocean point.`
              : datasetKey === 'co2'
                ? `Approximate mean of NASA OCO-2 total-column swath color bins through ${measurement?.date ?? 'the latest available sample'}; the sampled orbital tracks do not cover the full atmosphere.`
                : datasetKey === 'humidity'
                  ? 'Daily NASA POWER relative humidity at the selected point; the familiar map is geographic context, not a humidity raster.'
                        : datasetKey === 'specific-humidity'
                          ? 'NASA POWER daily 2-meter specific humidity in grams of water vapor per kilogram of moist air; this is distinct from relative humidity.'
                        : datasetKey === 'cloud-cover'
                          ? 'Daily NASA CERES cloud amount from POWER at the selected point; the map remains a geographic context layer.'
                          : datasetKey === 'solar-radiation'
                            ? 'Daily NASA POWER all-sky surface shortwave radiation at the selected point; cloud effects are included in the value.'
                            : datasetKey === 'aerosol-depth'
                              ? 'NASA CERES aerosol optical depth through POWER; this column measurement is not a surface pollution reading.'
                              : datasetKey === 'surface-pressure'
                                ? 'Daily NASA POWER surface pressure at the selected point; the map is geographic context, not a pressure raster.'
                                : datasetKey === 'wind-speed-2m'
                                  ? 'NASA POWER daily mean wind at 2 meters; this point series is separate from the 10-meter weather wind map overlay.'
                                  : datasetKey === 'air-temperature'
                                      ? 'Daily NASA POWER 2-meter air temperature at the selected point; it differs from the global GISTEMP anomaly.'
                                  : datasetKey === 'min-air-temperature'
                                    ? 'NASA POWER daily UTC minimum 2-meter air temperature, calculated from hourly model temperatures.'
                                    : datasetKey === 'max-air-temperature'
                                      ? 'NASA POWER daily UTC maximum 2-meter air temperature, calculated from hourly model temperatures.'
                                      : datasetKey === 'wet-bulb-temperature'
                                        ? 'Daily NASA POWER 2-meter wet-bulb temperature; this gridded reading is not a heat-stress alert or local sensor observation.'
                                        : datasetKey === 'dew-point'
                                          ? 'Daily NASA POWER dew/frost point at 2 meters; this gridded reading does not measure fog or surface moisture.'
                                          : datasetKey === 'soil-wetness'
                                            ? 'NASA POWER daily MERRA-2 surface soil wetness fraction; a modeled land-surface estimate, with no extra map layer.'
                                            : datasetKey === 'land-evaporation'
                                              ? 'NASA POWER daily MERRA-2 land evaporation in mm/day; this is estimated water loss from land, not precipitation.'
                                              : datasetKey === 'transpiration-energy'
                                                ? 'NASA POWER daily MERRA-2 transpiration energy flux; MJ/mÂ²/day describes latent-heat energy, not water depth.'
                                                : 'Daily NASA POWER specific humidity at 2 meters; a moisture-in-air value, not a rain measurement.'
  const resolvedGlobeCaption = isPowerMetric
    ? measurement
      ? `${locationPin ? `${coordinateLabel(activePoint.latitude, 'N', 'S')} Â· ${coordinateLabel(activePoint.longitude, 'E', 'W')}. ` : ''}Daily NASA POWER ${displayDatasetName.toLowerCase()} at the selected point. The colored halo marks its location and its size follows the value within this dataset's scale. ${powerMapContextNote(datasetKey, selectedYear)}`
      : `No NASA POWER ${displayDatasetName.toLowerCase()} value is available at this point in the latest data. The globe shows ${tx(powerMapLegend(datasetKey, selectedYear))}; a point halo appears when a reading is available.`
    : globeCaption
  const pointReadingExplanation = measurement
    ? `${t('reading')}: ${latestDisplay}${localizedPartialPeriod ? ` · ${localizedPartialPeriod}` : ''}${datasetKey === 'weather' && weatherMode === 'storm' && measurement.windSpeed !== undefined ? ` · ${t('wind')}: ${measurement.windSpeed.toFixed(1)} m/s` : ''}`
    : dataIsLoading ? t('updating') : tx(payload?.note ?? t('noPointReading'))
  const readingPanelExplanation = datasetKey === 'temperature' && temperatureLocation
    ? temperaturePointDisplay ? tx(datasets['air-temperature'].description) : temperaturePointError ? tx(temperaturePointError) : t('updating')
    : pointReadingExplanation

  const playerDatasetName = soundTrack
    ? soundTrack.dataset === 'weather' ? `${datasetName('weather')} · ${t(soundTrack.mode)}` : datasetName(soundTrack.dataset)
    : displayDatasetName
  const playerValue = soundTrack && soundTrack.value !== null
    ? formatValue(soundTrack.value, soundTrack.dataset, soundTrack.mode, temperatureUnit)
    : null
  const playerStatusLabel = soundPlayerStatus === 'loading'
    ? t('updating')
    : soundPlayerStatus === 'playing'
      ? t('live')
      : soundPlayerStatus === 'unavailable' ? t('noData') : t('ready')

  const chartDescription = useMemo(() => {
    if (!series.length) return 'Loading scientific time series.'
    const first = series[0]
    const last = series[series.length - 1]
    return series.length === 1
      ? `Latest available ${displayDatasetName} reading: ${latestDisplay}. ${payload?.note ?? ''}`
      : `Latest ${displayDatasetName} data from ${formatPointLabel(first, tx)} to ${formatPointLabel(last, tx)}. Current reading ${latestDisplay}. ${payload?.note ?? ''}`
  }, [series, displayDatasetName, currentYear, latestDisplay, payload?.note])

  return (
    <div id="home" className={`site-shell ${reducedMotion ? 'reduce-motion' : ''}`}>
      <a className="skip-link" href="#explorer">{t('skipToData')}</a>
      <header className="site-header">
        <a className="brand" href="#home" aria-label={tx("Field Force home")}>
          <span className="brand-mark"><span /></span>
          <span className="brand-copy"><strong>FIELD FORCE</strong><small>{tx("NASA EARTH DATA")}</small></span>
        </a>
        <nav className="main-nav" aria-label={t('navigation')}>
          <a href="#explorer" className={`nav-link ${activeNav === 'explorer' ? 'active' : ''}`} aria-current={activeNav === 'explorer' ? 'location' : undefined} onClick={() => setActiveNav('explorer')}>{t('exploreEarth')}</a>
          <a href="#how-it-works" className={`nav-link ${activeNav === 'how-it-works' ? 'active' : ''}`} aria-current={activeNav === 'how-it-works' ? 'location' : undefined} onClick={() => setActiveNav('how-it-works')}>{t('howItWorks')}</a>
          <a href="#about" className={`nav-link ${activeNav === 'about' ? 'active' : ''}`} aria-current={activeNav === 'about' ? 'location' : undefined} onClick={() => setActiveNav('about')}>{t('about')}</a>
        </nav>
        <div className="header-actions">
          <label className="language-picker"><Languages size={14} aria-hidden="true" /><span className="sr-only">{t('language')}</span><select aria-label={t('language')} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <button className="icon-button accessibility-toggle" onClick={() => setHighContrast((value) => !value)} aria-pressed={highContrast} aria-label={highContrast ? t('highContrastOff') : t('highContrastOn')} title={t('highContrast')}>
            <Eye size={16} />
          </button>
          <button className="motion-toggle" onClick={() => setReducedMotion((value) => !value)} aria-pressed={reducedMotion}>
            <span className={`toggle-track ${reducedMotion ? 'on' : ''}`}><span /></span>
            <span>{t('reducedMotion')}</span>
          </button>
        </div>
      </header>

      <main>
        <section className="intro-section" id="home">
          <div className="intro-copy">
            <div className="eyebrow"><span className="live-dot" /> {t('kicker')}</div>
            <h1>{heroTitleWords[0]}{heroTitleWords.length > 1 && <><br /><span>{heroTitleWords.slice(1).join(' ')}</span></>}</h1>
            <div className="tagline">{t('tagline')}</div>
            <p>{t('projectSummary')}</p>
            <div className="intro-actions">
              <button className="button button-primary" onClick={() => explorerRef.current?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })}>
                <Database size={16} /> {t('exploreEarth')} <ArrowRight size={16} />
              </button>
              <a className="text-link" href="#how-it-works">{t('exploreScience')} <ArrowUpRight size={14} /></a>
            </div>
            <div className="intro-meta"><span><Database size={13} /> {t('nasaData')}</span><i /><span>{t('rain')} · {t('wind')} · {t('storm')}</span></div>
          </div>
          <aside className="intro-signal data-snapshot" aria-label={t('dataSnapshot')}>
            <div className="signal-topline"><span><span className="signal-square" /> {t('nasaData')}</span><span className="mono">{t('latest')}</span></div>
            <div className="snapshot-copy"><span>{displayDatasetName}</span><strong>{latestDisplay}</strong><p>{tx(definition.description)}</p></div>
            <div className="signal-footer"><span>{tx(definition.source)}</span><span className="muted">{dataIsLoading ? t('updating') : t('dataReady')}</span></div>
          </aside>
          <div className="hero-orbit orbit-one" aria-hidden="true" />
          <div className="hero-orbit orbit-two" aria-hidden="true" />
        </section>

        <section className="observatory-section" id="explorer" ref={explorerRef} aria-labelledby="explorer-heading">
          <div className="section-heading">
            <div><div className="section-kicker"><span className="micro-line" /> {t('earthData')}</div><h2 id="explorer-heading">{t('explorePlanet')}</h2></div>
            <div className="section-heading-actions">
              <div className="data-period" role="status" aria-live="polite" aria-busy={dataIsLoading}><span className={`status-dot ${dataIsLoading ? 'live' : ''}`} /> {dataIsLoading ? t('updating') : missingData ? t('noData') : t('dataReady')} <span className="period-sep">·</span> {series.length ? `${t('latest')} · ${formatPointLabel(series[series.length - 1], tx)}` : weatherError ? t('retry') : payload ? t('noMeasurements') : t('loading')}</div>
              <button type="button" className="quiet-button csv-download" onClick={downloadCurrentCsv} disabled={!series.length || dataIsLoading} title={`${displayDatasetName} Â· CSV`} aria-label={`${displayDatasetName} Â· CSV`}><Download size={13} /> CSV</button>

            </div>
          </div>

          {missingData && <div className="no-data-alert" role="alert">
            <span className="no-data-icon"><Info size={16} /></span>
            <div className="no-data-copy"><strong>{displayDatasetName} · {t('noData')}</strong><span>{tx(datasetKey === 'ocean' ? 'NASA MUR needs an ocean pixel here. Move the pin over open water to read sea-surface temperature.' : datasetKey === 'co2' ? 'OCO-2 follows sparse satellite tracks, so there may be no recent swath sample for this view.' : powerLandOrder.includes(datasetKey) ? 'This NASA POWER land-water value needs a valid land grid cell. Try another land point.' : powerDatasetOrder.includes(datasetKey) ? 'NASA POWER has no valid reading at this grid cell. Try a nearby map point.' : 'NASA has no valid reading for this view right now.')}</span>{(payload?.note || weatherError) && <small>{tx(weatherError ?? payload?.note ?? '')}</small>}</div>
            {datasetKey === 'weather' && weatherError && <button type="button" className="secondary" onClick={() => setWeatherRetry((value) => value + 1)}>{t('retry')}</button>}
            <button type="button" className="secondary" onClick={chooseAlternativeDataset} disabled={!alternativeDataset}>{t('changeDataset')}</button>
          </div>}
          <div className="dashboard-grid">
            <aside className="dataset-panel panel" aria-label={t('datasets')}>
              <div className="panel-heading"><span className="panel-index">01</span><div><span className="panel-label">{t('datasets')}</span></div></div>
              <div className="dataset-search"><Search size={14} aria-hidden="true" /><label className="sr-only" htmlFor="dataset-search-input">{t('searchDatasets', { count: datasetOrder.length })}</label><input id="dataset-search-input" type="search" aria-controls="dataset-search-results" placeholder={t('searchDatasets', { count: datasetOrder.length })} value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setDatasetSearch(''); event.currentTarget.blur() } }} /><button type="button" onClick={() => setDatasetSearch('')} aria-label={t('searchDatasets', { count: datasetOrder.length })} hidden={!datasetSearch}><X size={13} /></button></div>
              {datasetSearchQuery ? <div id="dataset-search-results" className="dataset-search-results" role="group" aria-label={`${matchingDatasets.length} ${t('datasets')}`}>
                <div className="dataset-search-count" role="status" aria-live="polite">{t('resultCount', { count: matchingDatasets.length, label: t(matchingDatasets.length === 1 ? 'dataset' : 'datasets') })}</div>
                {matchingDatasets.map((key) => <DatasetOption key={key} dataset={key} selected={datasetKey === key} onSelect={chooseDataset} temperatureUnit={temperatureUnit} />)}
                {!matchingDatasets.length && <span className="dataset-search-empty">{t('noSearchMatches')}</span>}
              </div> : <>
                <div className="dataset-list" role="group" aria-label={t('datasets')}>
                  {coreDatasetOrder.map((key) => <DatasetOption key={key} dataset={key} selected={datasetKey === key} onSelect={chooseDataset} temperatureUnit={temperatureUnit} />)}
                </div>
              <details className={`dataset-more ${powerAtmosphereOrder.includes(datasetKey) ? 'has-selection' : ''}`} open={powerGroupOpen}>
                <summary onClick={(event) => { event.preventDefault(); setPowerGroupOpen((open) => !open) }} aria-expanded={powerGroupOpen}>
                  <span>{t('powerAtmosphere')}</span><small>{powerAtmosphereOrder.length}</small><ChevronDown size={13} />
                </summary>
                {powerGroupOpen && <div className="dataset-more-list" role="group" aria-label={tx("NASA POWER atmosphere datasets")}>
                  {powerAtmosphereOrder.map((key) => <DatasetOption key={key} dataset={key} selected={datasetKey === key} onSelect={chooseDataset} temperatureUnit={temperatureUnit} />)}
                </div>}
              </details>
              <details className={`dataset-more ${powerTemperatureOrder.includes(datasetKey) ? 'has-selection' : ''}`} open={powerTemperatureGroupOpen}>
                <summary onClick={(event) => { event.preventDefault(); setPowerTemperatureGroupOpen((open) => !open) }} aria-expanded={powerTemperatureGroupOpen}>
                  <span>{t('powerTemperature')}</span><small>{powerTemperatureOrder.length}</small><ChevronDown size={13} />
                </summary>
                {powerTemperatureGroupOpen && <div className="dataset-more-list" role="group" aria-label={tx("NASA POWER temperature datasets")}>
                  {powerTemperatureOrder.map((key) => <DatasetOption key={key} dataset={key} selected={datasetKey === key} onSelect={chooseDataset} temperatureUnit={temperatureUnit} />)}
                </div>}
              </details>
              <details className={`dataset-more ${powerLandOrder.includes(datasetKey) ? 'has-selection' : ''}`} open={powerLandGroupOpen}>
                <summary onClick={(event) => { event.preventDefault(); setPowerLandGroupOpen((open) => !open) }} aria-expanded={powerLandGroupOpen}>
                  <span>{t('powerLandWater')}</span><small>{powerLandOrder.length}</small><ChevronDown size={13} />
                </summary>
                {powerLandGroupOpen && <div className="dataset-more-list" role="group" aria-label={tx("NASA POWER land-water datasets")}>
                  {powerLandOrder.map((key) => <DatasetOption key={key} dataset={key} selected={datasetKey === key} onSelect={chooseDataset} temperatureUnit={temperatureUnit} />)}
                </div>}
              </details>
              </>}
              {datasetKey === 'weather' && <WeatherControls
                mode={weatherMode}
                locationId={weatherLocationId}
                loading={weatherLoading}
                error={weatherError}
                onModeChange={changeWeatherMode}
                onLocationChange={changeWeatherLocation}
                onRetry={() => setWeatherRetry((value) => value + 1)}
              />}
              <div className="dataset-footnote">
                <span className="dataset-footnote-icon"><Info size={13} /></span>
                <p><strong>{t('datasetViews', { count: datasetOrder.length })}:</strong> {t('coverageVaries')}</p>
              </div>
              <div className="source-mini"><span className="source-orbit"><Database size={14} /></span><div><small>{t('source')}</small><strong>{tx(readingSource)}</strong></div><a href={readingSourceUrl} target="_blank" rel="noreferrer" aria-label={t('source')}><ExternalLink size={13} /></a></div>
            </aside>

            <section className="globe-panel panel" aria-label={t('earthView')} ref={globePanelRef}>
              <div className="globe-header"><div><span className="panel-index">02</span><span className="panel-label">{t('earthView')}</span></div><span className="globe-state"><span className={`status-dot ${isLiveWeatherGlobe ? 'live' : ''}`} /> {globeStateLabel}</span>
                <details className="globe-tools">
                  <summary aria-label={t('tools')} title={t('tools')}><Settings2 size={13} /><span>{t('tools')}</span></summary>
                  <div className="globe-tools-menu">
                    <button type="button" onClick={randomLocation}><Shuffle size={13} /> {t('randomLocation')}</button>
                    <button type="button" onClick={shareCurrentView}><Share2 size={13} /> {shareMessage || t('copyShare')}</button>
                    <button type="button" onClick={toggleGlobeFullscreen}><Maximize2 size={13} /> {t('fullscreen')}</button>
                    <button type="button" onClick={() => { updateGlobeHeight(430); setCoordinatesVisible(true) }}><RotateCcw size={13} /> {t('resetLayout')}</button>
                    <label className="globe-tool-select">{t('appearance')}<select value={theme} onChange={(event) => setTheme(event.target.value as ThemeChoice)}><option value="dark">{t('dark')}</option><option value="light">{t('light')}</option><option value="system">{t('system')}</option></select></label>
                    <label className="globe-tool-select">{t('accentColor')}<select value={accent} onChange={(event) => setAccent(event.target.value as keyof typeof accentPalette)}><option value="cyan">{t('cyan')}</option><option value="violet">{t('violet')}</option><option value="mint">{t('mint')}</option><option value="amber">{t('amber')}</option></select></label>
                    <label className="globe-tool-range">{t('globeHeight')} <span>{globeHeight}px</span><input type="range" min="300" max="700" step="10" value={globeHeight} onChange={(event) => updateGlobeHeight(Number(event.target.value))} /></label>
                    <label className="globe-tool-check"><input type="checkbox" checked={coordinatesVisible} onChange={(event) => setCoordinatesVisible(event.target.checked)} /> {t('showCoordinates')}</label>
                    <label className="globe-tool-check"><input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} /> {t('highContrast')}</label>
                    <label className="globe-tool-check"><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> {t('reducedMotion')}</label>
                  </div>
                </details>
              </div>
              <div className="globe-stage" style={{ height: globeHeight }} onPointerUp={(event) => { const measuredHeight = event.currentTarget.getBoundingClientRect().height; if (Math.abs(measuredHeight - globeHeight) > 2) updateGlobeHeight(measuredHeight) }}>
                <Suspense fallback={<div className="globe-map-status" role="status"><span className="loading-orbit" /><span>{t('loadingGlobe')}</span></div>}>
                  {globeShouldLoad ? <Earth
                    dataset={datasetKey}
                    selectedYear={selectedYear}
                    dataAvailable={Boolean(measurement) || Boolean(matchingTemperaturePoint)}
                    reducedMotion={reducedMotion}
                    weatherMode={weatherMode}
                    weatherLocation={weatherLocation}
                    weatherMeasurements={datasetKey === 'weather' ? series : []}
                    weatherIndex={selectedIndex}
                    focusCity={focusCity}
                    onFocusCity={(id) => changeFocusCity(id)}
                    locationPin={locationPin}
                    showPointReading={isPowerMetric || Boolean(matchingTemperaturePoint)}
                    readingPoint={activePoint}
                    readingIntensity={readingIntensity}
                    readingColor={readingColor}
                    readingLabel={temperaturePointDisplay ?? latestDisplay}
                    onLocationPin={pinLocation}
                    cameraRequest={cameraRequest}
                    onViewLocationChange={setMapCenter}
                    selectedRasterDate={measurement?.date}
                  /> : <div className="globe-map-status" role="status"><span className="loading-orbit" /><span>{t('globeWillLoad')}</span></div>}
                </Suspense>
                {coordinatesVisible && <div className="globe-coordinates mono" aria-label={tx(`Map center ${coordinateLabel(globeLatitude, 'N', 'S')}, ${coordinateLabel(globeLongitude, 'E', 'W')}`)}><span>{coordinateLabel(globeLatitude, 'N', 'S')}</span><span>{coordinateLabel(globeLongitude, 'E', 'W')}</span></div>}
                <div className="globe-city-control">
                  <button type="button" className="locate-button" onClick={requestMyLocation} disabled={locationBusy} aria-label={locationBusy ? t('locating') : t('myLocation')} title={locationBusy ? t('locating') : t('myLocation')}><Compass size={13} /><span className="locate-label">{locationBusy ? t('locating') : t('myLocation')}</span></button>
                  <label htmlFor="city-focus-select" className="sr-only">{t('findCity')}</label>
                  <select id="city-focus-select" value={focusCity?.id ?? ''} onChange={(event) => changeFocusCity(event.target.value || null)} aria-label={t('findCity')}>
                    <option value="">{t('findCity')}</option>
                    {cityLocations.map((city) => <option key={city.id} value={city.id}>{city.city}</option>)}
                  </select>
                  {focusCity && <button type="button" onClick={() => changeFocusCity(null)} aria-label={t('returnToGlobe')}><RotateCcw size={11} /></button>}
                </div>
                {locationError && <div className={`location-feedback ${locationError === 'found' ? 'success' : ''}`} role={locationError === 'found' ? 'status' : 'alert'} aria-live="polite">{locationError === 'found' ? t('locationFound') : locationError === 'unsupported' ? t('locationUnsupported') : locationError === 'denied' ? t('locationDenied') : locationError === 'timeout' ? t('locationTimeout') : t('locationUnavailable')}</div>}
                {locationPin && <button type="button" className="globe-pin-clear" onClick={clearLocationPin} aria-label={t('clearPin')}><X size={11} /> {t('clearPin')}</button>}
                <div className="globe-data-badge"><span className="globe-badge-icon" style={{ color: focusCity ? '#ffdfa0' : isPowerMetric ? readingColor : activeColor }}><DatasetIcon dataset={datasetKey} size={12} /></span><span>{tx(globeTitle)}</span><small>{tx(globeTag)}</small></div>
              </div>
              <div className="globe-caption"><span className="caption-mark">⌁</span><span>{tx(resolvedGlobeCaption)}</span><a href={definition.sourceUrl} target="_blank" rel="noreferrer">{tx("Layer details")} <ArrowUpRight size={12} /></a></div>
              <div className={`globe-legend ${isPowerMetric ? 'power-globe-legend' : ''}`} aria-label={tx("Visualization legend")}>
                {datasetKey === 'weather'
                  ? weatherMode === 'rain'
                    ? <><span className="weather-scale-key"><i className="weather-rain-gradient" /> {tx("NASA POWER Â· mm/day")}</span><span className="weather-globe-note">{tx("GPM IMERG image")}</span></>
                    : weatherMode === 'wind'
                      ? <><span className="weather-scale-key"><i className="weather-wind-gradient" /> {tx("Wind Â· m/s")}</span><span className="weather-globe-note">{tx("NASA POWER Â· MERRA-2 map")}</span></>
                      : weatherMode === 'storm'
                        ? <><span className="weather-scale-key"><i className="weather-rain-gradient" /> {tx("Rain Â· mm/day")}</span><span className="weather-globe-note">{tx("Wind Â· m/s")}</span></>
                        : null
                  : datasetKey === 'temperature'
                    ? <><span className="weather-scale-key"><i className="surface-temperature-gradient" /> {tx(`Global anomaly · ${temperatureUnit === 'fahrenheit' ? '°F' : '°C'}`)}</span><span className="weather-globe-note">{tx("NASA AIRS map Â· 2002+")}</span>{matchingTemperaturePoint && <span className="power-reading-key" style={{ '--reading-color': readingColor } as React.CSSProperties}><i /> {t('reading')} · {datasetName('air-temperature')} · NASA POWER</span>}</>
                    : datasetKey === 'ocean'
                      ? <><span className="weather-scale-key"><i className="ocean-temperature-gradient" /> {tx(`Sea-surface temperature · ${temperatureUnit === 'fahrenheit' ? '°F' : '°C'}`)}</span><span className="weather-globe-note">{tx("NASA/JPL MUR Â· daily")}</span></>
                        : datasetKey === 'co2'
                          ? <><span className="weather-scale-key"><i className="co2-gradient" /> {tx("Column COâ‚‚ Â· 380â€“480 ppm")}</span><span className="weather-globe-note">{tx("NASA OCO-2 Â· sampled global swaths")}</span></>
                          : datasetKey === 'transpiration-energy'
                                  ? <span className="weather-scale-key"><i className="transpiration-gradient" /> {tx("NASA POWER · MERRA-2 EVPTRNS")} · W/m²</span>
                                  : isPowerMetric
                                  ? <>{measurement ? <span className="power-reading-key" style={{ '--reading-color': readingColor } as React.CSSProperties}><i /> {tx(powerVisualSignatures[datasetKey] ?? 'POINT HALO')} <small>{tx(readingColorNote)}</small></span> : <span className="power-reading-empty">{t('noPointReading')}</span>}<span className="weather-globe-note">{tx(powerMapLegend(datasetKey, selectedYear))}</span></>
                                  : null}
              </div>
            </section>

            <aside className="reading-panel panel" aria-label={t('reading')}>
              <div className="panel-heading"><span className="panel-index">03</span><div><span className="panel-label">{t('reading')}</span></div><span className="mode-tag">{tx(statusLabel)}</span></div>
              <div className="reading-primary" style={{ '--dataset-color': activeColor } as React.CSSProperties} aria-live="polite">
                <div className="reading-heading-row"><span className="reading-year">{t('latest')}</span>{isTemperatureDataset(datasetKey) && <div className="temperature-unit-switch" role="group" aria-label={tx('Temperature units')}><button type="button" aria-pressed={temperatureUnit === 'celsius'} onClick={() => setTemperatureUnit('celsius')} title={tx('Celsius')}>°C</button><button type="button" aria-pressed={temperatureUnit === 'fahrenheit'} onClick={() => setTemperatureUnit('fahrenheit')} title={tx('Fahrenheit')}>°F</button></div>}</div>
                <span className="reading-value">{readingPanelDisplay}</span>
                <span className="reading-name">{datasetKey === 'temperature' && temperatureLocation ? readingPanelName : tx(readingPanelName)}</span>
                {temperaturePointDisplay && <span className="reading-context">{tx('NASA GISTEMP Â· global anomaly')}: {latestDisplay}</span>}
                {datasetKey === 'weather' && weatherMode === 'storm' && weatherWindDisplay !== undefined && <span className="weather-category storm-secondary">WIND {weatherWindDisplay.toFixed(1)} m/s</span>}
              </div>
              <p className="dataset-description">{tx(datasetKey === 'temperature' && temperatureLocation ? datasets['air-temperature'].description : definition.description)}</p>
              <details className="reading-meaning" open><summary>{t('whatThisReadingMeans')}<ChevronDown size={13} /></summary><p>{tx(readingPanelExplanation)}</p></details>
            </aside>
          </div>
          <p className="globe-text-alt sr-only">{measurement ? tx(`Latest ${displayDatasetName}: ${latestDisplay}. ${payload?.note ?? ''}`) : tx('Loading the latest available measurement.')} {tx(resolvedGlobeCaption)}{tx(". The satellite basemap and place labels are contextual map sources; all scientific readings and science layers come from NASA.")}</p>
        </section>

        <section className="timeline-section panel" aria-labelledby="timeline-heading">
          <div className="timeline-top">
            <div className="timeline-title-group"><div className="timeline-icon"><Database size={16} /></div><div><span className="panel-label">{t('latest')}</span><h2 id="timeline-heading">{datasetKey === 'weather' ? t('recentWeather') : t('latest')}</h2></div></div>
          </div>
          <div className="timeline-chart-wrap">
            <div className="chart-annotation"><span className="chart-current-mark" style={{ backgroundColor: activeColor }} /><strong>{t('latest')}</strong><span>{latestDisplay}</span><span className="annotation-note">{tx(datasetKey === 'weather' ? 'NASA POWER DAILY RECORD' : datasetKey === 'ocean' ? 'NASA/JPL MUR MONTHLY MAP SAMPLES' : datasetKey === 'co2' ? 'NASA OCO-2 GLOBAL SWATH SAMPLE' : isPowerMetric ? 'NASA POWER DAILY POINT SERIES' : 'NASA GISTEMP RECORD')}</span></div>
            <div className="timeline-chart" role="img" aria-label={tx(chartDescription)}>
              {series.length === 1 && measurement ? <div className="latest-snapshot-card"><small>{t('latest')}</small><strong>{latestDisplay}</strong><span>{formatPointLabel(measurement, tx)}</span></div> : series.length ? <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartSeries} margin={{ top: 15, right: 7, bottom: 2, left: -14 }}>
                  <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={activeColor} stopOpacity={0.24} /><stop offset="94%" stopColor={activeColor} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#253344" strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="chartX" type="number" domain={['dataMin', 'dataMax']} tickCount={6} tickFormatter={datasetKey === 'weather' ? (value: number) => { const point = series[Math.max(0, Math.min(series.length - 1, Math.round(value)))]; return point ? formatPointLabel(point, tx) : '' } : undefined} tickLine={false} axisLine={false} tick={{ fill: '#a7b7c7', fontSize: 12, fontFamily: 'DM Mono' }} minTickGap={24} />
                  <YAxis yAxisId="rain" width={50} domain={['auto', 'auto']} tickFormatter={(value: number) => chartFormatter(value, datasetKey, temperatureUnit)} tickLine={false} axisLine={false} tick={{ fill: '#a7b7c7', fontSize: 12, fontFamily: 'DM Mono' }} />
                  {datasetKey === 'weather' && weatherMode === 'storm' && <YAxis yAxisId="wind" orientation="right" width={42} domain={[0, 25]} tickFormatter={(value: number) => value.toFixed(0)} tickLine={false} axisLine={false} tick={{ fill: '#c1b6ed', fontSize: 11, fontFamily: 'DM Mono' }} />}
                  <Tooltip content={<CustomTooltip dataset={datasetKey} weatherMode={weatherMode} temperatureUnit={temperatureUnit} />} cursor={{ stroke: '#dbe8f4', strokeOpacity: 0.28, strokeDasharray: '3 5' }} />
                  {measurement && <ReferenceLine yAxisId="rain" x={measurement.chartX ?? measurement.year} stroke="#eef7ff" strokeOpacity={0.62} strokeDasharray="3 5" />}
                  <Area yAxisId="rain" type="monotone" dataKey="value" stroke="none" fill="url(#chart-fill)" isAnimationActive={false} />
                  <Line yAxisId="rain" type="monotone" dataKey="value" stroke={activeColor} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: activeColor, stroke: '#07111e', strokeWidth: 2 }} isAnimationActive={false} />
                  {datasetKey === 'weather' && weatherMode === 'storm' && <Line yAxisId="wind" type="monotone" dataKey="windSpeed" stroke="#b5a4ff" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 3, fill: '#c5b8ff', stroke: '#07111e', strokeWidth: 1 }} isAnimationActive={false} />}
                </AreaChart>
              </ResponsiveContainer> : <div className="chart-loading">{missingData ? t('noData') : <><span className="loading-orbit" /> {t('loadingRecord')}</>}</div>}
            </div>
          </div>
          <div className="timeline-foot"><span>{t('availableTimestamps')}</span></div>
        </section>

        <details className="table-disclosure" id="data-notes">
          <summary><span><Database size={14} /> {t('dataTable')}</span><ChevronDown size={15} /></summary>
          <div className="data-table-scroll"><table><caption>{displayDatasetName} · {tx(displayedUnit(datasetKey, temperatureUnit))}</caption><thead><tr><th scope="col">{t('timestamp')}</th><th scope="col">{datasetKey === 'weather' && weatherMode === 'storm' ? t('rain') : t('value')}</th>{datasetKey === 'weather' && weatherMode === 'storm' && <th scope="col">{t('wind')} (m/s)</th>}<th scope="col">{t('record')}</th></tr></thead><tbody>{series.map((point, index) => <tr key={`${point.label ?? point.year}-${index}`}><th scope="row">{formatPointLabel(point, tx)}</th><td>{formatMeasurement(point, datasetKey, weatherMode, temperatureUnit)}</td>{datasetKey === 'weather' && weatherMode === 'storm' && <td>{point.windSpeed?.toFixed(1) ?? '—'}</td>}<td>{tx(payload?.status ?? t('loading'))}</td></tr>)}</tbody></table></div>
        </details>

        <details className="compact-details" id="how-it-works">
          <summary><span className="details-summary-copy"><Database size={15} /> {tx("How it works")}</span><ChevronDown size={15} /></summary>
          <div className="compact-details-content"><p>{tx("All scientific measurements and overlays are NASA products; the map basemap and labels provide geographic context.")}</p></div>
        </details>

        <details className="compact-details" id="about">
          <summary><span className="details-summary-copy"><Database size={15} /> {tx("About & credits")} <small>{tx("Field Force Â· NASA Space Apps")}</small></span><ChevronDown size={15} /></summary>
          <div className="compact-details-content about-credits"><span>{t('projectSummary')}</span><a href={datasets.temperature.sourceUrl} target="_blank" rel="noreferrer">{tx("NASA GISTEMP v4 global temperature")} <ExternalLink size={12} /></a><a href="https://data.giss.nasa.gov/gistemp/datasources_v4.html" target="_blank" rel="noreferrer">{tx("GISTEMP input sources Â· includes NOAA/NCEI records")} <ExternalLink size={12} /></a><a href={datasets.ocean.sourceUrl} target="_blank" rel="noreferrer">{tx("NASA/JPL MUR daily sea-surface temperature")} <ExternalLink size={12} /></a><a href={datasets.co2.sourceUrl} target="_blank" rel="noreferrer">{tx("NASA OCO-2 total-column COâ‚‚")} <ExternalLink size={12} /></a><a href={weatherDefinitions.rain.sourceUrl} target="_blank" rel="noreferrer">{tx("NASA POWER daily weather")} <ExternalLink size={12} /></a><a href="https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MERRA2_Surface_Wind_Speed_Monthly.json" target="_blank" rel="noreferrer">{tx("NASA MERRA-2 monthly wind map")} <ExternalLink size={12} /></a><a href="https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/IMERG_Precipitation_Rate_30min.json" target="_blank" rel="noreferrer">{tx("NASA GPM IMERG precipitation imagery")} <ExternalLink size={12} /></a><a href="https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/AIRS_L3_Surface_Air_Temperature_Monthly_Day.json" target="_blank" rel="noreferrer">{tx("NASA AIRS temperature imagery")} <ExternalLink size={12} /></a><a href="https://www.esri.com/en-us/arcgis/products/arcgis-living-atlas/imagery" target="_blank" rel="noreferrer">{tx("Satellite basemap imagery Â· Esri and imagery partners")} <ExternalLink size={12} /></a><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">{tx("Map style Â· OpenFreeMap")} <ExternalLink size={12} /></a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{tx("Map labels Â· OpenStreetMap contributors")} <ExternalLink size={12} /></a><span>{tx("Measurements and science overlays are NASA products, although some NASA analyses use partner observations such as the NOAA/NCEI records documented for GISTEMP. MUR point readings are approximate color-bin samples; OCO-2 uses sparse orbit swaths and is not a complete global daily field. Satellite basemap imagery and map labels are contextual layers. Colors and markers summarize NASA values; they are not additional measurements.")}</span></div>
        </details>
        <details className="compact-details" id="nasa-power-sources">
          <summary><span className="details-summary-copy"><Database size={15} /> {tx("NASA POWER data")} <small>{powerDatasetOrder.length} {tx("daily point series")}</small></span><ChevronDown size={15} /></summary>
          <div className="compact-details-content about-credits">
            {powerDatasetOrder.map((key) => <a key={key} href={datasets[key].sourceUrl} target="_blank" rel="noreferrer">{datasets[key].name} · {datasets[key].source} <ExternalLink size={12} /></a>)}
            <span>{tx(`All ${powerDatasetOrder.length} use the NASA POWER daily API at the selected coordinates. The meteorology and land-water series are gridded analyses, not local station or soil-probe observations. Coverage and source grids vary by parameter; the globe stays a geographic reference when a NASA raster overlay is unavailable.`)}</span>
          </div>
        </details>
      </main>

      <footer className="site-footer"><a className="footer-brand" href="#home"><span className="brand-mark small"><span /></span> {tx("FIELD FORCE")}</a><a href="#home">{t('backToTop')} <ArrowUpRight size={12} /></a></footer>

      <aside className={`sound-player-dock ${soundPlayerStatus === 'playing' ? 'is-playing' : ''}`} aria-label={t('player')}>
        <div className="sound-player-visual" aria-hidden="true">{[1, 2, 3, 4, 5].map((bar) => <span key={bar} />)}</div>
        <div className="sound-player-info">
          <div className="sound-player-title"><strong>{playerDatasetName}</strong><span aria-live="polite">{playerStatusLabel}</span></div>
          <div className="sound-player-progress" role="progressbar" aria-label={t('player')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(soundProgress * 100)}>
            <span style={{ width: `${soundProgress * 100}%` }} />
          </div>
          {playerValue && <small>{playerValue}</small>}
        </div>
        <div className="sound-player-controls">
          <button type="button" className="sound-player-play" onClick={toggleSoundPlayer} disabled={soundPlayerStatus === 'loading'} aria-label={soundPlayerStatus === 'playing' ? t('pauseAudio') : t('playAudio')} title={soundPlayerStatus === 'playing' ? t('pauseAudio') : t('playAudio')}>
            {soundPlayerStatus === 'playing' ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <button type="button" className="sound-player-stop" onClick={stopSoundPlayer} disabled={soundPlayerStatus === 'idle' || soundPlayerStatus === 'unavailable'} aria-label={t('stopAudio')} title={t('stopAudio')}><Square size={14} fill="currentColor" /></button>
        </div>
        <label className="sound-player-volume">
          <Volume2 size={17} aria-hidden="true" />
          <span className="sr-only">{t('volume')}</span>
          <input type="range" min="0" max="100" step="1" value={Math.round(soundVolume * 100)} aria-label={t('volume')} onChange={(event) => { const volume = Number(event.target.value) / 100; setSoundVolume(volume); setMapSoundVolume(volume) }} />
        </label>
      </aside>
    </div>
  )
}

export default App

interface AppErrorBoundaryState {
  error: unknown | null
}

interface AppErrorLabels { recovery: string; title: string; description: string; reload: string; reset: string; technicalDetail: string }

class AppErrorBoundary extends Component<{ children: ReactNode; labels: AppErrorLabels }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Field Force could not render a view.', error, info.componentStack)
  }

  resetPreferencesAndReload = () => {
    [
      'listening-planet.language',
      'earth-jukebox.high-contrast',
      'earth-jukebox.reduced-motion',
      'earth-jukebox.coordinates',
      'earth-jukebox.globe-height',
      'earth-jukebox.theme',
      'earth-jukebox.accent',
      'earth-jukebox.temperature-unit',
    ].forEach(removePreference)
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    const errorMessage = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
    return (
      <main role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, color: '#eaf5fb', background: '#070b14', fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ width: 'min(100%, 540px)', padding: 28, border: '1px solid #294052', borderRadius: 14, background: '#0d1723', boxShadow: '0 24px 80px #0008' }}>
          <p style={{ margin: '0 0 12px', color: '#7ddcf0', fontSize: 12, letterSpacing: '.16em' }}>{this.props.labels.recovery}</p>
          <h1 style={{ margin: '0 0 12px', fontSize: 30 }}>{this.props.labels.title}</h1>
          <p style={{ margin: '0 0 20px', color: '#b4c4d0', lineHeight: 1.6 }}>{this.props.labels.description}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 14px', border: 0, borderRadius: 6, color: '#06131b', background: '#91e7f5', fontWeight: 700, cursor: 'pointer' }}>{this.props.labels.reload}</button>
            <button type="button" onClick={this.resetPreferencesAndReload} style={{ padding: '10px 14px', border: '1px solid #426071', borderRadius: 6, color: '#d8e7f0', background: '#132230', fontWeight: 600, cursor: 'pointer' }}>{this.props.labels.reset}</button>
          </div>
          <details style={{ marginTop: 20, color: '#8399aa' }}><summary style={{ cursor: 'pointer' }}>{this.props.labels.technicalDetail}</summary><code style={{ display: 'block', marginTop: 8, overflowWrap: 'anywhere', color: '#a9bfce' }}>{errorMessage}</code></details>
        </section>
      </main>
    )
  }
}

function LocalizedErrorBoundary({ children }: { children: ReactNode }) {
  const { tx } = useLanguage()
  const labels = {
    recovery: tx('FIELD FORCE · RECOVERY'),
    title: tx('The page hit a problem.'),
    description: tx('The Earth view could not finish loading. Reload the page, or reset saved settings if the problem keeps returning.'),
    reload: tx('Reload page'),
    reset: tx('Reset saved settings and reload'),
    technicalDetail: tx('Technical detail'),
  }
  return <AppErrorBoundary labels={labels}>{children}</AppErrorBoundary>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <LocalizedErrorBoundary>
        <App />
      </LocalizedErrorBoundary>
    </LanguageProvider>
  </StrictMode>,
)

