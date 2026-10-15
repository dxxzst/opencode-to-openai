# opencode-to-openai

[English Version](./README.md) | 中文版

`opencode-to-openai` 是一个轻量级的 API 网关，它将 [OpenCode](https://opencode.ai) 命令行工具转换为标准的 OpenAI 兼容 REST API。通过它，您可以在任何支持 OpenAI 格式的 AI 客户端（如 Cursor, Claude Code, OpenClaw 等）中直接使用强大的免费模型（如 Kimi k2.5, GLM 4.7 和 MiniMax m2.1）。

---

## 前置要求

1.  **Node.js**: 18.0 或更高版本。
2.  **OpenCode CLI**: 必须已安装在您的系统中。
    - **Windows**: `npm install -g opencode-ai`
    - **Linux / macOS**: `curl -fsSL https://opencode.ai/install | bash`

> **需要 OpenCode v2。** 本代理对接的是 OpenCode **v2** HTTP API（`/api/...`），即 `opencode serve` 从 v2 起对外提供的接口。

---

## 🚀 模式 1：OpenClaw 插件模式 (原生集成)

**推荐方式。** 将 OpenCode 模型直接集成到 OpenClaw 环境中，支持图形化界面管理。

### 1. 安装步骤

在安装了 OpenClaw 的终端中运行：

```bash
openclaw plugins install https://github.com/dxxzst/opencode-to-openai
```

### 2. 重启 Gateway
由于 OpenClaw 需要加载新插件，请重启服务：
```bash
openclaw gateway restart
```

> 说明：如果启用了插件白名单（`plugins.allow`），必须把本插件加入 allowlist。注意 `openclaw config set ...` 会覆盖原有列表，请先读取并合并后再写回：
```bash
openclaw config get plugins.allow --json
# 假设返回 ["a","b"]，请写成：
openclaw config set plugins.allow '["a","b","opencode-to-openai"]' --json
openclaw gateway restart
```

如果插件已经加载，也可使用命令快速写入 allowlist（仍需重启）：
```bash
/opencode_allow
openclaw gateway restart
```

### 3. 配置模型
#### 第一步：同步模型并注入 Provider（官方方式）
运行以下命令触发插件的 Provider 认证流程，插件会自动从本地代理同步模型并写入配置：
```bash
openclaw models auth login --provider opencode-to-openai --method local
```

如需同时设置默认模型，可加 `--set-default`：
```bash
openclaw models auth login --provider opencode-to-openai --method local --set-default
```

#### 第二步：选择并使用
同步完成后，您可以运行：
👉 **/model status** (查看已导入的模型列表)

或者直接设置您的首选模型：
👉 `openclaw models set opencode-to-openai/opencode/kimi-k2.5-free`

> 提示：如果在 OpenClaw 环境里模型请求卡住，可将插件配置 `useIsolatedHome` 设为 `false`，让 OpenCode 使用真实 HOME（共享已登录/已配置的本地环境）。

> 安全：默认禁用 OpenCode 工具调用（插件配置 `disableTools=true`），避免模型执行本地命令或改动文件；如确需工具能力可手动关闭。

> 调试：可在插件配置中将 `debug` 设为 `true`，或设置环境变量 `OPENCODE_PROXY_DEBUG=1`，输出请求与会话的调试日志。

#### 4. 服务自检（推荐）
在同步模型前，建议先确认服务已启动并可用：

```bash
curl http://127.0.0.1:8083/health
curl http://127.0.0.1:8083/v1/models
```

若你配置了 `apiKey`，请加上鉴权头：

```bash
curl -H "Authorization: Bearer <YOUR_API_KEY>" http://127.0.0.1:8083/v1/models
```

最小对话测试（非流式）：

```bash
curl -X POST http://127.0.0.1:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode/kimi-k2.5-free","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

图像输入（视觉）：使用 OpenAI 风格的 `image_url` 内容块。其值可以是公网 `http(s)` 链接或 `data:` URI；远程链接会先下载并内联后再发送给 OpenCode：

```bash
curl -X POST http://127.0.0.1:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode/kimi-k2.5-free","messages":[{"role":"user","content":[{"type":"text","text":"这张图里有什么？"},{"type":"image_url","image_url":{"url":"https://example.com/cat.png"}}]}],"stream":false}'
```

> 仅当模型对应的 provider 支持视觉时图像才会生效，纯文本模型会忽略附件。

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

在 `config.json` 中设置您的端口 (`PORT`)、`API_KEY`、`BIND_HOST`、`DISABLE_TOOLS` 以及 `OPENCODE_PATH`。程序会自动在常见位置（如 `~/.opencode/bin`、npm/pnpm 全局目录等）尝试查找 `opencode`，但生产环境仍建议显式填写绝对路径。

OpenCode v2 服务要求 Basic 鉴权（`opencode:<password>`）。当代理自行拉起 OpenCode 时，会自动生成密码并注入子进程，无需额外配置。若您将代理指向**已在运行**的 OpenCode 服务，请把该服务的密码通过 `OPENCODE_SERVER_PASSWORD`（配置或环境变量）告知代理，以便鉴权通过。

### 3. 启动运行

```bash
node index.js
```

网关启动时会自动检测并拉起 OpenCode 后端服务。

---

## 开源协议

MIT
