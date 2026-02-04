import { startProxy } from './proxy.js';
import http from 'http';

/**
 * OpenClaw Native Plugin Entrypoint
 */
export default function (api) {
    const id = 'opencode-proxy';
    
    const configSchema = {
        type: 'object',
        properties: {
            enabled: { type: 'boolean', default: true },
            port: { type: 'integer', default: 8083 },
            apiKey: { type: 'string', default: "" },
            backendUrl: { type: 'string', default: "http://127.0.0.1:4097" },
            opencodePath: { type: 'string', default: "opencode" },
            autoSyncModels: { type: 'boolean', default: true }
        }
    };

    const uiHints = {
        enabled: { label: 'Enable Proxy' },
        port: { label: 'API Port' },
        apiKey: { label: 'API Key', sensitive: true },
        backendUrl: { label: 'Backend URL', advanced: true },
        opencodePath: { label: 'OpenCode Binary Path', advanced: true },
        autoSyncModels: { label: 'Auto Sync Models', help: 'Automatically sync and overwrite model list from OpenCode.' }
    };

    let server = null;

    /**
     * Fetch models from the proxy and update OpenClaw config defensively
     */
    async function syncModels(port) {
        const proxyUrl = `http://127.0.0.1:${port}/v1/models`;
        api.logger.info(`[${id}] Syncing models from ${proxyUrl}...`);
        
        try {
            const models = await new Promise((resolve, reject) => {
                const req = http.get(proxyUrl, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.data || []);
                        } catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.setTimeout(5000, () => req.destroy());
            });

            if (models && models.length > 0) {
                const modelEntries = models.map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 200000,
                    maxTokens: 8192
                }));

                const patch = {
                    models: {
                        providers: {
                            opencode: {
                                baseUrl: `http://127.0.0.1:${port}/v1`,
                                api: "openai-completions",
                                models: modelEntries
                            }
                        }
                    }
                };

                // Defensive logic for primary model
                const currentPrimary = api.config.agents?.defaults?.model?.primary;
                if (currentPrimary && currentPrimary.startsWith('opencode/')) {
                    const isStillAvailable = models.some(m => m.id === currentPrimary);
                    if (!isStillAvailable) {
                        const newPrimary = models[0].id;
                        api.logger.warn(`[${id}] Primary model ${currentPrimary} is no longer available. Auto-switching to ${newPrimary}.`);
                        
                        // Update the agents.defaults.model.primary as well
                        patch.agents = {
                            defaults: {
                                model: {
                                    primary: newPrimary
                                }
                            }
                        };
                    }
                }

                await api.gateway.applyConfigPatch(patch);
                api.logger.info(`[${id}] Successfully synced ${models.length} models.`);
            } else {
                api.logger.warn(`[${id}] Received empty model list from OpenCode. Skipping sync.`);
            }
        } catch (err) {
            api.logger.warn(`[${id}] Model sync failed: ${err.message}`);
        }
    }

    api.registerService({
        id,
        start: async () => {
            const cfg = api.config.plugins?.entries?.[id]?.config || {};
            if (cfg.enabled === false) return;

            const port = cfg.port || 8083;
            server = startProxy({
                PORT: port,
                API_KEY: cfg.apiKey || '',
                OPENCODE_SERVER_URL: cfg.backendUrl || 'http://127.0.0.1:4097',
                OPENCODE_PATH: cfg.opencodePath || 'opencode'
            });

            if (cfg.autoSyncModels !== false) {
                // Wait for proxy and backend to be fully initialized
                setTimeout(() => syncModels(port), 15000);
            }
        },
        stop: async () => {
            if (server) server.close();
        }
    });

    return { id, name: 'OpenCode to OpenAI Proxy', configSchema, uiHints };
}
