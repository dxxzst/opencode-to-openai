# opencode-to-openai

[English Version](./README.md) | 中文版

`opencode-to-openai` 是一个轻量级的 API 网关，它将 [OpenCode](https://opencode.ai) 命令行工具转换为标准的 OpenAI 兼容 REST API。通过它，您可以在任何支持 OpenAI 格式的 AI 客户端（如 Cursor, Claude Code, OpenClaw 等）中直接使用强大的免费模型（如 Kimi k2.5, GLM 4.7 和 MiniMax m2.1）。

---

## 前置要求

1.  **Node.js**: 18.0 或更高版本。
2.  **OpenCode CLI**: 必须已安装在您的系统中。
    - **Windows**: `npm install -g opencode-ai`
    - **Linux / macOS**: `curl -fsSL https://opencode.ai/install | bash`

---

## 🚀 模式 1：OpenClaw 插件模式 (原生集成)

**推荐方式。** 将 OpenCode 模型直接集成到 OpenClaw 环境中，支持图形化界面管理。

### 1. 安装步骤
在安装了 OpenClaw 的终端中运行：
```bash
openclaw plugins install https://github.com/dxxzst/opencode-to-openai
```

### 2. 配置说明
1.  重启您的 OpenClaw Gateway。
2.  在浏览器中打开 **OpenClaw Control UI** 网页界面。
3.  进入 **Settings -> Plugins -> OpenCode Proxy**。
4.  开启插件，并配置端口和可选的 API Key。

### 3. 使用方法
代理会随 OpenClaw Gateway 自动启动或停止。您现在可以在 Agent 配置中直接使用 `opencode/kimi-k2.5-free` 等模型 ID。

---

## 💻 模式 2：独立运行模式 (通用 API)

将网关作为一个独立的服务器运行，适用于任何支持 OpenAI 接口的客户端（如 Cursor, Claude Code）。

### 1. 安装步骤
```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

### 2. 配置说明
复制示例配置文件并进行编辑：
```bash
cp config.json.example config.json
```
在 `config.json` 中设置您的端口 (`PORT`)、`API_KEY` 以及 `OPENCODE_PATH`。

### 3. 启动运行
```bash
node index.js
```
网关启动时会自动检测并拉起 OpenCode 后端服务。

---

## 🛠️ API 使用示例

### 列出模型列表
```bash
curl http://localhost:8083/v1/models
```

### 对话补全 (支持流式)
```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": true
  }'
```

## 开源协议
MIT
