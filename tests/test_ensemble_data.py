import sys
from pathlib import Path
from datetime import datetime, timezone
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_ensembles as b
from omfiles import OmFileReader


class EnsembleDataTests(unittest.TestCase):
    def test_units_keep_temperature_spread_an_interval(self):
        a = b.np.array([273.15, 278.15])
        b.np.testing.assert_allclose(b.normalize_values(a, 'temperature_850hPa', 'mean', 'K'), [0, 5], atol=.0001)
        b.np.testing.assert_array_equal(b.normalize_values(b.np.array([0, 2.5]), 'temperature_850hPa', 'spread', 'K'), [0, 2.5])
        for stat in ('mean', 'spread'):
            b.np.testing.assert_array_equal(b.normalize_values(b.np.array([100000]), 'pressure_msl', stat, 'Pa'), [1000])
        with self.assertRaises(ValueError):
            b.normalize_values(a, 'temperature_850hPa', 'mean', 'C')
        with self.assertRaises(ValueError):
            b.normalize_values(b.np.array([-1]), 'temperature_850hPa', 'spread', 'K')

    def test_indices_reject_wrong_statistic_missing_levels_and_duplicates(self):
        text='1:0:d=2026101100:HGT:500 mb:anl:ens mean\n2:100:d=2026101100:TMP:850 mb:anl:ens mean\n3:200:d=2026101100:PRMSL:mean sea level:anl:ens mean\n'
        self.assertEqual(b.gefs_records(text, 'mean')['temperature_850hPa'], (100, 100))
        with self.assertRaises(ValueError): b.gefs_records(text, 'spread')
        rows=[dict(type='em',step='24',param=v[2],levtype=v[3],levelist=v[4],_offset=i*100,_length=100) for i,v in enumerate(b.FIELDS.values())]
        self.assertEqual(len(b.ecmwf_records(rows,24,'mean')),3)
        for invalid in [rows[:-1],rows+rows[:1]]:
            with self.assertRaises(ValueError): b.ecmwf_records(invalid,24,'mean')
        with self.assertRaises(ValueError): b.ecmwf_records(rows,24,'spread')

    def test_grib_orientation_units_cycle_and_statistic(self):
        ec=b.ec
        g=ec.codes_grib_new_from_samples('regular_ll_pl_grib2')
        try:
            for k,v in dict(Ni=720,Nj=361,latitudeOfFirstGridPointInDegrees=90,latitudeOfLastGridPointInDegrees=-90,
                            longitudeOfFirstGridPointInDegrees=0,longitudeOfLastGridPointInDegrees=359.5,
                            iDirectionIncrementInDegrees=.5,jDirectionIncrementInDegrees=.5,
                            productDefinitionTemplateNumber=2,derivedForecast=0,numberOfForecastsInEnsemble=30,
                            dataDate=20261011,dataTime=0,forecastTime=24,level=850,paramId=130).items():
                ec.codes_set(g,k,v)
            native=b.np.full((361,720),273.15);native[0,360]=283.15;native[-1,0]=263.15
            ec.codes_set_values(g,native.ravel())
            source=SimpleNamespace(run=datetime(2026,10,11,tzinfo=timezone.utc),config=b.MODELS['gefs'])
            message=ec.codes_get_message(g)
            result=b.decode(message,'temperature_850hPa','mean',source,24)
            self.assertAlmostEqual(float(result[-1,0]),10,places=3)
            self.assertAlmostEqual(float(result[0,360]),-10,places=3)
            with self.assertRaises(ValueError): b.decode(message,'temperature_850hPa','spread',source,24)
            with self.assertRaises(ValueError): b.decode(message,'temperature_850hPa','mean',source,27)
            with self.assertRaises(ValueError): b.decode(message[:-1],'temperature_850hPa','mean',source,24)
        finally: ec.codes_release(g)

    def test_om_quantization_keeps_zero_small_spread_and_negative_temperatures(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'frame.om'
            source=SimpleNamespace(records=lambda h,s:{k:(0,1) for k in b.FIELDS},url=lambda h,s:'https://example.invalid')
            def data(message,key,stat,source,hour):
                return b.np.full((10,180),.23 if stat=='spread' else -5.2,dtype=b.np.float32)
            with patch.object(b,'fetch',return_value=b'GRIB'),patch.object(b,'decode',side_effect=data):
                b.write_frame(source,24,path)
            reader=OmFileReader(str(path))
            self.assertAlmostEqual(float(reader.get_child_by_name('temperature_850hPa_spread')[0,0]),.23,places=2)
            self.assertAlmostEqual(float(reader.get_child_by_name('temperature_850hPa_mean')[0,0]),-5.2,places=1)
            del reader

    def test_failed_run_does_not_publish_partial_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source=SimpleNamespace(run=datetime(2026,10,11,tzinfo=timezone.utc),config=b.MODELS['gefs'],check_complete=lambda:None)
            with patch.object(b,'Source',return_value=source),patch.object(b,'write_frame',side_effect=ValueError('missing field')):
                with self.assertRaises(ValueError): b.build_model('gefs',Path(directory),source.run,1,[0,3])
            self.assertFalse((Path(directory)/b.MODELS['gefs']['domain']/'latest.json').exists())

    def test_utc_and_native_horizons(self):
        self.assertEqual(b.iso(datetime(2026,10,11)), '2026-10-11T00:00:00Z')
        self.assertEqual(len(b.MODELS['gefs']['hours']),105)
        self.assertEqual(len(b.MODELS['ecmwf']['hours']),85)
        self.assertEqual(b.MODELS['gefs']['hours'][-1],384)
        self.assertEqual(b.MODELS['ecmwf']['hours'][-1],360)


if __name__ == '__main__': unittest.main()
