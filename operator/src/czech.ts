import type {ObjectValue} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import {ResilientHttp} from './resilience.js';

const aresHttp = new ResilientHttp();
const cnbHttp = new ResilientHttp();

export function icoCheckDigit(seven: string): number {
  assert(/^\d{7}$/.test(seven), 'ICO_FORMAT_INVALID', 'IČO needs exactly 8 digits.');
  const weights = [8, 7, 6, 5, 4, 3, 2];
  const sum = [...seven].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
  return (11 - (sum % 11)) % 10;
}

export function validateIco(ico: string): {valid: boolean; expected: number} {
  assert(/^\d{8}$/.test(ico), 'ICO_FORMAT_INVALID', 'IČO needs exactly 8 digits.');
  const expected = icoCheckDigit(ico.slice(0, 7));
  return {valid: Number(ico[7]) === expected, expected};
}

function ibanNumeric(value: string): string {
  return [...value].map(char =>
    /[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55)).join('');
}

function ibanMod97(numeric: string): number {
  let rest = 0;
  for (const chunk of numeric.match(/.{1,9}/g) ?? []) rest = Number(String(rest) + chunk) % 97;
  return rest;
}

export function validateIban(iban: string): {valid: boolean; normalized: string} {
  const normalized = iban.replace(/[\s-]/g, '').toUpperCase();
  assert(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized), 'IBAN_FORMAT_INVALID', 'Use a valid IBAN shape.');
  return {valid: ibanMod97(ibanNumeric(normalized.slice(4) + normalized.slice(0, 4))) === 1, normalized};
}

export function czechToIban(bank: unknown, prefix: unknown, account: unknown): {iban: string} {
  assert(typeof bank === 'string' && /^\d{4}$/.test(bank), 'CZ_ACCOUNT_INVALID', 'Bank code needs 4 digits.');
  const pre = prefix === undefined || prefix === '' ? '000000' : String(prefix);
  const acc = String(account ?? '');
  assert(/^\d{1,6}$/.test(pre) && /^\d{1,10}$/.test(acc), 'CZ_ACCOUNT_INVALID', 'Prefix max 6 digits, account max 10 digits.');
  const bban = bank + pre.padStart(6, '0') + acc.padStart(10, '0');
  const check = String(98 - ibanMod97(ibanNumeric(bban + 'CZ00'))).padStart(2, '0');
  return {iban: 'CZ' + check + bban};
}

const ascii = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');

export function qrPlatba(input: ObjectValue): {payload: string} {
  const {normalized} = validateIban(String(input.iban ?? ''));
  const amount = Number(input.amount);
  assert(Number.isFinite(amount) && amount > 0 && amount < 1000000000, 'QR_AMOUNT_INVALID', 'Amount must be positive.');
  const currency = String(input.currency ?? 'CZK');
  assert(/^[A-Z]{3}$/.test(currency), 'QR_CURRENCY_INVALID', 'Currency needs 3 letters.');
  const fields: Array<[string, unknown, RegExp, string]> = [
    ['X-VS', input.vs, /^\d{1,10}$/, 'Variable symbol max 10 digits.'],
    ['X-SS', input.ss, /^\d{1,10}$/, 'Specific symbol max 10 digits.'],
    ['X-KS', input.ks, /^\d{1,10}$/, 'Constant symbol max 10 digits.'],
  ];
  let payload = `SPD*1.0*ACC:${normalized}*AM:${amount.toFixed(2)}*CC:${currency}`;
  for (const [key, value, pattern, message] of fields) {
    if (value === undefined || value === '') continue;
    assert(typeof value === 'string' && pattern.test(value), 'QR_FIELD_INVALID', message);
    payload += `*${key}:${value}`;
  }
  if (input.message !== undefined && input.message !== '') {
    assert(typeof input.message === 'string' && input.message.length <= 60, 'QR_MESSAGE_INVALID', 'Message max 60 chars.');
    payload += '*MSG:' + ascii(input.message);
  }
  assert(payload.length <= 500, 'QR_TOO_LONG', 'The payment payload is too long.');
  return {payload};
}

function easterSunday(year: number): {month: number; day: number} {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = Math.floor((h + l - 7 * m + 114) / 31);
  return {month: n, day: (h + l - 7 * m + 114) % 31 + 1};
}

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function czechHolidays(year: number): string[] {
  assert(Number.isSafeInteger(year) && year >= 1900 && year <= 2100, 'YEAR_INVALID', 'Year 1900-2100.');
  const days = [`${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-05`,
    `${year}-07-06`, `${year}-09-28`, `${year}-10-28`, `${year}-11-17`,
    `${year}-12-24`, `${year}-12-25`, `${year}-12-26`];
  const easter = easterSunday(year);
  const sunday = new Date(Date.UTC(year, easter.month - 1, easter.day));
  const friday = new Date(sunday.getTime() - 2 * 86400000);
  const monday = new Date(sunday.getTime() + 86400000);
  days.push(iso(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate()));
  days.push(iso(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()));
  return [...new Set(days)].sort();
}

const dayMs = 86400000;
const parseDay = (value: unknown): number => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'DATE_INVALID', 'Dates as YYYY-MM-DD.');
  const time = Date.parse(value + 'T00:00:00Z');
  assert(Number.isFinite(time), 'DATE_INVALID', 'Unknown calendar date.');
  return time;
};

export function workingDays(from: unknown, to: unknown): {from: string; to: string; workingDays: number} {
  const start = parseDay(from), end = parseDay(to);
  assert(end > start && end - start <= 731 * dayMs, 'DATE_RANGE_INVALID', 'Use a range of 1-731 days, from < to.');
  const holidays = new Set<string>();
  for (let year = new Date(start).getUTCFullYear(); year <= new Date(end).getUTCFullYear(); year++)
    for (const day of czechHolidays(year)) holidays.add(day);
  let count = 0;
  for (let at = start; at < end; at += dayMs) {
    const date = new Date(at), weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()))) continue;
    count++;
  }
  return {from: String(from), to: String(to), workingDays: count};
}

export function czechCalc(input: ObjectValue): ObjectValue {
  const operation = input.operation;
  if (operation === 'ico_check') {
    const ico = String(input.ico ?? '');
    const {valid, expected} = validateIco(ico);
    return {operation, ico, valid, expectedDigit: expected};
  }
  if (operation === 'iban_validate') {
    const {valid, normalized} = validateIban(String(input.iban ?? ''));
    return {operation, valid, iban: normalized};
  }
  if (operation === 'iban_from_czech') {
    return {operation, ...czechToIban(input.bank, input.prefix, input.account)};
  }
  if (operation === 'qr_platba') {
    return {operation, ...qrPlatba(input)};
  }
  if (operation === 'working_days') {
    return {operation, ...workingDays(input.from, input.to)};
  }
  if (operation === 'holidays') {
    const year = Number(input.year);
    assert(Number.isSafeInteger(year), 'YEAR_INVALID', 'Year 1900-2100.');
    return {operation, year, holidays: czechHolidays(year)};
  }
  throw new OperatorError('CODE_OPERATION_INVALID', 'Choose ico_check, iban_validate, iban_from_czech, qr_platba, working_days or holidays.', 400);
}

interface AresRecord {
  ico: string; name: string | null; address: string | null; legalForm: string | null;
  vatPayer: boolean; vatId: string | null; nace: string[]; active: boolean;
  established: string | null; updated: string | null; checksumValid: boolean;
}

export function parseAres(ico: string, raw: unknown): AresRecord {
  const data = (raw ?? {}) as Record<string, unknown>;
  const office = (data.sidlo ?? {}) as Record<string, unknown>;
  const regs = (data.seznamRegistraci ?? {}) as Record<string, unknown>;
  const nace = Array.isArray(data.czNace) ? data.czNace.map(String).slice(0, 20)
    : Array.isArray(data.czNace2008) ? (data.czNace2008 as unknown[]).map(String).slice(0, 20) : [];
  const active = regs.stavZdrojeRos === 'AKTIVNI' || regs.stavZdrojeVr === 'AKTIVNI' || regs.stavZdrojeRes === 'AKTIVNI';
  return {
    ico, name: typeof data.obchodniJmeno === 'string' ? data.obchodniJmeno : null,
    address: typeof office.textovaAdresa === 'string' ? office.textovaAdresa : null,
    legalForm: typeof data.pravniForma === 'string' ? data.pravniForma : null,
    vatPayer: regs.stavZdrojeDph === 'AKTIVNI' || typeof data.dicSkDph === 'string',
    vatId: typeof data.dicSkDph === 'string' ? data.dicSkDph : null,
    nace, active,
    established: typeof data.datumVzniku === 'string' ? data.datumVzniku : null,
    updated: typeof data.datumAktualizace === 'string' ? data.datumAktualizace : null,
    checksumValid: validateIco(ico).valid,
  };
}

export async function aresLookup(input: ObjectValue, signal: AbortSignal, http: ResilientHttp = aresHttp): Promise<ObjectValue> {
  const ico = String(input.ico ?? '');
  assert(/^\d{8}$/.test(ico), 'ICO_FORMAT_INVALID', 'IČO needs exactly 8 digits.');
  const response = await http.request({integration: 'ares',
    url: new URL('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/' + ico),
    method: 'GET', headers: {Accept: 'application/json', 'User-Agent': 'Jarvis-WorkOS/0.5 ares-client'},
    signal, safety: 'read', timeoutMs: 15000, maximumBytes: 512000, acceptedStatuses: [404]});
  if (response.status === 404) throw new OperatorError('ARES_NOT_FOUND', 'No company with this IČO in ARES.', 404);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(response.body).toString('utf8'));
  } catch {
    throw new OperatorError('ARES_INVALID', 'ARES returned an unreadable response.', 502);
  }
  return {...parseAres(ico, raw)};
}

export function parseCnb(text: string, currency?: string): ObjectValue {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  assert(lines.length >= 2, 'CNB_INVALID', 'CNB returned an unreadable table.');
  const date = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(lines[0] ?? '');
  assert(date, 'CNB_INVALID', 'CNB date header missing.');
  const rates = lines.slice(2).filter(line => line.includes('|')).map(line => {
    const [country, name, amount, code, rate] = line.split('|').map(part => part.trim());
    return {country: country ?? '', currency: name ?? '', amount: Number(amount), code: code ?? '',
      rateCzk: Number((rate ?? '').replace(',', '.'))};
  }).filter(row => row.code && Number.isFinite(row.rateCzk));
  assert(rates.length > 0, 'CNB_INVALID', 'No CNB rates parsed.');
  if (currency !== undefined) {
    assert(/^[A-Z]{3}$/.test(currency), 'CURRENCY_INVALID', 'Currency as 3 letters.');
    const row = rates.find(entry => entry.code === currency);
    assert(row, 'CURRENCY_NOT_FOUND', 'This currency is not in the CNB table.');
    return {date: `${date[3]}-${date[2]}-${date[1]}`, base: 'CZK', ...row};
  }
  return {date: `${date[3]}-${date[2]}-${date[1]}`, base: 'CZK', rates};
}

export async function cnbRates(input: ObjectValue, signal: AbortSignal, http: ResilientHttp = cnbHttp): Promise<ObjectValue> {
  const response = await http.request({integration: 'cnb',
    url: new URL('https://www.cnb.cz/cs/financni_trhy/devizovy_trh/kurzy_devizoveho_trhu/denni_kurz.txt'),
    method: 'GET', headers: {'User-Agent': 'Jarvis-WorkOS/0.5 cnb-client'},
    signal, safety: 'read', timeoutMs: 15000, maximumBytes: 256000});
  const currency = input.currency === undefined ? undefined : String(input.currency);
  return parseCnb(Buffer.from(response.body).toString('utf8'), currency);
}
