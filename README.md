# opencode-to-openai

[English] | [中文版](./README_CN.md)

`opencode-to-openai` is a lightweight API gateway that transforms the [OpenCode](https://opencode.ai) CLI into a standard OpenAI-compatible REST API. It enables you to use powerful free models (like Kimi k2.5, GLM 4.7, and MiniMax m2.1) in any AI client that supports the OpenAI format (e.g., Cursor, Claude Code, OpenClaw).

## Key Features

- **Standard API Support**: Implements `/v1/chat/completions` and `/v1/models`.
- **Auto-Management**: Automatically starts and manages the OpenCode backend server.
- **Streaming & Reasoning**: Native support for Server-Sent Events (SSE) and automatic wrapping of model reasoning in `<think>` tags.
- **Indentation Preserved**: Specifically optimized for coding tasks, ensuring 100% preservation of source code formatting.
- **Security**: Supports optional API key authentication for production or remote use.
- **No Dependencies**: Pure Node.js implementation using the official SDK.

## Prerequisites

1.  **Node.js**: Version 18.0 or higher.
2.  **OpenCode CLI**: Must be installed on your system.
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## Quick Start

1.  **Clone and Install**
    ```bash
    git clone https://github.com/dxxzst/opencode-to-openai.git
    cd opencode-to-openai
    npm install
    ```

2.  **Run the Proxy**
    ```bash
    # Simply run, the backend will start automatically
    node index.js
    ```

## Configuration

You can customize the behavior using environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the proxy will listen on. | `8083` |
| `API_KEY` | If set, requires `Authorization: Bearer <KEY>` header. | `undefined` |
| `OPENCODE_SERVER_URL` | URL of the OpenCode backend. | `http://127.0.0.1:4097` |
| `OPENCODE_PATH` | Path to the `opencode` binary. | `/usr/local/bin/opencode` |

## Usage Examples

### Cursor / Claude Code
Set the API base URL to `http://your-server-ip:8083/v1` and use any free model ID (e.g., `opencode/kimi-k2.5-free`).

### CURL
```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "Write a Python script."}],
    "stream": true
  }'
```

## License

MIT
