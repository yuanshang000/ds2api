# DS2API 接口文档

语言 / Language: [中文](API.md) | [English](API.en.md)

本文档详细介绍 DS2API 提供的所有 API 端点。

---

## 目录

- [基础信息](#基础信息)
- [OpenAI 兼容接口](#openai-兼容接口)
  - [获取模型列表](#获取模型列表)
  - [对话补全](#对话补全)
- [Claude 兼容接口](#claude-兼容接口)
  - [Claude 模型列表](#claude-模型列表)
  - [Claude 消息接口](#claude-消息接口)
  - [Token 计数](#token-计数)
- [管理接口](#管理接口)
  - [登录认证](#登录认证)
  - [配置管理](#配置管理)
  - [账号管理](#账号管理)
  - [Vercel 同步](#vercel-同步)
- [错误处理](#错误处理)
- [使用示例](#使用示例)

---

## 基础信息

| 项目 | 说明 |
|-----|------|
| **Base URL** | `https://your-domain.com` 或 `http://localhost:5001` |
| **OpenAI 认证** | `Authorization: Bearer <api-key>` |
| **Claude 认证** | `x-api-key: <api-key>` |
| **响应格式** | JSON |

---

## OpenAI 兼容接口

### 获取模型列表

```http
GET /v1/models
```

**响应示例**：

```json
{
  "object": "list",
  "data": [
    {"id": "deepseek-chat", "object": "model", "owned_by": "deepseek"},
    {"id": "deepseek-reasoner", "object": "model", "owned_by": "deepseek"},
    {"id": "deepseek-chat-search", "object": "model", "owned_by": "deepseek"},
    {"id": "deepseek-reasoner-search", "object": "model", "owned_by": "deepseek"}
  ]
}
```

---

### 对话补全

```http
POST /v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json
```

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----|------|:----:|------|
| `model` | string | ✅ | 模型名称（见下表） |
| `messages` | array | ✅ | 对话消息列表 |
| `stream` | boolean | ❌ | 是否流式输出，默认 `false` |
| `temperature` | number | ❌ | 温度参数，范围 0-2 |
| `max_tokens` | number | ❌ | 最大输出 token 数 |
| `tools` | array | ❌ | 工具定义列表（Function Calling） |
| `tool_choice` | string | ❌ | 工具选择策略 |

**支持的模型**：

| 模型 | 深度思考 | 联网搜索 | 说明 |
|-----|:--------:|:--------:|------|
| `deepseek-chat` | ❌ | ❌ | 标准对话 |
| `deepseek-reasoner` | ✅ | ❌ | 推理模式，输出思考过程 |
| `deepseek-chat-search` | ❌ | ✅ | 联网搜索增强 |
| `deepseek-reasoner-search` | ✅ | ✅ | 推理 + 联网搜索 |

**基础请求示例**：

```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "你是一个有帮助的助手。"},
    {"role": "user", "content": "你好"}
  ]
}
```

**流式请求示例**：

```json
{
  "model": "deepseek-reasoner-search",
  "messages": [
    {"role": "user", "content": "今天有什么重要新闻？"}
  ],
  "stream": true
}
```

**流式响应格式** (`stream: true`)：

```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"reasoning_content":"让我思考一下..."},"index":0}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"根据搜索结果..."},"index":0}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"finish_reason":"stop"}]}

data: [DONE]
```

> **注意**：推理模式会输出 `reasoning_content` 字段，包含模型的思考过程。

**非流式响应格式** (`stream: false`)：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1738400000,
  "model": "deepseek-reasoner",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "回复内容",
      "reasoning_content": "思考过程（仅 reasoner 模型）"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 60,
    "completion_tokens_details": {
      "reasoning_tokens": 20
    }
  }
}
```

#### 工具调用 (Function Calling)

**请求示例**：

```json
{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "北京今天天气怎么样？"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "获取指定城市的天气",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {"type": "string", "description": "城市名称"}
        },
        "required": ["location"]
      }
    }
  }]
}
```

**响应示例**：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\": \"北京\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

---

## Claude 兼容接口

### Claude 模型列表

```http
GET /anthropic/v1/models
```

**响应示例**：

```json
{
  "object": "list",
  "data": [
    {"id": "claude-sonnet-4-20250514", "object": "model", "owned_by": "anthropic"},
    {"id": "claude-sonnet-4-20250514-fast", "object": "model", "owned_by": "anthropic"},
    {"id": "claude-sonnet-4-20250514-slow", "object": "model", "owned_by": "anthropic"}
  ]
}
```

**模型映射说明**：

| Claude 模型 | 实际调用 | 说明 |
|------------|---------|------|
| `claude-sonnet-4-20250514` | deepseek-chat | 标准模式 |
| `claude-sonnet-4-20250514-fast` | deepseek-chat | 快速模式 |
| `claude-sonnet-4-20250514-slow` | deepseek-reasoner | 推理模式（深度思考） |

---

### Claude 消息接口

```http
POST /anthropic/v1/messages
x-api-key: your-api-key
Content-Type: application/json
anthropic-version: 2023-06-01
```

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----|------|:----:|------|
| `model` | string | ✅ | 模型名称 |
| `max_tokens` | integer | ✅ | 最大输出 token |
| `messages` | array | ✅ | 对话消息 |
| `stream` | boolean | ❌ | 是否流式，默认 `false` |
| `system` | string | ❌ | 系统提示词 |
| `temperature` | number | ❌ | 温度参数 |

**请求示例**：

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "你好，请介绍一下你自己"}
  ]
}
```

**非流式响应**：

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [{
    "type": "text",
    "text": "你好！我是一个 AI 助手..."
  }],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 50
  }
}
```

**流式响应** (SSE)：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","model":"claude-sonnet-4-20250514"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}
```

---

### Token 计数

```http
POST /anthropic/v1/messages/count_tokens
x-api-key: your-api-key
Content-Type: application/json
```

**请求示例**：

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [
    {"role": "user", "content": "你好"}
  ]
}
```

**响应示例**：

```json
{
  "input_tokens": 5
}
```

---

## 管理接口

所有管理接口（除登录外）需要在请求头携带 JWT Token：`Authorization: Bearer <jwt-token>`

### 登录认证

```http
POST /admin/login
Content-Type: application/json
```

**请求体**：

```json
{
  "key": "your-admin-key"
}
```

**响应**：

```json
{
  "success": true,
  "token": "jwt-token-string",
  "expires_in": 86400
}
```

> Token 有效期默认 24 小时。

---

### 配置管理

#### 获取配置

```http
GET /admin/config
Authorization: Bearer <jwt-token>
```

**响应**：

```json
{
  "keys": ["api-key-1", "api-key-2"],
  "accounts": [
    {
      "email": "user@example.com",
      "password": "***",
      "token": "session-token"
    }
  ]
}
```

#### 更新配置

```http
POST /admin/config
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**请求体**：

```json
{
  "keys": ["new-api-key"],
  "accounts": [...]
}
```

---

### 账号管理

#### 添加账号

```http
POST /admin/accounts
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**请求体**：

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### 批量导入账号

```http
POST /admin/accounts/batch
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**请求体**：

```json
{
  "accounts": [
    {"email": "user1@example.com", "password": "pass1"},
    {"email": "user2@example.com", "password": "pass2"}
  ]
}
```

#### 测试单个账号

```http
POST /admin/accounts/test
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**请求体**：

```json
{
  "email": "user@example.com"
}
```

#### 测试所有账号

```http
POST /admin/accounts/test-all
Authorization: Bearer <jwt-token>
```

#### 获取队列状态

```http
GET /admin/queue/status
Authorization: Bearer <jwt-token>
```

**响应**：

```json
{
  "total_accounts": 5,
  "healthy_accounts": 4,
  "queue_size": 10,
  "accounts": [
    {
      "email": "user@example.com",
      "status": "healthy",
      "last_used": "2026-02-01T12:00:00Z"
    }
  ]
}
```

---

### Vercel 同步

```http
POST /admin/vercel/sync
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**请求体**（首次同步需要）：

```json
{
  "vercel_token": "your-vercel-token",
  "project_id": "your-project-id"
}
```

> 首次同步成功后，凭证会被保存，后续同步可不传。

**响应**：

```json
{
  "success": true,
  "message": "配置已同步到 Vercel"
}
```

---

## 错误处理

所有错误响应遵循以下格式：

```json
{
  "error": {
    "message": "错误描述",
    "type": "error_type",
    "code": "error_code"
  }
}
```

**常见错误码**：

| HTTP 状态码 | 错误类型 | 说明 |
|:----------:|---------|------|
| 400 | `invalid_request_error` | 请求参数错误 |
| 401 | `authentication_error` | API Key 无效或未提供 |
| 403 | `permission_denied` | 权限不足 |
| 429 | `rate_limit_error` | 请求过于频繁 |
| 500 | `internal_error` | 服务器内部错误 |
| 503 | `service_unavailable` | 无可用账号 |

---

## 使用示例

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://your-domain.com/v1"
)

# 普通对话
response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)

# 流式 + 推理模式
for chunk in client.chat.completions.create(
    model="deepseek-reasoner",
    messages=[{"role": "user", "content": "解释相对论"}],
    stream=True
):
    delta = chunk.choices[0].delta
    if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
        print(f"[思考] {delta.reasoning_content}", end="")
    if delta.content:
        print(delta.content, end="")
```

### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-api-key",
    base_url="https://your-domain.com/anthropic"
)

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}]
)
print(response.content[0].text)
```

### cURL

```bash
# OpenAI 格式
curl https://your-domain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# Claude 格式
curl https://your-domain.com/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### JavaScript / TypeScript

```javascript
// OpenAI 格式 - 流式请求
const response = await fetch('https://your-domain.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-key'
  },
  body: JSON.stringify({
    model: 'deepseek-chat-search',
    messages: [{ role: 'user', content: '今天有什么新闻？' }],
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
  
  for (const line of lines) {
    const data = line.slice(6);
    if (data === '[DONE]') continue;
    
    const json = JSON.parse(data);
    const content = json.choices?.[0]?.delta?.content;
    if (content) process.stdout.write(content);
  }
}
```

### Node.js (OpenAI SDK)

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your-api-key',
  baseURL: 'https://your-domain.com/v1'
});

const stream = await client.chat.completions.create({
  model: 'deepseek-reasoner',
  messages: [{ role: 'user', content: '解释黑洞' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) process.stdout.write(content);
}
```
