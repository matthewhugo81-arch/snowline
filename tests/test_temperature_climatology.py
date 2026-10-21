"""Checks against the installed, authenticated-source reference artifact."""
import hashlib
import json
from pathlib import Path
import sys
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from temperature_climatology import read_normals
from pyproj import Transformer


class HadUKReference(unittest.TestCase):
    def test_verified_reference_and_source_provenance(self):
        path=ROOT/'climatology/haduk-extrema-1991-2020.npz'
        manifest=json.loads((path.parent/'manifest.json').read_text(encoding='utf8'))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['prepared_sha256'])
        normals=read_normals(path)
        with np.load(path,allow_pickle=False) as z:
            self.assertEqual(json.loads(str(z['provenance'])),manifest['sources'])
        np.testing.assert_equal(np.isfinite(normals['min']),np.isfinite(normals['max']))
        for a in normals.values():
            self.assertTrue(np.all(np.isfinite(a).sum(axis=(1,2))>50000))
            self.assertGreater(float(np.nanmin(a)),-20)
            self.assertLess(float(np.nanmax(a)),35)

    def test_orientation_land_mask_and_seasonal_cycle(self):
        normals=read_normals(ROOT/'climatology/haduk-extrema-1991-2020.npz')
        projection='+proj=laea +lat_0=54.9 +lon_0=-2.5 +a=6378137 +b=6356752.314140356 +units=m'
        transform=Transformer.from_crs('EPSG:4326',projection,always_xy=True)
        def cell(lon,lat):
            x,y=transform.transform(lon,lat)
            return round((y+1036000)/2000),round((x+1158000)/2000)
        for lon,lat in [(-.12,51.5),(-3.19,55.95),(-5.93,54.6)]:
            iy,ix=cell(lon,lat)
            for a in normals.values():
                self.assertTrue(np.isfinite(a[:,iy,ix]).all())
                self.assertGreater(a[6,iy,ix],a[0,iy,ix]+5)
        iy,ix=cell(-8,55)
        self.assertTrue(np.isnan(normals['min'][:,iy,ix]).all())


if __name__=='__main__':unittest.main()
