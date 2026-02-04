# opencode-to-openai

[English Version](./README.md) | 中文版

`opencode-to-openai` 是一个轻量级的 API 网关，它将 [OpenCode](https://opencode.ai) 命令行工具转换为标准的 OpenAI 兼容 REST API。通过它，您可以在任何支持 OpenAI 格式的 AI 客户端（如 Cursor, Claude Code, OpenClaw 等）中直接使用强大的免费模型（如 Kimi k2.5, GLM 4.7 和 MiniMax m2.1）。

## 核心功能

- **标准 API 支持**: 完整实现 `/v1/chat/completions` 和 `/v1/models` 接口。
- **全自动管理**: 启动时会自动检查并启动 OpenCode 后端服务，无需手动干预。
- **流式输出与推理**: 原生支持 SSE 流式返回，并自动将模型的推理过程封装在 `<think>` 标签中。
- **完美代码缩进**: 针对编程场景深度优化，100% 保留源码的所有空格和格式。
- **安全验证**: 支持可选的 API Key 认证，方便在远程服务器或生产环境部署。
- **无感集成**: 基于官方 SDK 实现，稳定性极佳。

## 前置要求

1.  **Node.js**: 18.0 或更高版本。
2.  **OpenCode CLI**: 必须已安装在系统中。
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## 快速开始

1.  **克隆并安装**
    ```bash
    git clone https://github.com/dxxzst/opencode-to-openai.git
    cd opencode-to-openai
    npm install
    ```

2.  **启动代理**
    ```bash
    # 直接运行即可，后端服务会自动启动
    node index.js
    ```

## 配置说明

您可以通过环境变量自定义网关行为：

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 代理监听端口。 | `8083` |
| `API_KEY` | 设置后，所有请求必须携带 `Authorization: Bearer <KEY>`。 | `未设置` |
| `OPENCODE_SERVER_URL` | OpenCode 后端的地址。 | `http://127.0.0.1:4097` |
| `OPENCODE_PATH` | `opencode` 二进制文件的路径。 | `/usr/local/bin/opencode` |

## 使用示例

### 在 Cursor / Claude Code 中使用
将 API Base URL 设置为 `http://您的服务器IP:8083/v1`，并使用任何免费模型 ID（如 `opencode/kimi-k2.5-free`）。

### CURL 测试
```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "用 Python 写一个 Hello World"}],
    "stream": true
  }'
```

## 开源协议

MIT
