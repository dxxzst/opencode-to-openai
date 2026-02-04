import { startProxy } from './src/proxy.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone mode configuration
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
    } catch (err) {
        console.error('[Standalone] Error parsing config.json:', err.message);
    }
}

const finalConfig = {
    PORT: process.env.PORT || config.PORT,
    API_KEY: process.env.API_KEY || config.API_KEY,
    OPENCODE_SERVER_URL: process.env.OPENCODE_SERVER_URL || config.OPENCODE_SERVER_URL,
    OPENCODE_PATH: process.env.OPENCODE_PATH || config.OPENCODE_PATH,
};

startProxy(finalConfig);
