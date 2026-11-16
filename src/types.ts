export type DatasetKey = 'temperature' | 'weather' | 'ocean' | 'co2' | 'humidity' | 'specific-humidity' | 'cloud-cover' | 'solar-radiation' | 'longwave-radiation' | 'aerosol-depth' | 'surface-pressure' | 'air-temperature' | 'min-air-temperature' | 'max-air-temperature' | 'temperature-range' | 'wet-bulb-temperature' | 'dew-point' | 'precipitable-water' | 'soil-wetness' | 'land-evaporation' | 'transpiration-energy' | 'wind-speed-2m'
export type WeatherMode = 'rain' | 'wind' | 'storm'
export type TemperatureUnit = 'celsius' | 'fahrenheit'

export interface WeatherLocation {
  id: string
  label: string
  latitude: number
  longitude: number
}

export interface GeoPoint {
  latitude: number
  longitude: number
}

export interface CityLocation {
  id: string
  city: string
  country: string
  latitude: number
  longitude: number
}

export interface Measurement {
  year: number
  value: number
  chartX?: number
  label?: string
  month?: number
  date?: string
  /** Number of complete January-to-month observations in this partial-year mean. */
  periodMonths?: number
  sampleCount?: number
  latitude?: number
  longitude?: number
  windSpeed?: number
  lowerBound?: boolean
}

export interface DatasetDefinition {
  key: DatasetKey
  name: string
  shortName: string
  unit: string
  description: string
  source: string
  sourceUrl: string
  status: 'NASA DATA' | 'ILLUSTRATIVE' | 'NASA MAP + SAMPLE'
  color: string
  min: number
  max: number
  yearStart?: number
  yearEnd?: number
  availableYears?: number[]
}

export interface DatasetPayload {
  measurements: Measurement[]
  /** Monthly source observations used to make year-to-date and matched-period comparisons. */
  monthlyMeasurements?: Measurement[]
  source: string
  sourceUrl: string
  status: DatasetDefinition['status']
  note: string
}
