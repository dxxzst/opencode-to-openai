import { startProxy } from './proxy.js';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * opencode-to-openai: OpenClaw Plugin (V1.5.8 - Clean Config Management)
 * Fixed: Robust CLI output parsing to prevent log noise from entering config.
 */
const plugin = {
    id: 'opencode-to-openai',
    name: 'OpenCode Proxy',
    
    register(api) {
        const providerId = 'opencode-to-openai';
        const proxyPort = api.pluginConfig?.port || 8083;
        const OPENCLAW_BIN = '/root/.nvm/versions/node/v24.13.0/bin/openclaw';

        /**
         * Robustly extracts only the value part from OpenClaw CLI output,
         * stripping away any log noise (timestamps, INFO tags, etc.)
         */
        function cleanCliOutput(stdout, isJson = false) {
            if (!stdout) return isJson ? {} : "";
            const lines = stdout.trim().split('\n');
            // The actual value is always the last part of the output
            const lastLine = lines[lines.length - 1].trim();
            
            if (isJson) {
                try {
                    // Try to find the JSON block in the output
                    const jsonMatch = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
                } catch (e) {
                    return {};
                }
            }
            return lastLine.replace(/^"|"$/g, ''); // Remove surrounding quotes
        }

        async function getModelsFromProxy() {
            const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/models`;
            const data = await new Promise((resolve, reject) => {
                const req = http.get(proxyUrl, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON')); } });
                });
                req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
                req.setTimeout(5000, () => { req.destroy(); reject(new Error('Proxy timeout')); });
            });
            return data.data || [];
        }

        async function getSanitizedAllowlist(freshProxyModels = {}) {
            // Get current allowlist using the robust parser
            const res = await execAsync(`${OPENCLAW_BIN} config get agents.defaults.models --json`).catch(() => ({ stdout: "{}" }));
            const currentAllowlist = cleanCliOutput(res.stdout, true);
            
            const nextAllowlist = {};
            // Remove ONLY items matching proxy patterns
            Object.keys(currentAllowlist).forEach(k => {
                if (!k.includes('opencode') && !k.startsWith('opencode-to-openai/')) {
                    nextAllowlist[k] = currentAllowlist[k];
                }
            });

            const mergedAllowlist = { ...nextAllowlist, ...freshProxyModels };

            // If list is empty, anchor it with the user's primary model to prevent "all models" explosion
            if (Object.keys(mergedAllowlist).length === 0) {
                const pRes = await execAsync(`${OPENCLAW_BIN} config get agents.defaults.model.primary`).catch(() => ({ stdout: "" }));
                const primary = cleanCliOutput(pRes.stdout, false);
                
                if (primary && !primary.includes('opencode')) {
                    mergedAllowlist[primary] = {};
                } else {
                    // Ultimate fallback if everything is opencode
                    mergedAllowlist["google-gemini-cli/gemini-3-flash-preview"] = {};
                }
            }

            return mergedAllowlist;
        }

        async function runSync() {
            const rawModels = await getModelsFromProxy();
            if (rawModels.length === 0) throw new Error('No models found');

            const modelEntries = rawModels.map(m => {
                const pureId = m.id.includes('/') ? m.id.split('/')[1] : m.id;
                return { id: pureId, name: m.name || pureId, input: ["text"], contextWindow: 200000, maxTokens: 8192 };
            });

            const newProxyModels = {};
            modelEntries.forEach(m => { newProxyModels[`${providerId}/${m.id}`] = {}; });

            const providerConfig = { baseUrl: `http://127.0.0.1:${proxyPort}/v1`, api: "openai-completions", models: modelEntries };
            const finalAllowlist = await getSanitizedAllowlist(newProxyModels);

            await execAsync(`${OPENCLAW_BIN} config set --json models.providers.${providerId} '${JSON.stringify(providerConfig)}'`);
            await execAsync(`${OPENCLAW_BIN} config set --json agents.defaults.models '${JSON.stringify(finalAllowlist)}'`);

            exec(`nohup pm2 restart openclaw-gateway > /dev/null 2>&1 &`);
            return modelEntries.length;
        }

        api.registerCommand({
            name: 'opencode_setup',
            description: '同步所有代理模型',
            handler: async () => {
                try {
                    const count = await runSync();
                    return { text: `🔄 **同步成功！** 已导入 **${count}** 个模型。系统正在重启应用配置... ✨` };
                } catch (err) { return { text: `❌ **同步失败**：${err.message}` }; }
            }
        });

        api.registerCommand({
            name: 'opencode_clear',
            description: '一键精准清除代理配置',
            handler: async () => {
                try {
                    await execAsync(`${OPENCLAW_BIN} config unset models.providers.${providerId}`).catch(() => {});
                    const finalAllowlist = await getSanitizedAllowlist({});
                    await execAsync(`${OPENCLAW_BIN} config set --json agents.defaults.models '${JSON.stringify(finalAllowlist)}'`);

                    const pRes = await execAsync(`${OPENCLAW_BIN} config get agents.defaults.model.primary`).catch(() => ({ stdout: "" }));
                    const primary = cleanCliOutput(pRes.stdout, false);
                    if (primary.includes('opencode')) {
                        await execAsync(`${OPENCLAW_BIN} config unset agents.defaults.model.primary`).catch(() => {});
                    }

                    exec(`nohup pm2 restart openclaw-gateway > /dev/null 2>&1 &`);
                    return { text: "🧹 **清理完成！** 代理配置已移除，环境已恢复纯净。✨" };
                } catch (err) { return { text: `❌ **清理失败**：${err.message}` }; }
            }
        });

        let proxyInstance = null;
        api.registerService({
            id: 'opencode-proxy-service',
            start: async () => {
                if (api.pluginConfig?.enabled === false) return;
                proxyInstance = startProxy({
                    PORT: proxyPort,
                    API_KEY: api.pluginConfig?.apiKey || '',
                    OPENCODE_SERVER_URL: api.pluginConfig?.backendUrl || 'http://127.0.0.1:4097',
                    OPENCODE_PATH: api.pluginConfig?.opencodePath || 'opencode'
                });
            },
            stop: async () => { if (proxyInstance) proxyInstance.server.close(); }
        });
    }
};

export default plugin;
