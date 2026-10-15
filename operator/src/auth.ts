import {createHash, createHmac, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import type {Actor} from './contracts.js';
import type {Config} from './config.js';
import {assert, OperatorError} from './errors.js';
import {Store} from './store.js';

const derive = promisify(scrypt);
export const digestToken = (value: string): string => createHash('sha256').update(value).digest('hex');

export async function passwordHash(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const result = await derive(value, salt, 64) as Buffer;
  return `scrypt-v1:${salt}:${result.toString('hex')}`;
}
async function passwordMatches(value: string, stored: string): Promise<boolean> {
  const [version, salt, expected] = stored.split(':');
  if (version !== 'scrypt-v1' || !salt || !expected || expected.length !== 128) return false;
  const actual = await derive(value, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export const ownerPermissions = ['operator.chat','users.manage','skills.read','memory.read','memory.write',
  'actions.read','actions.approve','actions.cancel','settings.write','schedule.manage','audit.read',
  'calendar.read','calendar.write','mail.read','mail.draft','mail.send','billing.read','billing.draft','billing.send',
  'monitor.read','monitor.restart','sandbox.execute','diagnostics.status','fixture.send',
  'projects.read','files.read','files.personal','documents.create','web.read','github.read','tasks.read','tasks.write','clinic.read','connections.manage'];

export class Auth {
  private readonly loginAttempts = new Map<string, {count: number; until: number}>();
  private readonly runs = new Map<string, Set<AbortController>>();
  constructor(private readonly store: Store, private readonly config: Config) {}

  async bootstrap(): Promise<void> {
    if (this.config.environment === 'prod') return;
    assert(this.config.adminPassword.length >= 24, 'CONFIG_MISSING', 'Initialize the private staging owner password.', 503);
    await this.store.call('bootstrap', {tenantId: this.config.tenantId, id: 'owner', login: 'matko', displayName: 'Matko',
      roles: ['owner'], permissions: ownerPermissions, language: 'en', timezone: this.config.timezone,
      passwordHash: await passwordHash(this.config.adminPassword), now: Date.now()});
  }

  async login(login: string, password: string, remote: string): Promise<{token: string; csrf: string; expires: number; actor: Actor}> {
    assert(this.config.environment !== 'prod', 'OIDC_REQUIRED', 'Production sign-in uses the configured identity provider.', 403);
    const key = digestToken(remote), now = Date.now();
    const attempts = this.loginAttempts.get(key);
    if (attempts && attempts.until > now && attempts.count >= 8) throw new OperatorError('LOGIN_RATE_LIMIT', 'Wait before trying another sign-in.', 429);
    this.loginAttempts.set(key, {count: attempts && attempts.until > now ? attempts.count + 1 : 1, until: now + 60_000});
    const found = await this.store.call<{actor: Actor; passwordHash: string} | null>('actor.login', {tenantId: this.config.tenantId, login});
    const valid = found ? await passwordMatches(password, found.passwordHash) : false;
    assert(valid && found, 'INVALID_LOGIN', 'The sign-in details are not valid.', 401);
    this.loginAttempts.delete(key);
    const token = randomBytes(32).toString('base64url'), csrf = this.csrf(token), expires = now + 8 * 3600_000;
    await this.store.call('session.create', {tenantId: found.actor.tenantId, actorId: found.actor.id, now,
      tokenHash: digestToken(token), csrfHash: digestToken(csrf), expires});
    return {token, csrf, expires, actor: found.actor};
  }

  async resolve(token: string): Promise<{actor: Actor; csrfHash: string; expires: number}> {
    assert(token.length <= 300, 'INVALID_SESSION', 'Sign in again.', 401);
    const result = await this.store.call<{actor: Actor; csrfHash: string; expires: number} | null>('session.resolve', {tokenHash: digestToken(token), now: Date.now()});
    assert(result, 'INVALID_SESSION', 'The session expired. Sign in again.', 401);
    return result;
  }

  csrf(token: string): string {
    return createHmac('sha256', Buffer.from(this.config.callbackKey, 'hex')).update('csrf:' + token).digest('base64url');
  }

  async revoke(token: string): Promise<void> {
    const session = await this.resolve(token);
    this.revokeActor(session.actor);
    await this.store.call('session.revoke', {tokenHash: digestToken(token)});
  }

  bind(actor: Actor, parent: AbortSignal): {signal: AbortSignal; release: () => void} {
    const controller = new AbortController(), key = actor.tenantId + ':' + actor.id;
    const set = this.runs.get(key) ?? new Set<AbortController>();
    this.runs.set(key, set); set.add(controller);
    return {signal: AbortSignal.any([parent, controller.signal]), release: () => {set.delete(controller);if (!set.size) this.runs.delete(key);}};
  }

  revokeActor(actor: Actor): void {
    for (const controller of this.runs.get(actor.tenantId + ':' + actor.id) ?? []) controller.abort(new OperatorError('AUTHORITY_REVOKED', 'Account authority changed.', 403));
  }
}

export async function verifyOidc(token: string, issuer: string, audience: string, jwksUrl: URL): Promise<{subject: string; issuer: string}> {
  assert(jwksUrl.protocol === 'https:', 'CONFIG_INVALID', 'OIDC keys require HTTPS.', 503);
  const {payload} = await jwtVerify(token, createRemoteJWKSet(jwksUrl), {issuer, audience, algorithms: ['RS256','ES256']});
  assert(typeof payload.sub === 'string' && payload.sub.length > 0, 'INVALID_IDENTITY', 'The identity provider did not identify this user.', 401);
  return {subject: payload.sub, issuer};
}
