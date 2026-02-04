import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { spawn } from 'child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import http from 'http';

/**
 * Starts the OpenCode-to-OpenAI Proxy server.
 * @param {Object} options Configuration options
 */
export function startProxy(options) {
    const {
        PORT = 8083,
        API_KEY = '',
        OPENCODE_SERVER_URL = 'http://127.0.0.1:4097',
        OPENCODE_PATH = 'opencode'
    } = options;

    const app = express();
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));
    app.use(bodyParser.json({ limit: '50mb' }));

    const client = createOpencodeClient({ baseUrl: OPENCODE_SERVER_URL });

    let isStartingBackend = false;
    async function ensureBackend() {
        if (isStartingBackend) return;
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`${OPENCODE_SERVER_URL}/health`, (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject(new Error('Backend not ready'));
                });
                req.on('error', reject);
                req.setTimeout(1500, () => req.destroy());
            });
        } catch (err) {
            isStartingBackend = true;
            console.log(`[Proxy] OpenCode backend not found at ${OPENCODE_SERVER_URL}. Starting it...`);
            const [,, portStr] = OPENCODE_SERVER_URL.split(':');
            const port = portStr ? portStr.split('/')[0] : '4097';
            
            const backend = spawn(OPENCODE_PATH, ['serve', '--port', port, '--hostname', '127.0.0.1'], {
                detached: true,
                stdio: 'ignore',
                shell: true
            });
            backend.unref();
            
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    await new Promise((res, rej) => {
                        const r = http.get(`${OPENCODE_SERVER_URL}/health`, () => res());
                        r.on('error', rej);
                        r.setTimeout(1000, () => req.destroy());
                    });
                    console.log('[Proxy] OpenCode backend successfully started.');
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
                return res.status(401).json({ error: { message: 'Unauthorized: Invalid API Key' } });
            }
        }
        next();
    });

    app.get('/v1/models', async (req, res) => {
        try {
            const providersRes = await client.config.providers();
            const providersRaw = providersRes.data?.providers || [];
            const models = [];
            const providersList = Array.isArray(providersRaw) ? providersRaw : Object.entries(providersRaw).map(([id, info]) => ({ ...info, id }));
            providersList.forEach((provider) => {
                if (provider.models) Object.entries(provider.models).forEach(([modelId, modelData]) => {
                    models.push({ id: `${provider.id}/${modelId}`, name: modelData.name || modelId, object: 'model', owned_by: provider.id });
                });
            });
            res.json({ object: 'list', data: models });
        } catch (error) {
            res.json({ object: 'list', data: [
                { id: 'opencode/kimi-k2.5-free', object: 'model', name: 'Kimi K2.5 (Free)' },
                { id: 'opencode/glm-4.7-free', object: 'model', name: 'GLM 4.7 (Free)' },
                { id: 'opencode/minimax-m2.1-free', object: 'model', name: 'MiniMax M2.1 (Free)' }
            ]});
        }
    });

    app.post('/v1/chat/completions', async (req, res) => {
        try {
            const { messages, model, stream } = req.body;
            let [providerID, modelID] = (model || 'opencode/kimi-k2.5-free').split('/');
            if (!modelID) { modelID = providerID; providerID = 'opencode'; }

            await ensureBackend();
            const sessionRes = await client.session.create();
            const sessionId = sessionRes.data?.id;
            const systemMsg = messages.find(m => m.role === 'system')?.content || '';
            const userMsgs = messages.filter(m => m.role !== 'system');
            const lastUserMsg = userMsgs[userMsgs.length - 1].content;

            const promptParams = {
                path: { id: sessionId },
                body: { model: { providerID, modelID }, prompt: lastUserMsg, system: systemMsg, parts: [] }
            };

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                const id = `chatcmpl-${Date.now()}`;
                client.session.prompt(promptParams).catch(e => console.error('[Proxy] SSE Prompt Error:', e.message));
                const eventStreamResult = await client.event.subscribe();
                const eventStream = eventStreamResult.stream;

                for await (const event of eventStream) {
                    if (event.type === 'message.part.updated' && event.properties.part.sessionID === sessionId) {
                        const { part, delta } = event.properties;
                        if (delta) {
                            const content = part.type === 'reasoning' ? `<think>${delta}</think>` : delta;
                            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: `${providerID}/${modelID}`, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
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
                let content = Array.isArray(parts) ? parts.filter(p => p.type === 'text').map(p => p.text).join('') : (typeof data === 'string' ? data : '');
                const thinking = Array.isArray(parts) ? parts.filter(p => p.type === 'reasoning').map(p => p.text).join('') : '';
                if (thinking) content = `<think>${thinking}</think>\n\n${content}`;

                res.json({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: `${providerID}/${modelID}`,
                    choices: [{ index: 0, message: { role: 'assistant', content: content || '(No content)' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                });
            }
        } catch (error) {
            console.error('[Proxy] API Error:', error.message);
            if (!res.headersSent) res.status(500).json({ error: { message: error.message } });
        }
    });

    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    app.get('/', (req, res) => res.send('OpenCode Proxy Gateway Running'));

    const server = app.listen(PORT, '0.0.0.0', async () => {
        console.log(`[Proxy] Active at http://0.0.0.0:${PORT}`);
        await ensureBackend();
    });

    return server;
}
