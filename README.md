# PureAPI Radar / LLM API Purity

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![OpenAI](https://img.shields.io/badge/OpenAI-Compatible-111827?style=flat-square)](#)
[![Claude](https://img.shields.io/badge/Claude-Compatible-5f8b71?style=flat-square)](#)

OpenAI and Claude API purity checker. It verifies whether an API relay behaves like a real provider endpoint by sending black-box probes for model catalogs, response schemas, tool calls, streaming events, multimodal input, and token usage.

The UI is inspired by modern API observability consoles: a clean config panel, score ring, verification checklist, latency/token metrics, token-audit chart, and a whitepaper-style explanation page.

## Features

- OpenAI-compatible checks: `/v1/models`, `/v1/responses`, `/v1/chat/completions`, function tool calls, SSE streaming, image input, usage fields.
- Claude-compatible checks: `/v1/models`, `/v1/messages`, `tool_use`, Claude SSE events, image blocks, cache/token usage fields.
- No key storage: API keys are used only for the current request and are never written to disk.
- Token audit: optional multi-round short probes to catch missing usage fields, abnormal token accounting, and rough multiplier drift.
- Ranking radar: seed provider directory with composite score, purity score, uptime, first-token latency, multiplier, protocol support, search, filters, and sorting.
- Single Node service: no database, no external dependencies, easy to deploy.
- GitHub-ready: CI, MIT license, bilingual README, and self-contained frontend assets.

## Quick Start

```bash
git clone https://github.com/xuweizhengo/llm-api-purity.git
cd llm-api-purity
npm start
```

Open:

```text
http://localhost:3078
```

Ranking data lives in:

```text
data/providers.json
```

Edit that file to maintain your own relay directory. The UI updates from `/api/ranking`.

Optional:

```bash
PORT=8080 REQUEST_TIMEOUT_MS=60000 npm start
```

## How It Works

PureAPI Radar does not judge purity from one successful text response. It builds a report from several independent probes:

| Probe | OpenAI path | Claude path | What it proves |
|---|---|---|---|
| Model catalog | `GET /v1/models` | `GET /v1/models` | Base auth, catalog shape, model visibility |
| Structure | `/v1/responses` or `/v1/chat/completions` | `/v1/messages` | Provider-specific response schema |
| Tool behavior | `tool_choice` + function tool | `tool_choice` + `tool_use` | Real tool-call semantics |
| Streaming | SSE chunks and `[DONE]` | `message_start`, `content_block_delta`, `message_stop` | Streaming lifecycle compatibility |
| Multimodal | `image_url` content block | `image` content block | Image-input compatibility |
| Token audit | `usage` fields | `usage` + cache fields | Token accounting sanity |

The final score is a weighted signal, not a legal or billing guarantee. Use a test key first.

## Security Notes

- The API key is accepted by the local backend only for the active request.
- The server does not write request bodies, keys, or reports to disk.
- Error messages are redacted before being returned to the browser.
- Browser requests and responses use `Cache-Control: no-store`.
- For public deployment, put it behind authentication or only expose it to trusted users.

## Related Projects

- [cursor-free-api](https://github.com/xuweizhengo/cursor-free-api) - Cursor API compatible gateway.
- [aws-auto-register](https://github.com/xuweizhengo/aws-auto-register) - AWS Builder ID automation research tool.
- [fingerprint-toolkit](https://github.com/xuweizhengo/fingerprint-toolkit) - Browser fingerprint randomization toolkit.
- [skills-hub](https://github.com/xuweizhengo/skills-hub) - AI coding agent skills collection.

---

# PureAPI Radar / LLM API 纯度检测

OpenAI 与 Claude API 纯度检测工具。它不是只测“能不能返回一句话”，而是通过黑盒探针验证模型目录、响应结构、工具调用、流式事件、多模态输入和 Token 用量字段，帮助你判断一个 API 中转站是否接近官方接口行为。

## 功能

- OpenAI 兼容检测：`/v1/models`、`/v1/responses`、`/v1/chat/completions`、函数工具调用、SSE 流式、图片输入、usage 字段。
- Claude 兼容检测：`/v1/models`、`/v1/messages`、`tool_use`、Claude SSE 事件、image block、cache/token usage 字段。
- Key 不入库：API Key 只在本次请求中使用，不写入磁盘。
- Token 审计：可选多轮短请求，检查 usage 字段缺失、用量异常和粗略倍率漂移。
- 榜单雷达：内置种子站点目录，展示综合分、纯度分、可用率、首 Token、倍率、协议支持、搜索、筛选和排序。
- 单 Node 服务：无数据库、无外部依赖，方便部署。
- 自带报告界面：分数圆环、验证清单、延迟与 Token 指标、审计柱状图、检测原理页。

## 快速开始

```bash
git clone https://github.com/xuweizhengo/llm-api-purity.git
cd llm-api-purity
npm start
```

浏览器打开：

```text
http://localhost:3078
```

榜单数据文件：

```text
data/providers.json
```

你可以把自己的真实检测数据写进这个文件，前端会通过 `/api/ranking` 自动读取。

## 检测原理

| 检测项 | OpenAI 路径 | Claude 路径 | 证明内容 |
|---|---|---|---|
| 模型目录 | `GET /v1/models` | `GET /v1/models` | 基础鉴权、目录结构、模型可见性 |
| 结构验证 | `/v1/responses` 或 `/v1/chat/completions` | `/v1/messages` | 官方风格响应结构 |
| 工具调用 | `tool_choice` + function tool | `tool_choice` + `tool_use` | 是否真实支持工具调用语义 |
| 流式事件 | SSE chunks 与 `[DONE]` | `message_start` / `content_block_delta` / `message_stop` | 流式生命周期完整性 |
| 多模态 | `image_url` content block | `image` content block | 图片输入兼容性 |
| Token 审计 | `usage` 字段 | `usage` 与 cache 字段 | Token 计量是否稳定 |

最终分数是加权参考信号，不等于法律或账单承诺。建议优先使用测试专用 API Key。

## License

[MIT](LICENSE)
