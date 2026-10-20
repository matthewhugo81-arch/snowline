# IFS 9 km field coverage — 20 October 2026

The 20 October 00Z Open-Meteo `ecmwf_ifs` metadata contains 43 source
variables, with 145 native valid times through T+360. Snowline reads these
spatial files directly in the browser and checks for new publications every
60 seconds; it does not maintain a separate copy of this feed.

The actual T+12 OM header confirms the advertised fields on the O1280 reduced
Gaussian grid (1 × 6,599,680 cells). It contains no pressure-level temperature,
humidity, geopotential or winds. Therefore this feed cannot provide 850 hPa
theta-w, pressure-level vorticity, vertical motion or upper-air charts. These
remain available from IFS 0.25° at their stated resolution. No coarse fields
are substituted into the IFS 9 km model.

The audit found six native arrays without map descriptions. They are now
available as five layers:

- Snow density, kg/m³. Its note explains that snow-free cells can carry a
  default density and that it must be interpreted alongside snow depth.
- Ocean current speed and direction, from the paired eastward/northward
  components, in m/s.
- Sea-ice thickness and sea-level height, in metres.
- Sea-water salinity, in g/kg.

Two surface diagnostics now use the original IFS 9 km inputs in one file:
2 m relative humidity from temperature/dew point using Open-Meteo's Magnus
coefficients, and diffuse radiation from total shortwave minus direct radiation.
Native fields take precedence. Missing inputs remain missing; inconsistent
radiation remains missing apart from 1 W/m² packing roundoff. Radiation retains
its native reporting interval and excludes initialization.

All 43 advertised native variables are now accounted for by map layers or the
MSLP overlay; U/V pairs are represented as speed/direction. This is an audit of
this published feed, not a claim that every product in ECMWF's full catalogue
or every conceivable derived diagnostic is implemented.

Verification: 553 Node regression tests passed. Real clipped land/ocean reads
confirmed units, missing land masks and both surface calculations. At a North
Sea grid cell near 54°N, 2°E, T+12 total/direct radiation were 415/343 W/m² and
derived diffuse radiation was 72 W/m²; salinity was 34.70 g/kg and sea-level
height −0.37 m.

Provider references:

- [Live IFS 9 km metadata](https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json)
- [Open-Meteo ECMWF documentation](https://open-meteo.com/en/docs/ecmwf-api)
- [Native IFS field units](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/EcmwfEcpds/EcmwfEcpdsVariable.swift)
- [Provider meteorological calculations](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Meteorology.swift)
- [ECMWF's announced 0.1° release](https://forum.ecmwf.int/t/ecmwf-free-and-open-data-at-9-km-soon-to-come/15366)

ECMWF's 16 October update targets the week beginning 19 October for the free
0.1° distribution, following its initial end-of-October announcement. This
will use a regular latitude/longitude grid, rather than native O1280.
The actual 20 October 00Z IFS directory still lists only
`0p25`. The announced product must be verified and integrated when published;
it is not presently collected by Snowline and is distinct from the existing
O1280 surface feed.

All seven additions rendered with real T+12 spatial data in the browser
without page errors. For that bounded rendering check, the metadata's time
list was restricted to the single audited frame to avoid unrelated preload
traffic; the production run's complete 145-step metadata remains unchanged.
Versioned imports propagate through the map and briefing dependency chains so
returning browsers load the new catalogue, source selection and derivations
together.
