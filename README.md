# Field Force

An interactive Earth-science explorer that presents NASA data as readable values, map colors, and plain-language explanations. Scientific measurements and raster overlays come from NASA products. The satellite basemap and place labels are contextual layers, credited in the app.

The explorer automatically uses the newest supported data window for each dataset. Year selection and year comparison are not shown; this keeps the interface on recent data. The latest calendar year may be incomplete, and sparse satellite sampling or masked pixels can still leave some locations without a valid reading.

Visitors can request their location only by pressing **My Location**. The globe flies to the point and keeps its coordinates in browser memory; newly generated share links omit exact coordinates. Hovering the map previews readings where point sampling is supported. Pinning a location updates the measurement panel. The site does not play audio or use speech synthesis.

The interface offers 30 languages: English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Hindi, Arabic, Italian, Russian, Indonesian, Dutch, Turkish, Bengali, Urdu, Swahili, Polish, Ukrainian, Vietnamese, Thai, Filipino, Persian, Greek, Hebrew, Swedish, Tamil, Telugu, and Malay. Locale packs load on demand and translate the interface, dataset explanations, map captions, status and error messages, and accessibility labels. Product identifiers, scientific units, source organization names, map place labels, and the no-JavaScript fallback remain in their original language where needed for identification or because the app cannot run. The translations are machine-generated and may benefit from review by native speakers.

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Create a production build with `npm run build`, then serve `dist` with a static web server. The GISTEMP live-data route is available in Vite development and preview; static hosts use the bundled NASA snapshot.

## Data sources and coverage

| View | NASA source | What the app shows |
| --- | --- | --- |
| Global temperature | [NASA GISS GISTEMP v4](https://data.giss.nasa.gov/gistemp/data_v4.html) | Global land-ocean temperature anomaly relative to 1951–1980, from 1880 onward. NASA's GISTEMP analysis uses NOAA/NCEI land-station and sea-surface-temperature input records ([NASA source notes](https://data.giss.nasa.gov/gistemp/datasources_v4.html)); this app reads the combined NASA GISTEMP table, not NOAA endpoints directly. The map uses a separate NASA AIRS monthly temperature raster for 2002 onward. |
| Rain and wind | [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) and [NASA POWER meteorology sources](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily precipitation and 10 m wind at the selected coordinates, from 1981 onward. NASA GPM IMERG precipitation and NASA MERRA-2 monthly wind are separate map layers; they do not supply the plotted daily values. |
| Ocean temperature | [NASA/JPL MUR SST via NASA GIBS](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/GHRSST_L4_MUR_Sea_Surface_Temperature.json) | Daily sea-surface temperature imagery. At a pinned ocean point, the app samples a map pixel on the 15th of each available month in the latest calendar year and averages valid samples. The result is an approximate map-color-bin sample, not a true monthly or annual product statistic; the current year can be partial. |
| Atmospheric CO₂ | [NASA OCO-2 via NASA GIBS](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/OCO-2_Carbon_Dioxide_Total_Column_Average.json) | Daily, sparse orbital swaths of total-column CO₂, starting in 2014. The latest value is an approximate mean of sampled visible swath pixels in the current data window (which allows for a 120-day latency), not a continuous station record or a complete global daily mean. |
| Vegetation | [NASA Terra MODIS NDVI via NASA GIBS](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Terra_NDVI_8Day.json) | A selected point's latest complete 8-day NDVI composite, from 2000 onward. Color bins are approximate; water, cloud, and masked pixels do not have values. |
| Land-surface temperature | [NASA MOD11A2 v061](https://lpdaac.usgs.gov/products/mod11a2v061/) cataloged and served by [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/catalog) | Quality-screened daytime value at the selected point from an 8-day 1 km GeoTIFF, converted from Kelvin with the NASA 0.02 scale factor. This is surface skin temperature, not air temperature. The map display is a separate NASA GIBS overlay. |
| Plant productivity | [NASA MOD17A2HGF v061](https://lpdaac.usgs.gov/products/mod17a2hgfv061/) cataloged and served by [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/catalog) | Quality-screened 500 m GPP sample from the latest available 8-day composite near the current date. The app applies the NASA 0.0001 scale factor. Water, barren, urban, and permanently snow-covered pixels have no valid GPP reading. |
| Snow cover | [NASA MOD10A1 v061](https://lpdaac.usgs.gov/products/mod10a1v061/) cataloged and served by [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/catalog) | Latest quality-screened daily snow-cover percentage available at the pinned point from a 500 m GeoTIFF. The map display is a separate NASA Terra MODIS layer from NASA GIBS. |
| Relative humidity | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/derived/met-derived-parameters/) | Daily 2 m relative humidity from NASA POWER at the selected map point, from 1981 onward. It is a gridded analysis estimate, not a local station observation. |
| Specific humidity | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily 2 m water-vapor mass per mass of moist air (g/kg), from 1981 onward. This is distinct from relative humidity and from a rain measurement. |
| Precipitable water | [NASA POWER daily `PW`](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/) | Daily column-integrated atmospheric water vapor, expressed as the depth of liquid water if condensed (cm), from 2001 onward. It is not precipitation at the surface. |
| Cloud amount | [NASA POWER / CERES SYN1deg](https://power.larc.nasa.gov/docs/methodology/data/sources_clds_aerosols/) | Daily mean cloud amount from the NASA CERES SYN1deg product, from 2001 onward. It is a gridded point sample; the familiar basemap is context, not a cloud raster. |
| Solar radiation | [NASA POWER / GEWEX SRB + CERES](https://power.larc.nasa.gov/docs/methodology/data/sources_fluxes/) | Daily all-sky shortwave radiation at the surface, from 1984 onward. Clouds are included; the source transitions from NASA GEWEX SRB to NASA CERES around 2001. |
| Downward longwave radiation | [NASA POWER / CERES SYN1deg and FLASHFlux](https://power.larc.nasa.gov/docs/methodology/data/sources_fluxes/) | Daily all-sky longwave energy reaching the surface, in MJ/m²/day, from 2001 onward. NASA uses FLASHFlux for lower-latency near-real-time updates; this is surface energy flux, not air temperature. |
| Aerosol optical depth | [NASA POWER / CERES SYN1deg](https://power.larc.nasa.gov/docs/methodology/data/sources_clds_aerosols/) | Daily adjusted optical depth at 550 nm, from 2001 onward. This is a full atmospheric-column measure and does not represent surface air quality. |
| Surface pressure | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily mean gridded surface pressure at the selected point, from 1981 onward. The model grid's elevation and resolution affect how local the estimate is. |
| Near-surface wind | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily mean wind speed at 2 m, from 1981 onward. It is a point series distinct from the existing 10 m weather wind and map layer. |
| Air temperature | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily 2-meter air temperature at the selected point, from 1981 onward. This local gridded estimate is distinct from the NASA GISTEMP global anomaly and MODIS land-surface temperature.  |
| Daily minimum air temperature | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | UTC daily minimum 2-meter temperature calculated from hourly model values, from 1981 onward. |
| Daily maximum air temperature | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | UTC daily maximum 2-meter temperature calculated from hourly model values, from 1981 onward. |
| Daily temperature range | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily 2-meter high-to-low temperature difference in °C, from 1981 onward. It is a range, not a mean or anomaly. |
| Wet-bulb temperature | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily 2 m wet-bulb temperature from 1981 onward. It combines air temperature and moisture in a gridded atmospheric analysis; it is not a heat-stress warning. |
| Dew / frost point | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) | Daily 2-meter dew/frost point from 1981 onward, a gridded estimate of atmospheric saturation temperature, not a fog or surface-wetness observation. |
| Surface soil wetness | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/) | Daily top-layer surface wetness fraction from 1981 onward. This is modeled land-surface wetness, not a direct probe or the finer SMAP soil-moisture product. |
| Land evaporation | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/) | Daily estimated land evaporation in mm/day, from 1981 onward; this is a land flux, not precipitation. |
| Transpiration energy flux | [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/) | Daily latent-heat energy flux associated with plant transpiration, in MJ/m²/day, from 1981 onward. It is not a direct plant-growth or water-depth reading. |

All scientific map imagery is served by [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs). The base satellite image and map labels are there to orient the viewer; they do not provide the app's scientific readings. They use [Esri and its imagery partners](https://www.esri.com/en-us/arcgis/products/arcgis-living-atlas/imagery) and [OpenFreeMap](https://openfreemap.org/) with [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). City markers are reference coordinates defined by the app, and a pin uses coordinates selected by the user.

NASA-hosted products can combine observations from partner agencies. GISTEMP is the clearest example: NASA publishes the analysis, and its documented land and ocean input records come from NOAA/NCEI. The app does not query any NOAA API or use a NOAA basemap. Its measurement sources are NASA POWER, NASA GISS, NASA GIBS, and NASA LP DAAC products distributed by Microsoft Planetary Computer.

The added MODIS values are read from the NASA LP DAAC raster pixels hosted by Microsoft's Planetary Computer. The app uses Planetary Computer only as a catalog and data distributor; the product, scaling, and quality flags are NASA MODIS. These values use exact source raster pixels, unlike the approximate color-bin samples used for MUR and NDVI.

## Reading and exploration

Selected readings appear as text alongside the dataset description, date, units, NASA source, and caveats. Map colors and point markers summarize the selected NASA product; they are not additional observations. Global temperature anomalies remain distinct from local air and land-surface temperatures.


Use the CSV control to export the current latest-data window. Each row includes its value and unit, date, available coordinates, related weather measurement, dataset caveat, sample note, and NASA source link, ready to inspect in Rainbow CSV or a spreadsheet.

Choosing a new map point loads its NASA measurement automatically. A point-based layer can show no reading over water, cloud, or masked pixels, depending on the product.

## Why a selection can show no data

The app automatically selects the newest data window supported by each NASA product. Point-based layers can also be blank over land, water, cloud, or masked pixels. MODIS GPP is intentionally absent on water, barren, urban, and permanently snow-covered surfaces. OCO-2 observes narrow satellite swaths rather than a complete globe, and its recent observations arrive with a delay. Move the map pin to a valid pixel. The page identifies the source and explains the coverage for each dataset.

Map tiles and NASA APIs need an internet connection. No NASA Earthdata credentials are stored in browser code.
#   f i e l d - f o r c e  
 #   f i e l d - f o r c e  
 