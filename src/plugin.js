import { startProxy } from './proxy.js';
import http from 'http';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * opencode-to-openai: OpenClaw Plugin (V2.0.0 - Production Ready)
 * 
 * Fixed:
 * - Removed hardcoded paths
 * - Added shell injection protection
 * - Improved error handling
 * - Better async/await patterns
 */
const plugin = {
    id: 'opencode-to-openai',
    name: 'OpenCode Proxy',
    
    register(api) {
        const providerId = 'opencode-to-openai';
        const proxyPort = api.pluginConfig?.port || 8083;
        
        // Get openclaw binary path from config or use 'openclaw' from PATH
        const OPENCLAW_BIN = api.pluginConfig?.openclawPath || process.env.OPENCLAW_PATH || 'openclaw';

        /**
         * Robustly extracts only the value part from OpenClaw CLI output,
         * stripping away any log noise (timestamps, INFO tags, etc.)
         */
        function cleanCliOutput(stdout, isJson = false) {
            if (!stdout) return isJson ? {} : "";
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1].trim();
            
            if (isJson) {
                try {
                    const jsonMatch = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
                } catch (e) {
                    return {};
                }
            }
            return lastLine.replace(/^"|"$/g, '');
        }

        /**
         * Safely escape string for shell usage
         */
        function shellEscape(str) {
            if (typeof str !== 'string') return '';
            // Use single quotes and escape any single quotes in the string
            return "'" + str.replace(/'/g, "'\"'\"'") + "'";
        }

        async function getModelsFromProxy() {
            const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/models`;
            const data = await new Promise((resolve, reject) => {
                const req = http.get(proxyUrl, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => { 
                        try { 
                            resolve(JSON.parse(body)); 
                        } catch (e) { 
                            reject(new Error('Invalid JSON from proxy')); 
                        } 
                    });
                });
                req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
                req.setTimeout(5000, () => { 
                    req.destroy(); 
                    reject(new Error('Proxy timeout')); 
                });
            });
            return data.data || [];
        }

        async function getSanitizedAllowlist(freshProxyModels = {}) {
            // Get current allowlist using the robust parser
            const res = await execAsync(`${shellEscape(OPENCLAW_BIN)} config get agents.defaults.models --json`).catch(() => ({ stdout: "{}" }));
            const currentAllowlist = cleanCliOutput(res.stdout, true);
            
            const nextAllowlist = {};
            // Remove ONLY items matching proxy patterns
            Object.keys(currentAllowlist).forEach(k => {
                if (!k.includes('opencode') && !k.startsWith(`${providerId}/`)) {
                    nextAllowlist[k] = currentAllowlist[k];
                }
            });

            const mergedAllowlist = { ...nextAllowlist, ...freshProxyModels };

            // If list is empty, anchor it with the user's primary model to prevent "all models" explosion
            if (Object.keys(mergedAllowlist).length === 0) {
                const pRes = await execAsync(`${shellEscape(OPENCLAW_BIN)} config get agents.defaults.model.primary`).catch(() => ({ stdout: "" }));
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
            if (rawModels.length === 0) throw new Error('No models found from proxy');

            const modelEntries = rawModels.map(m => {
                const pureId = m.id.includes('/') ? m.id.split('/')[1] : m.id;
                return { 
                    id: pureId, 
                    name: m.name || pureId, 
                    input: ["text"], 
                    contextWindow: 200000, 
                    maxTokens: 8192 
                };
            });

            const newProxyModels = {};
            modelEntries.forEach(m => { 
                newProxyModels[`${providerId}/${m.id}`] = {}; 
            });

            const providerConfig = { 
                baseUrl: `http://127.0.0.1:${proxyPort}/v1`, 
                api: "openai-completions", 
                models: modelEntries 
            };
            
            const finalAllowlist = await getSanitizedAllowlist(newProxyModels);

            // Use execFile to avoid shell injection
            const providerConfigStr = JSON.stringify(providerConfig);
            const allowlistStr = JSON.stringify(finalAllowlist);
            
            await execFileAsync(OPENCLAW_BIN, [
                'config', 'set', '--json', 
                `models.providers.${providerId}`, 
                providerConfigStr
            ]);
            
            await execFileAsync(OPENCLAW_BIN, [
                'config', 'set', '--json', 
                'agents.defaults.models', 
                allowlistStr
            ]);

            // Restart gateway with proper error handling
            return new Promise((resolve, reject) => {
                exec('nohup pm2 restart openclaw-gateway > /dev/null 2>&1 &', (error) => {
                    if (error) {
                        console.warn('[Plugin] PM2 restart warning:', error.message);
                        // Don't reject, this is non-critical
                    }
                    resolve(modelEntries.length);
                });
            });
        }

        api.registerCommand({
            name: 'opencode_setup',
            description: '同步所有代理模型',
            handler: async () => {
                try {
                    const count = await runSync();
                    return { 
                        text: `🔄 **同步成功！** 已导入 **${count}** 个模型。系统正在重启应用配置... ✨` 
                    };
                } catch (err) { 
                    return { 
                        text: `❌ **同步失败**：${err.message}` 
                    }; 
                }
            }
        });

        api.registerCommand({
            name: 'opencode_clear',
            description: '一键精准清除代理配置',
            handler: async () => {
                try {
                    await execFileAsync(OPENCLAW_BIN, [
                        'config', 'unset', 
                        `models.providers.${providerId}`
                    ]).catch(() => {});
                    
                    const finalAllowlist = await getSanitizedAllowlist({});
                    
                    await execFileAsync(OPENCLAW_BIN, [
                        'config', 'set', '--json', 
                        'agents.defaults.models', 
                        JSON.stringify(finalAllowlist)
                    ]);

                    const pRes = await execAsync(`${shellEscape(OPENCLAW_BIN)} config get agents.defaults.model.primary`).catch(() => ({ stdout: "" }));
                    const primary = cleanCliOutput(pRes.stdout, false);
                    
                    if (primary.includes('opencode')) {
                        await execFileAsync(OPENCLAW_BIN, [
                            'config', 'unset', 
                            'agents.defaults.model.primary'
                        ]).catch(() => {});
                    }

                    return new Promise((resolve) => {
                        exec('nohup pm2 restart openclaw-gateway > /dev/null 2>&1 &', (error) => {
                            if (error) {
                                console.warn('[Plugin] PM2 restart warning:', error.message);
                            }
                            resolve({ 
                                text: "🧹 **清理完成！** 代理配置已移除，环境已恢复纯净。✨" 
                            });
                        });
                    });
                } catch (err) { 
                    return { 
                        text: `❌ **清理失败**：${err.message}` 
                    }; 
                }
            }
        });

        let proxyInstance = null;
        api.registerService({
            id: 'opencode-proxy-service',
            start: async () => {
                if (api.pluginConfig?.enabled === false) return;
                
                try {
                    proxyInstance = startProxy({
                        PORT: proxyPort,
                        API_KEY: api.pluginConfig?.apiKey || '',
                        OPENCODE_SERVER_URL: api.pluginConfig?.backendUrl || 'http://127.0.0.1:4097',
                        OPENCODE_PATH: api.pluginConfig?.opencodePath || 'opencode'
                    });
                    console.log(`[Plugin] Proxy service started on port ${proxyPort}`);
                } catch (error) {
                    console.error('[Plugin] Failed to start proxy:', error.message);
                    throw error;
                }
            },
            stop: async () => { 
                if (proxyInstance) {
                    try {
                        proxyInstance.server.close();
                        proxyInstance.killBackend();
                        console.log('[Plugin] Proxy service stopped');
                    } catch (error) {
                        console.error('[Plugin] Error stopping proxy:', error.message);
                    }
                }
            }
        });
    }
};

export default plugin;
