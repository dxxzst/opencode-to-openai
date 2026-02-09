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

### 2. 重启 Gateway
由于 OpenClaw 需要加载新插件，请重启服务：
```bash
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

> 调试：可在插件配置中将 `debug` 设为 `true`，或设置环境变量 `OPENCODE_PROXY_DEBUG=1`，输出请求与会话的调试日志。

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

## 开源协议

MIT
