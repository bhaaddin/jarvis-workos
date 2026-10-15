"""Bounded, cached live weather lookup. No model, shell, scraping, or API key."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
import copy
import json
import math
import re
import threading
import time
import urllib.parse
import urllib.request

from .projects import ProjectError

CONDITIONS = {
    0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
    56: 'light freezing drizzle', 57: 'dense freezing drizzle', 61: 'light rain', 63: 'moderate rain',
    65: 'heavy rain', 66: 'light freezing rain', 67: 'heavy freezing rain', 71: 'light snow',
    73: 'moderate snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light rain showers',
    81: 'moderate rain showers', 82: 'violent rain showers', 85: 'light snow showers',
    86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
}


def is_weather_query(message):
    if not isinstance(message, str) or len(message) > 240 or '\n' in message:
        return False
    value = message.strip().lower().replace('’', "'")
    value = re.sub(r'^(?:(?:please|can you|could you|would you)\s+)+', '', value)
    if re.search(r'\b(code|project|repository|frontend|backend|implement|debug|fix|edit|change|write|read|open|update|refactor|deploy|install|delete|remove|create|commit|test|migrate|configure|widget|component|api|file|script|build|patient|climate|historical|compare|trend|algorithm|explain|predicted|prediction|simulation)\b|last year|[`{};]|https?://|\b[\w./-]+\.(?:py|js|ts|tsx|cs|json|md|ya?ml)\b', value):
        return False
    return bool(re.match(r"\s*(?:(?:what(?:'s| is)|how(?:'s| is))\s+(?:the\s+)?(?:current\s+)?weather\b|(?:check|get|show(?: me)?|tell me|give me)\s+(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?weather\b|(?:current\s+)?weather\s+(?:in|for|at)\b)", value))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Invalid weather number.')
    return value


class Weather:
    def __init__(self, budget=6.0):
        self.budget = budget
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='weather-io')
        self.slots = threading.BoundedSemaphore(2)
        self.lock = threading.RLock()
        self.pending, self.cache, self.locations = {}, {}, {}

    def json(self, base, parameters, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Weather deadline reached.')
        url = base + '?' + urllib.parse.urlencode(parameters)
        request = urllib.request.Request(url, headers={'User-Agent': 'JARVIS-weather/0.3.2', 'Accept': 'application/json'})
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(request, timeout=min(3.0, remaining)) as response:
            if response.headers.get_content_type() != 'application/json':
                raise ValueError('Weather provider did not return JSON.')
            raw = response.read(128 * 1024 + 1)
        if len(raw) > 128 * 1024 or time.monotonic() >= deadline:
            raise TimeoutError('Weather response exceeded its budget.')
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('error'):
            raise ValueError('Weather provider response was invalid.')
        return value

    @staticmethod
    def put(cache, key, value, ttl):
        if len(cache) >= 128 and key not in cache:
            del cache[min(cache, key=lambda item: cache[item][0])]
        cache[key] = (time.monotonic() + ttl, value)

    def fetch(self, location, country, deadline):
        key = (location.casefold(), country)
        with self.lock:
            cached = self.locations.get(key)
            place = cached[1] if cached and cached[0] > time.monotonic() else None
        if place is None:
            city, _, qualifier = location.partition(',')
            params = {'name': city.strip(), 'count': 10, 'language': 'en', 'format': 'json'}
            if country: params['countryCode'] = country
            result = self.json('https://geocoding-api.open-meteo.com/v1/search', params, deadline)
            places = result.get('results', [])
            if not isinstance(places, list): raise ValueError('Invalid location result.')
            candidates = [item for item in places if isinstance(item, dict) and (not country or item.get('country_code') == country)]
            if qualifier.strip():
                aliases = {'czech republic': 'czechia', 'uk': 'united kingdom', 'usa': 'united states'}
                wanted = [aliases.get(value.strip().casefold(), value.strip().casefold()) for value in qualifier.split(',')]
                candidates = [item for item in candidates if all(value in {
                    str(item.get(field, '')).casefold() for field in ('country', 'country_code', 'admin1', 'admin2')
                } for value in wanted)]
            place = candidates[0] if candidates else None
            if not place:
                return {'available': False, 'reason': 'location_not_found', 'message': 'Location not found. Ask for a city and country; do not guess coordinates.'}
            if len(candidates) > 1:
                first, second = candidates[:2]
                first_population, second_population = first.get('population') or 0, second.get('population') or 0
                if (first.get('name', '').casefold() == second.get('name', '').casefold()
                        and (first.get('country_code'), first.get('admin1')) != (second.get('country_code'), second.get('admin1'))
                        and type(first_population) in (int, float) and type(second_population) in (int, float)
                        and 0 < first_population < 2 * second_population):
                    return {'available': False, 'reason': 'ambiguous_location',
                            'matches': [{key: item.get(key) for key in ('name', 'country', 'admin1')} for item in candidates[:3]],
                            'message': 'Ask which country or region the user means before giving weather.'}
            number(place.get('latitude'), -90, 90)
            number(place.get('longitude'), -180, 180)
            if not all(isinstance(place.get(field), str) and 0 < len(place[field]) <= 120 for field in ('name', 'country', 'timezone')):
                raise ValueError('Invalid location identity.')
            with self.lock: self.put(self.locations, key, place, 86400)
        data = self.json('https://api.open-meteo.com/v1/forecast', {
            'latitude': place['latitude'], 'longitude': place['longitude'],
            'current': 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
            'daily': 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
            'temperature_unit': 'celsius', 'wind_speed_unit': 'kmh', 'timezone': 'auto', 'forecast_days': 3,
        }, deadline)
        current, units = data.get('current', {}), data.get('current_units', {})
        if not isinstance(current, dict) or not isinstance(units, dict): raise ValueError('Invalid current weather data.')
        if units.get('temperature_2m') != '°C' or units.get('wind_speed_10m') != 'km/h':
            raise ValueError('Weather units were not the requested units.')
        if not isinstance(current.get('time'), str): raise ValueError('Missing current weather time.')
        datetime.fromisoformat(current['time'])
        code = current.get('weather_code')
        if type(code) is not int or code not in CONDITIONS: raise ValueError('Unknown current weather condition.')
        result = {
            'available': True, 'source': 'Open-Meteo', 'source_url': 'https://open-meteo.com/',
            'location': {'name': place['name'], 'country': place['country'], 'country_code': place.get('country_code'),
                         'latitude': place['latitude'], 'longitude': place['longitude']},
            'timezone': data.get('timezone'), 'as_of': current['time'],
            'current': {'temperature_c': number(current.get('temperature_2m'), -100, 70),
                        'feels_like_c': number(current.get('apparent_temperature'), -120, 90),
                        'condition': CONDITIONS[code], 'wind_kmh': number(current.get('wind_speed_10m'), 0, 500)},
            'forecast': [], 'fetched_at': datetime.now(timezone.utc).isoformat(),
        }
        daily = data.get('daily', {})
        if not isinstance(daily, dict): raise ValueError('Invalid forecast data.')
        if data.get('daily_units', {}).get('temperature_2m_max') != '°C': raise ValueError('Invalid forecast units.')
        dates = daily.get('time', [])
        if not isinstance(dates, list) or not 1 <= len(dates) <= 3: raise ValueError('Invalid forecast dates.')
        for index, date in enumerate(dates):
            datetime.fromisoformat(date)
            if type(daily['weather_code'][index]) is not int: raise ValueError('Invalid forecast condition.')
            result['forecast'].append({'date': date,
                'condition': CONDITIONS[daily['weather_code'][index]],
                'high_c': number(daily['temperature_2m_max'][index], -100, 70),
                'low_c': number(daily['temperature_2m_min'][index], -100, 70),
                'rain_probability_percent': number(daily['precipitation_probability_max'][index], 0, 100)})
        if time.monotonic() >= deadline: raise TimeoutError('Weather deadline reached.')
        return result

    def lookup(self, location, country=None):
        if (not isinstance(location, str) or not 2 <= len(location.strip()) <= 100
                or any(ord(char) < 32 for char in location) or re.search(r'[\\/:{}<>]', location)
                or not any(char.isalpha() for char in location)):
            raise ProjectError('Choose a city name of 2-100 characters.')
        location = location.strip()
        if country is not None and (not isinstance(country, str) or not re.fullmatch(r'[A-Za-z]{2}', country)):
            raise ProjectError('Use a two-letter country code, such as CZ.')
        country = country.upper() if country else None
        key = (location.casefold(), country)
        started = time.monotonic()
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > started:
                return {**copy.deepcopy(cached[1]), 'cached': True, 'lookup_ms': 0}
            pending = self.pending.get(key)
            if pending:
                future, deadline = pending
            else:
                if not self.slots.acquire(blocking=False):
                    return {'available': False, 'reason': 'busy', 'message': 'Weather lookup is busy. Report unavailable; do not retry with shell/browser tools.'}
                deadline = started + self.budget
                try: future = self.pool.submit(self.fetch, location, country, deadline)
                except BaseException:
                    self.slots.release()
                    raise
                self.pending[key] = (future, deadline)
                def finished(done):
                    with self.lock:
                        try:
                            value = done.result()
                            if value.get('available') and time.monotonic() < deadline:
                                self.put(self.cache, key, value, 60)
                        except Exception:
                            pass
                        if self.pending.get(key, (None,))[0] is done: self.pending.pop(key, None)
                    self.slots.release()
                future.add_done_callback(finished)
        try:
            result = future.result(timeout=max(.001, deadline - time.monotonic()))
            if time.monotonic() >= deadline: raise TimeoutError('Weather deadline reached.')
            if result['available']:
                with self.lock: self.put(self.cache, key, result, 60)
            return {**copy.deepcopy(result), 'cached': False, 'lookup_ms': round((time.monotonic() - started) * 1000)}
        except Exception as error:
            return {'available': False, 'reason': 'timeout' if isinstance(error, TimeoutError) else 'provider_unavailable',
                    'message': 'Live weather is temporarily unavailable. Say so promptly; do not invent conditions or retry through shell/browser tools.',
                    'lookup_ms': round((time.monotonic() - started) * 1000)}
