
export const DEEPSEEK_HOST = "chat.deepseek.com";
export const DEEPSEEK_LOGIN_URL = `https://${DEEPSEEK_HOST}/api/v0/users/login`;
export const DEEPSEEK_CREATE_SESSION_URL = `https://${DEEPSEEK_HOST}/api/v0/chat_session/create`;
export const DEEPSEEK_CREATE_POW_URL = `https://${DEEPSEEK_HOST}/api/v0/chat/create_pow_challenge`;
export const DEEPSEEK_COMPLETION_URL = `https://${DEEPSEEK_HOST}/api/v0/chat/completion`;

export const BASE_HEADERS = {
    "Host": "chat.deepseek.com",
    "User-Agent": "DeepSeek/1.6.11 Android/35",
    "Accept": "application/json",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    "x-client-platform": "android",
    "x-client-version": "1.6.11",
    "x-client-locale": "zh_CN",
    "accept-charset": "UTF-8",
};

export const KEEP_ALIVE_TIMEOUT = 5;
export const STREAM_IDLE_TIMEOUT = 30;
export const MAX_KEEPALIVE_COUNT = 10;
