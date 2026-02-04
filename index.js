import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createOpencodeClient } from '@opencode-ai/sdk';

const app = express();
const PORT = process.env.PORT || 8083;
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4097';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const client = createOpencodeClient({ baseUrl: OPENCODE_SERVER_URL });

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
        console.error('[Proxy] Error fetching models:', error.message);
        res.status(500).json({ error: { message: 'Failed to fetch models from OpenCode' } });
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

        // Create a session for this request
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
                parts: [] // Add missing parts array
            }
        };

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const id = `chatcmpl-${Date.now()}`;

            // Fire the prompt
            client.session.prompt(promptParams).catch(e => console.error('[Proxy] Prompt error:', e.message));

            // Subscribe to events
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
            console.log(`[Proxy] Sending sync prompt to ${providerID}/${modelID}...`);
            const response = await client.session.prompt(promptParams);
            if (response.error) {
                console.error(`[Proxy] SDK Error:`, JSON.stringify(response.error));
                return res.status(500).json({ error: response.error });
            }
            const parts = response.response?.parts || []; // Try response.response
            console.log(`[Proxy] Parts:`, parts);
            let content = parts.filter(p => p.type === 'text').map(p => p.text).join('');
            const reasoning = parts.filter(p => p.type === 'reasoning').map(p => p.text).join('');

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenCode SDK Proxy active at http://0.0.0.0:${PORT}`);
});
