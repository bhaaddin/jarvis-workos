import {createHash} from 'node:crypto';
import {readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {Ajv, type ValidateFunction} from 'ajv';
import addFormats from 'ajv-formats';
import type {Environment, Invocation, Json, ObjectValue, SkillHealth, ToolContext, ToolManifest, ToolOutput} from './contracts.js';
import {OperatorError, assert} from './errors.js';
import {fingerprint, sensitivityRank} from './privacy.js';
import {json, object} from './store-context.js';
import {Store} from './store.js';
import {abortable} from './cancellation.js';

const manifestSchema = {
  type: 'object', additionalProperties: false,
  required: ['manifestVersion','id','version','description','handler','environments','permissions','risk','serviceOperations','sensitivity','requires','inputSchema','outputSchema','idempotent','supportsUndo','publicProjection','timeoutMs'],
  properties: {
    manifestVersion: {const: 1}, id: {type: 'string', pattern: '^jarvis_[a-z0-9_]{1,56}$'}, version: {type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$'},
    description: {type: 'string', minLength: 10, maxLength: 1500}, handler: {type: 'string', pattern: '^[a-zA-Z0-9_-]+\\.mjs$'},
    environments: {type: 'array', minItems: 1, uniqueItems: true, items: {enum: ['dev','staging','prod']}},
    permissions: {type: 'array', minItems: 1, uniqueItems: true, items: {type: 'string', maxLength: 100}},
    risk: {enum: ['read','internal_write','external_write','money','code','automation']},
    serviceOperations: {type: 'array', uniqueItems: true, items: {type: 'string', pattern: '^[a-z][a-z0-9_.]{1,80}$'}},
    sensitivity: {enum: ['public','internal','pii','phi']}, requires: {type: 'array', items: {type: 'string', pattern: '^[A-Z][A-Z0-9_]+$'}},
    inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, idempotent: {type: 'boolean'}, supportsUndo: {type: 'boolean'},
    publicProjection: {type: 'boolean'}, timeoutMs: {type: 'integer', minimum: 100, maximum: 120000},
    providerMode: {enum: ['live','fixture']},
  },
};

interface Loaded {
  manifest: ToolManifest;
  fingerprint: string;
  input: ValidateFunction;
  output: ValidateFunction;
  execute: (input: ObjectValue, context: ToolContext) => Promise<unknown>;
  health: SkillHealth;
}

export class Registry {
  private readonly ajv = new Ajv({allErrors: true, strict: true, validateFormats: true, allowUnionTypes: true});
  private readonly skills = new Map<string, Loaded>();
  private health: SkillHealth[] = [];
  constructor(private readonly options: {root: string; environment: Environment; enabled: string[];
    configurationHash: string; environmentValues: Record<string, string | undefined>; store: Store}) {
    // ajv-formats publishes CommonJS with an explicit default function property.
    addFormats.default(this.ajv);
  }

  async load(): Promise<void> {
    const root = await realpath(this.options.root);
    const validate = this.ajv.compile<ToolManifest>(manifestSchema);
    const candidates: Array<{manifest: ToolManifest; code: string; artifactHash: string; fingerprint: string; health: SkillHealth}> = [];
    const invalid: SkillHealth[] = [];
    for (const entry of (await readdir(root, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      try {
      const folder = await realpath(path.join(root, entry.name));
      assert(folder.startsWith(root + path.sep), 'SKILL_PATH_INVALID', 'A skill directory escaped its installation root.', 503);
      const raw = await readFile(path.join(folder, 'manifest.json'), 'utf8');
      assert(Buffer.byteLength(raw) <= 64000, 'SKILL_MANIFEST_INVALID', 'A skill manifest is too large.', 503);
      const manifest: unknown = JSON.parse(raw);
      assert(validate(manifest), 'SKILL_MANIFEST_INVALID', `Skill manifest ${entry.name} does not match version 1.`, 503);
      assert(manifest.inputSchema.type === 'object' && manifest.inputSchema.additionalProperties === false,
        'SKILL_SCHEMA_INVALID', 'Tool inputs must be closed objects.', 503);
      assert(!['_confidence','_respond'].some(key=>Object.hasOwn(object(manifest.inputSchema.properties ?? {}),key)),
        'SKILL_SCHEMA_INVALID', 'Orchestration metadata fields are reserved.', 503);
      assert(manifest.inputSchema.$async !== true && manifest.outputSchema.$async !== true,
        'SKILL_SCHEMA_INVALID', 'Tool schemas must validate synchronously.', 503);
      this.ajv.compile(manifest.inputSchema); this.ajv.compile(manifest.outputSchema);
      const file = await realpath(path.join(folder, manifest.handler));
      assert(file.startsWith(folder + path.sep), 'SKILL_PATH_INVALID', 'A handler escaped its skill directory.', 503);
      const code = await readFile(file, 'utf8');
      assert(Buffer.byteLength(code) <= 128000, 'SKILL_HANDLER_INVALID', 'A skill handler is too large.', 503);
      const artifactHash = createHash('sha256').update(raw).update(code).digest('hex');
      const identity = fingerprint({artifactHash, configuration: this.options.configurationHash});
      const enabled = manifest.environments.includes(this.options.environment) && this.options.enabled.includes(manifest.id);
      const missing = manifest.requires.filter(key => !this.options.environmentValues[key] || this.options.environmentValues[key]?.startsWith('__'));
      const health: SkillHealth = {id: manifest.id, version: manifest.version, fingerprint: identity, enabled,
        state: !enabled ? 'disabled' : missing.length ? 'missing_config' : 'ready',
        mode: manifest.providerMode ?? 'live', missing};
      const duplicate = candidates.find(value => value.manifest.id === manifest.id);
      if (duplicate) {
        duplicate.health.state = 'invalid'; duplicate.health.enabled = false; duplicate.health.reason = 'Duplicate installed skill identity.';
        throw new OperatorError('SKILL_DUPLICATE','Duplicate skill identities are not permitted.',503);
      }
      candidates.push({manifest, code, artifactHash, fingerprint: identity, health});
      } catch (error) {
        invalid.push({id:'invalid:'+entry.name,version:'unknown',fingerprint:fingerprint({directory:entry.name}),enabled:false,
          state:'invalid',mode:this.options.environment==='prod'?'live':'fixture',missing:[],
          reason:error instanceof OperatorError?error.message:'The installed manifest, schema or handler file is invalid.'});
      }
    }
    this.health = await this.options.store.call<SkillHealth[]>('skill.sync', {skills: json(candidates.map(({manifest, artifactHash, fingerprint, health}) => ({manifest, artifactHash, fingerprint, health})))});
    this.skills.clear();
    this.health.push(...invalid);
    for (const candidate of candidates) {
      const health = this.health.find(value => value.id === candidate.manifest.id);
      if (!health || health.state !== 'ready') continue;
      try {
      const input = this.ajv.compile(candidate.manifest.inputSchema);
      const output = this.ajv.compile(candidate.manifest.outputSchema);
      // Import the exact fingerprinted bytes. Handlers use injected services,
      // not relative file imports; disk mutation cannot race module loading.
      const module: Record<string, unknown> = await import('data:text/javascript;base64,' + Buffer.from(candidate.code).toString('base64'));
      const execute = module.execute;
      assert(typeof execute === 'function', 'SKILL_HANDLER_INVALID', 'A skill must export execute(input, context).', 503);
      this.skills.set(candidate.manifest.id, {manifest: candidate.manifest, fingerprint: candidate.fingerprint, input, output,
        health, execute: async (args, context) => execute(args, context)});
      } catch {
        health.state = 'invalid'; health.enabled = false; health.reason = 'The installed handler failed its startup load check.';
        await this.options.store.call('skill.health', {id:health.id,fingerprint:health.fingerprint,health:json(health)});
      }
    }
  }

  list(): SkillHealth[] { return structuredClone(this.health); }
  descriptor(id: string): {manifest: ToolManifest; fingerprint: string} {
    const skill = this.skills.get(id);
    assert(skill, 'TOOL_UNAVAILABLE', 'That skill is disabled, unconfigured, or not installed.', 409);
    return {manifest: structuredClone(skill.manifest), fingerprint: skill.fingerprint};
  }

  schemas(context: Invocation): ObjectValue[] {
    return [...this.skills.values()].filter(({manifest}) => manifest.permissions.every(value => context.actor.permissions.includes(value))
      && (context.secure || !['pii','phi'].includes(manifest.sensitivity))).map(({manifest}) => {
      const parameters = structuredClone(manifest.inputSchema);
      const properties = object(parameters.properties ?? {});
      assert(!('_confidence' in properties), 'SKILL_SCHEMA_INVALID', '_confidence is a reserved orchestration field.', 503);
      properties._confidence = {type: 'string', enum: ['high','medium','low','unknown'], description: 'Uncertainty can require human review; this value never grants permission.'};
      if(manifest.id==='jarvis_calculate')properties._respond={type:'boolean',description:'Set true ONLY when the user needs just this numeric answer. A successful exact result is delivered immediately without another model turn. Never set for intermediate calculations, explanations, files or multi-part tasks.'};
      if(manifest.id==='jarvis_finance')properties._respond={type:'boolean',description:'Set true for a simple paper wallet/status question (action=paper, including balance AND open-position count together), or the locked study outcome (action=study). Deliver a verified fixed numeric summary immediately, without another model turn. Leave false for analysis, daily/trade details, other sources, translation or additional deliverables.'};
      parameters.properties = properties;
      if(manifest.risk!=='read')parameters.required=[...(Array.isArray(parameters.required)?parameters.required:[]),'_confidence'];
      return {type: 'function', function: {name: manifest.id, description: manifest.description, parameters}};
    });
  }

  input(id: string, raw: unknown): {input: ObjectValue; confidence: Invocation['confidence']} {
    const skill = this.skills.get(id);
    assert(skill, 'TOOL_UNAVAILABLE', 'The requested skill is unavailable.', 409);
    const input = object(raw), confidence = input._confidence;
    delete input._confidence;
    if(id==='jarvis_calculate'||id==='jarvis_finance'){
      assert(input._respond===undefined||typeof input._respond==='boolean','TOOL_INPUT_INVALID','_respond must be a boolean.');
      delete input._respond;
    }
    if(!skill.input(input))throw new OperatorError('TOOL_INPUT_INVALID','Correct the indicated tool fields before retrying.',400,false,
      {validation:json((skill.input.errors??[]).slice(0,6).map(error=>({schemaPath:error.schemaPath,keyword:error.keyword,
        message:error.message??'Invalid field',...(error.keyword==='enum'?{allowedValues:error.params.allowedValues}:{})})))});
    return {input, confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'unknown'};
  }

  async execute(id: string, input: ObjectValue, context: ToolContext): Promise<ToolOutput> {
    const skill = this.skills.get(id);
    assert(skill, 'TOOL_UNAVAILABLE', 'The skill is not available.', 409);
    context.signal.throwIfAborted();
    await context.assertCurrent();
    const value = object(await abortable(() => skill.execute(structuredClone(input), context), context.signal));
    if (skill.manifest.risk === 'read') await context.assertCurrent();
    assert(Object.hasOwn(value, 'data') && skill.output(value.data), 'TOOL_OUTPUT_INVALID', 'The tool result did not match its declared schema.', 502);
    assert(typeof value.sensitivity === 'string' && value.sensitivity in sensitivityRank,
      'TOOL_OUTPUT_INVALID', 'The tool did not classify its result.', 502);
    const level = value.sensitivity as ToolOutput['sensitivity'];
    assert(sensitivityRank[level] >= sensitivityRank[skill.manifest.sensitivity], 'TOOL_OUTPUT_INVALID', 'A tool cannot downgrade its declared data sensitivity.', 502);
    assert(context.secure || !['pii','phi'].includes(level), 'PROTECTED_TOOL_OUTPUT', 'This result is available only in the secure application.', 403);
    const result = json(value) as unknown as ToolOutput;
    assert(Buffer.byteLength(JSON.stringify(result)) <= 256000, 'TOOL_OUTPUT_LIMIT', 'Use a narrower query for this result.', 502);
    return result;
  }
}
