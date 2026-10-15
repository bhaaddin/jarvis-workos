import {definePluginEntry} from 'openclaw/plugin-sdk/plugin-entry';
import {readFileSync} from 'node:fs';

export default definePluginEntry({
  id: 'jarvis-operator-boundary',
  name: 'JARVIS Operator Boundary',
  register(api) {
    let blockedNative = 0;
    let suppressedWrites = 0;
    api.on('before_tool_call', event => {
      // Client function calls only describe requests; Node owns their execution
      // and checks the exact registered name, caller and immutable policy state.
      if (!event.toolName.startsWith('jarvis_')) {
        blockedNative++;
        return {block: true, blockReason: 'Operational effects require the JARVIS policy owner.'};
      }
    }, {priority: 1000});
    // HTTP requests carry their prepared context; Node owns durable encrypted
    // history. This is a synchronous persistence hook, not an async observer.
    api.on('before_message_write', () => {suppressedWrites++;return {block: true};}, {priority: 1000});
    api.registerHttpRoute({
      path: '/jarvis/operator-boundary', auth: 'gateway', match: 'exact',
      handler(_request, response) {
        let nativeLogsDisabled=false;
        try {
          const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
          nativeLogsDisabled=config.logging?.level==='silent'&&config.logging?.consoleLevel==='silent'
            &&process.env.OPENCLAW_LOG_LEVEL==='silent'&&process.env.JARVIS_OPERATOR_CONSOLE_STORAGE==='none';
        } catch {}
        response.statusCode = nativeLogsDisabled?200:503;
        response.setHeader('Content-Type','application/json');
        response.end(JSON.stringify({boundaryVersion:2, policy:'caller-owned-effects', nativeLogsDisabled, blockedNative, suppressedWrites}));
        return true;
      },
    });
  },
});
