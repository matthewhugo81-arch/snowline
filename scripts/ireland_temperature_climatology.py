"""Prepare the verified Met Eireann 1991-2020 extrema supplement offline.

Only supplied 1 km land cells are used. No coastal extrapolation, temperature
proxies or changes to the existing HadUK reference are made.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
import numpy as np
from pyproj import Transformer

URL = 'https://www.met.ie/cms/assets/uploads/2024/07/IE_TEMP_9120_V2.zip'
ARCHIVE_SHA256 = 'f8ec55433fef2d6f0c9876e0c6b8c7c6bc50290c67ed31151c705dbd478da463'
SOURCE_HASHES = {
    'min': '9219851842aac5b56a610fcabab201e67660cb1f1da7a7ad64fa0d6c2992cd5a',
    'max': '3247967a45601fb180bda8f9540a8c1596eb2288cdca981faa798f4b9b4bd7f3',
}
PROJECTION = '+proj=laea +lat_0=54.9 +lon_0=-2.5 +a=6378137 +b=6356752.314140356 +units=m'


def read_source(path):
    payload = Path(path).read_bytes()
    if hashlib.sha256(payload).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Unverified Met Eireann archive; review upstream revisions before use')
    values, provenance, coordinates = {}, {}, None
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for kind in ('min', 'max'):
            name = f'IE_T{kind.upper()}_9120_V2.txt'
            raw = archive.read(name)
            digest = hashlib.sha256(raw).hexdigest()
            if digest != SOURCE_HASHES[kind]:
                raise ValueError('Unexpected extrema source checksum')
            header = raw.decode().splitlines()[0].replace('"', '').split()
            if header[:14] != ['east', 'north'] + [f'm{m}T{kind}' for m in range(1, 13)]:
                raise ValueError('Wrong extrema statistic or month order')
            table = np.loadtxt(io.BytesIO(raw), skiprows=1)
            if table.shape != (70091, 19) or not np.isfinite(table).all():
                raise ValueError('Incomplete Irish source grid')
            xy = table[:, :2].astype(np.int64)
            if not np.array_equal(xy, table[:, :2]) or np.any(xy % 1000) or len(np.unique(xy, axis=0)) != len(xy):
                raise ValueError('Invalid 1 km Irish Grid coordinates')
            if coordinates is not None and not np.array_equal(coordinates, xy):
                raise ValueError('Minimum and maximum source grids differ')
            coordinates = xy
            values[kind] = table[:, 2:14].T.astype(np.float32)
            provenance[kind] = dict(file=name, sha256=digest)
    if np.any(values['min'] > values['max']) or any(np.any((v < -20) | (v > 40)) for v in values.values()):
        raise ValueError('Invalid Celsius extrema normals')
    return coordinates, values, provenance


def sample_native(xy, values):
    # Lookup the containing 1 km cell, retaining holes and coastlines in the
    # supplied grid. A nearest-land search would incorrectly fill the sea.
    x, y = np.meshgrid(-1158000 + 2000*np.arange(1042), -1036000 + 2000*np.arange(970))
    east, north = Transformer.from_crs(PROJECTION, 'EPSG:29902', always_xy=True).transform(x, y)
    origin = xy.min(axis=0)
    indices = (xy-origin)//1000
    nx, ny = indices.max(axis=0)+1
    lookup = np.full((ny, nx), -1, dtype=np.int32)
    lookup[indices[:, 1], indices[:, 0]] = np.arange(len(xy))
    ix = np.floor((east-origin[0])/1000 + .5).astype(int)
    iy = np.floor((north-origin[1])/1000 + .5).astype(int)
    inside = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    ids = lookup[np.clip(iy, 0, ny-1), np.clip(ix, 0, nx-1)]
    use = inside & (ids >= 0)
    return {k: np.where(use, v[:, np.maximum(ids, 0)], np.nan) for k, v in values.items()}, use.astype(np.int32)


def average_ecmwf(xy, values):
    lon, lat = Transformer.from_crs('EPSG:29902', 'EPSG:4326', always_xy=True).transform(xy[:, 0], xy[:, 1])
    ix = np.floor((lon+16+.125)/.25).astype(int)
    iy = np.floor((lat-46+.125)/.25).astype(int)
    if not np.all((ix >= 0) & (ix < 105) & (iy >= 0) & (iy < 69)):
        raise ValueError('Irish reference extends outside the forecast grid')
    ids = iy*105+ix
    count = np.bincount(ids, minlength=69*105)
    result = {}
    for kind, data in values.items():
        months = []
        for month in data:
            total = np.bincount(ids, weights=month, minlength=69*105)
            months.append(np.divide(total, count, out=np.full(total.shape, np.nan), where=count > 0).reshape(69, 105))
        result[kind] = np.asarray(months, dtype=np.float32)
    return result, count.reshape(69, 105)


def prepare(archive, folder):
    xy, values, provenance = read_source(archive)
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    artifacts = {}
    for model, mapper, suffix in [('mogreps_uk', sample_native, ''), ('ecmwf', average_ecmwf, '-ecmwf')]:
        normals, count = mapper(xy, values)
        name = f'met-eireann-extrema-1991-2020{suffix}.npz'
        path = folder/name
        np.savez_compressed(path, **normals, land_cell_count=count, period='1991-2020',
                            statistic='monthly extrema normals', units='degC', model=model,
                            dataset='Met Eireann', provenance=json.dumps(provenance))
        artifacts[model] = dict(file=name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                land_cells=int(np.count_nonzero(count)), bytes=path.stat().st_size)
    manifest = dict(dataset='Met Eireann', period='1991-2020', source_url=URL,
                    archive_sha256=ARCHIVE_SHA256, source_crs='EPSG:29902', sources=provenance,
                    source_points=len(xy), artifacts=artifacts,
                    licence='https://creativecommons.org/licenses/by/4.0/',
                    licence_notice='https://www.met.ie/about-us/specialised-services/open-data',
                    method='Native MOGREPS: containing supplied 1 km cell. ECMWF: mean of supplied 1 km land points per 0.25 degree cell. Existing finite HadUK pairs always take precedence.')
    (folder/'ireland-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
    print(json.dumps(artifacts, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, default=Path('climatology'))
    args = parser.parse_args()
    prepare(args.archive, args.output)
