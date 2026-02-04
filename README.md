# opencode-to-openai

[English] | [中文版](#中文说明)

An OpenAI-compatible API gateway for the [OpenCode](https://opencode.ai) CLI. This proxy allows you to use OpenCode's free models (like Kimi k2.5, GLM 4.7, and MiniMax m2.1) in any standard AI client or agent framework (like OpenClaw, Cursor, or ChatGPT-Next-Web) that supports the OpenAI API format.

---

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

---

<a name="中文说明"></a>

# 中文说明

[English Version](#opencode-to-openai) | 中文

`opencode-to-openai` 是一个为 [OpenCode](https://opencode.ai) 命令行工具设计的 OpenAI 兼容 API 网关。该代理允许您在任何支持 OpenAI API 格式的标准 AI 客户端或 Agent 框架（如 OpenClaw、Cursor 或 ChatGPT-Next-Web）中使用 OpenCode 提供的免费模型（如 Kimi k2.5、GLM 4.7 和 MiniMax m2.1）。

## 功能特性

- **OpenAI 兼容**: 实现了 `/v1/chat/completions` 和 `/v1/models` 接口。
- **动态模型发现**: 自动从 OpenCode CLI 获取最新的免费模型列表。
- **零配置**: 自动处理终端 ANSI 转义码及构建状态清理，确保返回纯净文本。
- **轻量化**: 纯 Node.js 实现，无任何外部依赖。

## 前置条件

1.  **Node.js**: 14.0 或更高版本。
2.  **OpenCode CLI**: 必须已安装并可在 PATH 中调用。
    ```bash
    curl -fsSL https://opencode.ai/install | bash
    ```

## 安装步骤

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
```

## 使用方法

启动代理服务器：

```bash
# 默认端口为 8083
node index.js
```

### 环境变量

- `PORT`: 设置自定义端口（默认：`8083`）。
- `OPENCODE_PATH`: `opencode` 二进制文件的路径（默认：`/usr/local/bin/opencode`）。

## API 使用示例

### 列出模型

```bash
curl http://localhost:8083/v1/models
```

### 对话补全

```bash
curl http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/kimi-k2.5-free",
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

## 开源协议

MIT
