import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {DateTime} from 'luxon';
import type {ObjectValue} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import {ResilientHttp} from './resilience.js';
import {projectRoot} from './config.js';

const transitHttp = new ResilientHttp();
const BUDGET_MS = 9000;
const STOP_KEYWORDS = /\b(zastávka|zastavka|stanice|stanicia|nádraží|nadrazi|autobus|bus|stop|zastavku|stanici)\b/gi;

interface StopCandidate {name: string; lat: number; lon: number; lines: string[]}

const ascii = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 /.,-]/g, ' ').replace(/\s+/g, ' ').trim();

let cachedGroups: Array<Record<string, unknown>> | null = null;
let cachedAt = 0;

async function stopGroups(): Promise<Array<Record<string, unknown>>> {
  const configured = process.env.JARVIS_TRANSIT_STOPS ?? path.join(projectRoot, 'runtime/transit-stops.json');
  if (cachedGroups && Date.now() - cachedAt < 3600000) return cachedGroups;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configured, 'utf8'));
  } catch {
    throw new OperatorError('TRANSIT_INDEX_MISSING', 'The stop register is not downloaded. Run scripts/transit_stops.py on the PC.', 503);
  }
  const groups = (raw as {groups?: unknown}).groups;
  assert(Array.isArray(groups) && groups.length > 0, 'TRANSIT_INDEX_INVALID', 'The stop register is unusable.', 502);
  cachedGroups = groups as Array<Record<string, unknown>>;
  cachedAt = Date.now();
  return cachedGroups;
}

function groupNames(group: Record<string, unknown>): string[] {
  const names = new Set<string>();
  if (typeof group.name === 'string') names.add(group.name);
  const stops = Array.isArray(group.stops) ? group.stops : [];
  for (const stop of stops) {
    const row = stop as Record<string, unknown>;
    if (typeof row.altIdosName === 'string') names.add(row.altIdosName);
  }
  return [...names];
}

export function matchStops(groups: Array<Record<string, unknown>>, query: string): StopCandidate[] {
  const needle = ascii(query.replace(STOP_KEYWORDS, ''));
  assert(needle.length >= 2, 'TRANSIT_QUERY_INVALID', 'Name a stop with at least 2 letters.');
  const exact = groups.filter(group => typeof group.name === 'string' && ascii(group.name) === needle
    || groupNames(group).some(name => ascii(name) === needle));
  const pool = exact.length > 0 ? exact : groups;
  const scored: Array<{candidate: StopCandidate; score: number}> = [];
  for (const group of pool) {
    const lat = Number(group.avgLat), lon = Number(group.avgLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const stops = Array.isArray(group.stops) ? group.stops : [];
    const lines = [...new Set(stops.flatMap(stop => {
      const rows = (stop as Record<string, unknown>).lines;
      return Array.isArray(rows) ? rows.map(line => String((line as Record<string, unknown>).name ?? '')) : [];
    }).filter(Boolean))].slice(0, 12);
    let best = -1;
    for (const name of groupNames(group)) {
      const hay = ascii(name);
      if (!hay) continue;
      if (hay === needle) {
        best = 100;
        continue;
      }
      const words = needle.split(' ').filter(word => word.length > 2);
      const hayTokens = hay.split(/[^a-z0-9]+/).filter(token => token.length >= 2);
      let matched = 0;
      for (const word of words) {
        if (hay.includes(word)) {
          matched++;
          continue;
        }
        if (hayTokens.some(token => token.length >= 3 && (token.startsWith(word.slice(0, 4)) || word.startsWith(token.replace(/\./g, ''))))) matched++;
      }
      const ratio = words.length ? matched / words.length : 0;
      let score = ratio >= 0.5 ? 40 + Math.round(40 * ratio)
        : hay.startsWith(needle) || needle.startsWith(hay) ? 55 : hay.includes(needle) ? 50 : -1;
      if (hay.includes(needle) && needle.length >= 4) score = Math.max(score, 90);
      if (score > best) best = score;
    }
    if (best > 0 && typeof group.name === 'string') scored.push({candidate: {name: group.name, lat, lon, lines}, score: best});
  }
  scored.sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
  const top = scored.length ? scored[0]!.score : -1;
  return scored.filter(entry => entry.score === top).slice(0, 5).map(entry => entry.candidate);
}

interface Leg {mode: string; line: string | null; from: string; to: string; depart: string; arrive: string}

export function parsePlan(raw: unknown): Leg[][] {
  const data = (raw ?? {}) as Record<string, unknown>;
  assert(Array.isArray(data.itineraries), 'TRANSIT_PLAN_INVALID', 'The router returned no usable answer.', 502);
  return (data.itineraries as unknown[]).slice(0, 3).map(item => {
    const legs = ((item as Record<string, unknown>).legs ?? []) as Array<Record<string, unknown>>;
    return legs.map(leg => {
      const from = (leg.from ?? {}) as Record<string, unknown>;
      const to = (leg.to ?? {}) as Record<string, unknown>;
      return {mode: String(leg.mode ?? '?'),
        line: typeof leg.routeShortName === 'string' ? leg.routeShortName : null,
        from: String(from.name ?? ''), to: String(to.name ?? ''),
        depart: String(leg.startTime ?? ''), arrive: String(leg.endTime ?? '')};
    });
  });
}

const pragueTime = (value: string): string => {
  const instant = DateTime.fromISO(value, {zone: 'utc'});
  return instant.isValid ? instant.setZone('Europe/Prague').toFormat('H:mm') : value;
};

export function planAnswer(from: StopCandidate, to: StopCandidate, plans: Leg[][]): ObjectValue {
  assert(plans.length > 0 && plans[0]!.length > 0, 'TRANSIT_NO_CONNECTION', 'No connection found for this pair right now.');
  const transit = plans[0]!.filter(leg => leg.mode !== 'WALK');
  assert(transit.length > 0, 'TRANSIT_WALK_ONLY', 'Only walking found; no transit connection right now.');
  const first = transit[0]!, last = transit[transit.length - 1]!;
  const moves = transit.map(leg => `${leg.mode} ${leg.line ?? ''}`.trim()).join(' → ');
  const answer = `Next: ${moves} from ${first.from} at ${pragueTime(first.depart)}, arriving ${last.to} at ${pragueTime(last.arrive)}.`;
  const maps = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(`${from.lat},${from.lon}`)
    + '&destination=' + encodeURIComponent(`${to.lat},${to.lon}`) + '&travelmode=transit';
  return {answer, from: from.name, to: to.name, moves,
    departAt: first.depart, arriveAt: last.arrive, deepLink: maps,
    source: 'Transitous / MOTIS + PID stop register', status: 'ready'};
}

export async function transitPlan(input: ObjectValue, signal: AbortSignal, http: ResilientHttp = transitHttp): Promise<ObjectValue> {
  const deadline = Date.now() + BUDGET_MS;
  const fromQuery = String(input.from ?? ''), toQuery = String(input.to ?? '');
  assert(fromQuery.length >= 2 && toQuery.length >= 2, 'TRANSIT_QUERY_INVALID', 'Give departure and destination stops.');
  const groups = await stopGroups();
  signal.throwIfAborted();
  const from = matchStops(groups, fromQuery), to = matchStops(groups, toQuery);
  if (!from.length || !to.length)
    return {status: 'unknown_stop', candidates: {from: from.map(stop => stop.name), to: to.map(stop => stop.name)},
      note: 'Stop not found in the PID register. Check the name or share a location.'};
  if (from.length > 1 || to.length > 1)
    return {status: 'ambiguous', candidates: {from: from.map(stop => stop.name), to: to.map(stop => stop.name)},
      note: 'Several stops match. Reply with the exact one.'};
  const chosen = {from: from[0]!, to: to[0]!};
  const remaining = Math.max(1000, deadline - Date.now());
  const at = typeof input.at === 'string' && /^\d{1,2}:\d{2}$/.test(input.at) ? input.at : null;
  const depart = at
    ? DateTime.now().setZone('Europe/Prague').set({hour: Number(at.split(':')[0]), minute: Number(at.split(':')[1]), second: 0}).toUTC().toISO()
    : new Date().toISOString();
  const params = new URLSearchParams({fromPlace: `${chosen.from.lat},${chosen.from.lon}`,
    toPlace: `${chosen.to.lat},${chosen.to.lon}`, maxTransfers: '3'});
  if (depart) params.set('time', depart);
  const response = await http.request({integration: 'transitous', url: new URL('https://api.transitous.org/api/v6/plan?' + params),
    method: 'GET', headers: {Accept: 'application/json', 'User-Agent': 'Jarvis-WorkOS/0.5 transit'},
    signal, safety: 'read', timeoutMs: remaining, maximumBytes: 512000});
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(response.body).toString('utf8'));
  } catch {
    throw new OperatorError('TRANSIT_PLAN_INVALID', 'The router returned an unreadable answer.', 502);
  }
  const plans = parsePlan(parsed);
  if (!plans.length || !plans[0]!.some(leg => leg.mode !== 'WALK'))
    return {...planDeepLink(chosen.from, chosen.to), status: 'no_connection',
      note: 'No transit connection right now. The map link shows the route.'};
  return planAnswer(chosen.from, chosen.to, plans);
}

function planDeepLink(from: StopCandidate, to: StopCandidate): ObjectValue {
  return {deepLink: 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(`${from.lat},${from.lon}`)
    + '&destination=' + encodeURIComponent(`${to.lat},${to.lon}`) + '&travelmode=transit'};
}
