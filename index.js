import { startProxy } from './src/proxy.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default configuration
const defaultConfig = {
    PORT: 8083,
    API_KEY: '',
    OPENCODE_SERVER_URL: 'http://127.0.0.1:4097',
    OPENCODE_PATH: 'opencode'
};

// Load config from file
const configPath = path.join(__dirname, 'config.json');
let fileConfig = {};

if (fs.existsSync(configPath)) {
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        fileConfig = JSON.parse(content);
        console.log('[Config] Loaded from config.json');
    } catch (err) {
        console.error('[Config] Error parsing config.json:', err.message);
    }
}

// Merge configs: env > file > default
const finalConfig = {
    PORT: parseInt(process.env.PORT) || fileConfig.PORT || defaultConfig.PORT,
    API_KEY: process.env.API_KEY || fileConfig.API_KEY || defaultConfig.API_KEY,
    OPENCODE_SERVER_URL: process.env.OPENCODE_SERVER_URL || fileConfig.OPENCODE_SERVER_URL || defaultConfig.OPENCODE_SERVER_URL,
    OPENCODE_PATH: process.env.OPENCODE_PATH || fileConfig.OPENCODE_PATH || defaultConfig.OPENCODE_PATH
};

// Validate required configuration
if (!finalConfig.OPENCODE_PATH) {
    console.error('[Error] OPENCODE_PATH is not set. Please configure it in config.json or environment variable.');
    process.exit(1);
}

// Check if opencode is available
import { execSync } from 'child_process';
try {
    execSync(`"${finalConfig.OPENCODE_PATH}" --version`, { stdio: 'ignore' });
} catch (e) {
    console.warn(`[Warning] Cannot verify OpenCode installation: ${finalConfig.OPENCODE_PATH}`);
    console.warn('[Warning] Please ensure OpenCode is installed:');
    console.warn('  Windows: npm install -g opencode-ai');
    console.warn('  Linux/macOS: curl -fsSL https://opencode.ai/install | bash');
    console.warn('[Warning] Or specify the full path in config.json:');
    console.warn('  { "OPENCODE_PATH": "C:\\\\Users\\\\YourName\\\\AppData\\\\Roaming\\\\npm\\\\opencode.cmd" }');
}

console.log('[Config] Starting with configuration:');
console.log(`  - Port: ${finalConfig.PORT}`);
console.log(`  - Backend: ${finalConfig.OPENCODE_SERVER_URL}`);
console.log(`  - OpenCode Path: ${finalConfig.OPENCODE_PATH}`);
console.log(`  - API Key: ${finalConfig.API_KEY ? 'Configured' : 'Not configured (no auth)'}`);

// Start the proxy
try {
    const proxy = startProxy(finalConfig);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[Shutdown] Received SIGINT, shutting down gracefully...');
        proxy.killBackend();
        proxy.server.close(() => {
            console.log('[Shutdown] Server closed');
            process.exit(0);
        });
    });
    
    process.on('SIGTERM', () => {
        console.log('\n[Shutdown] Received SIGTERM, shutting down gracefully...');
        proxy.killBackend();
        proxy.server.close(() => {
            console.log('[Shutdown] Server closed');
            process.exit(0);
        });
    });
} catch (error) {
    console.error('[Fatal] Failed to start proxy:', error.message);
    process.exit(1);
}
