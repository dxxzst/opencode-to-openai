import { startProxy } from './proxy.js';
import http from 'http';
import { exec, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * opencode-to-openai: OpenClaw Plugin (V3.3.0 - Universal Path Edition)
 * 
 * Logic Flow:
 * 1. Immediate ACK: "Processing..."
 * 2. Task: Update config + Write PENDING_TASK.md.
 * 3. Notification: Tell Boss it's ready for restart.
 * 4. Universal Path Logic: Tries config -> which -> node-neighbor -> fallback.
 */
const plugin = {
    id: 'opencode-to-openai',
    name: 'OpenCode Proxy',
    
    register(api) {
        const providerId = 'opencode-to-openai';
        const proxyPort = api.pluginConfig?.port || 8083;
        
        // --- UNIVERSAL PATH DISCOVERY ---
        const resolveBin = () => {
            if (api.pluginConfig?.openclawPath) return api.pluginConfig.openclawPath;
            if (process.env.OPENCLAW_PATH) return process.env.OPENCLAW_PATH;
            
            // Try 'which' command first (covers npm, pnpm, system bins in PATH)
            try {
                const pathFromWhich = execSync('which openclaw', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                if (pathFromWhich) return pathFromWhich;
            } catch (e) {}

            // Fallback: Check next to the current node process (common in NVM/manual installs)
            try {
                const neighborPath = path.join(path.dirname(process.execPath), 'openclaw');
                const stats = execSync(`ls ${neighborPath}`, { stdio: ['ignore', 'pipe', 'ignore'] });
                if (stats) return neighborPath;
            } catch (e) {}

            return 'openclaw'; // Last resort
        };

        const OPENCLAW_BIN = resolveBin();
        const PENDING_FILE = '/root/.openclaw/workspace/PENDING_TASK.md';

        function cleanCliOutput(stdout, isJson = false) {
            if (!stdout) return isJson ? {} : "";
            const jsonMatch = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (isJson && jsonMatch) {
                try { return JSON.parse(jsonMatch[0]); } catch (e) { return {}; }
            }
            const lines = stdout.trim().split('\n');
            return lines[lines.length - 1].trim().replace(/^"|"$/g, '');
        }

        function shellEscape(str) {
            if (typeof str !== 'string') return "''";
            return "'" + str.replace(/'/g, "'\"'\"'") + "'";
        }

        async function getModelsFromProxy() {
            const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/models`;
            return new Promise((resolve, reject) => {
                const req = http.get(proxyUrl, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => { 
                        try { resolve(JSON.parse(body).data || []); } 
                        catch (e) { reject(new Error('Invalid JSON from proxy')); } 
                    });
                });
                req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
                req.setTimeout(3000, () => { req.destroy(); reject(new Error('Proxy timeout')); });
            });
        }

        async function getSanitizedAllowlist(freshProxyModels = {}) {
            const res = await execAsync(`${shellEscape(OPENCLAW_BIN)} config get agents.defaults.models --json`).catch(() => ({ stdout: "{}" }));
            const currentAllowlist = cleanCliOutput(res.stdout, true);
            const nextAllowlist = {};
            Object.keys(currentAllowlist).forEach(k => {
                const isManagedByMe = k.startsWith(`${providerId}/`) || (k.includes('opencode') && !k.includes('/'));
                if (!isManagedByMe) nextAllowlist[k] = currentAllowlist[k];
            });
            const merged = { ...nextAllowlist, ...freshProxyModels };
            if (Object.keys(merged).length === 0) {
                const pRes = await execAsync(`${shellEscape(OPENCLAW_BIN)} config get agents.defaults.model.primary`).catch(() => ({ stdout: "" }));
                const primary = cleanCliOutput(pRes.stdout, false);
                const anchor = (primary && !primary.startsWith(`${providerId}/`)) ? primary : "google-gemini-cli/gemini-3-flash-preview";
                merged[anchor] = {};
            }
            return merged;
        }

        async function runSetupTask(context) {
            try {
                const rawModels = await getModelsFromProxy();
                const modelEntries = rawModels.map(m => {
                    const pureId = m.id.includes('/') ? m.id.split('/')[1] : m.id;
                    return { id: pureId, name: pureId, input: ["text"], contextWindow: 200000, maxTokens: 8192 };
                });
                const newProxyModels = {};
                modelEntries.forEach(m => { newProxyModels[`${providerId}/${m.id}`] = {}; });
                
                const providerConfig = { baseUrl: `http://127.0.0.1:${proxyPort}/v1`, api: "openai-completions", models: modelEntries };
                const finalAllowlist = await getSanitizedAllowlist(newProxyModels);

                await execFileAsync(OPENCLAW_BIN, ['config', 'set', '--json', `models.providers.${providerId}`, JSON.stringify(providerConfig)]);
                await execFileAsync(OPENCLAW_BIN, ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(finalAllowlist)]);

                await fs.writeFile(PENDING_FILE, `✅ **OpenCode 模型通用同步成功**\n- 自动识别路径: \`${OPENCLAW_BIN}\`\n- 导入数量: ${modelEntries.length}\n- 资产状态: 配置已无损合并`);

                if (context.reply) {
                    await context.reply(`💡 **处理已就绪 (全自动路径识别)！**\n\n数据已写入配置并建立存根。请回复“重启”使模型生效。`);
                }
            } catch (e) {
                if (context.reply) await context.reply(`❌ **同步失败**：${e.message}\n(当前尝试路径: \`${OPENCLAW_BIN}\`)`);
            }
        }

        async function runClearTask(context) {
            try {
                await execFileAsync(OPENCLAW_BIN, ['config', 'unset', `models.providers.${providerId}`]).catch(() => {});
                const finalAllowlist = await getSanitizedAllowlist({});
                await execFileAsync(OPENCLAW_BIN, ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(finalAllowlist)]);

                await fs.writeFile(PENDING_FILE, `🧹 **OpenCode 插件清理成功**\n- 识别路径: \`${OPENCLAW_BIN}\`\n- 资产状态: 已恢复基础模型环境`);

                if (context.reply) {
                    await context.reply(`💡 **清理已就绪！**\n\n配置已调整并建立存根。请回复“重启”使环境恢复纯净。`);
                }
            } catch (e) {
                if (context.reply) await context.reply(`❌ **清理失败**：${e.message}`);
            }
        }

        api.registerCommand({
            name: 'opencode_setup',
            description: '同步所有代理模型',
            handler: async (cmd) => {
                runSetupTask(cmd);
                return { text: "⏳ **开始同步模型（全环境兼容模式），请稍候...**" };
            }
        });

        api.registerCommand({
            name: 'opencode_clear',
            description: '一键精准清除代理配置',
            handler: async (cmd) => {
                runClearTask(cmd);
                return { text: "⏳ **开始清理配置，请稍候...**" };
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
                } catch (error) { console.error('[Plugin] Error:', error.message); }
            },
            stop: async () => { if (proxyInstance) { proxyInstance.server.close(); proxyInstance.killBackend(); } }
        });
    }
};

export default plugin;
