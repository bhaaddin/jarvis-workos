import {definePluginEntry} from 'openclaw/plugin-sdk/plugin-entry';

export default definePluginEntry({
  id: 'jarvis-project-tools',
  name: 'JARVIS Project Tools',
  description: 'Connected Windows project source, instructions, and current Git facts.',
  register(api) {
    api.registerTool({
      name: 'jarvis_weather',
      label: 'Live weather',
      description: 'Get current conditions from Open-Meteo, or three forecast days when scope=forecast. Use this directly for weather questions; no skill read, curl, browser, or web search is needed. Return the actual matched location/time and values. If available=false, report that live weather is unavailable; do not retry via other tools.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          location: {type: 'string', minLength: 2, maxLength: 100, description: 'City name, e.g. Prague or Praha. Do not supply coordinates or URLs.'},
          country_code: {type: 'string', pattern: '^[A-Za-z]{2}$', description: 'Optional ISO country code, e.g. CZ for Czechia or US for the United States.'},
          scope: {type: 'string', enum: ['current', 'forecast'], description: 'Default current. Use forecast only when future weather is requested.'},
        },
        required: ['location'],
      },
      async execute(_id, parameters) {
        const token = process.env.JARVIS_PROJECT_TOKEN;
        if (!token) throw new Error('Project Hub is not configured.');
        const response = await fetch(new URL('/api/weather', process.env.JARVIS_PROJECT_URL || 'http://host.docker.internal:18791'), {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
          body: JSON.stringify(parameters), signal: AbortSignal.timeout(8000), redirect: 'error',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Weather lookup failed.');
        return {content: [{type: 'text', text: JSON.stringify(result)}], details: result};
      },
    });
    api.registerTool({
      name: 'jarvis_calculate',
      label: 'Verified arithmetic',
      description: 'Calculate numerical answers rather than guessing arithmetic. Supports decimal numbers, parentheses, + - * / % and small integer powers (**). For totals, discounts, time gaps and percentages, choose the correct counts/units, call this tool, and use its returned value.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {expression: {type: 'string', description: 'Arithmetic expression, for example 19.95*3. No code, names or functions.'}},
        required: ['expression'],
      },
      async execute(_id, parameters) {
        const token = process.env.JARVIS_PROJECT_TOKEN;
        if (!token) throw new Error('Project Hub is not configured.');
        const response = await fetch(new URL('/api/calculate', process.env.JARVIS_PROJECT_URL || 'http://host.docker.internal:18791'), {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
          body: JSON.stringify(parameters), signal: AbortSignal.timeout(10000), redirect: 'error',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Calculation failed (${response.status})`);
        return {content: [{type: 'text', text: JSON.stringify(result)}], details: result};
      },
    });
    api.registerTool({
      name: 'jarvis_projects',
      label: 'Connected project',
      description: 'Read connected host projects and upstream clones. Use list with query/start/limit to find project IDs, connections for adapter metadata, compatibility for actual source/runtime contract checks, overview for instructions, tree/read/search/git for source. Source-ready is not a running application or connected account. Paths are relative to the explicit root; cloned projects normally use root=source.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          action: {type: 'string', enum: ['list', 'connections', 'compatibility', 'overview', 'tree', 'read', 'search', 'git', 'instructions']},
          project: {type: 'string', description: 'Connected project ID, for example medical.'},
          root: {type: 'string', description: 'Root ID, for example backend or frontend.'},
          path: {type: 'string', description: 'Relative source path, for example package.json. Never a Windows absolute path.'},
          query: {type: 'string', description: 'Literal text to search, 2-200 characters.'},
          start: {type: 'integer', minimum: 1},
          limit: {type: 'integer', minimum: 1, maximum: 300},
        },
        required: ['action'],
      },
      async execute(_id, parameters) {
        const token = process.env.JARVIS_PROJECT_TOKEN;
        if (!token) throw new Error('The Project Hub token is missing from the Gateway environment.');
        const response = await fetch(new URL('/api/tool', process.env.JARVIS_PROJECT_URL || 'http://host.docker.internal:18791'), {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
          body: JSON.stringify(parameters), signal: AbortSignal.timeout(45000), redirect: 'error',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Project Hub HTTP ${response.status}`);
        return {content: [{type: 'text', text: JSON.stringify(result)}], details: result};
      },
    });
  },
});
