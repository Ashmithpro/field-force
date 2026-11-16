import { datasets, weatherDefinitions, weatherLocations } from '../data/datasets'
import type { DatasetKey, DatasetPayload, GeoPoint, Measurement, WeatherMode } from '../types'

const weatherCache = new Map<string, Promise<DatasetPayload>>()
const powerMetricCache = new Map<string, Promise<DatasetPayload>>()
let ndviPaletteRequest: Promise<Array<{ rgb: [number, number, number]; min: number; max: number }>> | null = null
const ndviCache = new Map<string, Promise<{ value: number; date: string } | null>>()
const nasaRasterCache = new Map<string, Promise<AnnualRasterValue>>()
const oco2YearCache = new Map<string, Promise<{ value: number; date: string; sampleCount: number }>>()
const nasaPaletteCache = new Map<string, Promise<ColorBin[]>>()
const planetaryRasterCache = new Map<string, Promise<PlanetarySample | null>>()
const NDVI_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml'
const NDVI_TILE_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default'
const GIBS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const MUR_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml'
const OCO2_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/OCO_Carbon_Dioxide_Total_Column_Average.xml'
const OCO2_LAYER = 'OCO-2_Carbon_Dioxide_Total_Column_Average'
const PLANETARY_STAC_ROOT = 'https://planetarycomputer.microsoft.com/api/stac/v1'
const PLANETARY_SIGN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'
const MODIS_EARTH_RADIUS = 6371007.181

type PowerMetricKey = 'humidity' | 'specific-humidity' | 'precipitable-water' | 'cloud-cover' | 'solar-radiation' | 'longwave-radiation' | 'aerosol-depth' | 'surface-pressure' | 'air-temperature' | 'min-air-temperature' | 'max-air-temperature' | 'temperature-range' | 'wet-bulb-temperature' | 'dew-point' | 'soil-wetness' | 'land-evaporation' | 'transpiration-energy' | 'wind-speed-2m'
const POWER_METRICS: Record<PowerMetricKey, { parameter: string; community: 'AG' | 'RE' }> = {
  humidity: { parameter: 'RH2M', community: 'AG' },
  'specific-humidity': { parameter: 'QV2M', community: 'AG' },
  'precipitable-water': { parameter: 'PW', community: 'AG' },
  'cloud-cover': { parameter: 'CLOUD_AMT', community: 'RE' },
  'solar-radiation': { parameter: 'ALLSKY_SFC_SW_DWN', community: 'AG' },
  'longwave-radiation': { parameter: 'ALLSKY_SFC_LW_DWN', community: 'AG' },
  'aerosol-depth': { parameter: 'AOD_55_ADJ', community: 'RE' },
  'surface-pressure': { parameter: 'PS', community: 'AG' },
  'air-temperature': { parameter: 'T2M', community: 'AG' },
  'min-air-temperature': { parameter: 'T2M_MIN', community: 'AG' },
  'max-air-temperature': { parameter: 'T2M_MAX', community: 'AG' },
  'temperature-range': { parameter: 'T2M_RANGE', community: 'AG' },
  'wet-bulb-temperature': { parameter: 'T2MWET', community: 'AG' },
  'dew-point': { parameter: 'T2MDEW', community: 'AG' },
  'soil-wetness': { parameter: 'GWETTOP', community: 'AG' },
  'land-evaporation': { parameter: 'EVLAND', community: 'AG' },
  'transpiration-energy': { parameter: 'EVPTRNS', community: 'AG' },
  'wind-speed-2m': { parameter: 'WS2M', community: 'AG' },
}

interface ColorBin {
  rgb: [number, number, number]
  min: number
  max: number
}

interface MonthlyRasterValue {
  month: number
  value: number
  date: string
}

interface AnnualRasterValue {
  value: number
  date: string
  samples: number
  months?: MonthlyRasterValue[]
  throughMonth?: number
}

interface PlanetarySample {
  value: number
  date: string
  platform: string
}

interface PlanetaryAsset {
  href: string
}

interface PlanetaryItem {
  id: string
  assets: Record<string, PlanetaryAsset | undefined>
  properties: { platform?: string; start_datetime?: string; datetime?: string }
}

function dateCode(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function shortDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(isoDate))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function yearToDateLabel(year: number, throughMonth: number): string {
  return `${year} YTD · Jan–${MONTH_NAMES[Math.max(0, Math.min(11, throughMonth - 1))]}`
}

function latestCompleteModisCompositeStart(year: number): Date {
  const currentDate = new Date()
  const referenceDate = year === currentDate.getUTCFullYear()
    ? new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate() - 8))
    : new Date(Date.UTC(year, 0, 1 + 8 * 22))
  const yearStart = Date.UTC(year, 0, 1)
  const dayOfYear = Math.max(0, Math.floor((referenceDate.getTime() - yearStart) / 86400000))
  const compositeIndex = Math.max(0, Math.floor(dayOfYear / 8))
  return new Date(Date.UTC(year, 0, 1 + compositeIndex * 8))
}

function latestCompleteModisCompositeDate(year: number): string {
  return latestCompleteModisCompositeStart(year).toISOString().slice(0, 10)
}

async function loadNdviPalette(): Promise<Array<{ rgb: [number, number, number]; min: number; max: number }>> {
  if (!ndviPaletteRequest) {
    ndviPaletteRequest = fetch(NDVI_COLORMAP_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error('NASA NDVI color scale is unavailable.')
        const xml = await response.text()
        const section = xml.match(/<ColorMap\s+title="Vegetation Indices"[^>]*>([\s\S]*?)<\/ColorMap>/)?.[1]
        if (!section) throw new Error('NASA NDVI color scale has an unexpected format.')
        const entries = [...section.matchAll(/<ColorMapEntry\s+([^>]+?)\s*\/>/g)].flatMap((match) => {
          const attributes = Object.fromEntries([...match[1].matchAll(/([\w]+)="([^"]*)"/g)].map((entry) => [entry[1], entry[2]]))
          const rgb = attributes.rgb?.split(',').map(Number)
          const range = attributes.value?.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/)
          if (!rgb || rgb.length !== 3 || !range || attributes.nodata === 'true' || attributes.transparent === 'true') return []
          return [{ rgb: rgb as [number, number, number], min: Number(range[1]), max: Number(range[2]) }]
        })
        if (!entries.length) throw new Error('NASA NDVI color scale contains no usable values.')
        return entries
      })
      .catch((error) => {
        ndviPaletteRequest = null
        throw error
      })
  }
  return ndviPaletteRequest
}

async function sampleModisNdvi(point: GeoPoint, year: number): Promise<{ value: number; date: string } | null> {
  const cacheKey = `${year}:${latestCompleteModisCompositeDate(year)}:${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}`
  const cached = ndviCache.get(cacheKey)
  if (cached) return cached
  const request = sampleModisNdviTile(point, year).catch((error: unknown) => {
    ndviCache.delete(cacheKey)
    throw error
  })
  ndviCache.set(cacheKey, request)
  while (ndviCache.size > 180) ndviCache.delete(ndviCache.keys().next().value as string)
  return request
}

async function sampleModisNdviTile(point: GeoPoint, year: number): Promise<{ value: number; date: string } | null> {
  const zoom = 9
  const tileCount = 2 ** zoom
  const latitude = Math.max(-85.0511, Math.min(85.0511, point.latitude))
  const sine = Math.sin(latitude * Math.PI / 180)
  const worldX = ((point.longitude + 180) / 360) * tileCount
  const worldY = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * tileCount
  const tileX = Math.max(0, Math.min(tileCount - 1, Math.floor(worldX)))
  const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(worldY)))
  const pixelX = Math.max(0, Math.min(255, Math.floor((worldX - tileX) * 256)))
  const pixelY = Math.max(0, Math.min(255, Math.floor((worldY - tileY) * 256)))
  if (year < 2000 || year > new Date().getUTCFullYear()) return null
  const targetDate = latestCompleteModisCompositeStart(year)
  const tileDates = [0, -8, -16, -24].map((offset) => {
    const date = new Date(targetDate)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
  const palette = await loadNdviPalette()
  let tileAvailable = false

  for (const date of tileDates) {
    const response = await fetch(`${NDVI_TILE_ROOT}/${date}/GoogleMapsCompatible_Level9/${zoom}/${tileX}/${tileY}.png`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) continue
    tileAvailable = true
    const bitmap = await createImageBitmap(await response.blob())
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('The browser could not read the NASA map pixel.')
      context.drawImage(bitmap, 0, 0)
      const [red, green, blue, alpha] = context.getImageData(pixelX, pixelY, 1, 1).data
      if (alpha < 128) continue
      let closest: { distance: number; min: number; max: number } | null = null
      for (const entry of palette) {
        const distance = (red - entry.rgb[0]) ** 2 + (green - entry.rgb[1]) ** 2 + (blue - entry.rgb[2]) ** 2
        if (!closest || distance < closest.distance) closest = { distance, min: entry.min, max: entry.max }
        if (distance === 0) break
      }
      if (closest && closest.distance <= 40) return { value: (closest.min + closest.max) / 2, date }
    } finally {
      bitmap.close()
    }
  }
  if (!tileAvailable) throw new Error('NASA MODIS vegetation imagery is not available for the selected dates.')
  return null
}

function attributesOf(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]))
}

async function loadNasaColorBins(url: string, title: string, min: number, max: number): Promise<ColorBin[]> {
  const cacheKey = `${url}:${title}`
  let request = nasaPaletteCache.get(cacheKey)
  if (!request) {
    request = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('NASA GIBS color scale is unavailable.')
      const xml = await response.text()
      const colorMap = [...xml.matchAll(/<ColorMap\b([^>]*)>([\s\S]*?)<\/ColorMap>/g)]
        .find((match) => attributesOf(match[1]).title === title)?.[2]
      if (!colorMap) throw new Error(`NASA GIBS color scale has no ${title} palette.`)
      const bins = [...colorMap.matchAll(/<ColorMapEntry\s+([^>]+?)\s*\/>/g)].flatMap((match): ColorBin[] => {
        const attributes = attributesOf(match[1])
        const rgb = attributes.rgb?.split(',').map(Number)
        const range = (attributes.value ?? attributes.sourceValue)?.match(/^\[\s*(-?\d+(?:\.\d+)?|-INF)\s*,\s*(-?\d+(?:\.\d+)?|\+INF)\s*\)/)
        if (!rgb || rgb.length !== 3 || !range || attributes.nodata === 'true' || attributes.transparent === 'true') return []
        const lower = range[1] === '-INF' ? min : Number(range[1])
        const upper = range[2] === '+INF' ? max : Number(range[2])
        if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return []
        return [{ rgb: rgb as [number, number, number], min: Math.max(min, lower), max: Math.min(max, upper) }]
      })
      if (!bins.length) throw new Error(`NASA GIBS ${title} palette has no usable value bins.`)
      return bins
    }).catch((error) => {
      nasaPaletteCache.delete(cacheKey)
      throw error
    })
    nasaPaletteCache.set(cacheKey, request)
  }
  return request
}

async function imagePixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) return null
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The browser could not read the NASA map tile.')
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { data: image.data, width: image.width, height: image.height }
  } finally {
    bitmap.close()
  }
}

function nearestColorBin(red: number, green: number, blue: number, bins: ColorBin[]): ColorBin | null {
  let best: ColorBin | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const bin of bins) {
    const distance = (red - bin.rgb[0]) ** 2 + (green - bin.rgb[1]) ** 2 + (blue - bin.rgb[2]) ** 2
    if (distance < bestDistance) {
      best = bin
      bestDistance = distance
    }
    if (distance === 0) break
  }
  return best && bestDistance <= 45 ? best : null
}

function colorBinValue(red: number, green: number, blue: number, bins: ColorBin[]): number | null {
  const bin = nearestColorBin(red, green, blue, bins)
  return bin ? (bin.min + bin.max) / 2 : null
}

function gibsTileAddress(point: GeoPoint, zoom: number) {
  const count = 2 ** zoom
  const latitude = Math.max(-85.0511, Math.min(85.0511, point.latitude))
  const sine = Math.sin(latitude * Math.PI / 180)
  const worldX = ((point.longitude + 180) / 360) * count
  const worldY = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * count
  const tileX = Math.max(0, Math.min(count - 1, Math.floor(worldX)))
  const tileY = Math.max(0, Math.min(count - 1, Math.floor(worldY)))
  return {
    tileX,
    tileY,
    pixelX: Math.max(0, Math.min(255, Math.floor((worldX - tileX) * 256))),
    pixelY: Math.max(0, Math.min(255, Math.floor((worldY - tileY) * 256))),
  }
}

async function sampleNasaPointTile(
  layer: string,
  date: string,
  matrixLevel: number,
  point: GeoPoint,
  bins: ColorBin[],
): Promise<{ value: number; date: string } | null> {
  const address = gibsTileAddress(point, matrixLevel)
  const url = `${GIBS_ROOT}/${layer}/default/${date}/GoogleMapsCompatible_Level${matrixLevel}/${matrixLevel}/${address.tileY}/${address.tileX}.png`
  const image = await imagePixels(url)
  if (!image) return null
  const offset = (address.pixelY * image.width + address.pixelX) * 4
  if (image.data[offset + 3] < 128) return null
  const value = colorBinValue(image.data[offset], image.data[offset + 1], image.data[offset + 2], bins)
  return value === null ? null : { value, date }
}

function modisSampleTargetDate(year: number, snow: boolean): Date {
  const currentDate = new Date()
  const isCurrentYear = year === currentDate.getUTCFullYear()
  const target = isCurrentYear
    ? new Date(currentDate)
    : new Date(Date.UTC(year, 11, 31))
  // Daily snow products usually lag a few days; 8-day products need a wider
  // margin. The catalog search then chooses the closest valid composite.
  target.setUTCDate(target.getUTCDate() - (snow ? 3 : 8))
  return target
}

function sinusoidalCoordinates(point: GeoPoint): [number, number] {
  const latitude = point.latitude * Math.PI / 180
  const longitude = point.longitude * Math.PI / 180
  return [MODIS_EARTH_RADIUS * longitude * Math.cos(latitude), MODIS_EARTH_RADIUS * latitude]
}

async function planetaryAssetValue(href: string, point: GeoPoint): Promise<number | null> {
  const signResponse = await fetch(`${PLANETARY_SIGN_URL}?href=${encodeURIComponent(href)}`, { signal: AbortSignal.timeout(15000) })
  if (!signResponse.ok) throw new Error('Microsoft Planetary Computer could not sign the NASA raster request.')
  const signed = await signResponse.json() as { href?: string }
  if (!signed.href) throw new Error('Microsoft Planetary Computer returned no signed NASA raster URL.')

  const { fromUrl } = await import('geotiff')
  const tiff = await fromUrl(signed.href)
  const image = await tiff.getImage()
  const [x, y] = sinusoidalCoordinates(point)
  const [originX, originY] = image.getOrigin()
  const [resolutionX, resolutionY] = image.getResolution()
  const pixelX = Math.floor((x - originX) / resolutionX)
  const pixelY = Math.floor((y - originY) / resolutionY)
  if (pixelX < 0 || pixelY < 0 || pixelX >= image.getWidth() || pixelY >= image.getHeight()) return null
  const rasters = await image.readRasters({ window: [pixelX, pixelY, pixelX + 1, pixelY + 1] }) as unknown as ArrayLike<ArrayLike<number>>
  const raw = Number(rasters[0]?.[0])
  return Number.isFinite(raw) ? raw : null
}

async function searchPlanetaryItems(collection: string, point: GeoPoint, target: Date, windowDays: number): Promise<PlanetaryItem[]> {
  const start = new Date(target.getTime() - windowDays * 86400000).toISOString().slice(0, 10)
  const end = new Date(target.getTime() + windowDays * 86400000).toISOString().slice(0, 10)
  const bounds = [
    Math.max(-180, point.longitude - 0.015),
    Math.max(-90, point.latitude - 0.015),
    Math.min(180, point.longitude + 0.015),
    Math.min(90, point.latitude + 0.015),
  ]
  const query = new URLSearchParams({
    collections: collection,
    bbox: bounds.join(','),
    datetime: `${start}/${end}`,
    limit: '100',
  })
  const response = await fetch(`${PLANETARY_STAC_ROOT}/search?${query}`, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('The NASA MODIS catalog is unavailable right now. Try again shortly.')
  const data = await response.json() as { features?: PlanetaryItem[] }
  return (data.features ?? []).sort((left, right) => {
    const leftDate = Date.parse(left.properties.start_datetime ?? left.properties.datetime ?? '')
    const rightDate = Date.parse(right.properties.start_datetime ?? right.properties.datetime ?? '')
    const temporalDifference = Math.abs(leftDate - target.getTime()) - Math.abs(rightDate - target.getTime())
    if (Math.abs(temporalDifference) > 0) return temporalDifference
    return Number((right.properties.platform ?? '').toLowerCase() === 'terra')
      - Number((left.properties.platform ?? '').toLowerCase() === 'terra')
  })
}

async function samplePlanetaryProduct(
  key: 'land-temperature' | 'productivity' | 'snow',
  year: number,
  point: GeoPoint,
): Promise<PlanetarySample | null> {
  const cacheKey = `${key}:${year}:${point.latitude.toFixed(3)}:${point.longitude.toFixed(3)}`
  const cached = planetaryRasterCache.get(cacheKey)
  if (cached) return cached
  const request = (async (): Promise<PlanetarySample | null> => {
    const snow = key === 'snow'
    const target = modisSampleTargetDate(year, snow)
    const collection = key === 'land-temperature' ? 'modis-11A2-061'
      : key === 'productivity' ? 'modis-17A2HGF-061'
        : 'modis-10A1-061'
    const dataAsset = key === 'land-temperature' ? 'LST_Day_1km'
      : key === 'productivity' ? 'Gpp_500m'
        : 'NDSI_Snow_Cover'
    const qualityAsset = key === 'land-temperature' ? 'QC_Day'
      : key === 'productivity' ? 'Psn_QC_500m'
        : 'NDSI_Snow_Cover_Basic_QA'
    const items = await searchPlanetaryItems(collection, point, target, snow ? 12 : 28)
    for (const item of items) {
      const dataHref = item.assets[dataAsset]?.href
      if (!dataHref) continue
      const raw = await planetaryAssetValue(dataHref, point).catch(() => null)
      if (raw === null) continue

      if (key === 'land-temperature') {
        if (raw <= 0 || raw === 65535) continue
        const qualityHref = item.assets[qualityAsset]?.href
        if (qualityHref) {
          const quality = await planetaryAssetValue(qualityHref, point).catch(() => null)
          if (quality === null || (quality & 0b11) > 1 || ((quality >> 6) & 0b11) > 1) continue
        }
        const celsius = raw * 0.02 - 273.15
        if (celsius < -90 || celsius > 80) continue
        return { value: celsius, date: (item.properties.start_datetime ?? item.properties.datetime ?? '').slice(0, 10), platform: item.properties.platform ?? 'MODIS' }
      }

      if (key === 'productivity') {
        if (raw < 0 || raw > 30000 || raw >= 32761) continue
        const qualityHref = item.assets[qualityAsset]?.href
        if (qualityHref) {
          const quality = await planetaryAssetValue(qualityHref, point).catch(() => null)
          if (quality === null || (quality & 0b1) !== 0) continue
        }
        return { value: raw * 0.0001, date: (item.properties.start_datetime ?? item.properties.datetime ?? '').slice(0, 10), platform: item.properties.platform ?? 'MODIS' }
      }

      if (raw < 0 || raw > 100) continue
      const qualityHref = item.assets[qualityAsset]?.href
      if (qualityHref) {
        const quality = await planetaryAssetValue(qualityHref, point).catch(() => null)
        if (quality === null || quality > 2) continue
      }
      return { value: raw, date: (item.properties.start_datetime ?? item.properties.datetime ?? '').slice(0, 10), platform: item.properties.platform ?? 'MODIS' }
    }
    return null
  })().catch((error: unknown) => {
    planetaryRasterCache.delete(cacheKey)
    throw error
  })
  planetaryRasterCache.set(cacheKey, request)
  while (planetaryRasterCache.size > 240) planetaryRasterCache.delete(planetaryRasterCache.keys().next().value as string)
  return request
}

function monthSampleDates(year: number, lastMonth: number): Array<{ month: number; date: string }> {
  return Array.from({ length: lastMonth }, (_, index) => {
    const month = index + 1
    return { month, date: new Date(Date.UTC(year, index, 15)).toISOString().slice(0, 10) }
  })
}

async function sampleMurYear(point: GeoPoint, year: number): Promise<AnnualRasterValue> {
  const currentYear = new Date().getUTCFullYear()
  if (year < 2003 || year > currentYear) throw new Error(`NASA/JPL MUR sea-surface temperature has complete calendar years from 2003 through ${currentYear}.`)
  const lastMonth = year === currentYear ? new Date().getUTCMonth() : 12
  if (lastMonth < 1) throw new Error('NASA/JPL MUR has no complete monthly samples for the current year yet.')
  const cacheKey = `mur:${year}:${lastMonth}:${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}`
  let request = nasaRasterCache.get(cacheKey)
  if (!request) {
    request = (async () => {
      const bins = await loadNasaColorBins(MUR_COLORMAP_URL, 'Sea Surface Temperature', -2, 35)
      const candidates = await Promise.all(monthSampleDates(year, lastMonth).map(({ date }) =>
        sampleNasaPointTile('GHRSST_L4_MUR_Sea_Surface_Temperature', date, 7, point, bins).catch(() => null),
      ))
      const months = candidates.filter((sample): sample is { value: number; date: string } => sample !== null)
      if (!months.length) throw new Error('NASA/JPL MUR has no valid sea-surface temperature pixel at this point at this point. Choose an ocean location.')
      const values = months.map((sample) => sample.value)
      const value = values.reduce((sum, item) => sum + item, 0) / values.length
      const throughMonth = Math.max(...months.map((sample) => new Date(`${sample.date}T00:00:00Z`).getUTCMonth() + 1))
      const monthly = months.map((sample) => ({
        month: new Date(`${sample.date}T00:00:00Z`).getUTCMonth() + 1,
        value: sample.value,
        date: sample.date,
      }))
      return { value, date: months[months.length - 1].date, samples: months.length, months: monthly, throughMonth }
    })().catch((error) => {
      nasaRasterCache.delete(cacheKey)
      throw error
    })
    nasaRasterCache.set(cacheKey, request)
  }
  return request
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await map(items[index])
    }
  }))
  return results
}

async function sampleOco2Tile(date: string, bins: ColorBin[]): Promise<{ value: number; count: number } | null> {
  const image = await imagePixels(`${GIBS_ROOT}/${OCO2_LAYER}/default/${date}/GoogleMapsCompatible_Level8/0/0/0.png`)
  if (!image) return null
  let sum = 0
  let count = 0
  const lookup = new Map<string, number | null>()
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] < 128) continue
    const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`
    let value = lookup.get(key)
    if (value === undefined) {
      value = colorBinValue(image.data[offset], image.data[offset + 1], image.data[offset + 2], bins)
      lookup.set(key, value)
    }
    if (value === null) continue
    sum += value
    count += 1
  }
  return count ? { value: sum / count, count } : null
}

function oco2SamplingDates(year: number): string[] {
  const currentYear = new Date().getUTCFullYear()
  const start = Date.UTC(year, year === 2014 ? 8 : 0, year === 2014 ? 6 : 1)
  const endDate = year === currentYear
    ? new Date(Math.min(Date.UTC(year, 11, 31), Date.now() - 120 * 86400000))
    : new Date(Date.UTC(year, 11, 31))
  const end = endDate.getTime()
  if (end < start) return []
  const dates: string[] = []
  for (let time = start; time <= end; time += 8 * 86400000) dates.push(new Date(time).toISOString().slice(0, 10))
  return dates
}

async function sampleOco2Year(year: number): Promise<{ value: number; date: string; sampleCount: number }> {
  const currentYear = new Date().getUTCFullYear()
  if (year < 2014 || year > currentYear) throw new Error(`NASA OCO-2 CO₂ observations are available from September 2014 through ${currentYear}.`)
  const cacheKey = `oco2:${year}`
  let request = oco2YearCache.get(cacheKey)
  if (!request) {
    request = (async () => {
      const bins = await loadNasaColorBins(OCO2_COLORMAP_URL, 'Carbon Dioxide', 380, 480)
      const dates = oco2SamplingDates(year)
      const tiles = await mapWithConcurrency(dates, 4, async (date) => {
        try {
          return { date, sample: await sampleOco2Tile(date, bins) }
        } catch {
          return { date, sample: null }
        }
      })
      const valid = tiles.filter((tile): tile is { date: string; sample: { value: number; count: number } } => tile.sample !== null)
      if (!valid.length) throw new Error(`NASA OCO-2 has no valid satellite swath pixels for ${year}. The latest orbital passes may not include this region.`)
      const totalPixels = valid.reduce((sum, tile) => sum + tile.sample.count, 0)
      const weightedValue = valid.reduce((sum, tile) => sum + tile.sample.value * tile.sample.count, 0) / totalPixels
      const lastDate = valid[valid.length - 1].date
      return { value: weightedValue, date: lastDate, sampleCount: totalPixels }
    })().catch((error) => {
      oco2YearCache.delete(cacheKey)
      throw error
    })
    oco2YearCache.set(cacheKey, request)
  }
  return request
}

async function loadWeather(mode: WeatherMode, locationId: string, year: number, point?: GeoPoint): Promise<DatasetPayload> {
  const location = weatherLocations.find((item) => item.id === locationId) ?? weatherLocations[0]
  const latitude = point?.latitude ?? location.latitude
  const longitude = point?.longitude ?? location.longitude
  const pointLabel = point ? `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°` : location.label
  const cacheKey = `${mode}:${year}:${latitude.toFixed(2)}:${longitude.toFixed(2)}`
  const cached = weatherCache.get(cacheKey)
  if (cached) return cached

  const request = (async () => {
    if (year < 1981 || year > new Date().getUTCFullYear()) throw new Error(`NASA POWER daily weather coverage begins in 1981; ${year} is unavailable.`)
    const startDate = new Date(Date.UTC(year, 0, 1))
    const endDate = year === new Date().getUTCFullYear()
      ? new Date(Math.min(Date.UTC(year, 11, 31), Date.now() - 3 * 24 * 60 * 60 * 1000))
      : new Date(Date.UTC(year, 11, 31))
    const parameters = mode === 'wind' ? ['WS10M'] : mode === 'storm' ? ['PRECTOTCORR', 'WS10M'] : ['PRECTOTCORR']
    const query = new URLSearchParams({
      parameters: parameters.join(','),
      community: 'AG',
      longitude: longitude.toFixed(4),
      latitude: latitude.toFixed(4),
      start: dateCode(startDate),
      end: dateCode(endDate),
      format: 'JSON',
      'time-standard': 'UTC',
    })
    const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`)
    if (!response.ok) throw new Error('NASA weather data is unavailable right now. Try again shortly.')
    const data = await response.json() as {
      properties?: { parameter?: Record<string, Record<string, number>> }
    }
    const rainfall = data.properties?.parameter?.IMERG_PRECTOT
      ?? data.properties?.parameter?.PRECTOTCORR
    const wind = data.properties?.parameter?.WS10M
    const values = mode === 'wind' ? wind : rainfall
    if (!values || (mode === 'storm' && !wind)) throw new Error('NASA returned an unexpected weather-data response.')
    const measurements = Object.entries(values)
      .filter(([date, value]) => Number.isFinite(value) && value !== -999 && (mode !== 'storm' || (Number.isFinite(wind?.[date]) && wind?.[date] !== -999)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value], index): Measurement => {
        const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`
        return {
          year: Number(date.slice(0, 4)),
          value,
          chartX: index,
          label: shortDate(isoDate),
          date,
          latitude,
          longitude,
          ...(mode === 'storm' ? { windSpeed: wind?.[date] } : {}),
        }
      })
    if (!measurements.length) throw new Error('No recent NASA weather records are available for this place yet.')

    const definition = weatherDefinitions[mode]
    const sourcePeriod = year === new Date().getUTCFullYear()
      ? 'MERRA-2 history with the low-latency GEOS-IT extension'
      : 'MERRA-2 reanalysis'
    return {
      measurements,
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: mode === 'rain'
        ? `NASA POWER daily corrected precipitation (${year}; ${sourcePeriod}) at ${pointLabel}; NASA GPM imagery is a separate satellite layer for the selected date.`
        : mode === 'wind'
          ? `NASA POWER daily 10-meter wind speed (${year}; ${sourcePeriod}) at ${pointLabel}; the sound follows the latest available daily record at this location.`
          : `NASA POWER daily corrected precipitation and 10-meter wind (${year}; ${sourcePeriod}) at ${pointLabel}.`
    }
  })()

  weatherCache.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    weatherCache.delete(cacheKey)
    throw error
  }
}

async function loadPowerMetric(key: PowerMetricKey, year: number, point?: GeoPoint): Promise<DatasetPayload> {
  const definition = datasets[key]
  const parameter = POWER_METRICS[key]
  const currentYear = new Date().getUTCFullYear()
  const firstYear = definition.yearStart ?? 1981
  const lastYear = definition.yearEnd ?? currentYear
  const emptyPayload = (note: string): DatasetPayload => ({
    measurements: [],
    source: definition.source,
    sourceUrl: definition.sourceUrl,
    status: definition.status,
    note,
  })

  if (!point) return emptyPayload('Choose a point on the map to read this NASA POWER daily series.')
  if (year < firstYear || year > lastYear) {
    return emptyPayload(`NASA POWER ${definition.name.toLowerCase()} is available from ${firstYear} through ${lastYear}.`)
  }

  const latitude = point.latitude
  const longitude = point.longitude
  const cacheKey = `${key}:${year}:${latitude.toFixed(3)}:${longitude.toFixed(3)}`
  const cached = powerMetricCache.get(cacheKey)
  if (cached) return cached

  const request = (async (): Promise<DatasetPayload> => {
    const startDate = new Date(Date.UTC(year, 0, 1))
    const endTimestamp = year === currentYear
      ? Math.max(startDate.getTime(), Math.min(Date.UTC(year, 11, 31), Date.now() - 3 * 24 * 60 * 60 * 1000))
      : Date.UTC(year, 11, 31)
    const query = new URLSearchParams({
      parameters: parameter.parameter,
      community: parameter.community,
      longitude: longitude.toFixed(4),
      latitude: latitude.toFixed(4),
      start: dateCode(startDate),
      end: dateCode(new Date(endTimestamp)),
      format: 'JSON',
      'time-standard': 'UTC',
    })
    const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`, {
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`NASA POWER ${definition.name.toLowerCase()} is unavailable right now. Try again shortly.`)
    const data = await response.json() as {
      properties?: { parameter?: Record<string, Record<string, number>> }
    }
    const values = data.properties?.parameter?.[parameter.parameter]
    if (!values) throw new Error(`NASA POWER did not return the ${parameter.parameter} field.`)

    const measurements = Object.entries(values)
      .filter(([, value]) => Number.isFinite(value) && value > -900)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([date, value], index): Measurement => {
        const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`
        return {
          year: Number(date.slice(0, 4)),
          value,
          chartX: index,
          label: shortDate(isoDate),
          date,
          latitude,
          longitude,
        }
      })

    if (!measurements.length) {
      return emptyPayload(`NASA POWER has no valid ${definition.name.toLowerCase()} values at this point in the latest data. Try a nearby location.`)
    }

    const period = year === currentYear ? 'year to date' : 'full year'
    return {
      measurements,
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: `NASA POWER ${parameter.parameter} daily ${period} values for ${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°. NASA POWER stores parameters at their source grid resolution; the grid size differs by product.`,
    }
  })()

  powerMetricCache.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    powerMetricCache.delete(cacheKey)
    throw error
  }
}

function numberFromCsv(value: string | undefined): number | undefined {
  if (!value?.trim() || value.trim() === '***') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function rowsFromGistemp(csv: string): { measurements: Measurement[]; monthlyMeasurements: Measurement[] } {
  const currentYear = new Date().getUTCFullYear()
  const measurements: Measurement[] = []
  const monthlyMeasurements: Measurement[] = []
  for (const line of csv.split(/\r?\n/)) {
    const clean = line.trim().replace(/^\uFEFF/, '')
    if (!/^\d{4},/.test(clean)) continue
    const fields = clean.split(',')
    const year = Number(fields[0])
    if (!Number.isInteger(year)) continue
    const monthValues = fields.slice(1, 13)
    const validMonths = monthValues.flatMap((text, index) => {
      const value = numberFromCsv(text)
      if (value === undefined) return []
      const month = index + 1
      monthlyMeasurements.push({
        year,
        month,
        value,
        chartX: year + (month - 0.5) / 12,
        label: `${MONTH_NAMES[index]} ${year}`,
      })
      return [{ month, value }]
    })
    const annualValue = numberFromCsv(fields[13])
    if (annualValue !== undefined && validMonths.length === 12) {
      measurements.push({ year, value: annualValue, chartX: year })
    } else if (year === currentYear && validMonths.length) {
      const throughMonth = Math.max(...validMonths.map((item) => item.month))
      const values = validMonths.filter((item) => item.month <= throughMonth).map((item) => item.value)
      measurements.push({
        year,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
        chartX: year,
        label: yearToDateLabel(year, throughMonth),
        periodMonths: throughMonth,
      })
    }
  }
  return { measurements, monthlyMeasurements }
}

async function readCsv(path: string): Promise<string | null> {
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(15000) })
    return response.ok ? response.text() : null
  } catch {
    return null
  }
}

async function loadTemperatureDataset(): Promise<DatasetPayload> {
  const candidatePaths = [
    import.meta.env.BASE_URL + 'api/climate-series?dataset=temperature',
    import.meta.env.BASE_URL + 'gistemp.csv',
  ]
  let csv: string | null = null
  for (const path of candidatePaths) {
    const candidate = await readCsv(path)
    if (candidate && rowsFromGistemp(candidate).monthlyMeasurements.length) {
      csv = candidate
      break
    }
  }
  if (!csv) {
    return {
      measurements: [],
      source: datasets.temperature.source,
      sourceUrl: datasets.temperature.sourceUrl,
      status: datasets.temperature.status,
      note: 'NASA GISTEMP could not be loaded. Check the connection and retry.',
    }
  }

  const parsed = rowsFromGistemp(csv)
  const currentRecord = parsed.measurements.find((item) => item.year === new Date().getUTCFullYear())
  return {
    measurements: parsed.measurements,
    monthlyMeasurements: parsed.monthlyMeasurements,
    source: datasets.temperature.source,
    sourceUrl: datasets.temperature.sourceUrl,
    status: datasets.temperature.status,
    note: currentRecord?.periodMonths
      ? 'NASA GISTEMP v4 monthly global land-ocean anomalies through ' + MONTH_NAMES[currentRecord.periodMonths - 1] + ' ' + currentRecord.year + '; the current-year reading is a year-to-date mean relative to 1951–1980. NASA GISTEMP uses NOAA/NCEI land and ocean input records. The NASA AIRS map is a separate satellite product, not the GISTEMP value at the selected point.'
      : 'NASA GISTEMP v4 annual global land-ocean anomalies relative to 1951–1980. NASA GISTEMP uses NOAA/NCEI land and ocean input records. The NASA AIRS map is a separate satellite product, not the GISTEMP value at the selected point.',
  }
}

async function loadOceanDataset(year: number, point?: GeoPoint): Promise<DatasetPayload> {
  if (!point) {
    return {
      measurements: [],
      source: datasets.ocean.source,
      sourceUrl: datasets.ocean.sourceUrl,
      status: datasets.ocean.status,
      note: 'Choose a point over the ocean to sample the latest NASA/JPL MUR data.',
    }
  }
  try {
    const sample = await sampleMurYear(point, year)
    const currentYear = new Date().getUTCFullYear()
    const partialYear = year === currentYear && sample.throughMonth !== 12
    const label = partialYear
      ? yearToDateLabel(year, sample.throughMonth ?? 1)
      : 'Annual mean ' + year
    const monthlyMeasurements = sample.months?.map(({ month, value, date }) => ({
      year,
      month,
      value,
      date,
      chartX: year + (month - 0.5) / 12,
      label: MONTH_NAMES[month - 1] + ' ' + year,
    }))
    return {
      measurements: [{
        year,
        value: sample.value,
        chartX: year,
        date: sample.date,
        label,
        ...(partialYear ? { periodMonths: sample.throughMonth } : {}),
        latitude: point.latitude,
        longitude: point.longitude,
        sampleCount: sample.samples,
      }],
      monthlyMeasurements,
      source: datasets.ocean.source,
      sourceUrl: datasets.ocean.sourceUrl,
      status: datasets.ocean.status,
      note: 'NASA/JPL MUR daily sea-surface temperature, summarized from ' + sample.samples + ' monthly map samples at ' + point.latitude.toFixed(2) + '°, ' + point.longitude.toFixed(2) + '°. Raster colors are published bins, so the result is approximate; land and masked pixels remain blank.',
    }
  } catch (error) {
    return {
      measurements: [],
      source: datasets.ocean.source,
      sourceUrl: datasets.ocean.sourceUrl,
      status: datasets.ocean.status,
      note: error instanceof Error ? error.message : 'NASA/JPL MUR could not sample this point in the latest data window.',
    }
  }
}

async function loadCo2Dataset(year: number): Promise<DatasetPayload> {
  try {
    const sample = await sampleOco2Year(year)
    const firstDate = year === 2014 ? '2014-09-06' : year + '-01-01'
    return {
      measurements: [{
        year,
        value: sample.value,
        chartX: year,
        date: sample.date,
        label: 'NASA OCO-2 swaths · through ' + sample.date,
        sampleCount: sample.sampleCount,
      }],
      source: datasets.co2.source,
      sourceUrl: datasets.co2.sourceUrl,
      status: datasets.co2.status,
      note: 'Approximate mean of NASA OCO-2 total-column CO₂ color bins sampled from ' + firstDate + ' through ' + sample.date + '. The estimate averages visible pixels across NASA GIBS orbit swaths; it is not a continuous station record or a complete global daily mean.',
    }
  } catch (error) {
    return {
      measurements: [],
      source: datasets.co2.source,
      sourceUrl: datasets.co2.sourceUrl,
      status: datasets.co2.status,
      note: error instanceof Error ? error.message : 'NASA OCO-2 could not provide a sample from the latest orbital data.',
    }
  }
}

async function loadModisPointDataset(
  key: 'land-temperature' | 'productivity' | 'snow',
  year: number,
  point?: GeoPoint,
): Promise<DatasetPayload> {
  const definition = datasets[key]
  if (!point) {
    return {
      measurements: [],
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: 'Pin a location to read this NASA MODIS product at the selected point.',
    }
  }
  const lastYear = definition.yearEnd ?? new Date().getUTCFullYear()
  if (year < (definition.yearStart ?? 2000) || year > lastYear) {
    return {
      measurements: [],
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: `NASA MODIS ${definition.name.toLowerCase()} coverage for this product is currently listed from ${definition.yearStart ?? 2000} through ${lastYear}.`,
    }
  }
  try {
    const sample = await samplePlanetaryProduct(key, year, point)
    if (!sample) throw new Error(`NASA MODIS has no valid quality-screened ${definition.name.toLowerCase()} pixel in the latest composite window at this point. Try a nearby point.`)
    const platform = sample.platform.toUpperCase()
    return {
      measurements: [{
        year,
        value: sample.value,
        chartX: year,
        date: sample.date,
        label: `${sample.date} · ${platform}`,
        latitude: point.latitude,
        longitude: point.longitude,
      }],
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: `${definition.name} sampled from the NASA ${platform} MODIS cloud-optimized GeoTIFF via Microsoft Planetary Computer at ${point.latitude.toFixed(3)}°, ${point.longitude.toFixed(3)}° on ${sample.date}. The reported value uses the NASA product scale factor and quality flags.`,
    }
  } catch (error) {
    return {
      measurements: [],
      source: definition.source,
      sourceUrl: definition.sourceUrl,
      status: definition.status,
      note: error instanceof Error ? error.message : `NASA MODIS could not sample ${definition.name.toLowerCase()} at this point.`,
    }
  }
}

export async function loadDataset(
  key: DatasetKey,
  options?: { mode?: WeatherMode; locationId?: string; year?: number; point?: GeoPoint },
): Promise<DatasetPayload> {
  const year = options?.year ?? new Date().getUTCFullYear()
  const point = options?.point
  if (key === 'weather') {
    return loadWeather(options?.mode ?? 'rain', options?.locationId ?? weatherLocations[0].id, year, point)
  }
  if (key === 'humidity' || key === 'specific-humidity' || key === 'precipitable-water' || key === 'cloud-cover' || key === 'solar-radiation' || key === 'longwave-radiation' || key === 'aerosol-depth' || key === 'surface-pressure' || key === 'air-temperature' || key === 'min-air-temperature' || key === 'max-air-temperature' || key === 'temperature-range' || key === 'wet-bulb-temperature' || key === 'dew-point' || key === 'soil-wetness' || key === 'land-evaporation' || key === 'transpiration-energy' || key === 'wind-speed-2m') {
    return loadPowerMetric(key, year, point)
  }
  if (key === 'temperature') return loadTemperatureDataset()
  if (key === 'co2') return loadCo2Dataset(year)
  if (key === 'ocean') return loadOceanDataset(year, point)
  if (key === 'land-temperature' || key === 'productivity' || key === 'snow') return loadModisPointDataset(key, year, point)
  if (key === 'vegetation') {
    if (!point) {
      return {
        measurements: [],
        source: datasets.vegetation.source,
        sourceUrl: datasets.vegetation.sourceUrl,
        status: datasets.vegetation.status,
      note: 'Pin a land location to sample the latest available NASA Terra MODIS 8-day composite.',
      }
    }
    try {
      const sample = await sampleModisNdvi(point, year)
      if (!sample) throw new Error('NASA MODIS has no valid NDVI pixel at this point or date. Water, cloud, and masked areas stay unavailable.')
      return {
        measurements: [{
          year,
          value: sample.value,
          chartX: year,
          label: sample.date,
          date: sample.date,
          latitude: point.latitude,
          longitude: point.longitude,
        }],
        source: datasets.vegetation.source,
        sourceUrl: datasets.vegetation.sourceUrl,
        status: datasets.vegetation.status,
        note: 'Approximate center of the NASA Terra MODIS GIBS color bin at ' + point.latitude.toFixed(2) + '°, ' + point.longitude.toFixed(2) + '°. Water, cloud, masked pixels, and unavailable composites stay blank.',
      }
    } catch (error) {
      return {
        measurements: [],
        source: datasets.vegetation.source,
        sourceUrl: datasets.vegetation.sourceUrl,
        status: datasets.vegetation.status,
        note: error instanceof Error ? error.message : 'NASA MODIS NDVI could not sample this point in the latest composite window.',
      }
    }
  }
  throw new Error('Unsupported dataset.')
}
