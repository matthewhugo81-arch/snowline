import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from knmi_cooldown import KNMIRateLimited, request_download_url, retry_time


class CooldownTests(unittest.TestCase):
    def test_retry_after_seconds_dates_and_shared_hourly_quota(self):
        self.assertEqual(retry_time('120', 1000), 1120)
        self.assertEqual(retry_time('Thu, 01 Jan 1970 01:00:00 GMT', 1000), 3600)
        self.assertEqual(retry_time(None, 1000), 4600)
        self.assertEqual(retry_time('-1', 1000), 1060)

    def test_quota_failure_survives_new_process_and_new_forecast_cycle(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cooldown.json'
            client = Mock()
            client.get.return_value = Mock(status_code=429, headers={'Retry-After': '120'})
            with self.assertRaises(KNMIRateLimited):
                request_download_url(client, 'https://example.test/run-a', 'private-key', path, now=1000)
            self.assertNotIn('private-key', path.read_text())
            next_client = Mock()
            with self.assertRaises(KNMIRateLimited):
                request_download_url(next_client, 'https://example.test/run-b', 'private-key', path, now=1100)
            next_client.get.assert_not_called()
            next_client.get.return_value = Mock(status_code=200, headers={})
            next_client.get.return_value.json.return_value = {'temporaryDownloadUrl': 'https://example.test/data'}
            self.assertEqual(request_download_url(next_client, 'url', 'key', path, now=1120), 'https://example.test/data')
            self.assertFalse(path.exists())

    def test_new_registered_key_is_not_blocked_by_anonymous_quota(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cooldown.json'
            path.write_text('{"retry_at": 2000, "registered": false}')
            client = Mock()
            client.get.return_value = Mock(status_code=200, headers={})
            client.get.return_value.json.return_value = {'temporaryDownloadUrl': 'download'}
            self.assertEqual(request_download_url(client, 'url', 'key', path, registered=True, now=1000), 'download')


if __name__ == '__main__':
    unittest.main()
