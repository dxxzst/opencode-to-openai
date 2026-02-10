# opencode-to-openai

English Version | [中文版](./README_CN.md)

`opencode-to-openai` is a lightweight API gateway that transforms the [OpenCode](https://opencode.ai) command-line tool into a standard OpenAI-compatible REST API. With it, you can directly use powerful free models (such as Kimi k2.5, GLM 4.7, and MiniMax m2.1) in any AI client that supports the OpenAI format (e.g., Cursor, Claude Code, OpenClaw, etc.).

---

## Prerequisites

1.  **Node.js**: Version 18.0 or higher.
2.  **OpenCode CLI**: Must be installed on your system.
    - **Windows**: `npm install -g opencode-ai`
    - **Linux / macOS**: `curl -fsSL https://opencode.ai/install | bash`

---

## 🚀 Mode 1: OpenClaw Plugin Mode (Native Integration)

**Recommended.** Directly integrate OpenCode models into the OpenClaw environment with graphical interface management support.

### 1. Installation Steps

Run the following command in a terminal where OpenClaw is installed:

```bash
openclaw plugins install https://github.com/dxxzst/opencode-to-openai
```

### 2. Restart Gateway

Since OpenClaw needs to load the new plugin, please restart the service:

```bash
openclaw gateway restart
```

> Note: If you enabled plugin allowlist (`plugins.allow`), you must add this plugin to the list. `openclaw config set ...` overwrites the list, so merge first:
```bash
openclaw config get plugins.allow --json
# If it returns ["a","b"], write back:
openclaw config set plugins.allow '["a","b","opencode-to-openai"]' --json
openclaw gateway restart
```

If the plugin is already loaded, you can use the built-in command to add it (restart still required):
```bash
/opencode_allow
openclaw gateway restart
```

### 3. Configure Models
#### Step 1: Sync Models and Inject Provider (Official Flow)

Run the following command to trigger the provider auth flow. The plugin will sync models from the local proxy and write the config:

```bash
openclaw models auth login --provider opencode-to-openai --method local
```

To set the default model at the same time, add `--set-default`:

```bash
openclaw models auth login --provider opencode-to-openai --method local --set-default
```

#### Step 2: Select and Use

After the sync is complete, you can run:

👉 **/model status** (to view the list of imported models)

Or directly set your preferred model:

👉 `openclaw models set opencode-to-openai/opencode/kimi-k2.5-free`

> Tip: If requests hang in the OpenClaw environment, set plugin config `useIsolatedHome` to `false` so OpenCode uses the real HOME (shared local auth/config).

> Debug: set plugin config `debug` to `true`, or export `OPENCODE_PROXY_DEBUG=1` to see request/session debug logs.

#### 4. Service Self-Test (Recommended)
Before syncing models, verify the proxy is up:

```bash
curl http://127.0.0.1:8083/health
curl http://127.0.0.1:8083/v1/models
```

If you set `apiKey`, include the auth header:

```bash
curl -H "Authorization: Bearer <YOUR_API_KEY>" http://127.0.0.1:8083/v1/models
```

Minimal chat test (non-stream):

```bash
curl -X POST http://127.0.0.1:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode/kimi-k2.5-free","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

---

## 💻 Mode 2: Standalone Mode (Universal API)

Run the gateway as a standalone server, suitable for any client that supports the OpenAI interface (such as Cursor, Claude Code).

### 1. Installation Steps

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

### 2. Configuration

Copy the example configuration file and edit it:

```bash
cp config.json.example config.json
```

Set your `PORT`, `API_KEY`, `BIND_HOST`, and `OPENCODE_PATH` in `config.json`.

### 3. Start Running

```bash
node index.js
```

The gateway will automatically detect and launch the OpenCode backend service upon startup.

---

## License

MIT
