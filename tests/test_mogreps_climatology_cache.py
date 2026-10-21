from pathlib import Path
import sys
import tempfile
import unittest
import netCDF4
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import mogreps_climatology_cache as cache


class ClimatologyCacheTests(unittest.TestCase):
    def test_exact_period_level_grid_and_units_survive_compact_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            raw=Path(directory)/'source.nc'
            target=Path(directory)/'climate.npz'
            with netCDF4.Dataset(raw,'w') as ds:
                for name,size in [('time',365),('level',1),('lat',73),('lon',144)]:
                    ds.createDimension(name,size)
                times=ds.createVariable('time','f8',('time',));times.units='days since 0001-01-01';times.climo_period=cache.PERIOD;times[:]=np.arange(365)
                ds.createVariable('level','f4',('level',))[:]=[500]
                ds.createVariable('lat','f4',('lat',))[:]=np.arange(90,-90.1,-2.5)
                ds.createVariable('lon','f4',('lon',))[:]=np.arange(0,360,2.5)
                values=ds.createVariable('hgt','f4',('time','level','lat','lon'));values.units='m';values[:]=5500.5
            cache.prepare(target,raw)
            actual=cache.read_cache(target)
            self.assertEqual(actual.shape,(365,73,144))
            self.assertEqual(float(actual[293,10,20]),5500.5)
            with netCDF4.Dataset(raw,'a') as ds:
                ds['hgt'].units='dam'
            with netCDF4.Dataset(raw) as ds,self.assertRaisesRegex(ValueError,'Unverified'):
                cache.verified_values(ds)
            with np.load(target,allow_pickle=False) as saved:
                corrupted={key:saved[key] for key in saved.files}
            corrupted['values'][0,0,0]+=1
            np.savez_compressed(target,**corrupted)
            with self.assertRaisesRegex(ValueError,'checksum'):
                cache.read_cache(target)


if __name__=='__main__':
    unittest.main()
