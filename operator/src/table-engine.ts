import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {packageRoot,projectRoot} from './config.js';
import {assert} from './errors.js';
import {object} from './store-context.js';

export async function tableEngineImage():Promise<string>{
  let record;try{record=object(JSON.parse(await readFile(path.join(projectRoot,'runtime/table-engine.json'),'utf8')));}
  catch{assert(false,'TABLE_ENGINE_UNAVAILABLE','Run python -B scripts/setup_table_engine.py install.',503);}
  const hash=createHash('sha256');
  for(const name of ['Dockerfile','worker.py','.dockerignore'])hash.update(name).update('\0').update(await readFile(path.join(packageRoot,'table-sandbox',name))).update('\0');
  assert(record.owner==='jarvis-table-engine'&&record.sourceHash===hash.digest('hex'),'TABLE_ENGINE_STALE','Rebuild the table engine after its source changed.',503);
  assert(typeof record.image==='string'&&/^sha256:[a-f0-9]{64}$/.test(record.image),'TABLE_ENGINE_UNAVAILABLE','Install the pinned table-analysis image.',503);
  return record.image;
}
