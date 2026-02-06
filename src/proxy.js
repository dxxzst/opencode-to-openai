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

// --- Mutex Logic with Timeout ---
const queue = [];
let isProcessing = false;

function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { task, timeout } = queue.shift();
    
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 120s')), timeout || 120000);
    });
    
    Promise.race([task(), timeoutPromise])
        .finally(() => {
            isProcessing = false;
            setTimeout(processQueue, 100);
        });
}

function lock(task, timeout = 120000) {
    return new Promise((resolve, reject) => {
        queue.push({ 
            task: () => task().then(resolve).catch(reject),
            timeout 
        });
        processQueue();
    });
}

/**
 * Robust Health Check Helper
 */
function checkHealth(serverUrl) {
    return new Promise((resolve, reject) => {
        const req = http.get(`${serverUrl}/health`, (res) => {
            if (res.statusCode === 200) resolve(true);
            else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', (e) => reject(e));
        req.setTimeout(2000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

/**
 * Cleanup temporary directories
 */
function cleanupTempDirs() {
    // Only cleanup jail directories on non-Windows platforms
    // On Windows, we don't use isolated jail to avoid path issues
    if (process.platform === 'win32') return;
    
    const jailRoot = path.join(os.tmpdir(), 'opencode-proxy-jail');
    try {
        if (fs.existsSync(jailRoot)) {
            fs.rmSync(jailRoot, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('[Cleanup] Failed to remove temp dirs:', e.message);
    }
}

// Register cleanup on exit
process.on('exit', cleanupTempDirs);

// Handle signals - Windows has limited signal support
if (process.platform !== 'win32') {
    // Unix-like systems (Linux, macOS)
    process.on('SIGINT', () => {
        console.log('\n[Shutdown] Received SIGINT, cleaning up...');
        cleanupTempDirs();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('\n[Shutdown] Received SIGTERM, cleaning up...');
        cleanupTempDirs();
        process.exit(0);
    });
} else {
    // Windows: use readline for graceful shutdown
    try {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        rl.on('SIGINT', () => {
            console.log('\n[Shutdown] Received Ctrl+C, cleaning up...');
            cleanupTempDirs();
            process.exit(0);
        });
    } catch (e) {
        // Fallback if readline is not available
        console.log('[Proxy] Running on Windows with limited signal handling');
    }
}

/**
 * Create Express app with proper configuration
 */
function createApp(config) {
    const { API_KEY, OPENCODE_SERVER_URL } = config;
    
    const app = express();
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));
    app.use(bodyParser.json({ limit: '50mb' }));

    const client = createOpencodeClient({ baseUrl: OPENCODE_SERVER_URL });

    // Auth middleware
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

    // Models endpoint
    app.get('/v1/models', async (req, res) => {
        try {
            const providersRes = await client.config.providers();
            const providersRaw = providersRes.data?.providers || [];
            const models = [];
            const list = Array.isArray(providersRaw) 
                ? providersRaw 
                : Object.entries(providersRaw).map(([id, info]) => ({ ...info, id }));
            
            list.forEach((p) => {
                if (p.models) {
                    Object.entries(p.models).forEach(([mId, mData]) => {
                        models.push({ 
                            id: `${p.id}/${mId}`, 
                            name: mData.name || mId, 
                            object: 'model', 
                            owned_by: p.id 
                        });
                    });
                }
            });
            res.json({ object: 'list', data: models });
        } catch (error) {
            console.error('[Proxy] Model Fetch Error:', error.message);
            res.json({ object: 'list', data: [{ id: 'opencode/kimi-k2.5-free', object: 'model' }]});
        }
    });

    // Chat completions endpoint
    app.post('/v1/chat/completions', async (req, res) => {
        await lock(async () => {
            let sessionId = null;
            let eventStream = null;
            
            try {
                const { messages, model, stream } = req.body;
                if (!messages || !Array.isArray(messages) || messages.length === 0) {
                    return res.status(400).json({ error: { message: 'messages array is required' } });
                }

                let [pID, mID] = (model || 'opencode/kimi-k2.5-free').split('/');
                if (!mID) { mID = pID; pID = 'opencode'; }

                const userMsgs = messages.filter(m => m.role !== 'system');
                const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : '';
                const systemMsg = messages.find(m => m.role === 'system')?.content || '';

                const parts = userMsgs.map(m => ({
                    type: 'text',
                    text: `${m.role.toUpperCase()}: ${m.content}`
                }));

                // Ensure backend is running
                await ensureBackend(config);
                
                // Create session
                const sessionRes = await client.session.create();
                sessionId = sessionRes.data?.id;
                if (!sessionId) throw new Error('Failed to create OpenCode session');

                const promptParams = {
                    path: { id: sessionId },
                    body: {
                        model: { providerID: pID, modelID: mID },
                        prompt: lastUserMsg,
                        system: systemMsg + "\n\nCRITICAL: Answer directly. Do not use tools. Do not analyze files. Do not propose code changes.",
                        parts: parts,
                        agent: 'general'
                    }
                };

                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    const id = `chatcmpl-${Date.now()}`;
                    
                    // Subscribe to events FIRST to avoid race condition
                    const eventStreamResult = await client.event.subscribe();
                    eventStream = eventStreamResult.stream;
                    
                    // Then send the prompt
                    const promptPromise = client.session.prompt(promptParams);
                    
                    try {
                        for await (const event of eventStream) {
                            if (event.type === 'message.part.updated' && event.properties.part.sessionID === sessionId) {
                                const { part, delta } = event.properties;
                                if (delta) {
                                    const chunk = {
                                        id, 
                                        object: 'chat.completion.chunk', 
                                        created: Math.floor(Date.now() / 1000), 
                                        model: `${pID}/${mID}`,
                                        choices: [{ index: 0, delta: {}, finish_reason: null }]
                                    };
                                    if (part.type === 'reasoning') {
                                        chunk.choices[0].delta.reasoning_content = delta;
                                    } else {
                                        chunk.choices[0].delta.content = delta;
                                    }
                                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                                }
                            }
                            if (event.type === 'message.updated' && 
                                event.properties.info.sessionID === sessionId && 
                                event.properties.info.finish === 'stop') {
                                res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                                res.write('data: [DONE]\n\n');
                                break;
                            }
                        }
                    } finally {
                        if (eventStream && eventStream.close) {
                            eventStream.close();
                        }
                        res.end();
                        // Cleanup session
                        try {
                            await client.session.delete({ path: { id: sessionId } });
                        } catch (e) {
                            console.error('[Proxy] Failed to cleanup session:', e.message);
                        }
                    }
                    
                    // Handle prompt errors
                    promptPromise.catch(e => {
                        console.error('[Proxy] SSE Prompt Error:', e.message);
                    });
                } else {
                    const response = await client.session.prompt(promptParams);
                    const data = response.response || response.data || response;
                    const responseParts = data.parts || [];
                    let content = Array.isArray(responseParts) 
                        ? responseParts.filter(p => p.type === 'text').map(p => p.text).join('') 
                        : '';
                    const reasoning = Array.isArray(responseParts) 
                        ? responseParts.filter(p => p.type === 'reasoning').map(p => p.text).join('') 
                        : '';

                    res.json({
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: `${pID}/${mID}`,
                        choices: [{ 
                            index: 0, 
                            message: { role: 'assistant', content, reasoning_content: reasoning || null }, 
                            finish_reason: 'stop' 
                        }],
                        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                    });
                    
                    // Cleanup session
                    try {
                        await client.session.delete({ path: { id: sessionId } });
                    } catch (e) {
                        console.error('[Proxy] Failed to cleanup session:', e.message);
                    }
                }
            } catch (error) {
                console.error('[Proxy] API Error:', error.message);
                console.error('[Proxy] Error details:', error);
                
                if (!res.headersSent) {
                    // Provide more detailed error information
                    let errorMessage = error.message;
                    if (error.message && error.message.includes('ENOENT')) {
                        errorMessage = 'OpenCode backend file access error. This may be a Windows compatibility issue. Please try restarting the service.';
                    }
                    res.status(500).json({ 
                        error: { 
                            message: errorMessage,
                            type: error.constructor.name
                        } 
                    });
                }
                // Cleanup session on error
                if (sessionId) {
                    try {
                        await client.session.delete({ path: { id: sessionId } });
                    } catch (e) {
                        console.error('[Proxy] Failed to cleanup session on error:', e.message);
                    }
                }
            } finally {
                if (eventStream && eventStream.close) {
                    eventStream.close();
                }
            }
        }, 120000); // 120s timeout
    });

    // Health check
    app.get('/health', (req, res) => res.json({ 
        status: 'ok', 
        backend: OPENCODE_SERVER_URL 
    }));

    return { app, client };
}

// Backend management state (per-instance)
const backendState = new Map();

/**
 * Backend Lifecycle Management
 */
async function ensureBackend(config) {
    const { OPENCODE_SERVER_URL, OPENCODE_PATH } = config;
    const stateKey = OPENCODE_SERVER_URL;
    
    if (!backendState.has(stateKey)) {
        backendState.set(stateKey, { 
            isStarting: false, 
            process: null,
            jailRoot: null 
        });
    }
    
    const state = backendState.get(stateKey);
    
    if (state.isStarting) {
        // Wait for startup to complete
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                await checkHealth(OPENCODE_SERVER_URL);
                return;
            } catch (e) {}
        }
        throw new Error('Backend startup timeout');
    }
    
    try {
        await checkHealth(OPENCODE_SERVER_URL);
    } catch (err) {
        state.isStarting = true;
        console.log(`[Proxy] OpenCode backend not found at ${OPENCODE_SERVER_URL}. Starting...`);
        
        // Kill existing process if any
        if (state.process) {
            try {
                state.process.kill();
            } catch (e) {}
        }
        
        // Cleanup old temp dir
        if (state.jailRoot && fs.existsSync(state.jailRoot)) {
            try {
                fs.rmSync(state.jailRoot, { recursive: true, force: true });
            } catch (e) {}
        }
        
        const isWindows = process.platform === 'win32';
        
        // On Windows, don't use isolated fake-home to avoid path issues
        // On Unix-like systems, use jail for isolation
        const salt = Math.random().toString(36).substring(7);
        const jailRoot = path.join(os.tmpdir(), 'opencode-proxy-jail', salt);
        state.jailRoot = jailRoot;
        const workspace = path.join(jailRoot, 'empty-workspace');
        
        let envVars;
        let cwd;
        
        if (isWindows) {
            // Windows: use normal user home to avoid opencode storage path issues
            fs.mkdirSync(workspace, { recursive: true });
            cwd = workspace;
            envVars = { 
                ...process.env,
                OPENCODE_PROJECT_DIR: workspace
            };
            console.log('[Proxy] Running on Windows, using standard user home directory');
        } else {
            // Unix-like: use isolated fake-home
            const fakeHome = path.join(jailRoot, 'fake-home');
            
            // Create necessary opencode directories
            const opencodeDir = path.join(fakeHome, '.local', 'share', 'opencode');
            const storageDir = path.join(opencodeDir, 'storage');
            const messageDir = path.join(storageDir, 'message');
            const sessionDir = path.join(storageDir, 'session');
            
            [workspace, fakeHome, opencodeDir, storageDir, messageDir, sessionDir].forEach(d => { 
                if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); 
            });
            
            cwd = workspace;
            envVars = { 
                ...process.env, 
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                OPENCODE_PROJECT_DIR: workspace
            };
        }

        const [,, portStr] = OPENCODE_SERVER_URL.split(':');
        const port = portStr ? portStr.split('/')[0] : '4097';
        
        // Cross-platform spawn options
        const spawnOptions = {
            stdio: 'inherit',
            cwd: cwd,
            env: envVars,
            shell: true  // Enable shell on all platforms to resolve commands in PATH
        };
        
        state.process = spawn(OPENCODE_PATH, ['serve', '--port', port, '--hostname', '127.0.0.1'], spawnOptions);
        
        // Handle spawn errors
        state.process.on('error', (err) => {
            console.error(`[Proxy] Failed to spawn OpenCode: ${err.message}`);
            if (err.code === 'ENOENT') {
                console.error(`[Proxy] Command '${OPENCODE_PATH}' not found. Please ensure OpenCode is installed and in your PATH.`);
                console.error(`[Proxy] You can specify the full path in config.json using 'OPENCODE_PATH'`);
            }
        });

        // Wait for backend to be ready
        let started = false;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                await checkHealth(OPENCODE_SERVER_URL);
                console.log('[Proxy] OpenCode backend ready.');
                started = true;
                break;
            } catch (e) {}
        }
        
        state.isStarting = false;
        
        if (!started) {
            console.warn('[Proxy] Backend start timed out.');
            throw new Error('Backend start timeout');
        }
    }
}

/**
 * Starts the OpenCode-to-OpenAI Proxy server.
 */
export function startProxy(options) {
    const config = {
        PORT: options.PORT || 8083,
        API_KEY: options.API_KEY || '',
        OPENCODE_SERVER_URL: options.OPENCODE_SERVER_URL || 'http://127.0.0.1:4097',
        OPENCODE_PATH: options.OPENCODE_PATH || 'opencode'
    };
    
    const { app } = createApp(config);
    
    const server = app.listen(config.PORT, '0.0.0.0', async () => {
        console.log(`[Proxy] Active at http://0.0.0.0:${config.PORT}`);
        await ensureBackend(config);
    });
    
    return {
        server,
        killBackend: () => { 
            const state = backendState.get(config.OPENCODE_SERVER_URL);
            if (state && state.process) {
                state.process.kill();
            }
            // Cleanup temp dir (only on non-Windows where we use jail)
            if (state && state.jailRoot && process.platform !== 'win32') {
                try {
                    fs.rmSync(state.jailRoot, { recursive: true, force: true });
                } catch (e) {}
            }
        }
    };
}
