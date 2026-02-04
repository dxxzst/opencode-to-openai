import { startProxy } from './proxy.js';

/**
 * OpenClaw Native Plugin Entrypoint
 */
export default function (api) {
    const id = 'opencode-proxy';
    
    // Register the configuration schema for OpenClaw Control UI
    const configSchema = {
        type: 'object',
        properties: {
            enabled: { type: 'boolean', default: true },
            port: { type: 'integer', default: 8083 },
            apiKey: { type: 'string', default: '' },
            backendUrl: { type: 'string', default: 'http://127.0.0.1:4097' },
            opencodePath: { type: 'string', default: 'opencode' }
        }
    };

    const uiHints = {
        enabled: { label: 'Enable Proxy' },
        port: { label: 'API Port', help: 'Port for the OpenAI-compatible API.' },
        apiKey: { label: 'API Key', help: 'Optional Bearer Token for security.', sensitive: true },
        backendUrl: { label: 'Backend URL', advanced: true },
        opencodePath: { label: 'OpenCode Binary Path', placeholder: 'opencode', advanced: true }
    };

    let server = null;

    // Register as a Background Service in OpenClaw
    api.registerService({
        id,
        start: async () => {
            const cfg = api.config.plugins?.entries?.[id]?.config || {};
            if (cfg.enabled === false) return;

            api.logger.info(`[${id}] Starting OpenCode Proxy on port ${cfg.port || 8083}...`);
            
            server = startProxy({
                PORT: cfg.port || 8083,
                API_KEY: cfg.apiKey || '',
                OPENCODE_SERVER_URL: cfg.backendUrl || 'http://127.0.0.1:4097',
                OPENCODE_PATH: cfg.opencodePath || 'opencode'
            });
        },
        stop: async () => {
            if (server) {
                api.logger.info(`[${id}] Stopping OpenCode Proxy...`);
                server.close();
            }
        }
    });

    return { id, name: 'OpenCode to OpenAI Proxy', configSchema, uiHints };
}
