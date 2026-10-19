import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import check_generated_freshness as f


class GeneratedFeedTests(unittest.TestCase):
    reference = datetime(2026, 10, 16, 3, tzinfo=timezone.utc)

    def metadata(self, run=None, hours=(1, 2, 3)):
        run = run or self.reference
        return dict(format_version=1, reference_time=f.ensemble.iso(run), variables=['snowfall_probability'],
                    valid_times=[f.ensemble.iso(run + timedelta(hours=h)) for h in hours])

    def check(self, published, available, native=None):
        with patch.object(f, 'native_meta', return_value=native or self.metadata()), \
             patch.object(f.ensemble, 'get', return_value=json.dumps(published).encode()), \
             patch.object(f, 'direct_hours', side_effect=lambda model, run, hours: sorted(set(hours) & set(available))):
            return f.check_direct('mogreps', 'https://site.test', self.reference)

    def test_new_snow_cycle_requires_actual_snow_objects(self):
        previous = self.metadata(self.reference - timedelta(hours=1))
        waiting = self.check(previous, [])
        self.assertEqual(waiting['status'], 'awaiting-source')
        self.assertFalse(waiting['refresh_needed'])
        ready = self.check(previous, [1, 2])
        self.assertTrue(ready['refresh_needed'])
        self.assertEqual(ready['missing_source_hours'], [1, 2])

    def test_partial_same_run_checks_later_hours_and_does_not_loop_when_current(self):
        partial = self.metadata(hours=[1])
        self.assertFalse(self.check(partial, [1])['refresh_needed'])
        later = self.check(partial, [1, 2])
        self.assertEqual(later['status'], 'hours-pending')
        self.assertEqual(later['missing_source_hours'], [2])
        self.assertFalse(self.check(self.metadata(), [1, 2, 3])['refresh_needed'])

    def test_missing_fields_and_regressed_pointer_are_not_current(self):
        missing = self.metadata()
        missing['variables'] = []
        self.assertTrue(self.check(missing, [1, 2, 3])['refresh_needed'])
        ahead = self.check(self.metadata(self.reference + timedelta(hours=1)), [1, 2, 3])
        self.assertEqual(ahead['status'], 'upstream-behind')
        self.assertFalse(ahead['refresh_needed'])

    def test_snow_listing_paginates_and_requires_correct_valid_time_and_product(self):
        prefix = self.reference.strftime('uk-ensemble/%Y/%m/%d/T%H00Z/')
        keys = [prefix + '20261016T0400Z-PT0001H00M-snowfall_accumulation-PT01H.nc',
                prefix + '20261016T0500Z-PT0002H00M-snowfall_accumulation-PT01H.nc',
                prefix + '20261016T0900Z-PT0003H00M-snowfall_accumulation-PT01H.nc',
                prefix + '20261016T0600Z-PT0003H00M-rainfall_accumulation-PT01H.nc']
        calls = []
        def get(url):
            query = parse_qs(urlparse(url).query)
            calls.append(query)
            second = 'continuation-token' in query
            selected = keys[1:] if second else keys[:1]
            return ('<ListBucketResult><IsTruncated>' + ('false' if second else 'true') + '</IsTruncated>' +
                    '<NextContinuationToken>page2</NextContinuationToken>' +
                    ''.join('<Contents><Key>' + key + '</Key></Contents>' for key in selected) + '</ListBucketResult>').encode()
        with patch.object(f.ensemble, 'get', side_effect=get):
            self.assertEqual(f.mogreps_hours(self.reference), {1, 2})
        self.assertEqual(calls[1]['continuation-token'], ['page2'])

    def test_icon_requires_all_four_fields_for_the_exact_cycle(self):
        def get(url):
            variable = url.rstrip('/').split('/')[-1]
            hours = [0, 1] if variable == 'v' else [0, 1, 2]
            return ('\n'.join(f'icon-eu_europe_regular-lat-lon_pressure-level_2026101603_{h:03d}_700_{variable.upper()}.grib2.bz2' for h in hours) +
                    f'\nicon-eu_europe_regular-lat-lon_pressure-level_2026101503_002_700_{variable.upper()}.grib2.bz2').encode()
        with patch.object(f.ensemble, 'get', side_effect=get):
            self.assertEqual(f.direct_hours('icon-eu', self.reference, [0, 1, 2]), [0, 1])

    def test_gem_directory_alone_is_not_a_complete_frame(self):
        run = self.reference.replace(hour=0)
        def get(url):
            if url.endswith('/00/'):
                return b'<a href="000/">0</a><a href="003/">3</a>'
            hour = int(url.rstrip('/').split('/')[-1])
            fields = ['VerticalVelocity', 'GeopotentialHeight', 'WindU', 'WindV'][:3 if hour == 3 else 4]
            return '\n'.join(f'20261016T00Z_MSC_GDPS_{field}_IsbL-0700_LatLon0.15_PT{hour:03d}H.grib2' for field in fields).encode()
        with patch.object(f.ensemble, 'get', side_effect=get):
            self.assertEqual(f.direct_hours('gem', run, [0, 3]), [0])

    def test_one_source_failure_does_not_suppress_other_feed_recovery(self):
        def direct(model, *args):
            if model == 'gem':
                raise TimeoutError('source unavailable')
            return dict(model=f.DIRECT[model][0], status='hours-pending', refresh_needed=True)
        with patch.object(f.ensemble, 'check_model', side_effect=lambda model, *args: dict(model=f.ensemble.MODELS[model][0], status='current', refresh_needed=False)), \
             patch.object(f, 'check_direct', side_effect=direct), patch.object(f, 'check_global', return_value=dict(model='snowline_mogreps_global', status='current', refresh_needed=False)), patch.object(f.ensemble, 'publication_check_overdue', return_value=False):
            result = f.report('https://site.test', self.reference)
        self.assertEqual(len(result['models']), 6)
        self.assertTrue(result['refresh_needed'])
        self.assertEqual(next(row for row in result['models'] if row['model'] == 'snowline_gem_700')['status'], 'check-failed')


if __name__ == '__main__':
    unittest.main()
