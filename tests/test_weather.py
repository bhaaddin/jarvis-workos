from concurrent.futures import ThreadPoolExecutor
import copy
import threading
import time
import unittest
from unittest.mock import patch

from project_hub.projects import ProjectError
from project_hub.server import Hub
from project_hub.weather import Weather, is_weather_query
from project_hub.intents import basic_kind
from test_command_center import StoreFixture

PLACE = {'name': 'Prague', 'country': 'Czechia', 'country_code': 'CZ', 'timezone': 'Europe/Prague',
         'latitude': 50.088, 'longitude': 14.42, 'population': 1165581, 'admin1': 'Prague'}
FORECAST = {'timezone': 'Europe/Prague', 'current_units': {'temperature_2m': '°C', 'wind_speed_10m': 'km/h'},
            'current': {'time': '2026-09-26T21:00', 'temperature_2m': 11.5, 'apparent_temperature': 10.2, 'weather_code': 2, 'wind_speed_10m': 5.4},
            'daily_units': {'temperature_2m_max': '°C'},
            'daily': {'time': ['2026-09-26', '2026-09-27', '2026-09-28'], 'temperature_2m_max': [15, 16, 17],
                      'temperature_2m_min': [8, 9, 10], 'weather_code': [2, 3, 61], 'precipitation_probability_max': [10, 20, 80]}}


class WeatherTests(unittest.TestCase):
    def setUp(self):
        self.weather = Weather()
        self.addCleanup(self.weather.pool.shutdown)

    def data(self, url, params, deadline):
        return {'results': [copy.deepcopy(PLACE)]} if 'geocoding-' in url else copy.deepcopy(FORECAST)

    def test_lookup_preserves_units_source_time_and_caches_both_requests(self):
        with patch.object(self.weather, 'json', side_effect=self.data) as network:
            first = self.weather.lookup('Prague', 'cz')
            self.assertTrue(first['available'])
            self.assertEqual(first['current']['temperature_c'], 11.5)
            self.assertEqual(first['current']['condition'], 'partly cloudy')
            self.assertEqual(first['location']['country'], 'Czechia')
            self.assertEqual(first['as_of'], '2026-09-26T21:00')
            self.assertEqual(first['source'], 'Open-Meteo')
            self.assertEqual(len(first['forecast']), 3)
            self.assertEqual(network.call_count, 2)
            first['current']['temperature_c'] = 999
            second = self.weather.lookup('prague', 'CZ')
            self.assertTrue(second['cached'])
            self.assertEqual(second['current']['temperature_c'], 11.5)
            self.assertEqual(network.call_count, 2)
            self.weather.cache[('prague', 'CZ')] = (0, second)
            self.weather.lookup('Prague', 'CZ')
            self.assertEqual(network.call_count, 3)  # Geocode remains fresh.

    def test_location_qualification_and_ambiguity_do_not_guess(self):
        with patch.object(self.weather, 'json', side_effect=self.data):
            self.assertTrue(self.weather.lookup('Prague, Czechia')['available'])
            self.assertFalse(self.weather.lookup('Prague', 'US')['available'])
        places = [dict(PLACE, name='Cambridge', country='United Kingdom', country_code='GB', population=145000),
                  dict(PLACE, name='Cambridge', country='United States', country_code='US', population=118000)]
        with patch.object(self.weather, 'json', return_value={'results': places}) as network:
            result = self.weather.lookup('Cambridge')
            self.assertFalse(result['available'])
            self.assertEqual(result['reason'], 'ambiguous_location')
            self.assertEqual(network.call_count, 1)
        places = [dict(PLACE, name='Springfield', country='United States', country_code='US', admin1='Missouri', population=169000),
                  dict(PLACE, name='Springfield', country='United States', country_code='US', admin1='Massachusetts', population=156000)]
        with patch.object(self.weather, 'json', return_value={'results': places}):
            self.assertEqual(self.weather.lookup('Springfield, US')['reason'], 'ambiguous_location')

    def test_bad_inputs_and_bad_provider_values_fail_without_invented_conditions(self):
        for location in ('', 'a', 'http://127.0.0.1', 'Prague\nsecret', '12.2,14.2'):
            with self.subTest(location=location), self.assertRaises(ProjectError): self.weather.lookup(location)
        for country in ('Czechia', '12', 5):
            with self.subTest(country=country), self.assertRaises(ProjectError): self.weather.lookup('Prague', country)
        for change in ({'temperature_2m': None}, {'temperature_2m': float('nan')}, {'weather_code': 999}):
            data = copy.deepcopy(FORECAST); data['current'].update(change)
            with patch.object(self.weather, 'json', side_effect=[{'results': [PLACE]}, data]):
                self.weather.locations.clear()
                result = self.weather.lookup('Prague')
                self.assertFalse(result['available'])
                self.assertNotIn('current', result)

    def test_total_wait_is_bounded_even_when_worker_does_not_cooperate(self):
        self.weather.budget = .05
        release = threading.Event()
        self.addCleanup(release.set)
        def stalled(*args):
            release.wait(2)
            return {'available': True}
        with patch.object(self.weather, 'fetch', side_effect=stalled):
            start = time.monotonic()
            result = self.weather.lookup('Prague')
            self.assertLess(time.monotonic() - start, .5)
            self.assertFalse(result['available'])
            self.assertEqual(result['reason'], 'timeout')
        release.set()

    def test_concurrent_identical_lookups_share_the_network_work(self):
        release, entered = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        def fetch(*args):
            entered.set(); release.wait(2)
            return {'available': True, 'value': 'synthetic'}
        with patch.object(self.weather, 'fetch', side_effect=fetch) as network, ThreadPoolExecutor(max_workers=2) as callers:
            first = callers.submit(self.weather.lookup, 'Prague')
            self.assertTrue(entered.wait(1))
            second = callers.submit(self.weather.lookup, 'prague')
            release.set()
            self.assertTrue(first.result()['available'])
            self.assertTrue(second.result()['available'])
            self.assertEqual(network.call_count, 1)


class WeatherContextTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.hub = Hub(self.projects, 'synthetic', 'synthetic', reviews=False)
        self.addCleanup(self.hub.operations.pool.shutdown)
        self.addCleanup(self.hub.chat_jobs.pool.shutdown)
        self.addCleanup(self.hub.weather.pool.shutdown)

    def test_clear_weather_query_skips_all_project_root_and_source_reads(self):
        with patch.object(self.projects, 'root', side_effect=AssertionError('Weather must not touch project folders')), patch.object(self.hub.chat_service, 'source_evidence') as source:
            call, _, _, size = self.hub.chat_service.prepare({'project': 'fixture', 'message': "What's the weather in Prague?", 'voice_mode': True})
        self.assertLess(size, 1600)
        self.assertIn(b'jarvis_weather', call.data)
        source.assert_not_called()

    def test_mixed_code_requests_and_weather_explanations_keep_normal_context(self):
        for message in ('Fix weather.py', 'Review the weather API', "What's the weather in Prague and fix weather.py?", 'How is the weather predicted?'):
            with self.subTest(message=message):
                self.assertFalse(is_weather_query(message))
                call, _, _, _ = self.hub.chat_service.prepare({'project': 'fixture', 'message': message})
                self.assertIn(b'Follow the synthetic project instruction.', call.data)

    def test_only_unambiguous_social_and_arithmetic_requests_skip_project_context(self):
        for message, kind in (('Hi Jarvis!', 'social'), ('What is 2+2?', 'arithmetic')):
            self.assertEqual(basic_kind(message), kind)
            with patch.object(self.projects, 'root', side_effect=AssertionError('Unnecessary project read')):
                self.hub.chat_service.prepare({'project': 'fixture', 'message': message})
        for message in ('Hi Jarvis, fix the API', 'What is 2.3 in package.json?', 'Calculate the patient score', 'What is 2+2 and edit code?'):
            self.assertIsNone(basic_kind(message))
