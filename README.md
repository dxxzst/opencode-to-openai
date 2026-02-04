# opencode-to-openai

[English] | [中文版](./README_CN.md)

`opencode-to-openai` is a lightweight API gateway that transforms the [OpenCode](https://opencode.ai) CLI into a standard OpenAI-compatible REST API. It enables you to use powerful free models (like Kimi k2.5, GLM 4.7, and MiniMax m2.1) in any AI client that supports the OpenAI format (e.g., Cursor, Claude Code, OpenClaw).

## Key Features

- **Standard API Support**: Implements `/v1/chat/completions` and `/v1/models`.
- **Auto-Lifecycle Management**: Automatically starts and monitors the OpenCode backend server.
- **Streaming & Reasoning**: Native support for Server-Sent Events (SSE) and automatic wrapping of model reasoning in `<think>` tags.
- **Developer Friendly**: 100% preservation of source code formatting and indentation.
- **Secure**: Optional API key authentication support.

## Prerequisites

1.  **Node.js**: Version 18.0 or higher.
2.  **OpenCode CLI**: Must be installed and available in your system path.

### Installation of OpenCode

-   **Windows (NPM)**:
    ```bash
    npm install -g opencode-ai
    ```
-   **Linux / macOS (Shell)**:
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## Installation of Proxy

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

## Usage

Start the proxy server:

```bash
node index.js
```

The proxy will automatically detect if the OpenCode backend is running. If not, it will start it for you on the configured port.

### Configuration

You can customize settings via a `config.json` file or environment variables.

| Option | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Proxy listener port. | `8083` |
| `API_KEY` | Optional security key (Bearer Token). | `(none)` |
| `OPENCODE_SERVER_URL` | Internal OpenCode backend URL. | `http://127.0.0.1:4097` |
| `OPENCODE_PATH` | Path to the `opencode` binary. | `opencode` |

## API Examples

### Chat Completions (Streaming)
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
