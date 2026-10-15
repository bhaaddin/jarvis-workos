import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assert} from './errors.js';
import type {Environment, ObjectValue} from './contracts.js';
import {fingerprint} from './privacy.js';
import {integer, object, strings, text} from './store-context.js';
import type {ResourceProfile} from './runtime-control.js';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const projectRoot = path.resolve(packageRoot, '..');

export interface Config {
  environment: Environment;
  tenantId: string;
  timezone: string;
  host: string;
  port: number;
  origin: string;
  databasePath: string;
  dataKey: string;
  callbackKey: string;
  adminPassword: string;
  gatewayUrl: URL;
  gatewayToken: string;
  skillsRoot: string;
  enabledTools: string[];
  providerMode: 'fixture' | 'live';
  maxAgentSteps: number;
  maxToolCalls: number;
  maxAgentMs?: number;
  configurationHash: string;
  environmentValues: Record<string, string | undefined>;
  medicalContext?: string;
  inference?:{baseUrl:string;model:string;think:true|'high'|'xhigh';contextTokens:number;maxTokens:number;keepAliveSeconds?:number};
  toolDiscovery?:boolean;
  resourceProfile?:ResourceProfile;
  resourceConfigPath?:string;
  buildInfo?:ObjectValue;
  finance?:{root:string;ownerId:string;studyId:string};
  firm?:{tenant:string;displayName:string;industry:string;languages:string[];tone:string;workingHours:ObjectValue;approvalDefaults:ObjectValue;fieldPacks:string[];branding:ObjectValue;billingNote:string};
}

export function loadConfig(): Config {
  const environment = process.env.JARVIS_OPERATOR_ENV ?? 'staging';
  assert(['dev','staging','prod'].includes(environment), 'CONFIG_INVALID', 'Choose dev, staging, or prod.', 503);
  const all = object(JSON.parse(readFileSync(path.join(packageRoot, 'config/environments.json'), 'utf8')));
  const selected = object(all[environment]);
  const financePath=path.join(packageRoot,'config/finance.json');let finance:Config['finance'];
  if(existsSync(financePath)){
    const value=object(JSON.parse(readFileSync(financePath,'utf8')));
    assert(typeof value.root==='string'&&typeof value.ownerId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value.ownerId)
      &&typeof value.studyId==='string'&&/^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/.test(value.studyId),'CONFIG_INVALID','Invalid local Finance configuration.',503);
    finance={root:path.resolve(projectRoot,value.root),ownerId:value.ownerId,studyId:value.studyId};
  }
  const medicalContext=readFileSync(path.join(packageRoot,'context/medical.md'),'utf8');
  const firmPath=path.join(packageRoot,'config/firm.json');let firm:Config['firm'];
  if(existsSync(firmPath)){
    const value=object(JSON.parse(readFileSync(firmPath,'utf8')));
    assert(typeof value.tenant==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value.tenant)
      &&typeof value.displayName==='string'&&value.displayName.length>=1&&value.displayName.length<=80
      &&typeof value.industry==='string'&&value.industry.length<=80&&Array.isArray(value.languages)
      &&value.languages.length>=1&&value.languages.every(language=>typeof language==='string'&&/^[a-z]{2}$/.test(language))
      &&typeof value.tone==='string'&&value.tone.length<=500&&typeof value.billingNote==='string'&&value.billingNote.length<=500
      &&Array.isArray(value.fieldPacks)&&value.fieldPacks.every(pack=>typeof pack==='string'&&/^[a-z-]{1,40}$/.test(pack)),'CONFIG_INVALID','Invalid firm profile.',503);
    firm={tenant:value.tenant,displayName:value.displayName,industry:value.industry,languages:value.languages as string[],
      tone:value.tone,workingHours:object(value.workingHours??{}),approvalDefaults:object(value.approvalDefaults??{}),
      fieldPacks:value.fieldPacks as string[],branding:object(value.branding??{}),billingNote:value.billingNote};
  }
  const modelPath=path.join(packageRoot,'config/model.json');let inference:Config['inference'];let toolDiscovery=false;
  const resourceConfigPath=path.join(packageRoot,'config/resources.json');
  const resource=existsSync(resourceConfigPath)?object(JSON.parse(readFileSync(resourceConfigPath,'utf8'))):{profile:'interactive'};
  assert(resource.profile==='interactive'||resource.profile==='balanced','CONFIG_INVALID','Choose interactive or balanced resources.',503);
  const resourceProfile=resource.profile;
  if(existsSync(modelPath)){
    const model=object(JSON.parse(readFileSync(modelPath,'utf8')));
    toolDiscovery=model.toolDiscovery===true;
    assert(model.transport==='ollama'||model.transport==='openclaw','CONFIG_INVALID','Choose a reviewed model transport.',503);
    if(model.transport==='ollama'){
      assert(model.think===true||model.think==='high'||model.think==='xhigh','CONFIG_INVALID','Keep the selected model reasoning enabled.',503);
      inference={baseUrl:text(model.baseUrl,200),model:text(model.model,200),think:model.think,
        contextTokens:integer(model.contextTokens,32768,262144),maxTokens:integer(model.maxTokens,4096,32768)};
    }
  }
  const enabledTools=[...strings(selected.enabledTools),...strings(all.commonEnabledTools??[])];
  const mode = selected.providerMode === 'fixture' ? 'fixture' : 'live';
  assert(environment !== 'prod' || mode === 'live', 'CONFIG_INVALID', 'Production cannot use synthetic providers.', 503);
  const key = process.env.JARVIS_OPERATOR_DATA_KEY ?? '', callback = process.env.JARVIS_OPERATOR_CALLBACK_KEY ?? '';
  assert(/^[0-9a-f]{64}$/i.test(key) && /^[0-9a-f]{64}$/i.test(callback), 'CONFIG_MISSING', 'Initialize the private operator data/callback keys first.', 503);
  const origin = process.env.JARVIS_PUBLIC_ORIGIN ?? 'http://127.0.0.1:18801';
  if (environment === 'prod') {
    assert(origin.startsWith('https://') && Boolean(process.env.JARVIS_OIDC_ISSUER && process.env.JARVIS_OIDC_AUDIENCE),
      'PRODUCTION_IDENTITY_MISSING', 'Production requires an approved HTTPS origin and OIDC configuration.', 503);
  }
  const publicConfig: ObjectValue = {environment, tenant: process.env.JARVIS_OPERATOR_TENANT ?? 'sportmedical-local',
    timezone: process.env.JARVIS_OPERATOR_TIMEZONE ?? 'Europe/Prague', origin, selected, enabledTools,medicalContextHash:fingerprint(medicalContext),inference:inference??null,toolDiscovery,finance:finance??null};
  if(firm)assert(firm.tenant===text(publicConfig.tenant),'CONFIG_INVALID','The firm profile tenant does not match this deployment.',503);
  // Residency policy affects resources, not tool authorization or effect identity.
  const configurationHash=fingerprint(publicConfig);
  if(inference)inference.keepAliveSeconds=resourceProfile==='balanced'?900:-1;
  const stampPath=path.join(packageRoot,'dist/.build-info.json');
  const stamp=existsSync(stampPath)?object(JSON.parse(readFileSync(stampPath,'utf8'))):null;
  const buildInfo: ObjectValue={source:stamp?.source??null,builtAt:stamp?.builtAt??null,node:process.version};
  new Intl.DateTimeFormat('en', {timeZone: text(publicConfig.timezone)}).format();
  return {environment: environment as Environment, tenantId: text(publicConfig.tenant), timezone: text(publicConfig.timezone),
    host: '127.0.0.1', port: 18801, origin, databasePath: path.join(projectRoot, 'runtime/operator', environment + '.sqlite'),
    dataKey: key, callbackKey: callback, adminPassword: process.env.JARVIS_OPERATOR_ADMIN_PASSWORD ?? '',
    gatewayUrl: new URL(process.env.JARVIS_OPERATOR_GATEWAY_URL ?? 'http://127.0.0.1:18809'),
    gatewayToken: process.env.JARVIS_OPERATOR_GATEWAY_TOKEN ?? '', skillsRoot: path.join(packageRoot, 'skills'),
    enabledTools, providerMode: mode,
     maxAgentSteps: integer(selected.maxAgentSteps, 1, 20), maxToolCalls: integer(selected.maxToolCalls, 1, 40),
     maxAgentMs: integer(selected.maxAgentMs??180000,60000,600000),
     configurationHash, environmentValues: {...process.env},medicalContext,toolDiscovery,...(inference?{inference}:{}),...(finance?{finance}:{}),...(firm?{firm}:{}),resourceProfile,resourceConfigPath,buildInfo};
}
