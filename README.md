# opencode-to-openai

[English] | [中文版](./README_CN.md)

`opencode-to-openai` is a lightweight API gateway that transforms the [OpenCode](https://opencode.ai) CLI into a standard OpenAI-compatible REST API. Use powerful free models like Kimi k2.5, GLM 4.7, and MiniMax m2.1 in any AI client (Cursor, Claude Code, OpenClaw, etc.).

---

## Prerequisites

1.  **Node.js**: Version 18.0 or higher.
2.  **OpenCode CLI**: Must be installed on your system.
    - **Windows**: `npm install -g opencode-ai`
    - **Linux / macOS**: `curl -fsSL https://opencode.ai/install | bash`

---

## 🚀 Mode 1: OpenClaw Plugin (Recommended)

Integrate OpenCode models directly into your OpenClaw environment with native UI management.

### 1. Installation
Run this command in your terminal where OpenClaw is installed:
```bash
openclaw plugins install https://github.com/dxxzst/opencode-to-openai
```

### 2. Configuration
1.  Restart your OpenClaw Gateway.
2.  Open the **OpenClaw Control UI** in your browser.
3.  Navigate to **Settings -> Plugins -> OpenCode Proxy**.
4.  Enable the plugin and configure the port and optional API Key.

### 3. Usage
The proxy starts and stops automatically with your OpenClaw Gateway. You can now use model IDs like `opencode/kimi-k2.5-free` in your agents.

---

## 💻 Mode 2: Standalone Mode (Generic API)

Run the gateway as a standalone server for use with any OpenAI-compatible client (e.g., Cursor, Claude Code).

### 1. Installation
```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

### 2. Configuration
Copy the example config and edit it:
```bash
cp config.json.example config.json
```
Edit `config.json` to set your `PORT`, `API_KEY`, and `OPENCODE_PATH`.

### 3. Running
```bash
node index.js
```
The gateway will automatically start the OpenCode backend if it's not already running.

---

## 🛠️ API Usage Example

### List Available Models
```bash
curl http://localhost:8083/v1/models
```

### Chat Completion (Streaming)
```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## License
MIT
