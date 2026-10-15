import {createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes} from 'node:crypto';
import type {Json, ObjectValue, Sensitivity} from './contracts.js';
import {OperatorError} from './errors.js';

export const sensitivityRank: Record<Sensitivity, number> = {public: 0, internal: 1, pii: 2, phi: 3};

export function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new OperatorError('INVALID_JSON', 'Finite JSON numbers are required.');
    if (value !== null && !['boolean','number','string'].includes(typeof value)) throw new OperatorError('INVALID_JSON', 'JSON data is required.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => {
    const item = value[key];
    if (item === undefined) throw new OperatorError('INVALID_JSON', 'Undefined JSON fields are not accepted.');
    return JSON.stringify(key) + ':' + canonical(item);
  }).join(',') + '}';
}

export function fingerprint(value: Json): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class Seal {
  private readonly encryptionKey: Buffer;
  private readonly digestKey: Buffer;
  constructor(key: Buffer) {
    if (key.length !== 32) throw new OperatorError('CONFIG_INVALID', 'A 32-byte data encryption key is required.', 503);
    this.encryptionKey = Buffer.from(hkdfSync('sha256', key, '', 'jarvis-data-v1', 32));
    this.digestKey = Buffer.from(hkdfSync('sha256', key, '', 'jarvis-audit-v1', 32));
  }

  seal(value: Json, binding: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, nonce);
    cipher.setAAD(Buffer.from(binding));
    const ciphertext = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  open(value: string, binding: string): Json {
    try {
      const bytes = Buffer.from(value, 'base64url');
      if (bytes.length < 30 || bytes[0] !== 1) throw new Error('Invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, bytes.subarray(1, 13));
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(bytes.subarray(13, 29));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8')) as Json;
    } catch {
      throw new OperatorError('DATA_INTEGRITY', 'Protected application data could not be verified.', 500);
    }
  }

  digest(value: Json): string {
    return createHmac('sha256', this.digestKey).update(canonical(value)).digest('hex');
  }

  redacted(value: Json, sensitivity: Sensitivity): ObjectValue {
    // Free-form data is never copied into operational logs, even if a model
    // guessed that it was public. Authorized payload access is a separate path.
    return {redacted: true, sensitivity, digest: this.digest(value), bytes: Buffer.byteLength(canonical(value))};
  }
}
