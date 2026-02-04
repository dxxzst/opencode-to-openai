# opencode-to-openai

[English] | [中文版](./README_CN.md)

An OpenAI-compatible API gateway for the [OpenCode](https://opencode.ai) CLI. This proxy allows you to use OpenCode's free models (like Kimi k2.5, GLM 4.7, and MiniMax m2.1) in any standard AI client or agent framework (like OpenClaw, Cursor, or ChatGPT-Next-Web) that supports the OpenAI API format.

## Features

- **OpenAI Compatible**: Implements `/v1/chat/completions` and `/v1/models`.
- **Dynamic Model Discovery**: Automatically fetches the latest free models from OpenCode CLI.
- **Zero Configuration**: Automatically handles terminal ANSI codes and build status cleaning.
- **Lightweight**: Pure Node.js implementation with no external dependencies.

## Prerequisites

1.  **Node.js**: Version 14 or higher.
2.  **OpenCode CLI**: Must be installed and available in your PATH.
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## Installation

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
```

## Usage

Start the proxy server:

```bash
# Default port is 8083
node index.js
```

### Environment Variables

- `PORT`: Set a custom port (default: `8083`).
- `OPENCODE_PATH`: Path to the `opencode` binary (default: `/usr/local/bin/opencode`).

## API Usage Example

### List Models

```bash
curl http://localhost:8083/v1/models
```

### Chat Completions

```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## License

MIT
