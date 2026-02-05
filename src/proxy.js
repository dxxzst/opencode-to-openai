import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { spawn } from 'child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
let config = {
    PORT: 8083,
    API_KEY: '',
    OPENCODE_SERVER_URL: 'http://127.0.0.1:4097',
    OPENCODE_PATH: 'opencode'
};

const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config = { ...config, ...fileConfig };
        console.log('[Proxy] Loaded configuration from config.json');
    } catch (err) {
        console.error('[Proxy] Error parsing config.json:', err.message);
    }
}

const PORT = process.env.PORT || config.PORT;
const API_KEY = process.env.API_KEY || config.API_KEY;
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || config.OPENCODE_SERVER_URL;
const OPENCODE_PATH = process.env.OPENCODE_PATH || config.OPENCODE_PATH;

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '50mb' }));

const client = createOpencodeClient({ baseUrl: OPENCODE_SERVER_URL });

// Mutex to prevent backend overload
let isProcessing = false;
const queue = [];

function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { task } = queue.shift();
    task().finally(() => {
        isProcessing = false;
        setTimeout(processQueue, 500);
    });
}

const lock = (task) => new Promise((resolve, reject) => {
    queue.push({ task: () => task().then(resolve).catch(reject) });
    processQueue();
});

/**
 * OpenCode Backend Management with "Jail" Isolation
 */
let isStartingBackend = false;
async function ensureBackend() {
    if (isStartingBackend) return;
    try {
        await new Promise((resolve, reject) => {
            const r = http.get(`${OPENCODE_SERVER_URL}/health`, (res) => {
                if (res.statusCode === 200) resolve();
                else reject(new Error('Status not 200'));
            });
            r.on('error', reject);
            reqTimeout = setTimeout(() => r.destroy(), 1500);
            function resolveCleanup() { clearTimeout(reqTimeout); resolve(); }
        }).catch(e => { throw e; });
    } catch (err) {
        isStartingBackend = true;
        console.log(`[Proxy] OpenCode backend not found at ${OPENCODE_SERVER_URL}. Starting with isolation...`);
        
        const salt = Math.random().toString(36).substring(7);
        const jailRoot = path.join(os.tmpdir(), 'opencode-proxy-jail', salt);
        const workspace = path.join(jailRoot, 'empty-workspace');
        const fakeHome = path.join(jailRoot, 'fake-home');
        
        [workspace, fakeHome].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });

        const [,, portStr] = OPENCODE_SERVER_URL.split(':');
        const port = portStr ? portStr.split('/')[0] : '4097';
        
        const backend = spawn(OPENCODE_PATH, ['serve', '--port', port, '--hostname', '127.0.0.1'], {
            stdio: 'inherit',
            shell: true,
            cwd: workspace,
            env: { 
                ...process.env, 
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                OPENCODE_PROJECT_DIR: workspace
            }
        });
        backend.unref();
        
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                await new Promise((res, rej) => {
                    const checkReq = http.get(`${OPENCODE_SERVER_URL}/health`, () => res());
                    checkReq.on('error', rej);
                    checkReq.setTimeout(1000, () => checkReq.destroy());
                });
                console.log('[Proxy] OpenCode backend successfully started and jailed.');
                isStartingBackend = false;
                return;
            } catch (e) {}
        }
        isStartingBackend = false;
    }
}

app.use((req, res, next) => {
    if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/') return next();
    if (API_KEY && API_KEY.trim() !== '') {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
            return res.status(401).json({ error: { message: 'Unauthorized' } });
        }
    }
    next();
});

app.get('/v1/models', async (req, res) => {
    try {
        const providersRes = await client.config.providers();
        const providersRaw = providersRes.data?.providers || [];
        const models = [];
        const list = Array.isArray(providersRaw) ? providersRaw : Object.entries(providersRaw).map(([id, info]) => ({ ...info, id }));
        list.forEach((p) => {
            if (p.models) Object.entries(p.models).forEach(([mId, mData]) => {
                models.push({ id: `${p.id}/${mId}`, name: mData.name || mId, object: 'model', owned_by: p.id });
            });
        });
        res.json({ object: 'list', data: models });
    } catch (error) {
        res.json({ object: 'list', data: [{ id: 'opencode/kimi-k2.5-free', object: 'model', name: 'Kimi K2.5 (Free)' }]});
    }
});

app.post('/v1/chat/completions', async (req, res) => {
    await lock(async () => {
        try {
            const { messages, model, stream } = req.body;
            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({ error: { message: 'messages array is required' } });
            }

            let [providerID, modelID] = (model || 'opencode/kimi-k2.5-free').split('/');
            if (!modelID) { modelID = providerID; providerID = 'opencode'; }

            // Extract prompt and history
            const systemMsg = messages.find(m => m.role === 'system')?.content || '';
            const conversation = messages.filter(m => m.role !== 'system');
            const lastUserMsg = conversation[conversation.length - 1].content;

            // Map OpenAI messages to OpenCode Parts for context support
            const parts = conversation.map(m => ({
                type: 'text',
                text: `${m.role.toUpperCase()}: ${m.content}`
            }));

            console.log(`[Proxy] >>> Prompt: "${lastUserMsg.substring(0, 50).replace(/\n/g, ' ')}..." | Context: ${parts.length} turns`);

            await ensureBackend();
            const sessionRes = await client.session.create();
            const sessionId = sessionRes.data?.id;
            if (!sessionId) throw new Error('Failed to create OpenCode session');

            const promptParams = {
                path: { id: sessionId },
                body: {
                    model: { providerID, modelID },
                    prompt: lastUserMsg,
                    system: systemMsg + "\n\nCRITICAL: Answer directly. Do not use tools. Do not analyze files. Do not propose code changes.",
                    parts: parts, // Pass the formatted history as parts
                    agent: 'general'
                }
            };

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const id = `chatcmpl-${Date.now()}`;
                client.session.prompt(promptParams).catch(e => console.error('[Proxy] SSE Prompt Error:', e.message));
                const eventStreamResult = await client.event.subscribe();
                const eventStream = eventStreamResult.stream;

                for await (const event of eventStream) {
                    if (event.type === 'message.part.updated' && event.properties.part.sessionID === sessionId) {
                        const { part, delta } = event.properties;
                        if (delta) {
                            const payload = {
                                id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: `${providerID}/${modelID}`,
                                choices: [{ index: 0, delta: {}, finish_reason: null }]
                            };
                            if (part.type === 'reasoning') payload.choices[0].delta.reasoning_content = delta;
                            else payload.choices[0].delta.content = delta;
                            res.write(`data: ${JSON.stringify(payload)}\n\n`);
                        }
                    }
                    if (event.type === 'message.updated' && event.properties.info.sessionID === sessionId && event.properties.info.finish === 'stop') {
                        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                        res.write('data: [DONE]\n\n');
                        res.end();
                        break;
                    }
                }
            } else {
                const response = await client.session.prompt(promptParams);
                const data = response.response || response.data || response;
                const parts = data.parts || [];
                let content = Array.isArray(parts) ? parts.filter(p => p.type === 'text').map(p => p.text).join('') : '';
                const reasoning = Array.isArray(parts) ? parts.filter(p => p.type === 'reasoning').map(p => p.text).join('') : '';

                res.json({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: `${providerID}/${modelID}`,
                    choices: [{ 
                        index: 0, 
                        message: { role: 'assistant', content, reasoning_content: reasoning || null }, 
                        finish_reason: 'stop' 
                    }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                });
            }
        } catch (error) {
            console.error('[Proxy] API Error:', error.message);
            if (!res.headersSent) res.status(500).json({ error: { message: error.message } });
        }
    });
});

app.get('/health', (req, res) => res.json({ status: 'ok', backend: OPENCODE_SERVER_URL }));

export function startProxy(options) {
    const server = app.listen(PORT, '0.0.0.0', async () => {
        console.log(`[Proxy] Active at http://0.0.0.0:${PORT}`);
        await ensureBackend();
    });
    return server;
}
