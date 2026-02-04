# opencode-to-openai

[English] | [中文版](./README_CN.md)

An OpenAI-compatible API gateway for [OpenCode](https://opencode.ai). This project enables standard AI clients (OpenClaw, Cursor, Claude Code, etc.) to use OpenCode's free models (Kimi k2.5, GLM 4.7, MiniMax m2.1) via a stable SDK-based proxy.

## Key Enhancements (v5.0)

- **SDK-Powered**: Uses the official `@opencode-ai/sdk` for superior stability and speed compared to CLI parsing.
- **Streaming Support**: Real-time response streaming via SSE (Server-Sent Events).
- **Reasoning/Thinking**: Automatically captures and wraps model reasoning processes in `<think>` tags.
- **Indentation Preserved**: Perfect for coding tasks; maintains all source code formatting and indentation.
- **Dynamic Models**: Automatically discovers the latest available models from the OpenCode server.

## Prerequisites

1.  **Node.js**: Version 18 or higher recommended.
2.  **OpenCode CLI**: Installed and running in server mode.
    ```bash
    # Install
    curl -fsSL https://opencode.ai/install | bash
    # Start the backend server (Required)
    opencode serve --port 4097 --hostname 127.0.0.1
    ```

## Installation

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

## Usage

Start the proxy server:

```bash
# Default port is 8083, connects to OpenCode on 4097
node index.js
```

### Environment Variables

- `PORT`: Proxy listener port (default: `8083`).
- `OPENCODE_SERVER_URL`: OpenCode backend URL (default: `http://127.0.0.1:4097`).

## API Usage Example

### List Models

```bash
curl http://localhost:8083/v1/models
```

### Chat Completions (with Streaming)

```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "Write a Python hello world."}],
    "stream": true
  }'
```

## License

MIT
