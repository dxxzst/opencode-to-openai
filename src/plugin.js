import { startProxy } from './proxy.js';
import http from 'http';

/**
 * OpenClaw Native Plugin Entrypoint
 */
export default function (api) {
    const id = 'opencode-to-openai';
    // configSchema is now defined in openclaw.plugin.json

    let proxyInstance = null;

    /**
     * Poll health then sync models
     */
    async function syncModels(port, backendUrl) {
        api.logger.info(`[${id}] Waiting for backend health at ${backendUrl}...`);
        
        for (let i = 0; i < 30; i++) {
            try {
                const healthy = await new Promise((resolve, reject) => {
                    const req = http.get(`${backendUrl}/health`, (res) => resolve(res.statusCode === 200));
                    req.on('error', reject);
                    req.setTimeout(1000, () => { req.destroy(); reject(new Error('Timeout')); });
                });
                if (healthy) break;
            } catch (e) {}
            await new Promise(r => setTimeout(r, 2000));
        }

        const proxyUrl = `http://127.0.0.1:${port}/v1/models`;
        try {
            const models = await new Promise((resolve, reject) => {
                const req = http.get(proxyUrl, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(JSON.parse(data).data || []));
                });
                req.on('error', reject);
            });

            if (models.length > 0) {
                const modelEntries = models.map(m => ({
                    id: m.id, name: m.name || m.id, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 200000, maxTokens: 8192
                }));

                await api.gateway.applyConfigPatch({
                    models: { providers: { opencode: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", models: modelEntries } } }
                });
                api.logger.info(`[${id}] Synced ${models.length} models.`);
            }
        } catch (err) {
            api.logger.warn(`[${id}] Sync failed: ${err.message}`);
        }
    }

    api.registerService({
        id,
        start: async () => {
            const cfg = api.config.plugins?.entries?.[id]?.config || {};
            if (cfg.enabled === false) return;

            const port = cfg.port || 8083;
            const backendUrl = cfg.backendUrl || 'http://127.0.0.1:4097';
            
            proxyInstance = startProxy({
                PORT: port,
                API_KEY: cfg.apiKey || '',
                OPENCODE_SERVER_URL: backendUrl,
                OPENCODE_PATH: cfg.opencodePath || 'opencode'
            });

            if (cfg.autoSyncModels !== false) syncModels(port, backendUrl);
        },
        stop: async () => {
            if (proxyInstance) {
                proxyInstance.server.close();
                proxyInstance.killBackend();
            }
        }
    });

    return { id, name: 'OpenCode Proxy' };
}
