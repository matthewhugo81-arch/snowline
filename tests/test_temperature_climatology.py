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
    def test_ecmwf_reference_matches_grid_and_original_provenance(self):
        path=ROOT/'climatology/haduk-extrema-1991-2020-ecmwf.npz'
        manifest=json.loads((path.parent/'manifest.json').read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['ecmwf_prepared_sha256'])
        normals=read_normals(path,'ecmwf',include_ireland=False)
        with np.load(path,allow_pickle=False) as z:
            self.assertEqual(json.loads(str(z['provenance'])),manifest['sources'])
            for a in normals.values():
                self.assertEqual(a.shape,(12,69,105))
                np.testing.assert_equal(np.isfinite(a),z['land_cell_count']>0)
                self.assertTrue(np.all(np.isfinite(a).sum(axis=(1,2))>300))
                self.assertTrue(np.isnan(a[:,0,0]).all())

    def test_verified_reference_and_source_provenance(self):
        path=ROOT/'climatology/haduk-extrema-1991-2020.npz'
        manifest=json.loads((path.parent/'manifest.json').read_text(encoding='utf8'))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['prepared_sha256'])
        normals=read_normals(path,include_ireland=False)
        with np.load(path,allow_pickle=False) as z:
            self.assertEqual(json.loads(str(z['provenance'])),manifest['sources'])
        np.testing.assert_equal(np.isfinite(normals['min']),np.isfinite(normals['max']))
        for a in normals.values():
            self.assertTrue(np.all(np.isfinite(a).sum(axis=(1,2))>50000))
            self.assertGreater(float(np.nanmin(a)),-20)
            self.assertLess(float(np.nanmax(a)),35)

    def test_orientation_land_mask_and_seasonal_cycle(self):
        normals=read_normals(ROOT/'climatology/haduk-extrema-1991-2020.npz',include_ireland=False)
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


class IrelandReference(unittest.TestCase):
    def test_irish_cells_added_uk_unchanged_and_sea_missing_in_every_month(self):
        from temperature_climatology import anomaly_reference
        projection='+proj=laea +lat_0=54.9 +lon_0=-2.5 +a=6378137 +b=6356752.314140356 +units=m'
        transform=Transformer.from_crs('EPSG:4326',projection,always_xy=True)
        cities=[(-6.26,53.35),(-8.47,51.90),(-9.05,53.28),(-8.47,54.27),(-7.73,54.95),(-9.70,52.27)]
        for model,suffix in [('mogreps_uk',''),('ecmwf','-ecmwf')]:
            path=ROOT/f'climatology/haduk-extrema-1991-2020{suffix}.npz'
            old=read_normals(path,model,include_ireland=False);new=read_normals(path,model)
            for kind in old:
                finite=np.isfinite(old[kind])
                np.testing.assert_array_equal(new[kind][finite],old[kind][finite])
                self.assertTrue(np.all(np.isfinite(new[kind]).sum(axis=(1,2))>finite.sum(axis=(1,2))))
                for lon,lat in cities+[(-.12,51.5),(-3.19,55.95),(-5.93,54.6)]:
                    if model=='ecmwf':iy,ix=round((lat-46)/.25),round((lon+16)/.25)
                    else:
                        x,y=transform.transform(lon,lat);iy,ix=round((y+1036000)/2000),round((x+1158000)/2000)
                    self.assertTrue(np.isfinite(new[kind][:,iy,ix]).all(),(model,kind,lon,lat))
                lon,lat=-12,53
                if model=='ecmwf':iy,ix=round((lat-46)/.25),round((lon+16)/.25)
                else:
                    x,y=transform.transform(lon,lat);iy,ix=round((y+1036000)/2000),round((x+1158000)/2000)
                self.assertTrue(np.isnan(new[kind][:,iy,ix]).all())
            reference=anomaly_reference(path,model)
            self.assertEqual(reference['dataset'],'HadUK-Grid + Met Eireann')
            self.assertEqual(len(reference['inputs']),2)
            self.assertEqual(len(reference['revision']),64)

    def test_corrupt_supplement_is_rejected(self):
        from tempfile import TemporaryDirectory
        import shutil
        with TemporaryDirectory() as temporary:
            folder=Path(temporary)
            for name in ['haduk-extrema-1991-2020-ecmwf.npz','met-eireann-extrema-1991-2020-ecmwf.npz','ireland-manifest.json']:
                shutil.copy(ROOT/'climatology'/name,folder/name)
            with (folder/'met-eireann-extrema-1991-2020-ecmwf.npz').open('ab') as f:f.write(b'changed')
            with self.assertRaisesRegex(ValueError,'checksum'):
                read_normals(folder/'haduk-extrema-1991-2020-ecmwf.npz','ecmwf')


if __name__=='__main__':unittest.main()
