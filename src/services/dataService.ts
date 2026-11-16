import { datasets, weatherDefinitions, weatherLocations } from '../data/datasets'
import type { DatasetKey, DatasetPayload, GeoPoint, Measurement, WeatherMode } from '../types'

const weatherCache = new Map<string, Promise<DatasetPayload>>()
const powerMetricCache = new Map<string, Promise<DatasetPayload>>()
const pointAirTemperatureCache = new Map<string, Promise<Measurement>>()
const nasaRasterCache = new Map<string, Promise<AnnualRasterValue>>()
const oco2YearCache = new Map<string, Promise<{ value: number; date: string; sampleCount: number }>>()
const nasaPaletteCache = new Map<string, Promise<ColorBin[]>>()
const GIBS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const MUR_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml'
const OCO2_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/OCO_Carbon_Dioxide_Total_Column_Average.xml'
const OCO2_LAYER = 'OCO-2_Carbon_Dioxide_Total_Column_Average'

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

/** Fetch the latest available NASA POWER 2 m air temperature for a clicked map point. */
export async function loadLatestPointAirTemperature(point: GeoPoint): Promise<Measurement> {
  const latitude = point.latitude
  const longitude = point.longitude
  const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const startDate = new Date(endDate.getTime() - 20 * 24 * 60 * 60 * 1000)
  const cacheKey = `${dateCode(endDate)}:${latitude.toFixed(3)}:${longitude.toFixed(3)}`
  const cached = pointAirTemperatureCache.get(cacheKey)
  if (cached) return cached

  const request = (async (): Promise<Measurement> => {
    const query = new URLSearchParams({
      parameters: 'T2M',
      community: 'AG',
      longitude: longitude.toFixed(4),
      latitude: latitude.toFixed(4),
      start: dateCode(startDate),
      end: dateCode(endDate),
      format: 'JSON',
      'time-standard': 'UTC',
    })
    const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`, {
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('NASA POWER air temperature is unavailable right now. Try again shortly.')
    const data = await response.json() as {
      properties?: { parameter?: Record<string, Record<string, number>> }
    }
    const values = data.properties?.parameter?.T2M
    if (!values) throw new Error('NASA POWER did not return the T2M air-temperature field.')
    const validValues = Object.entries(values)
      .filter(([, value]) => Number.isFinite(value) && value > -900)
      .sort(([first], [second]) => first.localeCompare(second))
    const latest = validValues[validValues.length - 1]
    if (!latest) throw new Error('NASA POWER has no valid recent air-temperature reading at this point.')

    const [date, value] = latest
    const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`
    return {
      year: Number(date.slice(0, 4)),
      value,
      label: shortDate(isoDate),
      date,
      latitude,
      longitude,
    }
  })()

  pointAirTemperatureCache.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    pointAirTemperatureCache.delete(cacheKey)
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
  throw new Error('Unsupported dataset.')
}
