const http = require('http');
const { spawn, execSync } = require('child_process');

const PORT = process.env.PORT || 8083;
const OPENCODE_PATH = process.env.OPENCODE_PATH || '/usr/local/bin/opencode';

/**
 * Clean ANSI codes and OpenCode specific status lines
 */
function cleanOutput(text) {
    return text
        .replace(/\x1B\[[0-9;]*[JKmsu]/g, '') // Remove ANSI escape codes
        .replace(/> build · .*\n/g, '')        // Remove build status line
        .replace(/\r/g, '')                    // Remove carriage returns
        .trim();
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
        // Fallback to a safe list if CLI fails
        return [
            { id: 'opencode/kimi-k2.5-free', object: 'model' },
            { id: 'opencode/glm-4.7-free', object: 'model' },
            { id: 'opencode/minimax-m2.1-free', object: 'model' }
        ];
    }
}

const server = http.createServer((req, res) => {
    // OpenAI-compatible /v1/chat/completions
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { model, messages } = data;
                const lastMessage = messages[messages.length - 1].content;

                console.log(`[Proxy] Request: "${lastMessage.substring(0, 50)}..." (${model})`);

                // Run opencode CLI via script to handle potential TUI behaviors
                const opencode = spawn('script', ['-q', '-c', `${OPENCODE_PATH} run "${lastMessage.replace(/"/g, '\\"')}" -m ${model}`, '/dev/null']);
                
                let stdout = '';
                let stderr = '';
                opencode.stdout.on('data', (d) => stdout += d.toString());
                opencode.stderr.on('data', (d) => stderr += d.toString());

                const timer = setTimeout(() => {
                    opencode.kill();
                    console.log('[Proxy] Error: OpenCode process timed out');
                }, 120000);

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
    // OpenAI-compatible /v1/models (NOW DYNAMIC)
    else if (req.method === 'GET' && req.url === '/v1/models') {
        const models = getDynamicModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            object: 'list',
            data: models
        }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenCode OpenAI Proxy active at http://0.0.0.0:${PORT}`);
    console.log(`OpenCode Path: ${OPENCODE_PATH}`);
});
