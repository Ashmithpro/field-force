import { Activity, CloudRain, Wind, type LucideIcon } from 'lucide-react'
import { weatherLocations } from '../data/datasets'
import { useLanguage } from '../i18n'
import type { WeatherMode } from '../types'

const modes: Array<{ key: WeatherMode; label: string; Icon: LucideIcon }> = [
  { key: 'rain', label: 'Rain', Icon: CloudRain },
  { key: 'wind', label: 'Wind', Icon: Wind },
  { key: 'storm', label: 'Storm', Icon: Activity },
]

interface WeatherControlsProps {
  mode: WeatherMode
  locationId: string
  loading: boolean
  error: string | null
  onModeChange: (mode: WeatherMode) => void
  onLocationChange: (locationId: string) => void
  onRetry: () => void
}

export default function WeatherControls({
  mode,
  locationId,
  loading,
  error,
  onModeChange,
  onLocationChange,
  onRetry,
}: WeatherControlsProps) {
  const { t, tx } = useLanguage()
  return (
    <section className="weather-controls" aria-label={t('weatherLens')}>
      <div className="weather-control-heading"><span>{t('weatherLens')}</span><span className="weather-control-dot" /></div>
      <div className="weather-mode-switch" role="group" aria-label={t('chooseWeatherLayer')}>
        {modes.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            className={`weather-mode-option ${mode === key ? 'active' : ''}`}
            onClick={() => onModeChange(key)}
            aria-pressed={mode === key}
          >
            <Icon size={13} /> {t(key)}
          </button>
        ))}
      </div>
      <label className="weather-select-label">
        <span>{t('measureNear')}</span>
        <select
          value={locationId}
          onChange={(event) => onLocationChange(event.target.value)}
          aria-label={t('measureNear')}
        >
          {weatherLocations.map((place) => <option key={place.id} value={place.id}>{tx(place.label)}</option>)}
        </select>
      </label>
      <div className={`weather-control-status ${error ? 'error' : ''}`} aria-live="polite" aria-busy={loading}>
        {error ? <><span>{tx(error)}</span><button type="button" onClick={onRetry}>{t('retry')}</button></> : loading ? <><span className="weather-loading-dot" /> {t('updating')}</> : tx(`NASA POWER · latest available · GEOS-IT + MERRA-2 · ${mode === 'rain' ? 'rain' : mode === 'wind' ? 'wind' : 'rain + wind'}`)}
      </div>
    </section>
  )
}
