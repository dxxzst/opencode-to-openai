import { startProxy } from './proxy.js';
import http from 'http';

/**
 * OpenClaw Native Plugin Entrypoint
 * 
 * This plugin:
 * 1. Registers 'opencode' as a model provider for openclaw onboard wizard
 * 2. Starts a background proxy service that bridges OpenCode CLI to OpenAI-compatible API
 */
export default function (api) {
    const id = 'opencode-to-openai';
    let proxyInstance = null;

    /**
     * Fetch available models from the proxy
     */
    async function fetchModelsFromProxy(port) {
        return new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}/v1/models`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.data || []);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    // Register as a model provider for openclaw onboard / models auth wizard
    api.registerProvider({
        id: 'opencode',
        label: 'OpenCode (Free Models)',
        auth: [
            {
                id: 'local-proxy',
                label: 'Local Proxy (No Auth Required)',
                kind: 'none',
                run: async (ctx) => {
                    const cfg = api.config.plugins?.entries?.[id]?.config || {};
                    const port = cfg.port || 8083;
                    
                    // Dynamically fetch models from proxy
                    let models = [];
                    try {
                        api.logger.info(`[${id}] Fetching available models from proxy...`);
                        models = await fetchModelsFromProxy(port);
                        api.logger.info(`[${id}] Found ${models.length} models.`);
                    } catch (err) {
                        api.logger.warn(`[${id}] Failed to fetch models: ${err.message}. Using fallback.`);
                        // Fallback to common free models if proxy is not ready
                        models = [
                            { id: 'opencode/kimi-k2.5-free', name: 'Kimi K2.5 Free' },
                            { id: 'opencode/glm-4.7-free', name: 'GLM 4.7 Free' }
                        ];
                    }

                    // Build model entries for config
                    const modelEntries = models.map(m => ({
                        id: m.id.includes('/') ? m.id.split('/')[1] : m.id,
                        name: m.name || m.id
                    }));

                    // Build model aliases
                    const modelAliases = {};
                    models.forEach(m => {
                        const fullId = m.id.includes('/') ? m.id : `opencode/${m.id}`;
                        const shortName = m.name || m.id.split('/').pop();
                        modelAliases[fullId] = { alias: shortName.replace(/-free$/, '').replace(/-/g, ' ') };
                    });

                    // Default to first model
                    const defaultModel = models.length > 0 
                        ? (models[0].id.includes('/') ? models[0].id : `opencode/${models[0].id}`)
                        : 'opencode/kimi-k2.5-free';

                    return {
                        profiles: [],
                        defaultModel,
                        configPatch: {
                            models: {
                                mode: 'merge',
                                providers: {
                                    opencode: {
                                        baseUrl: `http://127.0.0.1:${port}/v1`,
                                        api: 'openai-completions',
                                        models: modelEntries
                                    }
                                }
                            },
                            agents: {
                                defaults: {
                                    models: modelAliases
                                }
                            }
                        }
                    };
                }
            }
        ]
    });

    // Register background service to start the proxy
    api.registerService({
        id,
        start: async () => {
            const cfg = api.config.plugins?.entries?.[id]?.config || {};
            if (cfg.enabled === false) return;

            const port = cfg.port || 8083;
            proxyInstance = startProxy({
                PORT: port,
                API_KEY: cfg.apiKey || '',
                OPENCODE_SERVER_URL: cfg.backendUrl || 'http://127.0.0.1:4097',
                OPENCODE_PATH: cfg.opencodePath || 'opencode'
            });
            
            api.logger.info(`[${id}] Proxy service started on port ${port}`);
            api.logger.info(`[${id}] To configure models, run: openclaw models auth login --provider opencode`);
        },
        stop: async () => {
            if (proxyInstance) {
                proxyInstance.server.close();
                proxyInstance.killBackend();
                api.logger.info(`[${id}] Proxy service stopped`);
            }
        }
    });

    return { id, name: 'OpenCode Proxy' };
}
