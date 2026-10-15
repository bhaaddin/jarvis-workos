import path from 'node:path';
import {loadConfig, projectRoot} from './config.js';
import {createOperator} from './server.js';
import {OperatorError} from './errors.js';

let runtime: Awaited<ReturnType<typeof createOperator>> | undefined;
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
  const config = loadConfig();
  runtime = await createOperator(config);
  const {app} = runtime;
  await app.listen({host: config.host, port: config.port});
  console.log(JSON.stringify({service:'jarvis-operator',environment:config.environment,url:`http://${config.host}:${config.port}`,state:'ready'}));
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
} catch (error) {
  await runtime?.app.close().catch(()=>{});
  console.error(JSON.stringify({service:'jarvis-operator',state:'startup_failed',code:error instanceof OperatorError?error.code:'STARTUP_FAILED',
    message:error instanceof OperatorError?error.message:'Startup failed; inspect the scoped setup and checks.'}));
  process.exitCode=1;
}
