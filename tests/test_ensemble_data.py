import sys
from pathlib import Path
from datetime import datetime, timezone
import tempfile
import json
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
            source=SimpleNamespace(run=datetime(2026,10,11,tzinfo=timezone.utc),config=b.MODELS['gefs'],available_hours=lambda:[0,3])
            with patch.object(b,'Source',return_value=source),patch.object(b,'write_frame',side_effect=ValueError('missing field')):
                with self.assertRaises(ValueError): b.build_model('gefs',Path(directory),source.run,1,[0,3])
            self.assertFalse((Path(directory)/b.MODELS['gefs']['domain']/'latest.json').exists())

    def test_partial_run_publishes_good_frames_and_appends_without_redownloading(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=SimpleNamespace(run=datetime(2026,10,11,12,tzinfo=timezone.utc),config=b.MODELS['gefs'],available_hours=lambda:[0,3,6,9])
            downloaded=[]
            def write(source,hour,path):
                downloaded.append(hour)
                if hour==3: raise ValueError('temporary missing field')
                path.write_bytes(b'verified frame'); return 14
            with patch.object(b,'Source',return_value=source),patch.object(b,'write_frame',side_effect=write):
                b.build_model('gefs',root,source.run,1,max_new_frames=2)
                meta=json.loads((root/b.MODELS['gefs']['domain']/'latest.json').read_text())
                self.assertFalse(meta['completed'])
                self.assertEqual(meta['valid_times'],[b.iso(source.run)])
                b.build_model('gefs',root,source.run,1,max_new_frames=2)
                updated=json.loads((root/b.MODELS['gefs']['domain']/'latest.json').read_text())
                self.assertEqual(len(updated['valid_times']),2)
                self.assertEqual(downloaded.count(0),1)
                self.assertNotIn(b.iso(source.run+b.timedelta(hours=3)),updated['valid_times'])

    def test_ecmwf_first_block_does_not_wait_for_day_fifteen(self):
        rows=[dict(type=stat,step='0',param=v[2],levtype=v[3],levelist=v[4],_offset=i*100,_length=100)
              for stat in ('em','es') for i,v in enumerate(b.FIELDS.values())]
        response=b.requests.Response();response.status_code=404
        def fetch(url):
            if '360h' in url: raise b.requests.HTTPError(response=response)
            return '\n'.join(json.dumps(row) for row in rows).encode()
        with patch.object(b,'fetch',side_effect=fetch):
            source=b.Source('ecmwf',datetime(2026,10,11,12,tzinfo=timezone.utc))
            self.assertEqual(source.available_hours(),[0])

    def test_ecmwf_rate_limit_uses_official_mirror_for_index_and_binary(self):
        rows=[dict(type=stat,step='0',param=v[2],levtype=v[3],levelist=v[4],_offset=i*100,_length=100)
              for stat in ('em','es') for i,v in enumerate(b.FIELDS.values())]
        calls=[]
        def fetch(url):
            calls.append(url)
            response=b.requests.Response()
            response.status_code=429 if url.startswith(b.ECMWF_BASES[0]) else 404
            if url.startswith(b.ECMWF_BASES[0]) or '360h' in url:
                raise b.requests.HTTPError(response=response)
            return '\n'.join(json.dumps(row) for row in rows).encode()
        with patch.object(b,'fetch',side_effect=fetch):
            source=b.Source('ecmwf',datetime(2026,10,11,12,tzinfo=timezone.utc))
            self.assertEqual(source.available_hours(),[0])
            self.assertTrue(source.url(0,'mean').startswith(b.ECMWF_BASES[1]))
            self.assertEqual(source.url(0,'mean'),source.url(0,'spread'))
            self.assertIn('20261011/12z/',source.url(0,'mean'))
            self.assertEqual(len(calls),4)

    def test_ecmwf_mirror_failure_is_not_missing_product(self):
        response=b.requests.Response();response.status_code=503
        with patch.object(b,'fetch',side_effect=b.requests.HTTPError(response=response)) as fetch:
            with self.assertRaises(b.requests.HTTPError):
                b.Source('ecmwf',datetime(2026,10,11,12,tzinfo=timezone.utc))
            self.assertEqual(fetch.call_count,2)

    def test_gefs_availability_requires_mean_and_spread_but_not_full_run(self):
        source=b.Source('gefs',datetime(2026,10,11,12,tzinfo=timezone.utc))
        def fetch(url):
            stat='mean' if 'geavg' in url else 'spread'
            keys=[source.url(hour,stat).split('.com/',1)[1] for hour in ([0,3,6] if stat=='mean' else [0,3])]
            return ('<ListBucketResult><IsTruncated>false</IsTruncated>'+''.join('<Contents><Key>'+key+'</Key></Contents>' for key in keys)+'</ListBucketResult>').encode()
        with patch.object(b,'fetch',side_effect=fetch): self.assertEqual(source.available_hours(),[0,3])

    def test_utc_and_native_horizons(self):
        self.assertEqual(b.iso(datetime(2026,10,11)), '2026-10-11T00:00:00Z')
        self.assertEqual(len(b.MODELS['gefs']['hours']),105)
        self.assertEqual(len(b.MODELS['ecmwf']['hours']),85)
        self.assertEqual(b.MODELS['gefs']['hours'][-1],384)
        self.assertEqual(b.MODELS['ecmwf']['hours'][-1],360)

    def test_history_backfills_three_cycles_without_rolling_back_latest(self):
        for model in b.MODELS:
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                config={**b.MODELS[model], 'hours':[0,3]}
                run=datetime(2026,10,15,tzinfo=timezone.utc)
                downloaded=[]
                def source(name, reference):
                    return SimpleNamespace(run=reference,config=config,available_hours=lambda:[0,3])
                def write(source,hour,path):
                    downloaded.append((source.run,hour));path.write_bytes(b'verified');return 8
                with patch.dict(b.MODELS,{model:config}), patch.object(b,'Source',side_effect=source), patch.object(b,'write_frame',side_effect=write):
                    b.build_model(model,root,run,1)
                    live_path=root/config['domain']/'latest.json'
                    original=live_path.read_bytes()
                    history=b.prepare_history(model,root,run,1)
                    expected=[b.iso(run-b.timedelta(hours=config['cycle']*i)) for i in range(3)]
                    self.assertEqual(history['runs'],expected)
                    self.assertEqual(live_path.read_bytes(),original)
                    self.assertEqual(len(downloaded),6)
                    b.prepare_history(model,root,run,1)
                    self.assertEqual(len(downloaded),6,'Complete archived cycles are reused')
                    newer=run+b.timedelta(hours=config['cycle'])
                    b.build_model(model,root,newer,1)
                    rolled=b.prepare_history(model,root,newer,1)
                    self.assertEqual(rolled['runs'],[b.iso(newer)]+expected[:2])
                    self.assertEqual(json.loads(live_path.read_text())['reference_time'],b.iso(newer))
                    self.assertEqual(len(list((root/config['domain']).glob('*/*/*/*Z'))),3)
                    for reference in rolled['runs']:
                        for hour in config['hours']:
                            self.assertTrue(b.frame_path(root,config['domain'],datetime.fromisoformat(reference),hour).exists())

    def test_history_skips_unpublished_cycles_without_substituting_their_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);run=datetime(2026,10,15,tzinfo=timezone.utc)
            config={**b.MODELS['gefs'],'hours':[0,3]};missing=run-b.timedelta(hours=6)
            requested=[]
            def source(name,reference):
                requested.append(reference)
                return SimpleNamespace(run=reference,config=config,available_hours=lambda:[] if reference==missing else [0,3])
            def write(source,hour,path):
                path.write_bytes(b'verified');return 8
            with patch.dict(b.MODELS,gefs=config),patch.object(b,'Source',side_effect=source),patch.object(b,'write_frame',side_effect=write):
                b.build_model('gefs',root,run,1)
                history=b.prepare_history('gefs',root,run,1)
            self.assertEqual(history['runs'],[b.iso(run-b.timedelta(hours=h)) for h in [0,12,18]])
            self.assertEqual(requested.count(missing),1)
            self.assertFalse((b.frame_path(root,config['domain'],missing,0).parent/'meta.json').exists())
            self.assertEqual(json.loads((root/config['domain']/'latest.json').read_text())['reference_time'],b.iso(run))

    def test_incomplete_archived_frames_are_retained_for_retry_but_not_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);run=datetime(2026,10,15,tzinfo=timezone.utc)
            config={**b.MODELS['gefs'],'hours':[0,3]};partial=run-b.timedelta(hours=6)
            failed=True;downloaded=[]
            def source(name,reference):
                return SimpleNamespace(run=reference,config=config,available_hours=lambda:[0,3])
            def write(source,hour,path):
                downloaded.append((source.run,hour))
                if failed and source.run==partial and hour==3:raise ValueError('temporary source failure')
                path.write_bytes(b'verified');return 8
            with patch.dict(b.MODELS,gefs=config),patch.object(b,'Source',side_effect=source),patch.object(b,'write_frame',side_effect=write):
                b.build_model('gefs',root,run,1)
                history=b.prepare_history('gefs',root,run,1)
                self.assertNotIn(b.iso(partial),history['runs'])
                self.assertTrue(b.frame_path(root,config['domain'],partial,0).exists())
                failed=False
                recovered=b.prepare_history('gefs',root,run,1)
                self.assertEqual(recovered['runs'],[b.iso(run-b.timedelta(hours=h)) for h in [0,6,12]])
                self.assertEqual(downloaded.count((partial,0)),1)


if __name__ == '__main__': unittest.main()
