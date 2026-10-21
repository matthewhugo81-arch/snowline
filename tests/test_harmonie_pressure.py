import sys
from pathlib import Path
from datetime import datetime, timezone
import unittest
from unittest.mock import Mock
import numpy as np
import eccodes as ec
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_harmonie_pressure import decode, read_range

class PressureTests(unittest.TestCase):
    def message(self, parameter=1, level_type=103, pressure=100000):
        g=ec.codes_grib_new_from_samples('rotated_ll_sfc_grib1')
        try:
            for k,v in dict(Ni=676,Nj=564,latitudeOfFirstGridPointInDegrees=-13.6,longitudeOfFirstGridPointInDegrees=-13.5,
                            latitudeOfLastGridPointInDegrees=14.55,longitudeOfLastGridPointInDegrees=20.25,
                            latitudeOfSouthernPoleInDegrees=-35,longitudeOfSouthernPoleInDegrees=-8,
                            iDirectionIncrementInDegrees=.05,jDirectionIncrementInDegrees=.05,
                            iScansNegatively=0,jScansPositively=1,jPointsAreConsecutive=0,
                            indicatorOfParameter=parameter,indicatorOfTypeOfLevel=level_type,level=0,
                            dataDate=20261021,dataTime=1400,timeRangeIndicator=0,step=43).items(): ec.codes_set(g,k,v)
            ec.codes_set_values(g,np.full(676*564,pressure,dtype=float))
            return ec.codes_get_message(g)
        finally: ec.codes_release(g)

    def test_native_pressure_converts_pa_to_hpa_without_changing_grid(self):
        hour,a=decode(self.message(),datetime(2026,10,21,14,tzinfo=timezone.utc))
        self.assertEqual(hour,43);self.assertEqual(a.shape,(564,676));self.assertTrue(np.all(a==1000))

    def test_wrong_cycle_surface_pressure_and_invalid_values_are_rejected(self):
        for data,run in [(self.message(),datetime(2026,10,21,13,tzinfo=timezone.utc)),
                         (self.message(level_type=105),datetime(2026,10,21,14,tzinfo=timezone.utc)),
                         (self.message(pressure=9999),datetime(2026,10,21,14,tzinfo=timezone.utc))]:
            with self.assertRaises(ValueError): decode(data,run)

    def test_server_ignoring_range_is_rejected_before_body_is_read(self):
        response=Mock(status_code=200,headers={});s=Mock();s.get.return_value.__enter__=Mock(return_value=response);s.get.return_value.__exit__=Mock(return_value=False)
        with self.assertRaises(ValueError): read_range(s,'https://example.test/data',0,1024)

if __name__=='__main__': unittest.main()
