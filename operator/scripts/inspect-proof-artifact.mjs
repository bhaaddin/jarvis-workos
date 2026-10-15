import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const id=process.argv[2];if(!/^[0-9a-f-]{36}$/i.test(id??''))throw new Error('Provide a qualification artifact UUID');
const session=await fetch('http://127.0.0.1:18791/api/session');const cookie=session.headers.get('set-cookie').split(';')[0];
const response=await fetch('http://127.0.0.1:18791/api/operator/actions/'+id,{headers:{Cookie:cookie}});
const action=await response.json();
const folder=path.join(projectRoot,'logs','artifact-inspection-'+id);mkdirSync(folder,{recursive:true});
writeFileSync(path.join(folder,'action.json'),JSON.stringify(action,null,2));console.log(JSON.stringify(action,null,2));
