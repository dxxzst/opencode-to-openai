import { startProxy } from './proxy.js';
import axios from 'axios';

const PROVIDER_ID = 'opencode-to-openai';

const DEFAULTS = {
    enabled: true,
    port: 8083,
    apiKey: '',
    backendUrl: 'http://127.0.0.1:4097',
    opencodePath: 'opencode',
    writeAllowlist: true,
    setDefaultOnLogin: false,
    defaultModel: ''
};

function normalizeConfig(raw = {}) {
    const merged = { ...DEFAULTS, ...raw };
    merged.port = Number.parseInt(merged.port, 10) || DEFAULTS.port;
    merged.apiKey = merged.apiKey || '';
    merged.defaultModel = merged.defaultModel || '';
    merged.backendUrl = merged.backendUrl || DEFAULTS.backendUrl;
    merged.opencodePath = merged.opencodePath || DEFAULTS.opencodePath;
    return merged;
}

function baseUrlFor(port) {
    return `http://127.0.0.1:${port}/v1`;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModels(rawModels) {
    if (!Array.isArray(rawModels)) return [];
    return rawModels.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        input: ['text'],
        contextWindow: 200000,
        maxTokens: 8192
    }));
}

function resolveDefaultModel(requested, modelEntries) {
    if (!modelEntries.length) return null;
    if (requested) {
        const trimmed = requested.trim();
        if (trimmed.startsWith(`${PROVIDER_ID}/`)) return trimmed;
        const ids = new Set(modelEntries.map((m) => m.id));
        if (ids.has(trimmed)) return `${PROVIDER_ID}/${trimmed}`;
    }
    return `${PROVIDER_ID}/${modelEntries[0].id}`;
}

function mergeAllowlist(existingAllowlist, modelEntries) {
    const merged = { ...(existingAllowlist || {}) };
    modelEntries.forEach((m) => {
        const ref = `${PROVIDER_ID}/${m.id}`;
        if (!merged[ref]) merged[ref] = {};
    });
    return merged;
}

const plugin = {
    id: PROVIDER_ID,
    name: 'OpenCode Proxy',

    register(api) {
        const cfg = normalizeConfig(api.pluginConfig);
        const baseUrl = baseUrlFor(cfg.port);
        let proxyInstance = null;
        let proxyStarting = null;
        let cachedModels = null;
        let cachedAt = 0;

        const ensureProxy = async () => {
            if (!cfg.enabled) {
                throw new Error('Plugin is disabled in config.');
            }
            if (proxyInstance) return false;
            const healthUrl = `http://127.0.0.1:${cfg.port}/health`;
            try {
                await axios.get(healthUrl, { timeout: 1000 });
                return false;
            } catch (e) {
                // Proxy not running, start locally.
            }
            let startedHere = false;
            if (!proxyStarting) {
                startedHere = true;
                proxyStarting = (async () => {
                    proxyInstance = startProxy({
                        PORT: cfg.port,
                        API_KEY: cfg.apiKey,
                        OPENCODE_SERVER_URL: cfg.backendUrl,
                        OPENCODE_PATH: cfg.opencodePath
                    });

                    for (let i = 0; i < 20; i += 1) {
                        try {
                            await axios.get(healthUrl, { timeout: 2000 });
                            return;
                        } catch (e) {
                            await delay(500);
                        }
                    }
                    throw new Error('Proxy startup timeout.');
                })();
            }
            try {
                await proxyStarting;
            } catch (err) {
                proxyStarting = null;
                proxyInstance = null;
                throw err;
            }
            return startedHere;
        };

        const fetchModels = async () => {
            const now = Date.now();
            if (cachedModels && now - cachedAt < 30000) return cachedModels;

            const startedHere = await ensureProxy();

            try {
                const headers = {};
                if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
                const res = await axios.get(`${baseUrl}/models`, { headers, timeout: 8000 });
                const data = res.data?.data || [];
                const models = normalizeModels(data);
                cachedModels = models;
                cachedAt = now;
                return models;
            } finally {
                if (startedHere && proxyInstance) {
                    proxyInstance.server.close();
                    proxyInstance.killBackend();
                    proxyInstance = null;
                    proxyStarting = null;
                }
            }
        };

        api.registerService({
            id: 'opencode-proxy-service',
            start: async () => {
                if (!cfg.enabled) return;
                await ensureProxy();
            },
            stop: async () => {
                if (proxyInstance) {
                    proxyInstance.server.close();
                    proxyInstance.killBackend();
                    proxyInstance = null;
                    proxyStarting = null;
                }
            }
        });

        api.registerProvider({
            id: PROVIDER_ID,
            label: 'OpenCode Proxy',
            auth: [
                {
                    id: 'local',
                    label: 'Local Proxy',
                    kind: 'apiKey',
                    run: async () => {
                        const modelEntries = await fetchModels();
                        if (!modelEntries.length) {
                            throw new Error('No models returned from proxy.');
                        }

                        const providerConfig = {
                            baseUrl,
                            api: 'openai-completions',
                            models: modelEntries
                        };
                        if (cfg.apiKey) providerConfig.apiKey = cfg.apiKey;

                        const configPatch = {
                            models: {
                                mode: 'merge',
                                providers: {
                                    [PROVIDER_ID]: providerConfig
                                }
                            }
                        };

                        if (cfg.writeAllowlist) {
                            const existingAllowlist = api.config?.agents?.defaults?.models || {};
                            const allowlist = mergeAllowlist(existingAllowlist, modelEntries);
                            configPatch.agents = { defaults: { models: allowlist } };
                        }

                        const defaultRef = resolveDefaultModel(cfg.defaultModel, modelEntries);
                        if (cfg.setDefaultOnLogin && defaultRef) {
                            if (!configPatch.agents) configPatch.agents = { defaults: {} };
                            if (!configPatch.agents.defaults) configPatch.agents.defaults = {};
                            const existingModel = api.config?.agents?.defaults?.model || {};
                            configPatch.agents.defaults.model = { ...existingModel, primary: defaultRef };
                        }

                        const profileKey = cfg.apiKey || 'local';
                        const profileId = `${PROVIDER_ID}:local`;
                        const profiles = [
                            {
                                profileId,
                                credential: {
                                    type: 'api_key',
                                    provider: PROVIDER_ID,
                                    key: profileKey
                                }
                            }
                        ];

                        return {
                            profiles,
                            configPatch,
                            defaultModel: defaultRef
                        };
                    }
                }
            ]
        });
    }
};

export default plugin;
