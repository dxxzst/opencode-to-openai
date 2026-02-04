const http = require('http');
const { spawn, execSync } = require('child_process');

const PORT = process.env.PORT || 8083;
const OPENCODE_PATH = process.env.OPENCODE_PATH || '/usr/local/bin/opencode';

/**
 * Advanced output cleaner for coding scenarios.
 * Preserves indentation and accurately removes terminal noise.
 */
function cleanOutput(text) {
    if (!text) return '';

    // 1. Remove ANSI escape codes (Terminal colors/progress bars)
    let cleaned = text.replace(/\x1B\[[0-9;]*[JKmsu]/g, '').replace(/\r/g, '');

    // 2. Split into lines for precise filtering
    let lines = cleaned.split('\n');

    // 3. Filter out OpenCode system lines and CLI artifacts
    const noisePatterns = [
        /^> build · /,
        /🔍 Resolving/,
        /🚚 pyright/,
        /🔒 Saving lockfile/,
        /migrated lockfile from/
    ];

    lines = lines.filter(line => {
        const trimmed = line.trim();
        // Skip noise lines
        if (noisePatterns.some(p => p.test(line))) return false;
        // Skip TUI tool execution indicators (e.g., "← Wrote file")
        if (trimmed.startsWith('← ')) return false;
        // Skip shell command echoes (e.g., "$ python3 ...")
        if (trimmed.startsWith('$ ')) return false;
        return true;
    });

    // 4. Strip leading/trailing empty lines but PRESERVE indentation of content
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

    return lines.join('\n');
}

/**
 * Dynamically fetch models from OpenCode CLI
 */
function getDynamicModels() {
    try {
        const output = execSync(`${OPENCODE_PATH} models opencode`, { encoding: 'utf8' });
        return output.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(id => ({ id, object: 'model' }));
    } catch (err) {
        console.error('[Proxy] Failed to fetch dynamic models:', err.message);
        return [
            { id: 'opencode/kimi-k2.5-free', object: 'model' },
            { id: 'opencode/glm-4.7-free', object: 'model' },
            { id: 'opencode/minimax-m2.1-free', object: 'model' }
        ];
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { model, messages } = data;
                const lastMessage = messages[messages.length - 1].content;

                console.log(`[Proxy] Request: "${lastMessage.substring(0, 50).replace(/\n/g, ' ')}..." (${model})`);

                // We use script to ensure a stable environment if needed, but run CLI directly for code generation
                const opencode = spawn(OPENCODE_PATH, ['run', lastMessage, '-m', model]);
                
                let stdout = '';
                let stderr = '';
                opencode.stdout.on('data', (d) => stdout += d.toString());
                opencode.stderr.on('data', (d) => stderr += d.toString());

                const timer = setTimeout(() => {
                    opencode.kill();
                    console.log('[Proxy] Error: OpenCode process timed out');
                }, 180000); // Extended 3min timeout for code generation

                opencode.on('close', (code) => {
                    clearTimeout(timer);
                    const content = cleanOutput(stdout);
                    
                    if (code !== 0 && !content) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ 
                            error: { message: `OpenCode CLI failed with code ${code}. Stderr: ${stderr}` } 
                        }));
                    }

                    const response = {
                        id: `opencode-${Date.now()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: content || '(No response)' },
                            finish_reason: 'stop'
                        }],
                        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response));
                });
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
            }
        });
    } 
    else if (req.method === 'GET' && req.url === '/v1/models') {
        const models = getDynamicModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: models }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenCode OpenAI Proxy (v4-optimized) active at http://0.0.0.0:${PORT}`);
});
