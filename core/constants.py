# -*- coding: utf-8 -*-
"""常量定义模块 - 统一管理项目中的所有常量"""

# ----------------------------------------------------------------------
# 网络和超时配置
# ----------------------------------------------------------------------
KEEP_ALIVE_TIMEOUT = 5  # 保活超时（秒）
STREAM_IDLE_TIMEOUT = 30  # 流无新内容超时（秒）
MAX_KEEPALIVE_COUNT = 10  # 最大连续 keepalive 次数

# ----------------------------------------------------------------------
# DeepSeek API 配置
# ----------------------------------------------------------------------
DEEPSEEK_HOST = "chat.deepseek.com"
DEEPSEEK_LOGIN_URL = f"https://{DEEPSEEK_HOST}/api/v0/users/login"
DEEPSEEK_CREATE_SESSION_URL = f"https://{DEEPSEEK_HOST}/api/v0/chat_session/create"
DEEPSEEK_CREATE_POW_URL = f"https://{DEEPSEEK_HOST}/api/v0/chat/create_pow_challenge"
DEEPSEEK_COMPLETION_URL = f"https://{DEEPSEEK_HOST}/api/v0/chat/completion"

# ----------------------------------------------------------------------
# 请求头配置
# ----------------------------------------------------------------------
BASE_HEADERS = {
    "Host": "chat.deepseek.com",
    "User-Agent": "DeepSeek/1.6.11 Android/35",
    "Accept": "application/json",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    "x-client-platform": "android",
    "x-client-version": "1.6.11",
    "x-client-locale": "zh_CN",
    "accept-charset": "UTF-8",
}

# ----------------------------------------------------------------------
# SSE 解析配置
# ----------------------------------------------------------------------
# 跳过的路径模式（状态相关，不是内容）
SKIP_PATTERNS = [
    "quasi_status", "elapsed_secs", "token_usage", 
    "pending_fragment", "conversation_mode",
    "fragments/-1/status", "fragments/-2/status", "fragments/-3/status"
]
