"""Deterministic basic replies, persisted through OpenClaw's supported inject RPC."""
from collections import OrderedDict
from datetime import datetime
import json
import re
import threading
import time
import uuid

from .calculate import calculate
from .intents import basic_kind
from .projects import ProjectError

MARKER = '[jarvis-quick-v1]\n\n'


def quick_record(item):
    if item.get('role') != 'assistant' or item.get('provider') != 'openclaw' or item.get('model') != 'gateway-injected':
        return None
    content = item.get('content')
    if isinstance(content, str): text = content
    elif isinstance(content, list):
        text = '\n'.join(part['text'] for part in content if isinstance(part, dict) and part.get('type') == 'text' and isinstance(part.get('text'), str))
    else: return None
    if not text.startswith(MARKER) or len(text) > 20000: return None
    try: record = json.loads(text[len(MARKER):])
    except ValueError: return None
    if (not isinstance(record, dict) or record.get('version') != 1
            or not isinstance(record.get('id'), str) or not re.fullmatch(r'[0-9a-f]{32}', record['id'])
            or record.get('kind') not in ('weather', 'arithmetic', 'social')
            or not all(isinstance(record.get(key), str) and 0 < len(record[key]) <= 6000 for key in ('question', 'answer'))):
        return None
    return record


def quick_match(message):
    if not isinstance(message, str) or len(message) > 240: return None
    kind = basic_kind(message)
    if kind in ('social', 'arithmetic'): return {'kind': kind}
    if kind != 'weather': return None
    text = message.strip().replace('’', "'").rstrip(' ?!.')
    text = re.sub(r'\s+please$', '', text, flags=re.I)
    match = re.search(r'\bweather(?:\s+like)?(?:\s+(today|tomorrow))?\s+(?:in|for|at)\s+(.+?)\s*[?!.]*$', text, re.I)
    if not match:
        if re.fullmatch(r"(?:what(?:'s| is)|how(?:'s| is))\s+(?:the\s+)?weather[?!. ]*", text, re.I):
            return {'kind': kind, 'location': None}
        return None
    location = match[2].strip(' ?. !')
    suffix = re.search(r'\s+(right now|today|tomorrow)$', location, re.I)
    period = (suffix[1].lower() if suffix else match[1] or 'current').lower()
    if suffix: location = location[:suffix.start()].strip()
    location = re.sub(r'\s+like$', '', location, flags=re.I)
    if (not 2 <= len(location) <= 100 or re.search(r'\b(and|but|should|will|next|week|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', location, re.I)
            or not re.fullmatch(r"[\w\s,.'’\-]+", location)):
        return None
    return {'kind': kind, 'location': location, 'period': period}


class QuickReplies:
    def __init__(self, hub):
        self.hub = hub
        self.lock = threading.RLock()
        self.initialized = OrderedDict()
        self.contexts = OrderedDict()

    @staticmethod
    def put(cache, key, value):
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > 64: cache.popitem(last=False)

    def answer(self, spec, message):
        kind = spec['kind']
        if kind == 'social':
            return ("You're welcome." if re.match(r'thanks|thank you', message.strip(), re.I) else "Hi! I'm here and ready to help."), None
        if kind == 'arithmetic':
            expression = re.sub(r"^(?:what(?:'s| is)|calculate|compute)\s+", '', message.strip().lower().replace('’', "'")).rstrip('?= ')
            try: facts = calculate(expression)
            except ProjectError:
                return "I couldn't evaluate that expression. Please use numbers and arithmetic operators.", None
            return f'The answer is {"approximately " if facts["rounded"] else ""}{facts["value"]}.', facts
        location = spec['location']
        if not location: return 'Which city would you like the weather for?', None
        facts = self.hub.weather.lookup(location)
        if not facts['available']:
            if facts['reason'] in ('location_not_found', 'ambiguous_location'):
                return f'Please specify the city and country or region for {location}.', facts
            return f'I cannot retrieve live weather for {location} right now. Please try again shortly.', facts
        place = facts['location']['name'] + ', ' + facts['location']['country']
        if spec.get('period') in ('today', 'tomorrow'):
            day = facts['forecast'][1 if spec['period'] == 'tomorrow' else 0]
            answer = f'In {place} on {day["date"]}, expect {day["condition"]}, a low of {day["low_c"]:g}°C, a high of {day["high_c"]:g}°C, and a {day["rain_probability_percent"]:g}% rain probability, according to Open-Meteo.'
        else:
            current = facts['current']
            clock = datetime.fromisoformat(facts['as_of']).strftime('%H:%M')
            answer = f'In {place}, it is {current["temperature_c"]:g}°C and {current["condition"]}, with wind at {current["wind_kmh"]:g} km/h, according to Open-Meteo at {clock} local time.'
        return answer, facts

    def persist(self, conversation, message, answer, kind, facts, deadline, cancelled):
        key = conversation['session']
        def remaining():
            if cancelled is not None and cancelled.is_set(): raise ProjectError('Request cancelled.', 409)
            budget = min(5, deadline - time.monotonic())
            if budget <= 0: raise ProjectError('Quick reply exceeded its deadline.', 504)
            return budget
        with self.lock: initialized = key in self.initialized
        if not initialized:
            self.hub.gateway.rpc('sessions.patch', {'key': key}, timeout=remaining())
            with self.lock: self.put(self.initialized, key, True)
        record = {'version': 1, 'id': uuid.uuid4().hex, 'kind': kind, 'question': message, 'answer': answer, 'facts': facts}
        # Mark native history readable before an append whose acknowledgement could
        # be lost. A later reload can recover a committed native record.
        self.hub.conversations.touch(conversation['project'], conversation['thread'], message, quick=True)
        result = self.hub.gateway.rpc('chat.inject', {'sessionKey': key, 'label': 'jarvis-quick-v1', 'message': json.dumps(record, ensure_ascii=False)}, timeout=remaining())
        if result.get('ok') is not True:
            raise ProjectError('The quick reply could not be saved. Reload history before retrying.', 502)
        with self.lock:
            previous = self.contexts.get(key, [])
            self.put(self.contexts, key, [*previous, record][-4:])
        return record

    def context(self, conversation):
        key = conversation['session']
        with self.lock:
            cached = self.contexts.get(key)
            if cached is not None: return cached
        if not conversation.get('quick_context'): return []
        # Injected rows are not necessarily replayed by a model provider. Restore
        # their bounded Q/A context from the authoritative native transcript.
        try:
            history = self.hub.gateway.rpc('chat.history', {'sessionKey': key, 'limit': 20}, timeout=4)
            records = [record for item in history.get('messages', []) if isinstance(item, dict) and (record := quick_record(item))][-4:]
        except ProjectError:
            records = []
        if records:
            with self.lock: self.put(self.contexts, key, records)
        return records
