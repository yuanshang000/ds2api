# -*- coding: utf-8 -*-
"""会话管理模块 - 封装公共的会话创建和 PoW 获取逻辑"""
from curl_cffi import requests as cffi_requests
from fastapi import HTTPException, Request

from .config import logger
from .utils import get_account_identifier
from .models import get_model_config
from .auth import (
    get_auth_headers,
    choose_new_account,
    release_account,
    refresh_account_token,
)
from .deepseek import (
    DEEPSEEK_CREATE_SESSION_URL,
    DEEPSEEK_CREATE_POW_URL,
    login_deepseek_via_account,
    call_completion_endpoint,
)
from .pow import get_pow_response


def create_session(request: Request, max_attempts: int = 3) -> str | None:
    """创建 DeepSeek 会话
    
    Args:
        request: FastAPI 请求对象
        max_attempts: 最大重试次数
        
    Returns:
        会话 ID，如果失败返回 None
    """
    attempts = 0
    token_refreshed = False  # 标记是否已尝试刷新 token
    
    while attempts < max_attempts:
        headers = get_auth_headers(request)
        try:
            resp = cffi_requests.post(
                DEEPSEEK_CREATE_SESSION_URL,
                headers=headers,
                json={"agent": "chat"},
                impersonate="safari15_3",
            )
        except Exception as e:
            logger.error(f"[create_session] 请求异常: {e}")
            attempts += 1
            continue
        
        try:
            data = resp.json()
        except Exception as e:
            logger.error(f"[create_session] JSON解析异常: {e}")
            data = {}
        
        if resp.status_code == 200 and data.get("code") == 0:
            session_id = data["data"]["biz_data"]["id"]
            resp.close()
            return session_id
        else:
            code = data.get("code")
            msg = data.get("msg", "")
            logger.warning(
                f"[create_session] 创建会话失败, code={code}, msg={msg}"
            )
            resp.close()
            
            # 配置模式下尝试处理 token 问题
            if request.state.use_config_token:
                # token 无效（认证失败）时，先尝试刷新当前账号的 token
                if code in [40001, 40002, 40003] or "token" in msg.lower() or "unauthorized" in msg.lower():
                    if not token_refreshed:
                        logger.info("[create_session] 检测到 token 可能过期，尝试刷新")
                        if refresh_account_token(request):
                            token_refreshed = True
                            continue  # 使用新 token 重试
                        else:
                            logger.warning("[create_session] token 刷新失败，尝试切换账号")
                
                # token 刷新失败或其他错误，尝试切换账号
                current_id = get_account_identifier(request.state.account)
                if not hasattr(request.state, "tried_accounts"):
                    request.state.tried_accounts = []
                if current_id not in request.state.tried_accounts:
                    request.state.tried_accounts.append(current_id)
                new_account = choose_new_account(request.state.tried_accounts)
                if new_account is None:
                    break
                try:
                    login_deepseek_via_account(new_account)
                except Exception as e:
                    logger.error(
                        f"[create_session] 账号 {get_account_identifier(new_account)} 登录失败：{e}"
                    )
                    attempts += 1
                    continue
                request.state.account = new_account
                request.state.deepseek_token = new_account.get("token")
                token_refreshed = False  # 新账号重置刷新标记
            else:
                attempts += 1
                continue
        attempts += 1
    return None


def get_pow(request: Request, max_attempts: int = 3) -> str | None:
    """获取 PoW 响应的包装函数
    
    Args:
        request: FastAPI 请求对象
        max_attempts: 最大重试次数
        
    Returns:
        Base64 编码的 PoW 响应，如果失败返回 None
    """
    return get_pow_response(request, max_attempts)


def prepare_completion_request(
    request: Request,
    session_id: str,
    prompt: str,
    thinking_enabled: bool = False,
    search_enabled: bool = False,
    max_attempts: int = 3,
):
    """准备并执行对话补全请求
    
    Args:
        request: FastAPI 请求对象
        session_id: 会话 ID
        prompt: 处理后的提示词
        thinking_enabled: 是否启用思考模式
        search_enabled: 是否启用搜索
        max_attempts: 最大重试次数
        
    Returns:
        DeepSeek 响应对象，如果失败返回 None
    """
    pow_resp = get_pow(request, max_attempts)
    if not pow_resp:
        return None
    
    headers = {**get_auth_headers(request), "x-ds-pow-response": pow_resp}
    payload = {
        "chat_session_id": session_id,
        "parent_message_id": None,
        "prompt": prompt,
        "ref_file_ids": [],
        "thinking_enabled": thinking_enabled,
        "search_enabled": search_enabled,
    }
    
    return call_completion_endpoint(payload, headers, max_attempts)


# get_model_config 已移至 core.models


def cleanup_account(request: Request):
    """清理账号资源（将账号放回队列）"""
    if getattr(request.state, "use_config_token", False) and hasattr(request.state, "account"):
        release_account(request.state.account)
