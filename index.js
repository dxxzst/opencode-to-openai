import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { spawn, execSync } from 'child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import http from 'http';

const app = express();
const PORT = process.env.PORT || 8083;
const API_KEY = process.env.API_KEY;
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4097';
const OPENCODE_PATH = process.env.OPENCODE_PATH || '/root/.opencode/bin/opencode';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const client = createOpencodeClient({ baseUrl: OPENCODE_SERVER_URL });

// 1. Authentication Middleware
app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/') return next();
    
    if (API_KEY) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
            return res.status(401).json({ error: { message: 'Unauthorized: Invalid API Key' } });
        }
    }
    next();
});

// 2. Lifecycle Management: Ensure OpenCode backend is running
async function ensureBackend() {
    console.log(`[Proxy] Checking OpenCode backend at ${OPENCODE_SERVER_URL}...`);
    try {
        await new Promise((resolve, reject) => {
            const req = http.get(`${OPENCODE_SERVER_URL}/health`, (res) => {
                if (res.statusCode === 200) resolve();
                else reject(new Error('Status not 200'));
            });
            req.on('error', reject);
            req.setTimeout(2000, () => req.destroy());
        });
        console.log('[Proxy] OpenCode backend is already running.');
    } catch (err) {
        console.log('[Proxy] OpenCode backend not found. Starting it automatically...');
        const [,, portStr] = OPENCODE_SERVER_URL.split(':');
        const port = portStr ? portStr.split('/')[0] : '4097';
        
        const backend = spawn(OPENCODE_PATH, ['serve', '--port', port, '--hostname', '127.0.0.1'], {
            detached: true,
            stdio: 'ignore'
        });
        backend.unref();
        
        // Wait for it to become healthy (max 30s)
        for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                // simple ping
                await new Promise((res, rej) => {
                    http.get(`${OPENCODE_SERVER_URL}/health`, (r) => res()).on('error', rej);
                });
                console.log('[Proxy] OpenCode backend started successfully.');
                return;
            } catch (e) {}
        }
        console.warn('[Proxy] Warning: OpenCode backend might still be starting...');
    }
}

// Endpoint: GET /v1/models
app.get('/v1/models', async (req, res) => {
    try {
        const providersRes = await client.config.providers();
        const providersRaw = providersRes.data?.providers || [];
        const models = [];

        const providersList = Array.isArray(providersRaw)
            ? providersRaw
            : Object.entries(providersRaw).map(([id, info]) => ({ ...info, id }));

        providersList.forEach((provider) => {
            if (provider.models) {
                Object.entries(provider.models).forEach(([modelId, modelData]) => {
                    models.push({
                        id: `${provider.id}/${modelId}`,
                        name: modelData.name || modelId,
                        object: 'model',
                        owned_by: provider.id
                    });
                });
            }
        });

        res.json({ object: 'list', data: models });
    } catch (error) {
        res.status(500).json({ error: { message: 'Failed to fetch models' } });
    }
});

// Endpoint: POST /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model, stream } = req.body;
        if (!messages) return res.status(400).json({ error: { message: 'messages are required' } });

        let [providerID, modelID] = (model || 'opencode/big-pickle').split('/');
        if (!modelID) { modelID = providerID; providerID = 'opencode'; }

        console.log(`[Proxy] Request: ${providerID}/${modelID} (stream: ${!!stream})`);

        const sessionRes = await client.session.create();
        const sessionId = sessionRes.data?.id;

        const systemMsg = messages.find(m => m.role === 'system')?.content || '';
        const userMessages = messages.filter(m => m.role !== 'system');
        const lastUserMsg = userMessages[userMessages.length - 1].content;

        const promptParams = {
            path: { id: sessionId },
            body: {
                model: { providerID, modelID },
                prompt: lastUserMsg,
                system: systemMsg,
                parts: []
            }
        };

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const id = `chatcmpl-${Date.now()}`;
            client.session.prompt(promptParams).catch(e => console.error('[Proxy] Prompt error:', e.message));

            const eventStreamResult = await client.event.subscribe();
            const eventStream = eventStreamResult.stream;

            for await (const event of eventStream) {
                if (event.type === 'message.part.updated' && event.properties.part.sessionID === sessionId) {
                    const { part, delta } = event.properties;
                    if (delta) {
                        const chunk = {
                            id,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: `${providerID}/${modelID}`,
                            choices: [{
                                index: 0,
                                delta: { content: part.type === 'reasoning' ? `<think>${delta}</think>` : delta },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
            const parts = response.response?.parts || response.data?.parts || response.data || [];
            console.log(`[Proxy] Debug Parts:`, JSON.stringify(parts));
            let content = '';
            if (Array.isArray(parts)) {
                content = parts.filter(p => p.type === 'text').map(p => p.text).join('');
            } else if (typeof parts === 'string') {
                content = parts;
            }
            
            let reasoning = '';
            if (Array.isArray(parts)) {
                reasoning = parts.filter(p => p.type === 'reasoning').map(p => p.text).join('');
            }

            if (reasoning) content = `<think>${reasoning}</think>\n\n${content}`;

            res.json({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: `${providerID}/${modelID}`,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content },
                    finish_reason: 'stop'
                }]
            });
        }
    } catch (error) {
        console.error('[Proxy] Completion Error:', error.message);
        res.status(500).json({ error: { message: error.message } });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`OpenCode-to-OpenAI Proxy active at http://0.0.0.0:${PORT}`);
    if (API_KEY) console.log('[Proxy] API Key authentication enabled.');
    await ensureBackend();
});
