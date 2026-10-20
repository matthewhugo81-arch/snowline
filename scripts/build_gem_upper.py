"""Additional native GDPS comparison fields, independently retryable from omega."""
import build_vertical_motion as native

LEVELS = {
    'temperature': [1000, 850, 500, 250],
    'geopotential_height': [500, 300, 200],
    'relative_humidity': [1000, 700, 300],
    'wind_u_component': [1000, 500, 300, 200],
    'wind_v_component': [1000, 500, 300, 200],
}
SPECS = {
    'temperature': ('AirTemp', 130, 'K', '°C', 20),
    'geopotential_height': ('GeopotentialHeight', 156, 'gpm', 'm', 1),
    'relative_humidity': ('RelativeHumidity', 157, '%', '%', 1),
    'wind_u_component': ('WindU', 131, 'm s**-1', 'm/s', 10),
    'wind_v_component': ('WindV', 132, 'm s**-1', 'm/s', 10),
}

def configure():
    fields = [(f'{kind}_{level}hPa', SPECS[kind]) for kind, levels in LEVELS.items() for level in levels]
    native.CONFIG['gem'] = {
        **native.CONFIG['gem'], 'domain': 'snowline_gem_upper',
        # Upper pressure levels switch to six-hourly after T+168.
        'forecast_hours': list(range(0,169,3))+list(range(174,241,6)),
        'method':'Native regional subset; temperature converted K to °C, height in m, relative humidity in %, earth-relative wind components in m/s.',
        'fields': [key for key, _ in fields],
        'variables': [spec[0] for _, spec in fields],
        'params': [spec[1] for _, spec in fields],
        'units': [spec[2] for _, spec in fields],
        'output_units': {key: spec[3] for key, spec in fields},
        'scales': {key: spec[4] for key, spec in fields},
    }

if __name__ == '__main__':
    configure()
    native.main()
