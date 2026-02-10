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

const STARTUP_WAIT_ITERATIONS = 60;
const STARTUP_WAIT_INTERVAL_MS = 2000;
const STARTING_WAIT_ITERATIONS = 120;
const STARTING_WAIT_INTERVAL_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_EVENT_FIRST_DELTA_TIMEOUT_MS = 4000;
const DEFAULT_EVENT_IDLE_TIMEOUT_MS = 8000;

const OPENCODE_BASENAME = 'opencode';

function splitPathEnv() {
    const raw = process.env.PATH || '';
    return raw.split(path.delimiter).filter(Boolean);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushDir(list, dir) {
    if (!dir) return;
    if (!list.includes(dir)) list.push(dir);
}

function pushExistingDir(list, dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) return;
    if (!list.includes(dir)) list.push(dir);
}

function addVersionedDirs(list, baseDir, subpath) {
    if (!baseDir || !fs.existsSync(baseDir)) return;
    let entries = [];
    try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    entries.forEach((entry) => {
        if (!entry.isDirectory()) return;
        const full = path.join(baseDir, entry.name, subpath || '');
        pushExistingDir(list, full);
    });
}

function prefixToBin(prefix) {
    if (!prefix) return null;
    return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function getOpencodeCandidateNames() {
    if (process.platform === 'win32') {
        return [`${OPENCODE_BASENAME}.cmd`, `${OPENCODE_BASENAME}.exe`, `${OPENCODE_BASENAME}.bat`, OPENCODE_BASENAME];
    }
    return [OPENCODE_BASENAME];
}

function findExecutableInDirs(dirs, names) {
    for (const dir of dirs) {
        for (const name of names) {
            const full = path.join(dir, name);
            if (fs.existsSync(full)) {
                return full;
            }
        }
    }
    return null;
}

function resolveOpencodePath(requestedPath) {
    const input = (requestedPath || '').trim();
    const names = getOpencodeCandidateNames();

    if (input) {
        const looksLikePath = path.isAbsolute(input) || input.includes('/') || input.includes('\\');
        if (looksLikePath) {
            if (fs.existsSync(input)) return { path: input, source: 'config' };
            const resolved = path.resolve(process.cwd(), input);
            if (fs.existsSync(resolved)) return { path: resolved, source: 'config' };
        }
    }

    const pathDirs = splitPathEnv();
    const fromPath = findExecutableInDirs(pathDirs, names);
    if (fromPath) return { path: fromPath, source: 'PATH' };

    const extraDirs = [];
    if (process.env.OPENCODE_HOME) {
        pushDir(extraDirs, path.join(process.env.OPENCODE_HOME, 'bin'));
    }
    if (process.env.OPENCODE_DIR) {
        pushDir(extraDirs, path.join(process.env.OPENCODE_DIR, 'bin'));
    }
    pushDir(extraDirs, prefixToBin(process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX));
    pushDir(extraDirs, process.env.PNPM_HOME);
    if (process.env.YARN_GLOBAL_FOLDER) {
        pushDir(extraDirs, path.join(process.env.YARN_GLOBAL_FOLDER, 'bin'));
    }
    if (process.env.VOLTA_HOME) {
        pushDir(extraDirs, path.join(process.env.VOLTA_HOME, 'bin'));
    }
    pushDir(extraDirs, process.env.NVM_BIN);
    pushDir(extraDirs, path.dirname(process.execPath));

    const home = os.homedir();
    if (home) {
        pushDir(extraDirs, path.join(home, '.opencode', 'bin'));
        pushDir(extraDirs, path.join(home, '.local', 'bin'));
        pushDir(extraDirs, path.join(home, '.npm-global', 'bin'));
        pushDir(extraDirs, path.join(home, '.npm', 'bin'));
        pushDir(extraDirs, path.join(home, '.pnpm-global', 'bin'));
        pushDir(extraDirs, path.join(home, '.local', 'share', 'pnpm'));
        pushDir(extraDirs, path.join(home, '.fnm', 'node-versions', 'v1', 'installations'));
        pushDir(extraDirs, path.join(home, '.asdf', 'shims'));
    }

    if (process.platform === 'win32') {
        pushDir(extraDirs, process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null);
        pushDir(extraDirs, process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm') : null);
        pushDir(extraDirs, process.env.NVM_HOME);
        pushDir(extraDirs, process.env.NVM_SYMLINK);
        pushDir(extraDirs, process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs') : null);
        pushDir(extraDirs, process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs') : null);
    } else {
        pushDir(extraDirs, '/usr/local/bin');
        pushDir(extraDirs, '/usr/bin');
        pushDir(extraDirs, '/bin');
        pushDir(extraDirs, '/opt/homebrew/bin');
        pushDir(extraDirs, '/snap/bin');
    }

    // nvm (unix) versions
    const nvmDir = process.env.NVM_DIR || (home ? path.join(home, '.nvm') : null);
    if (nvmDir) {
        addVersionedDirs(extraDirs, path.join(nvmDir, 'versions', 'node'), 'bin');
    }

    // asdf nodejs installs
    const asdfDir = process.env.ASDF_DATA_DIR || (home ? path.join(home, '.asdf') : null);
    if (asdfDir) {
        addVersionedDirs(extraDirs, path.join(asdfDir, 'installs', 'nodejs'), 'bin');
    }

    // fnm installs
    if (home) {
        addVersionedDirs(extraDirs, path.join(home, '.fnm', 'node-versions', 'v1'), 'installation' + path.sep + 'bin');
    }

    const fromExtras = findExecutableInDirs(extraDirs, names);
    if (fromExtras) return { path: fromExtras, source: 'known-locations' };

    return { path: null, source: 'not-found' };
}

function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { task, timeout, resolve, reject } = queue.shift();
    let settled = false;
    const timeoutMs = timeout || 120000;
    const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
        .then(() => task())
        .then((result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
        })
        .catch((err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            reject(err);
        })
        .finally(() => {
            isProcessing = false;
            setTimeout(processQueue, 100);
        });
}

function lock(task, timeout = 120000) {
    return new Promise((resolve, reject) => {
        queue.push({ task, timeout, resolve, reject });
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

// Handle signals - Unix-like systems
if (process.platform !== 'win32') {
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
}
// Note: Windows signal handling is limited, cleanup is handled via process.on('exit')

/**
 * Create Express app with proper configuration
 */
function createApp(config) {
    const { API_KEY, OPENCODE_SERVER_URL, REQUEST_TIMEOUT_MS, DEBUG, DISABLE_TOOLS } = config;

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
            res.json({ object: 'list', data: [{ id: 'opencode/kimi-k2.5-free', object: 'model' }] });
        }
    });

    const logDebug = (...args) => {
        if (DEBUG) {
            console.log('[Proxy][Debug]', ...args);
        }
    };

    const TOOL_GUARD_MESSAGE = 'Tools are disabled. Do not call tools or function calls. Answer directly based on the conversation.';
    const applyToolGuard = (systemMsg) => {
        if (!DISABLE_TOOLS) return systemMsg || undefined;
        if (systemMsg && systemMsg.trim()) {
            return `${systemMsg}\n\n${TOOL_GUARD_MESSAGE}`;
        }
        return TOOL_GUARD_MESSAGE;
    };

    const stripFunctionCalls = (text) => {
        if (!DISABLE_TOOLS || !text) return text;
        return text
            .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
            .replace(/<\/?function_calls>/g, '')
            .trim();
    };

    const createToolCallFilter = () => {
        if (!DISABLE_TOOLS) return (chunk) => chunk;
        let inBlock = false;
        return (chunk) => {
            if (!chunk) return chunk;
            let output = '';
            let remaining = chunk;
            while (remaining.length) {
                if (inBlock) {
                    const endIdx = remaining.indexOf('</function_calls>');
                    if (endIdx === -1) {
                        return output;
                    }
                    remaining = remaining.slice(endIdx + '</function_calls>'.length);
                    inBlock = false;
                    continue;
                }
                const startIdx = remaining.indexOf('<function_calls>');
                if (startIdx === -1) {
                    output += remaining;
                    return output;
                }
                output += remaining.slice(0, startIdx);
                remaining = remaining.slice(startIdx + '<function_calls>'.length);
                inBlock = true;
            }
            return output;
        };
    };

    const TOOL_IDS_CACHE_MS = 5 * 60 * 1000;
    let cachedToolOverrides = null;
    let cachedToolAt = 0;

    const getToolOverrides = async () => {
        if (!DISABLE_TOOLS) return null;
        if (cachedToolOverrides && Date.now() - cachedToolAt < TOOL_IDS_CACHE_MS) {
            return cachedToolOverrides;
        }
        try {
            const idsRes = await client.tool.ids();
            const ids = Array.isArray(idsRes?.data)
                ? idsRes.data
                : Array.isArray(idsRes)
                    ? idsRes
                    : [];
            const overrides = {};
            ids.forEach((id) => {
                overrides[id] = false;
            });
            cachedToolOverrides = overrides;
            cachedToolAt = Date.now();
            logDebug('Tool overrides loaded', { count: ids.length });
            return overrides;
        } catch (e) {
            logDebug('Tool override fetch failed', { error: e.message });
            return null;
        }
    };

    async function promptWithTimeout(promptParams, timeoutMs) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
        });
        return Promise.race([client.session.prompt(promptParams), timeoutPromise]);
    }

    class NoEventDataError extends Error {
        constructor(message) {
            super(message);
            this.name = 'NoEventDataError';
        }
    }

    function extractFromParts(parts) {
        if (!Array.isArray(parts)) return { content: '', reasoning: '' };
        const content = parts.filter(p => p.type === 'text').map(p => p.text).join('');
        const reasoning = parts.filter(p => p.type === 'reasoning').map(p => p.text).join('');
        return { content, reasoning };
    }

    async function pollForAssistantResponse(sessionId, timeoutMs, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
        const pollStart = Date.now();
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const messagesRes = await client.session.messages({ path: { id: sessionId } });
            const messages = messagesRes?.data || messagesRes || [];
            if (Array.isArray(messages) && messages.length) {
                for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const entry = messages[i];
                    const info = entry?.info;
                    if (info?.role !== 'assistant') continue;
                    const { content, reasoning } = extractFromParts(entry?.parts || []);
                    const error = info?.error || null;
                    const done = Boolean(info.finish || info.time?.completed || error);
                    if (done || content || reasoning) {
                        if (error) {
                            console.error('[Proxy] OpenCode assistant error:', error);
                        }
                        logDebug('Polling completed', {
                            sessionId,
                            ms: Date.now() - pollStart,
                            done,
                            contentLen: content.length,
                            reasoningLen: reasoning.length,
                            error: error ? error.name : null
                        });
                        return { content, reasoning, error };
                    }
                }
            }
            await sleep(intervalMs);
        }
        logDebug('Polling timeout', { sessionId, ms: Date.now() - pollStart });
        throw new Error(`Request timeout after ${timeoutMs}ms`);
    }

    async function collectFromEvents(sessionId, timeoutMs, onDelta, firstDeltaTimeoutMs, idleTimeoutMs) {
        const controller = new AbortController();
        const eventStreamResult = await client.event.subscribe({ signal: controller.signal });
        const eventStream = eventStreamResult.stream;
        let finished = false;
        let content = '';
        let reasoning = '';
        let receivedDelta = false;
        let deltaChars = 0;
        let firstDeltaAt = null;
        const startedAt = Date.now();

        const finishPromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (finished) return;
                finished = true;
                controller.abort();
                reject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            const firstDeltaTimer = firstDeltaTimeoutMs
                ? setTimeout(() => {
                    if (finished || receivedDelta) return;
                    finished = true;
                    controller.abort();
                    logDebug('No event data received', { sessionId, ms: Date.now() - startedAt });
                    resolve({ content: '', reasoning: '', noData: true });
                }, firstDeltaTimeoutMs)
                : null;

            let idleTimer = null;
            const scheduleIdleTimer = () => {
                if (!idleTimeoutMs) return;
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    controller.abort();
                    logDebug('Event idle timeout', {
                        sessionId,
                        ms: Date.now() - startedAt,
                        deltaChars
                    });
                    if (receivedDelta) {
                        resolve({ content, reasoning });
                    } else {
                        resolve({ content: '', reasoning: '', noData: true });
                    }
                }, idleTimeoutMs);
            };

            (async () => {
                try {
                    for await (const event of eventStream) {
                        if (event.type === 'message.part.updated' && event.properties.part.sessionID === sessionId) {
                            const { part, delta } = event.properties;
                            if (delta) {
                                receivedDelta = true;
                                if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
                                scheduleIdleTimer();
                                if (!firstDeltaAt) {
                                    firstDeltaAt = Date.now();
                                    logDebug('SSE first delta', {
                                        sessionId,
                                        ms: firstDeltaAt - startedAt,
                                        type: part.type
                                    });
                                }
                                if (part.type === 'reasoning') {
                                    reasoning += delta;
                                    if (onDelta) onDelta(delta, true);
                                } else {
                                    content += delta;
                                    if (onDelta) onDelta(delta, false);
                                }
                                deltaChars += delta.length;
                            }
                        }
                        if (event.type === 'message.updated' &&
                            event.properties.info.sessionID === sessionId &&
                            event.properties.info.finish === 'stop') {
                            if (!finished) {
                                finished = true;
                                clearTimeout(timeoutId);
                                if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
                                if (idleTimer) clearTimeout(idleTimer);
                                logDebug('SSE completed', {
                                    sessionId,
                                    ms: Date.now() - startedAt,
                                    deltaChars
                                });
                                resolve({ content, reasoning });
                            }
                            break;
                        }
                    }
                } catch (e) {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeoutId);
                        if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
                        if (idleTimer) clearTimeout(idleTimer);
                        reject(e);
                    }
                }
            })();
        });

        try {
            return await finishPromise;
        } finally {
            controller.abort();
        }
    }

    // Chat completions endpoint
    app.post('/v1/chat/completions', async (req, res) => {
        try {
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

                    const normalizeMessageContent = (content) => {
                        if (typeof content === 'string') return content;
                        if (Array.isArray(content)) {
                            return content.map((part) => {
                                if (typeof part === 'string') return part;
                                if (part && typeof part.text === 'string') return part.text;
                                return '';
                            }).join('');
                        }
                        if (content && typeof content.text === 'string') return content.text;
                        if (content === null || content === undefined) return '';
                        if (typeof content === 'number' || typeof content === 'boolean') return String(content);
                        return '';
                    };

                    const buildPromptParts = (rawMessages) => {
                        const parts = [];
                        const systemChunks = [];
                        const userContents = [];
                        rawMessages.forEach((m) => {
                            const role = (m?.role || 'user').toLowerCase();
                            const content = normalizeMessageContent(m?.content);
                            if (role === 'system') {
                                if (content) systemChunks.push(content);
                                return;
                            }
                            if (!content) return;
                            if (role === 'user') userContents.push(content);
                            const roleLabel = role.toUpperCase();
                            const nameSuffix = m?.name ? `(${m.name})` : '';
                            parts.push({
                                type: 'text',
                                text: `${roleLabel}${nameSuffix}: ${content}`
                            });
                        });
                        return {
                            parts,
                            system: systemChunks.join('\n\n'),
                            lastUserMsg: userContents[userContents.length - 1] || ''
                        };
                    };

                    const { parts, system: systemMsg, lastUserMsg } = buildPromptParts(messages);
                    const systemWithGuard = applyToolGuard(systemMsg);
                    if (!parts.length) {
                        return res.status(400).json({ error: { message: 'messages must include at least one non-system text message' } });
                    }
                    logDebug('Request start', {
                        model: `${pID}/${mID}`,
                        stream: Boolean(stream),
                        userMessages: messages.length,
                        system: Boolean(systemMsg),
                        lastUserLength: lastUserMsg.length,
                        parts: parts.length,
                        disableTools: DISABLE_TOOLS
                    });

                    // Ensure backend is running
                    await ensureBackend(config);

                    // Create session
                    const sessionRes = await client.session.create();
                    sessionId = sessionRes.data?.id;
                    if (!sessionId) throw new Error('Failed to create OpenCode session');
                    logDebug('Session created', { sessionId });

                    const promptParams = {
                        path: { id: sessionId },
                        body: {
                            model: { providerID: pID, modelID: mID },
                            system: systemWithGuard,
                            parts: parts
                        }
                    };
                    const toolOverrides = await getToolOverrides();
                    if (toolOverrides && Object.keys(toolOverrides).length > 0) {
                        promptParams.body.tools = toolOverrides;
                    }

                    if (stream) {
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        const id = `chatcmpl-${Date.now()}`;
                        const filterContentDelta = createToolCallFilter();
                        const filterReasoningDelta = createToolCallFilter();

                        const sendDelta = (delta, isReasoning = false) => {
                            if (!delta) return;
                            const filtered = isReasoning ? filterReasoningDelta(delta) : filterContentDelta(delta);
                            if (!filtered) return;
                            const chunk = {
                                id,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: `${pID}/${mID}`,
                                choices: [{ index: 0, delta: {}, finish_reason: null }]
                            };
                            if (isReasoning) {
                                chunk.choices[0].delta.reasoning_content = filtered;
                            } else {
                                chunk.choices[0].delta.content = filtered;
                            }
                            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        };

                        let collected = null;
                        try {
                            const collectPromise = collectFromEvents(
                                sessionId,
                                REQUEST_TIMEOUT_MS,
                                sendDelta,
                                DEFAULT_EVENT_FIRST_DELTA_TIMEOUT_MS,
                                DEFAULT_EVENT_IDLE_TIMEOUT_MS
                            );
                            const safeCollect = collectPromise.catch((err) => ({ __error: err }));
                            const promptStart = Date.now();
                            await promptWithTimeout(promptParams, REQUEST_TIMEOUT_MS);
                            logDebug('Prompt sent', { sessionId, ms: Date.now() - promptStart });
                            collected = await safeCollect;
                        } catch (e) {
                            throw e;
                        }

                        if (collected && collected.__error) {
                            logDebug('SSE collect error, falling back to polling', {
                                sessionId,
                                error: collected.__error?.message
                            });
                            const { content, reasoning, error } = await pollForAssistantResponse(sessionId, REQUEST_TIMEOUT_MS);
                            if (error && !content && !reasoning) {
                                sendDelta(`[Proxy Error] ${error.name || 'OpenCodeError'}: ${error.data?.message || error.message || 'Unknown error'}`);
                            } else {
                                if (reasoning) sendDelta(reasoning, true);
                                if (content) sendDelta(content, false);
                            }
                        } else if (collected && collected.noData) {
                            logDebug('Fallback to polling (stream)', { sessionId });
                            const { content, reasoning, error } = await pollForAssistantResponse(sessionId, REQUEST_TIMEOUT_MS);
                            if (error && !content && !reasoning) {
                                sendDelta(`[Proxy Error] ${error.name || 'OpenCodeError'}: ${error.data?.message || error.message || 'Unknown error'}`);
                            } else {
                                if (reasoning) sendDelta(reasoning, true);
                                if (content) sendDelta(content, false);
                            }
                        }

                        if (collected && (collected.reasoning || collected.content)) {
                            if (collected.reasoning) sendDelta(collected.reasoning, true);
                            if (collected.content) sendDelta(collected.content, false);
                        }

                        res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                        res.write('data: [DONE]\n\n');
                        res.end();
                    } else {
                        const promptStart = Date.now();
                        await promptWithTimeout(promptParams, REQUEST_TIMEOUT_MS);
                        logDebug('Prompt sent', { sessionId, ms: Date.now() - promptStart });
                        const { content, reasoning, error } = await pollForAssistantResponse(sessionId, REQUEST_TIMEOUT_MS);
                        if (error && !content && !reasoning) {
                            return res.status(502).json({
                                error: {
                                    message: error.data?.message || error.message || 'OpenCode provider error',
                                    type: error.name || 'OpenCodeError'
                                }
                            });
                        }
                        const safeContent = stripFunctionCalls(content);
                        const safeReasoning = stripFunctionCalls(reasoning);

                        res.json({
                            id: `chatcmpl-${Date.now()}`,
                            object: 'chat.completion',
                            created: Math.floor(Date.now() / 1000),
                            model: `${pID}/${mID}`,
                            choices: [{
                                index: 0,
                                message: { role: 'assistant', content: safeContent, reasoning_content: safeReasoning || null },
                                finish_reason: 'stop'
                            }],
                            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                        });
                    }
                } catch (error) {
                    console.error('[Proxy] API Error:', error.message);
                    console.error('[Proxy] Error details:', error);

                    if (!res.headersSent) {
                        let errorMessage = error.message;
                        let statusCode = 500;
                        if (error.message && error.message.includes('Request timeout')) {
                            statusCode = 504;
                        }
                        if (error.message && error.message.includes('ENOENT')) {
                            errorMessage = 'OpenCode backend file access error. This may be a Windows compatibility issue. Please try restarting the service.';
                        }
                        res.status(statusCode).json({
                            error: {
                                message: errorMessage,
                                type: error.constructor.name
                            }
                        });
                    }
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
            }, REQUEST_TIMEOUT_MS + 20000);
        } catch (error) {
            console.error('[Proxy] Request Handler Error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: { message: error.message, type: error.constructor.name } });
            }
        }
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
    const { OPENCODE_SERVER_URL, OPENCODE_PATH, USE_ISOLATED_HOME } = config;
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
        for (let i = 0; i < STARTING_WAIT_ITERATIONS; i++) {
            await new Promise(r => setTimeout(r, STARTING_WAIT_INTERVAL_MS));
            try {
                await checkHealth(OPENCODE_SERVER_URL);
                return;
            } catch (e) { }
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
            } catch (e) { }
        }

        // Cleanup old temp dir
        if (state.jailRoot && fs.existsSync(state.jailRoot)) {
            try {
                fs.rmSync(state.jailRoot, { recursive: true, force: true });
            } catch (e) { }
        }

        const isWindows = process.platform === 'win32';
        const useIsolatedHome = typeof USE_ISOLATED_HOME === 'boolean'
            ? USE_ISOLATED_HOME
            : String(process.env.OPENCODE_USE_ISOLATED_HOME || '').toLowerCase() === 'true' ||
            process.env.OPENCODE_USE_ISOLATED_HOME === '1';

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
            fs.mkdirSync(workspace, { recursive: true });
            cwd = workspace;

            if (useIsolatedHome) {
                // Unix-like: use isolated fake-home
                const fakeHome = path.join(jailRoot, 'fake-home');

                // Create necessary opencode directories
                const opencodeDir = path.join(fakeHome, '.local', 'share', 'opencode');
                const storageDir = path.join(opencodeDir, 'storage');
                const messageDir = path.join(storageDir, 'message');
                const sessionDir = path.join(storageDir, 'session');

                [fakeHome, opencodeDir, storageDir, messageDir, sessionDir].forEach(d => {
                    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                });

                envVars = {
                    ...process.env,
                    HOME: fakeHome,
                    USERPROFILE: fakeHome,
                    OPENCODE_PROJECT_DIR: workspace
                };
                console.log('[Proxy] Using isolated home for OpenCode');
            } else {
                envVars = {
                    ...process.env,
                    OPENCODE_PROJECT_DIR: workspace
                };
                console.log('[Proxy] Using real HOME for OpenCode (isolation disabled)');
            }
        }

        const [, , portStr] = OPENCODE_SERVER_URL.split(':');
        const port = portStr ? portStr.split('/')[0] : '4097';
        const resolved = resolveOpencodePath(OPENCODE_PATH);
        const opencodeBin = resolved.path || OPENCODE_PATH || OPENCODE_BASENAME;
        if (resolved.path) {
            console.log(`[Proxy] Using OpenCode binary: ${opencodeBin} (source: ${resolved.source})`);
        } else {
            console.warn(`[Proxy] Unable to resolve OpenCode binary for '${OPENCODE_PATH}'. Using as-is.`);
        }

        // Cross-platform spawn options
        const useShell = process.platform === 'win32' || !resolved.path ||
            opencodeBin.endsWith('.cmd') || opencodeBin.endsWith('.bat');
        const spawnOptions = {
            stdio: 'inherit',
            cwd: cwd,
            env: envVars,
            shell: useShell  // Use shell only when needed (e.g., Windows .cmd or unresolved PATH)
        };

        state.process = spawn(opencodeBin, ['serve', '--port', port, '--hostname', '127.0.0.1'], spawnOptions);

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
        for (let i = 0; i < STARTUP_WAIT_ITERATIONS; i++) {
            await new Promise(r => setTimeout(r, STARTUP_WAIT_INTERVAL_MS));
            try {
                await checkHealth(OPENCODE_SERVER_URL);
                console.log('[Proxy] OpenCode backend ready.');
                started = true;
                break;
            } catch (e) { }
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
    const normalizeBool = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
        }
        return undefined;
    };

    const disableTools =
        normalizeBool(options.DISABLE_TOOLS) ??
        normalizeBool(options.disableTools) ??
        normalizeBool(process.env.OPENCODE_DISABLE_TOOLS) ??
        true;

    const config = {
        PORT: options.PORT || 8083,
        API_KEY: options.API_KEY || '',
        OPENCODE_SERVER_URL: options.OPENCODE_SERVER_URL || 'http://127.0.0.1:4097',
        OPENCODE_PATH: options.OPENCODE_PATH || 'opencode',
        BIND_HOST: options.BIND_HOST || options.bindHost || process.env.OPENCODE_PROXY_BIND_HOST || '127.0.0.1',
        USE_ISOLATED_HOME: typeof options.USE_ISOLATED_HOME === 'boolean'
            ? options.USE_ISOLATED_HOME
            : String(options.USE_ISOLATED_HOME || '').toLowerCase() === 'true' ||
            options.USE_ISOLATED_HOME === '1' ||
            String(process.env.OPENCODE_USE_ISOLATED_HOME || '').toLowerCase() === 'true' ||
            process.env.OPENCODE_USE_ISOLATED_HOME === '1',
        REQUEST_TIMEOUT_MS: Number(options.REQUEST_TIMEOUT_MS || process.env.OPENCODE_PROXY_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
        DISABLE_TOOLS: disableTools,
        DEBUG: String(options.DEBUG || '').toLowerCase() === 'true' ||
            options.DEBUG === '1' ||
            String(process.env.OPENCODE_PROXY_DEBUG || '').toLowerCase() === 'true' ||
            process.env.OPENCODE_PROXY_DEBUG === '1'
    };

    const { app } = createApp(config);
    
    const server = app.listen(config.PORT, config.BIND_HOST, async () => {
        console.log(`[Proxy] Active at http://${config.BIND_HOST}:${config.PORT}`);
        try {
            await ensureBackend(config);
        } catch (error) {
            console.error('[Proxy] Backend warmup failed:', error.message);
        }
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
                } catch (e) { }
            }
        }
    };
}
