"""Conservative fast-context routing for unambiguous, non-project requests."""
import re
from .weather import is_weather_query


def basic_kind(message):
    if not isinstance(message, str): return None
    if is_weather_query(message): return 'weather'
    text = message.strip().lower().replace('’', "'")
    if re.fullmatch(r"(?:hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you)(?:[, ]+jarvis)?(?:[,!. ]+(?:how are you|are you there))?[.!? ]*", text):
        return 'social'
    match = re.fullmatch(r"(?:what(?:'s| is)|calculate|compute)\s+([0-9eE+*/%().\s-]+)[?= ]*", text)
    if match and any(char.isdigit() for char in match[1]) and len(match[1]) <= 200:
        return 'arithmetic'
    return None


def basic_context(kind):
    if kind == 'weather':
        return (
            'You are JARVIS answering a routine live-weather question. '
            'Use the native jarvis_weather tool once for the requested city (and country if given). '
            'It returns current conditions plus three dated forecast days; select only the period the user asks for. '
            'Use the actual returned temperature, condition, matched city/country, and as_of time. '
            'Give one or two short spoken sentences in Celsius and km/h, naming Open-Meteo as the source. '
            'Do not read skills, inspect project files, run curl/exec, search the skill catalog, or browse websites. '
            'If available is false, report unavailable promptly; never invent weather or retry with another tool. '
            'For location_not_found or ambiguous_location, ask which city/country/region the user means. '
            'If no city is supplied, ask which city. Any later project task must use its project instructions.'
        )
    if kind == 'arithmetic':
        return ('You are JARVIS answering a simple arithmetic question. Use jarvis_calculate once and quote its result accurately. '
                'One short sentence is enough. Do not inspect project files, skills, or websites. '
                'Any later project task must use its project instructions.')
    return ('You are JARVIS. Answer this greeting or thanks naturally in one short sentence. '
            'No tools or project inspection are needed for this social exchange. '
            'Any later project task must use its project instructions and source tools.')
