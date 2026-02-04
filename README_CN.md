# opencode-to-openai

[English Version](./README.md) | 中文版

`opencode-to-openai` 是一个轻量级的 API 网关，它将 [OpenCode](https://opencode.ai) 命令行工具转换为标准的 OpenAI 兼容 REST API。通过它，您可以在任何支持 OpenAI 格式的 AI 客户端（如 Cursor, Claude Code, OpenClaw 等）中直接使用强大的免费模型（如 Kimi k2.5, GLM 4.7 和 MiniMax m2.1）。

## 核心功能

- **标准 API 支持**: 完整实现 `/v1/chat/completions` 和 `/v1/models` 接口。
- **全自动生命周期管理**: 启动时会自动检查并拉起 OpenCode 后端服务（支持 Windows 和 Linux）。
- **流式输出与推理过程**: 原生支持 SSE 流式返回，并自动将模型的推理过程封装在 `<think>` 标签中。
- **开发者友好**: 针对编程场景深度优化，100% 保留源码的所有空格和缩进格式。
- **安全验证**: 支持可选的 API Key 认证，确保接口安全。

## 前置要求

1.  **Node.js**: 18.0 或更高版本。
2.  **OpenCode CLI**: 必须已安装在您的系统中。

### 安装 OpenCode CLI

-   **Windows (推荐通过 NPM)**:
    ```bash
    npm install -g opencode-ai
    ```
-   **Linux / macOS (通过 Shell 脚本)**:
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## 代理安装步骤

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

## 使用方法

启动代理服务器：

```bash
node index.js
```

代理会自动检测 OpenCode 后端是否已在运行。如果未运行，它将在配置的端口上为您自动启动后端服务。

### 配置说明

您可以通过根目录下的 `config.json` 文件或环境变量自定义网关行为。

| 选项名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 代理监听端口。 | `8083` |
| `API_KEY` | 设置后需在请求头携带 `Authorization: Bearer <KEY>`。 | `未设置` |
| `OPENCODE_SERVER_URL` | 内部 OpenCode 后端地址。 | `http://127.0.0.1:4097` |
| `OPENCODE_PATH` | `opencode` 二进制文件的路径或全局命令名。 | `opencode` |

## API 使用示例

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
