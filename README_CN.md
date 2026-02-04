# opencode-to-openai

[English Version](./README.md) | 中文版

这是一个为 [OpenCode](https://opencode.ai) 设计的 OpenAI 兼容 API 网关。本项目允许标准的 AI 客户端（如 OpenClaw, Cursor, Claude Code 等）通过一个基于 SDK 的稳定代理，直接调用 OpenCode 提供的免费模型（Kimi k2.5, GLM 4.7, MiniMax m2.1）。

## 重大更新 (v5.0)

- **SDK 驱动**: 采用官方 `@opencode-ai/sdk` 实现，相比之前的命令行解析，稳定性与响应速度大幅提升。
- **流式输出 (Streaming)**: 完美支持 SSE (Server-Sent Events)，实现逐字生成的丝滑体验。
- **推理思维链 (Reasoning)**: 自动捕获模型的思考过程，并使用 `<think>` 标签封装。
- **完美缩进**: 针对编程场景优化，100% 保留源码格式与缩进，适配 Python/YAML 等对格式敏感的语言。
- **动态模型发现**: 自动同步 OpenCode 后端最新的免费模型列表。

## 前置条件

1.  **Node.js**: 建议使用 18.0 或更高版本。
2.  **OpenCode CLI**: 已安装并以服务器模式运行。
    ```bash
    # 安装
    curl -fsSL https://opencode.ai/install | bash
    # 启动后端服务 (必须)
    opencode serve --port 4097 --hostname 127.0.0.1
    ```

## 安装步骤

```bash
git clone https://github.com/dxxzst/opencode-to-openai.git
cd opencode-to-openai
npm install
```

## 使用方法

启动代理服务器：

```bash
# 默认监听 8083 端口，连接到 127.0.0.1:4097 的 OpenCode 后端
node index.js
```

### 环境变量

- `PORT`: 代理监听端口（默认：`8083`）。
- `OPENCODE_SERVER_URL`: OpenCode 后端地址（默认：`http://127.0.0.1:4097`）。

## API 使用示例

### 列出可用模型

```bash
curl http://localhost:8083/v1/models
```

### 对话补全 (支持流式)

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
