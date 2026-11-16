import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  NavigationControl,
  RasterTileSource,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { cityLocations } from '../data/datasets'
import { useLanguage } from '../i18n'
import type { CityLocation, DatasetKey, GeoPoint, Measurement, WeatherLocation, WeatherMode } from '../types'

setWorkerUrl(mapWorkerUrl)

const GIBS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const ESRI_IMAGERY_TILES = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const MAP_FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'earth-background', type: 'background' as const, paint: { 'background-color': '#07111b' } }],
}
const EMPTY_POINTS: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }
const POWER_MONTHLY_IMAGE_SERVICE = 'https://gis.earthdata.nasa.gov/portal/rest/services/POWER/POWER_MONTHLY_METEOROLOGY_LST/ImageServer'
const TRANSPIRATION_IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, 85], [180, 85], [180, -85], [-180, -85],
]
const TRANSPARENT_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
let transpirationImagePromise: Promise<string> | null = null

function loadTranspirationImage(): Promise<string> {
  if (!transpirationImagePromise) {
    transpirationImagePromise = (async () => {
      const metadataResponse = await fetch(`${POWER_MONTHLY_IMAGE_SERVICE}?f=json`)
      if (!metadataResponse.ok) throw new Error('NASA POWER map metadata request failed.')
      const metadata = await metadataResponse.json() as { timeInfo?: { timeExtent?: [number, number] } }
      const latestTime = metadata.timeInfo?.timeExtent?.[1]
      if (typeof latestTime !== 'number' || !Number.isFinite(latestTime)) throw new Error('NASA POWER did not report an available map date.')

      const mosaicRule = {
        multidimensionalDefinition: [{ variableName: 'EVPTRNS', dimensionName: 'StdTime', values: [latestTime], isSlice: true }],
      }
      const renderingRule = {
        rasterFunction: 'Colormap',
        rasterFunctionArguments: {
          Colormap: [
            [0, 14, 24, 65], [5, 36, 98, 168], [15, 24, 178, 184], [35, 145, 218, 125],
            [70, 247, 220, 103], [130, 239, 107, 66], [200, 166, 42, 105],
          ],
          Raster: '$$',
        },
        variableName: 'EVPTRNS',
        outputPixelType: 'U8',
      }
      const parameters = new URLSearchParams({
        f: 'json',
        format: 'png32',
        bbox: '-180,-85,180,85',
        bboxSR: '4326',
        imageSR: '4326',
        size: '1440,680',
        mosaicRule: JSON.stringify(mosaicRule),
        renderingRule: JSON.stringify(renderingRule),
      })
      const imageResponse = await fetch(`${POWER_MONTHLY_IMAGE_SERVICE}/exportImage?${parameters}`)
      if (!imageResponse.ok) throw new Error('NASA POWER transpiration heat map request failed.')
      const result = await imageResponse.json() as { href?: string; error?: { message?: string } }
      if (!result.href) throw new Error(result.error?.message ?? 'NASA POWER returned no transpiration map image.')
      return result.href
    })().catch((error: unknown) => {
      transpirationImagePromise = null
      throw error
    })
  }
  return transpirationImagePromise
}

interface RasterLayerDefinition {
  datasets: DatasetKey[]
  sourceId: string
  layerId: string
  gibsLayer: string
  matrixSet: string
  maxZoom: number
  attribution: string
  opacity: number
  date: (year: number) => string | null
  defaultDate: () => string
  useSelectedRasterDate?: boolean
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function monthStartDaysAgo(months: number): string {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - months)
  return date.toISOString().slice(0, 10)
}

function windMapDate(year: number): string {
  return year === new Date().getUTCFullYear() ? monthStartDaysAgo(3) : `${year}-06-01`
}

function powerMonthlyMapDate(year: number, firstYear = 1980): string | null {
  const currentYear = new Date().getUTCFullYear()
  if (year < firstYear || year > currentYear) return null
  return year === currentYear ? monthStartDaysAgo(3) : `${year}-06-01`
}

function airsMonthlyMapDate(year: number): string | null {
  const currentYear = new Date().getUTCFullYear()
  if (year < 2002 || year > currentYear) return null
  return year === currentYear ? monthStartDaysAgo(3) : `${year}-06-01`
}

const RASTER_LAYERS: RasterLayerDefinition[] = [
  {
    datasets: ['temperature'],
    sourceId: 'nasa-airs-temperature',
    layerId: 'nasa-airs-temperature-layer',
    gibsLayer: 'AIRS_L3_Surface_Air_Temperature_Monthly_Day',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA AIRS / NASA GIBS',
    opacity: 0.72,
    date: (year) => year >= 2002 && year <= new Date().getUTCFullYear()
      ? year === new Date().getUTCFullYear() ? monthStartDaysAgo(3) : `${year}-06-01`
      : null,
    defaultDate: () => monthStartDaysAgo(3),
  },
  {
    datasets: ['ocean'],
    sourceId: 'nasa-mur-sst',
    layerId: 'nasa-mur-sst-layer',
    gibsLayer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    matrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 7,
    attribution: 'NASA/JPL MUR sea-surface temperature / NASA GIBS',
    opacity: 0.96,
    date: (year) => year >= 2003 && year <= new Date().getUTCFullYear()
      ? year === new Date().getUTCFullYear() ? dateDaysAgo(2) : `${year}-06-26`
      : null,
    defaultDate: () => dateDaysAgo(2),
  },
  {
    datasets: ['co2'],
    sourceId: 'nasa-oco2-co2',
    layerId: 'nasa-oco2-co2-layer',
    gibsLayer: 'OCO-2_Carbon_Dioxide_Total_Column_Average',
    matrixSet: 'GoogleMapsCompatible_Level8',
    maxZoom: 8,
    attribution: 'NASA OCO-2 carbon dioxide / NASA GIBS',
    opacity: 0.96,
    date: (year) => year >= 2014 && year <= new Date().getUTCFullYear()
      ? year === new Date().getUTCFullYear() ? dateDaysAgo(120) : `${year}-06-01`
      : null,
    defaultDate: () => dateDaysAgo(120),
  },
  {
    datasets: ['humidity'],
    sourceId: 'nasa-airs-relative-humidity-context',
    layerId: 'nasa-airs-relative-humidity-context-layer',
    gibsLayer: 'AIRS_L3_Surface_Relative_Humidity_Monthly_Day',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA AIRS L3 relative humidity / NASA GIBS',
    opacity: 0.9,
    date: airsMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['cloud-cover'],
    sourceId: 'nasa-merra2-isccp-cloud-albedo-context',
    layerId: 'nasa-merra2-isccp-cloud-albedo-context-layer',
    gibsLayer: 'MERRA2_ISCCP_Cloud_Albedo_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 ISCCP cloud albedo / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['precipitable-water'],
    sourceId: 'nasa-merra2-precipitable-water-context',
    layerId: 'nasa-merra2-precipitable-water-context-layer',
    gibsLayer: 'MERRA2_Total_Precipitable_Water_Vapor_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 precipitable water / NASA GIBS',
    opacity: 0.92,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['solar-radiation'],
    sourceId: 'nasa-merra2-solar-radiation-context',
    layerId: 'nasa-merra2-solar-radiation-context-layer',
    gibsLayer: 'MERRA2_Incident_Shortwave_Over_Land_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 incident shortwave radiation / NASA GIBS',
    opacity: 0.92,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['longwave-radiation'],
    sourceId: 'nasa-ceres-longwave-context',
    layerId: 'nasa-ceres-longwave-context-layer',
    gibsLayer: 'CERES_Combined_Surface_Longwave_Flux_Down_All_Sky_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA CERES SYN1deg surface longwave flux / NASA GIBS',
    opacity: 0.92,
    date: (year) => year < 2001 ? null : year >= 2021 ? '2021-07-01' : `${year}-06-01`,
    defaultDate: () => '2021-07-01',
    useSelectedRasterDate: false,
  },
  {
    datasets: ['aerosol-depth'],
    sourceId: 'nasa-merra2-aerosol-context',
    layerId: 'nasa-merra2-aerosol-context-layer',
    gibsLayer: 'MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 aerosol optical thickness / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['surface-pressure'],
    sourceId: 'nasa-merra2-surface-pressure-context',
    layerId: 'nasa-merra2-surface-pressure-context-layer',
    gibsLayer: 'MERRA2_Surface_Pressure_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 surface pressure / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['air-temperature', 'min-air-temperature', 'max-air-temperature', 'temperature-range', 'wet-bulb-temperature', 'dew-point'],
    sourceId: 'nasa-merra2-2m-temperature-context',
    layerId: 'nasa-merra2-2m-temperature-context-layer',
    gibsLayer: 'MERRA2_2m_Air_Temperature_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 2 m air temperature / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['land-evaporation'],
    sourceId: 'nasa-merra2-land-evaporation-context',
    layerId: 'nasa-merra2-land-evaporation-context-layer',
    gibsLayer: 'MERRA2_Evaporation_Land_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 land evaporation / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
  {
    datasets: ['soil-wetness'],
    sourceId: 'nasa-merra2-root-zone-soil-water-context',
    layerId: 'nasa-merra2-root-zone-soil-water-context-layer',
    gibsLayer: 'MERRA2_Soil_Water_Root_Zone_Monthly',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    attribution: 'NASA MERRA-2 root-zone soil water / NASA GIBS',
    opacity: 0.9,
    date: powerMonthlyMapDate,
    defaultDate: () => monthStartDaysAgo(3),
    useSelectedRasterDate: false,
  },
]
const RAIN_TILE = `${GIBS_ROOT}/IMERG_Precipitation_Rate_30min/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`
const WIND_TILE = `${GIBS_ROOT}/MERRA2_Surface_Wind_Speed_Monthly/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`

function tileUrl(layer: RasterLayerDefinition, date: string): string {
  return `${GIBS_ROOT}/${layer.gibsLayer}/default/${date}/${layer.matrixSet}/{z}/{y}/{x}.png`
}

function cityFeatures(focusedCityId: string | null): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: cityLocations.map((city) => ({
      type: 'Feature',
      properties: { id: city.id, city: city.city, focused: city.id === focusedCityId },
      geometry: { type: 'Point', coordinates: [city.longitude, city.latitude] },
    })),
  }
}

function pointFeature(longitude: number, latitude: number): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [longitude, latitude] } }],
  }
}

function readingPattern(dataset: DatasetKey): string {
  if (['air-temperature', 'min-air-temperature', 'max-air-temperature', 'wet-bulb-temperature'].includes(dataset)) return 'thermal'
  if (dataset === 'temperature-range') return 'range'
  if (dataset === 'dew-point') return 'dew'
  if (dataset === 'co2') return 'co2'
  if (dataset === 'specific-humidity') return 'vapor'
  if (dataset === 'humidity' || dataset === 'precipitable-water') return 'moisture'
  if (dataset === 'cloud-cover') return 'cloud'
  if (['solar-radiation', 'longwave-radiation'].includes(dataset)) return 'radiant'
  if (dataset === 'aerosol-depth') return 'haze'
  if (dataset === 'surface-pressure') return 'pressure'
  if (dataset === 'wind-speed-2m') return 'wind'
  if (dataset === 'soil-wetness') return 'soil'
  if (dataset === 'land-evaporation') return 'evaporation'
  if (dataset === 'transpiration-energy') return 'growth'
  return 'default'
}

function readingPointFeature(
  point: GeoPoint | null,
  intensity: number,
  color: string,
  label: string,
  pattern: string,
): FeatureCollection<Point> {
  if (!point) return EMPTY_POINTS
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { intensity, color, label, pattern },
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    }],
  }
}

function sourceAsGeoJson(map: MapLibreMap, id: string): GeoJSONSource | undefined {
  const source = map.getSource(id)
  return source instanceof GeoJSONSource ? source : undefined
}

function weatherTileDate(measurement: Measurement | undefined, year: number): string {
  const compactDate = measurement?.date?.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`
  if (measurement?.date && /^\d{4}-\d{2}-\d{2}$/.test(measurement.date)) return measurement.date
  const parsedLabel = measurement?.label ? new Date(measurement.label) : null
  if (parsedLabel && Number.isFinite(parsedLabel.getTime())) return parsedLabel.toISOString().slice(0, 10)
  return year === new Date().getUTCFullYear() ? dateDaysAgo(2) : `${year}-06-26`
}

export default function Earth({
  dataset,
  selectedYear,
  dataAvailable,
  reducedMotion,
  weatherMode = 'rain',
  weatherLocation,
  weatherMeasurements = [],
  weatherIndex = 0,
  focusCity,
  onFocusCity,
  locationPin,
  showPointReading,
  readingPoint,
  readingIntensity,
  readingColor,
  readingLabel,
  onLocationPin,
  onViewLocationChange,
  cameraRequest = null,
  selectedRasterDate,
}: {
  dataset: DatasetKey
  selectedYear: number
  dataAvailable: boolean
  reducedMotion: boolean
  weatherMode?: WeatherMode
  weatherLocation?: WeatherLocation
  weatherMeasurements?: Measurement[]
  weatherIndex?: number
  focusCity: CityLocation | null
  onFocusCity: (id: string) => void
  locationPin: GeoPoint | null
  showPointReading: boolean
  readingPoint: GeoPoint
  readingIntensity: number
  readingColor: string
  readingLabel: string
  onLocationPin: (point: GeoPoint) => void
  onViewLocationChange: (point: GeoPoint) => void
  cameraRequest?: { id: number; point: GeoPoint } | null
  selectedRasterDate?: string
}) {
  const { tx } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const rasterDatesRef = useRef(new Map<string, string>())
  const transpirationImageRequestRef = useRef(0)
  const onFocusCityRef = useRef(onFocusCity)
  const onLocationPinRef = useRef(onLocationPin)
  const onViewLocationChangeRef = useRef(onViewLocationChange)
  const previousFocusCityIdRef = useRef<string | null>(null)
  const previousWeatherContextRef = useRef<string | null>(null)
  const lastCameraRequestIdRef = useRef<number | null>(null)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [mapError, setMapError] = useState('')
  const [labelsUnavailable, setLabelsUnavailable] = useState(false)

  onFocusCityRef.current = onFocusCity
  onLocationPinRef.current = onLocationPin
  onViewLocationChangeRef.current = onViewLocationChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let active = true
    let readyTimer = 0
    let styleFallbackTimer = 0
    let viewChangeTimer = 0
    let configured = false
    let fallbackAttempted = false
    let map: MapLibreMap
    rasterDatesRef.current.clear()

    try {
      map = new MapLibreMap({
        container,
        style: MAP_STYLE,
        center: focusCity ? [focusCity.longitude, focusCity.latitude] : locationPin ? [locationPin.longitude, locationPin.latitude] : [-20, 18],
        zoom: focusCity ? 14 : locationPin ? 3.2 : 1.15,
        pitch: focusCity ? 35 : 0,
        bearing: focusCity ? 18 : 0,
        minZoom: 0.45,
        maxZoom: 19,
        maxPitch: 55,
        renderWorldCopies: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25),
        attributionControl: false,
        canvasContextAttributes: { antialias: false },
      })
    } catch (error) {
      console.error('The map could not be initialized.', error)
      setMapError(error instanceof Error ? error.message : 'The globe map could not be initialized.')
      setMapStatus('error')
      return
    }

    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(container)
    map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right')
    map.addControl(new ScaleControl({ maxWidth: 92, unit: 'metric' }), 'bottom-left')
    map.addControl(new AttributionControl({
      compact: true,
      customAttribution: [
        'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        'OpenFreeMap · © OpenStreetMap contributors',
        'NASA GIBS',
        'NASA POWER / NASA Earthdata',
      ],
    }), 'bottom-left')

    readyTimer = window.setTimeout(() => {
      if (active) setMapStatus((status) => status === 'ready' ? 'ready' : 'error')
    }, 15000)

    const configureMap = () => {
      if (!active || configured) return
      configured = true
      window.clearTimeout(styleFallbackTimer)
      try {
        const styleLayers = map.getStyle().layers ?? []
        const firstOverlayLayer = styleLayers.find((layer) => layer.type === 'line' || layer.type === 'symbol')?.id
        const firstSymbolLayer = styleLayers.find((layer) => layer.type === 'symbol')?.id
        map.addSource('satellite-imagery', {
          type: 'raster',
          tiles: [ESRI_IMAGERY_TILES],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        })
        map.addLayer({
          id: 'satellite-imagery-layer',
          type: 'raster',
          source: 'satellite-imagery',
          paint: {
            'raster-saturation': -0.08,
            'raster-contrast': 0.06,
            'raster-brightness-min': 0.015,
            'raster-brightness-max': 0.88,
            'raster-fade-duration': 180,
          },
        }, firstOverlayLayer)
        for (const layer of styleLayers) {
          if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-opacity', 0)
        }
        try {
          map.addLayer({
            id: 'city-building-extrusions',
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: 14,
            filter: ['!', ['has', 'hide_3d']],
            paint: {
              'fill-extrusion-color': '#a4c7d3',
              'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'render_height']], ['to-number', ['get', 'height']], 7],
              'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'render_min_height']], ['to-number', ['get', 'min_height']], 0],
              'fill-extrusion-opacity': 0.38,
              'fill-extrusion-vertical-gradient': true,
            },
          }, firstSymbolLayer)
        } catch (error) {
          console.info('3D building detail is unavailable for this map style.', error)
        }
        for (const layer of styleLayers) {
          if (layer.type !== 'symbol') continue
          const color = layer.id.startsWith('place_city') ? '#d4e3ec'
            : layer.id.startsWith('place_town') || layer.id.startsWith('place_suburb') ? '#bed0dc'
              : layer.id.startsWith('place_') ? '#aebfcb'
                : layer.id.startsWith('highway_name_motorway') ? '#cbd8e1'
                  : layer.id.startsWith('highway_name') ? '#adbfcc'
                    : layer.id === 'water_name' ? '#82b7d1' : '#bbcbd6'
          map.setPaintProperty(layer.id, 'text-color', color)
          map.setPaintProperty(layer.id, 'text-halo-color', '#080f17')
          map.setPaintProperty(layer.id, 'text-halo-width', 1.1)
        }
        const roadColors: Record<string, string> = {
          waterway: '#8fc5d5',
          highway_path: '#eee7d8',
          highway_minor: '#eee8da',
          highway_major_casing: '#18212a',
          highway_major_inner: '#e9d5a2',
          highway_major_subtle: '#d7d9d1',
          highway_motorway_casing: '#101a22',
          highway_motorway_inner: '#ffe1a2',
          highway_motorway_subtle: '#efdfb6',
          boundary_state: '#e8d7a7',
          'boundary_country_z0-4': '#eee4c7',
          'boundary_country_z5-': '#eee4c7',
        }
        for (const [id, color] of Object.entries(roadColors)) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color)
        }

        const initialRainDate = dateDaysAgo(2)
        map.addSource('nasa-gpm-rain', {
          type: 'raster',
          tiles: [RAIN_TILE.replace('{date}', initialRainDate)],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 6,
          attribution: 'NASA GPM IMERG / NASA GIBS',
        })
        map.addLayer({
          id: 'nasa-gpm-rain-layer',
          type: 'raster',
          source: 'nasa-gpm-rain',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 350 }, 'raster-fade-duration': 180 },
        }, firstOverlayLayer)
        rasterDatesRef.current.set('nasa-gpm-rain', initialRainDate)

        const initialWindDate = windMapDate(new Date().getUTCFullYear())
        map.addSource('nasa-merra2-wind', {
          type: 'raster',
          tiles: [WIND_TILE.replace('{date}', initialWindDate)],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 6,
          attribution: 'NASA MERRA-2 / NASA GIBS',
        })
        map.addLayer({
          id: 'nasa-merra2-wind-layer',
          type: 'raster',
          source: 'nasa-merra2-wind',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 350 }, 'raster-fade-duration': 180 },
        }, firstOverlayLayer)
        rasterDatesRef.current.set('nasa-merra2-wind', initialWindDate)

        map.addSource('nasa-power-transpiration-heatmap', {
          type: 'image',
          url: TRANSPARENT_IMAGE,
          coordinates: TRANSPIRATION_IMAGE_COORDINATES,
        })
        map.addLayer({
          id: 'nasa-power-transpiration-heatmap-layer',
          type: 'raster',
          source: 'nasa-power-transpiration-heatmap',
          layout: { visibility: 'none' },
          paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': { duration: 250 },
            'raster-fade-duration': 0,
          },
        }, firstOverlayLayer)

        for (const layer of RASTER_LAYERS) {
          const initialDate = layer.date(new Date().getUTCFullYear()) ?? layer.defaultDate()
          map.addSource(layer.sourceId, {
            type: 'raster',
            tiles: [tileUrl(layer, initialDate)],
            tileSize: 256,
            minzoom: 0,
            maxzoom: layer.maxZoom,
            attribution: layer.attribution,
          })
          map.addLayer({
            id: layer.layerId,
            type: 'raster',
            source: layer.sourceId,
            layout: { visibility: 'none' },
            paint: {
              'raster-opacity': 0,
              'raster-opacity-transition': { duration: 450 },
              'raster-fade-duration': 200,
              ...(layer.sourceId === 'nasa-oco2-co2' ? { 'raster-resampling': 'nearest' as const } : {}),
            },
          }, firstOverlayLayer)
          rasterDatesRef.current.set(layer.sourceId, initialDate)
        }

        map.addSource('city-reference-locations', { type: 'geojson', data: cityFeatures(null) })
        map.addLayer({
          id: 'city-reference-halo',
          type: 'circle',
          source: 'city-reference-locations',
          filter: ['==', ['get', 'focused'], true],
          paint: {
            'circle-radius': ['case', ['boolean', ['get', 'focused'], false], 12, 8],
            'circle-color': ['case', ['boolean', ['get', 'focused'], false], '#ffe0a0', '#83cde7'],
            'circle-opacity': 0.18,
            'circle-blur': 0.72,
          },
        })
        map.addLayer({
          id: 'city-reference-markers',
          type: 'circle',
          source: 'city-reference-locations',
          filter: ['==', ['get', 'focused'], true],
          paint: {
            'circle-radius': ['case', ['boolean', ['get', 'focused'], false], 5, 3],
            'circle-color': ['case', ['boolean', ['get', 'focused'], false], '#ffe0a0', '#b6e9f6'],
            'circle-stroke-color': '#10202d',
            'circle-stroke-width': 1.5,
          },
        })
        map.addSource('selected-location-pin', { type: 'geojson', data: EMPTY_POINTS })
        map.addLayer({
          id: 'selected-location-pin-glow',
          type: 'circle',
          source: 'selected-location-pin',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 9, 8, 15, 16, 22],
            'circle-color': '#74ddf3',
            'circle-opacity': 0.26,
            'circle-blur': 0.72,
          },
        })
        map.addLayer({
          id: 'selected-location-pin-core',
          type: 'circle',
          source: 'selected-location-pin',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 8, 5.5, 16, 7],
            'circle-color': '#e8fbff',
            'circle-stroke-color': '#48cfe9',
            'circle-stroke-width': 2,
          },
        })

        map.addSource('selected-reading-point', { type: 'geojson', data: EMPTY_POINTS })
        map.addLayer({
          id: 'selected-reading-halo',
          type: 'circle',
          source: 'selected-reading-point',
          paint: {
            'circle-radius': ['match', ['get', 'pattern'],
              'co2', ['interpolate', ['linear'], ['get', 'intensity'], 0, 26, 0.5, 48, 1, 72],
              'vapor', ['interpolate', ['linear'], ['get', 'intensity'], 0, 36, 0.5, 62, 1, 88],
              'cloud', ['interpolate', ['linear'], ['get', 'intensity'], 0, 20, 1, 42],
              'haze', ['interpolate', ['linear'], ['get', 'intensity'], 0, 22, 1, 44],
              'pressure', ['interpolate', ['linear'], ['get', 'intensity'], 0, 9, 1, 23],
              'wind', ['interpolate', ['linear'], ['get', 'intensity'], 0, 12, 1, 28],
              'radiant', ['interpolate', ['linear'], ['get', 'intensity'], 0, 15, 1, 34],
              ['interpolate', ['linear'], ['get', 'intensity'], 0, 10, 0.5, 20, 1, 32]],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['match', ['get', 'pattern'], 'co2', 0.34, 'vapor', 0.28, 'cloud', 0.2, 'haze', 0.16, 'pressure', 0.3, 'radiant', 0.26, 0.34],
            'circle-blur': ['match', ['get', 'pattern'], 'co2', 0.58, 'vapor', 0.82, 'cloud', 1, 'haze', 0.98, 'radiant', 0.38, 'pressure', 0.22, 'thermal', 0.48, 'wind', 0.65, 0.78],
          },
        })
        map.addLayer({
          id: 'selected-reading-contour',
          type: 'circle',
          source: 'selected-reading-point',
          filter: ['match', ['get', 'pattern'], ['thermal', 'range', 'moisture', 'vapor', 'dew', 'radiant', 'pressure', 'soil', 'growth', 'evaporation', 'co2'], true, false],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 12, 0.5, 24, 1, 38],
            'circle-color': '#ffffff',
            'circle-opacity': 0,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['match', ['get', 'pattern'], 'co2', 2.1, 'vapor', 2.2, 'pressure', 2.2, 'radiant', 1.9, 'thermal', 1.7, 'range', 1.4, 1],
            'circle-stroke-opacity': ['match', ['get', 'pattern'], 'co2', 0.84, 'vapor', 0.84, 'pressure', 0.86, 'radiant', 0.76, 'growth', 0.68, 'soil', 0.62, 'moisture', 0.58, 0.5],
          },
        })
        map.addLayer({
          id: 'selected-reading-vapor-ripple',
          type: 'circle',
          source: 'selected-reading-point',
          filter: ['==', ['get', 'pattern'], 'vapor'],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 26, 0.5, 45, 1, 66],
            'circle-color': 'rgba(0, 0, 0, 0)',
            'circle-opacity': 0,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1.25,
            'circle-stroke-opacity': 0.62,
          },
        })
        map.addLayer({
          id: 'selected-reading-co2-ripple',
          type: 'circle',
          source: 'selected-reading-point',
          filter: ['==', ['get', 'pattern'], 'co2'],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 32, 0.5, 52, 1, 76],
            'circle-color': 'rgba(0, 0, 0, 0)',
            'circle-opacity': 0,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1.35,
            'circle-stroke-opacity': 0.68,
          },
        })
        map.addLayer({
          id: 'selected-reading-core',
          type: 'circle',
          source: 'selected-reading-point',
          paint: {
            'circle-radius': ['match', ['get', 'pattern'], 'co2', 6.4, 'vapor', 6.5, 'pressure', 3.8, 'wind', 3.5, 'cloud', 4, 'haze', 4, 'radiant', 5.8, 'growth', 5.2, 4.8],
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#f5fbff',
            'circle-stroke-width': 1.7,
          },
        })
        map.addLayer({
          id: 'selected-reading-label',
          type: 'symbol',
          source: 'selected-reading-point',
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 0, 9, 8, 11, 14, 13],
            'text-offset': [0, -1.6],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#07131d',
            'text-halo-width': 1.6,
          },
        })

        map.on('click', 'city-reference-markers', (event) => {
          const id = event.features?.[0]?.properties?.id
          if (typeof id === 'string') onFocusCityRef.current(id)
        })
        map.on('click', (event) => {
          const clickedCity = map.queryRenderedFeatures(event.point, { layers: ['city-reference-markers'] })
          if (!clickedCity.length) onLocationPinRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
        })
        map.on('moveend', () => {
          window.clearTimeout(viewChangeTimer)
          viewChangeTimer = window.setTimeout(() => {
            if (!active) return
            const center = map.getCenter()
            onViewLocationChangeRef.current({ latitude: center.lat, longitude: center.lng })
          }, 420)
        })
        map.on('mouseenter', 'city-reference-markers', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'city-reference-markers', () => { map.getCanvas().style.cursor = '' })
        map.setProjection({ type: 'globe' })
        window.clearTimeout(readyTimer)
        readyTimer = window.setTimeout(() => { if (active) setMapStatus('ready') }, 350)
      } catch (error) {
        configured = false
        console.error('The globe layers could not be initialized.', error)
        if (!fallbackAttempted) {
          fallbackAttempted = true
          setLabelsUnavailable(true)
          map.setStyle(MAP_FALLBACK_STYLE)
        } else {
          setMapError(error instanceof Error ? error.message : 'The globe layers could not be initialized.')
          setMapStatus('error')
        }
      }
    }

    map.on('style.load', configureMap)
    map.once('load', configureMap)
    styleFallbackTimer = window.setTimeout(() => {
      if (!active || configured) return
      fallbackAttempted = true
      setLabelsUnavailable(true)
      try {
        map.setStyle(MAP_FALLBACK_STYLE)
      } catch (error) {
        setMapError(error instanceof Error ? error.message : 'The map style could not be loaded.')
        setMapStatus('error')
      }
    }, 7000)
    map.on('error', (event) => {
      if (event.error) console.warn('A map resource could not be loaded.', event.error)
    })

    return () => {
      active = false
      window.clearTimeout(readyTimer)
      window.clearTimeout(styleFallbackTimer)
      window.clearTimeout(viewChangeTimer)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (mapStatus !== 'ready') return
    sourceAsGeoJson(mapRef.current!, 'city-reference-locations')?.setData(cityFeatures(focusCity?.id ?? null))
  }, [focusCity?.id, mapStatus])

  useEffect(() => {
    if (mapStatus !== 'ready') return
    const map = mapRef.current!
    // OCO-2 has a sparse swath map; avoid drawing an invented purple point halo
    // over it. A clicked location still uses the normal location pin and sound.
    const showReading = showPointReading && dataAvailable && dataset !== 'co2'
    sourceAsGeoJson(map, 'selected-location-pin')?.setData(
      locationPin && !showReading ? pointFeature(locationPin.longitude, locationPin.latitude) : EMPTY_POINTS,
    )
    sourceAsGeoJson(map, 'selected-reading-point')?.setData(
      showReading ? readingPointFeature(readingPoint, readingIntensity, readingColor, readingLabel, readingPattern(dataset)) : EMPTY_POINTS,
    )
  }, [dataAvailable, dataset, locationPin?.latitude, locationPin?.longitude, mapStatus, readingColor, readingIntensity, readingLabel, readingPoint.latitude, readingPoint.longitude, showPointReading])

  useEffect(() => {
    if (mapStatus !== 'ready') return
    const map = mapRef.current
    if (!map) return

    const selectedWeather = weatherMeasurements[Math.max(0, Math.min(weatherIndex, weatherMeasurements.length - 1))]
    // Raster visuals describe the selected dataset and date. They do not
    // depend on the separate point-reading request finishing first.
    const isWeather = dataset === 'weather'
    const rainVisible = isWeather && (weatherMode === 'rain' || weatherMode === 'storm') && selectedYear >= 2000
    const windContextVisible = dataset === 'wind-speed-2m' && selectedYear >= 1981
    const windVisible = (isWeather && (weatherMode === 'wind' || weatherMode === 'storm') && selectedYear >= 1981) || windContextVisible
    const rainDate = weatherTileDate(selectedWeather, selectedYear)
    const windDate = windMapDate(selectedYear)

    map.setLayoutProperty('nasa-gpm-rain-layer', 'visibility', rainVisible ? 'visible' : 'none')
    map.setPaintProperty('nasa-gpm-rain-layer', 'raster-opacity', rainVisible ? weatherMode === 'storm' ? 0.54 : 0.84 : 0)
    if (rainVisible && rasterDatesRef.current.get('nasa-gpm-rain') !== rainDate) {
      ;(map.getSource('nasa-gpm-rain') as RasterTileSource | undefined)?.setTiles([RAIN_TILE.replace('{date}', rainDate)])
      rasterDatesRef.current.set('nasa-gpm-rain', rainDate)
    }

    map.setLayoutProperty('nasa-merra2-wind-layer', 'visibility', windVisible ? 'visible' : 'none')
    map.setPaintProperty('nasa-merra2-wind-layer', 'raster-opacity', windVisible ? isWeather && weatherMode === 'storm' ? 0.48 : 0.84 : 0)
    if (windVisible && rasterDatesRef.current.get('nasa-merra2-wind') !== windDate) {
      ;(map.getSource('nasa-merra2-wind') as RasterTileSource | undefined)?.setTiles([WIND_TILE.replace('{date}', windDate)])
      rasterDatesRef.current.set('nasa-merra2-wind', windDate)
    }

    for (const layer of RASTER_LAYERS) {
      const date = layer.useSelectedRasterDate === false
        ? layer.date(selectedYear)
        : selectedRasterDate ?? layer.date(selectedYear)
      const visible = layer.datasets.includes(dataset) && date !== null
      map.setLayoutProperty(layer.layerId, 'visibility', visible ? 'visible' : 'none')
      map.setPaintProperty(layer.layerId, 'raster-opacity', visible ? layer.opacity : 0)
      if (visible && date && rasterDatesRef.current.get(layer.sourceId) !== date) {
        ;(map.getSource(layer.sourceId) as RasterTileSource | undefined)?.setTiles([tileUrl(layer, date)])
        rasterDatesRef.current.set(layer.sourceId, date)
      }
    }

    const showCityReferences = dataset !== 'weather'
    map.setLayoutProperty('city-reference-halo', 'visibility', showCityReferences ? 'visible' : 'none')
    map.setLayoutProperty('city-reference-markers', 'visibility', showCityReferences ? 'visible' : 'none')
  }, [dataset, mapStatus, selectedRasterDate, selectedYear, weatherIndex, weatherMeasurements, weatherMode])

  useEffect(() => {
    if (mapStatus !== 'ready') return
    const map = mapRef.current
    if (!map) return

    const visible = dataset === 'transpiration-energy'
    map.setLayoutProperty('nasa-power-transpiration-heatmap-layer', 'visibility', visible ? 'visible' : 'none')
    map.setPaintProperty('nasa-power-transpiration-heatmap-layer', 'raster-opacity', visible ? 0.96 : 0)
    if (!visible) return

    let active = true
    const request = ++transpirationImageRequestRef.current
    void loadTranspirationImage().then((url) => {
      if (!active || request !== transpirationImageRequestRef.current) return
      const source = map.getSource('nasa-power-transpiration-heatmap')
      if (source instanceof ImageSource) source.updateImage({ url, coordinates: TRANSPIRATION_IMAGE_COORDINATES })
    }).catch((error: unknown) => {
      if (active) console.warn('The NASA POWER transpiration heat map could not be loaded.', error)
    })
    return () => { active = false }
  }, [dataset, mapStatus])

  useEffect(() => {
    if (mapStatus !== 'ready') return
    const map = mapRef.current
    if (!map) return

    const motion = { duration: reducedMotion ? 0 : 1400, essential: !reducedMotion }
    const focusCityChanged = previousFocusCityIdRef.current !== (focusCity?.id ?? null)
    const weatherContext = dataset === 'weather' && weatherLocation ? `${weatherMode}:${weatherLocation.id}` : null
    const weatherContextChanged = weatherContext !== null
      && (weatherContext !== previousWeatherContextRef.current || (focusCityChanged && !focusCity))
    previousFocusCityIdRef.current = focusCity?.id ?? null
    previousWeatherContextRef.current = weatherContext

    if (cameraRequest && lastCameraRequestIdRef.current !== cameraRequest.id) {
      lastCameraRequestIdRef.current = cameraRequest.id
      map.flyTo({ center: [cameraRequest.point.longitude, cameraRequest.point.latitude], zoom: 4.7, pitch: 0, bearing: 0, ...motion })
      return
    }
    if (focusCity && focusCityChanged) {
      map.flyTo({ center: [focusCity.longitude, focusCity.latitude], zoom: 14, pitch: 35, bearing: 18, ...motion })
      return
    }
    if (focusCity || locationPin) return
    if (dataset === 'weather' && weatherContextChanged && weatherLocation) {
      map.flyTo({ center: [weatherLocation.longitude, weatherLocation.latitude], zoom: 4.4, pitch: 0, bearing: 0, ...motion })
      return
    }
    if (focusCityChanged) map.flyTo({ center: [-20, 18], zoom: 1.15, pitch: 0, bearing: 0, ...motion })
  }, [cameraRequest?.id, cameraRequest?.point.latitude, cameraRequest?.point.longitude, dataset, focusCity?.id, locationPin?.latitude, locationPin?.longitude, mapStatus, reducedMotion, weatherLocation, weatherMode])

  const error = mapStatus === 'error'

  return (
    <div className="earth-map-shell">
      <div
        ref={containerRef}
        className="earth-canvas"
        role="application"
        aria-label={tx("Interactive satellite Earth globe with NASA science layers. Drag to rotate or pan, and scroll to zoom.")}
      />
      {labelsUnavailable && mapStatus === 'ready' && (
        <div className="map-layer-note" role="status">{tx("Satellite view · place labels unavailable")}</div>
      )}
      {mapStatus !== 'ready' && (
        <div className={`globe-map-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} title={mapError ? tx(mapError) : undefined}>
          {error
            ? <><strong>{tx("Globe map could not load")}</strong><span>{tx("Check your connection, then reload the page.")}</span></>
            : <><span className="loading-orbit" /><span>{tx("Loading satellite imagery…")}</span></>}
        </div>
      )}
    </div>
  )
}
