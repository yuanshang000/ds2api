# -*- coding: utf-8 -*-
"""DeepSeek API 相关逻辑"""
import time
from curl_cffi import requests
from fastapi import HTTPException

from .config import CONFIG, save_config, logger
from .utils import get_account_identifier
from .constants import (
    DEEPSEEK_HOST,
    DEEPSEEK_LOGIN_URL,
    DEEPSEEK_CREATE_SESSION_URL,
    DEEPSEEK_CREATE_POW_URL,
    DEEPSEEK_COMPLETION_URL,
    BASE_HEADERS,
)


# get_account_identifier 已移至 core.utils




# ----------------------------------------------------------------------
# 登录函数：支持使用 email 或 mobile 登录
# ----------------------------------------------------------------------
def login_deepseek_via_account(account: dict) -> str:
    """使用 account 中的 email 或 mobile 登录 DeepSeek，
    成功后将返回的 token 写入 account 并保存至配置文件，返回新 token。
    """
    email = account.get("email", "").strip()
    mobile = account.get("mobile", "").strip()
    password = account.get("password", "").strip()
    if not password or (not email and not mobile):
        raise HTTPException(
            status_code=400,
            detail="账号缺少必要的登录信息（必须提供 email 或 mobile 以及 password）",
        )
    if email:
        payload = {
            "email": email,
            "password": password,
            "device_id": "deepseek_to_api",
            "os": "android",
        }
    else:
        payload = {
            "mobile": mobile,
            "area_code": None,
            "password": password,
            "device_id": "deepseek_to_api",
            "os": "android",
        }
    try:
        resp = requests.post(
            DEEPSEEK_LOGIN_URL, headers=BASE_HEADERS, json=payload, impersonate="safari15_3"
        )
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"[login_deepseek_via_account] 登录请求异常: {e}")
        raise HTTPException(status_code=500, detail="Account login failed: 请求异常")
    try:
        logger.warning(f"[login_deepseek_via_account] {resp.text}")
        data = resp.json()
    except Exception as e:
        logger.error(f"[login_deepseek_via_account] JSON解析失败: {e}")
        raise HTTPException(
            status_code=500, detail="Account login failed: invalid JSON response"
        )
    
    # 检查 API 错误码
    if data.get("code") != 0:
        error_msg = data.get("msg", "Unknown error")
        logger.error(f"[login_deepseek_via_account] API错误: {error_msg}")
        raise HTTPException(
            status_code=500, detail=f"Account login failed: {error_msg}"
        )
    
    # 检查业务错误码
    biz_code = data.get("data", {}).get("biz_code")
    biz_msg = data.get("data", {}).get("biz_msg", "")
    if biz_code != 0:
        logger.error(f"[login_deepseek_via_account] 业务错误: {biz_msg}")
        raise HTTPException(
            status_code=500, detail=f"Account login failed: {biz_msg}"
        )
    
    # 校验响应数据格式是否正确
    if (
        data.get("data") is None
        or data["data"].get("biz_data") is None
        or data["data"]["biz_data"].get("user") is None
    ):
        logger.error(f"[login_deepseek_via_account] 登录响应格式错误: {data}")
        raise HTTPException(
            status_code=500, detail="Account login failed: invalid response format"
        )
    new_token = data["data"]["biz_data"]["user"].get("token")
    if not new_token:
        logger.error(f"[login_deepseek_via_account] 登录响应中缺少 token: {data}")
        raise HTTPException(
            status_code=500, detail="Account login failed: missing token"
        )
    account["token"] = new_token
    save_config(CONFIG)
    return new_token


# ----------------------------------------------------------------------
# 封装对话接口调用的重试机制
# ----------------------------------------------------------------------
def call_completion_endpoint(payload: dict, headers: dict, max_attempts: int = 3):
    """调用 DeepSeek 对话接口，支持重试"""
    attempts = 0
    while attempts < max_attempts:
        try:
            deepseek_resp = requests.post(
                DEEPSEEK_COMPLETION_URL,
                headers=headers,
                json=payload,
                stream=True,
                impersonate="safari15_3",
            )
        except Exception as e:
            logger.warning(f"[call_completion_endpoint] 请求异常: {e}")
            time.sleep(1)
            attempts += 1
            continue
        if deepseek_resp.status_code == 200:
            return deepseek_resp
        else:
            logger.warning(
                f"[call_completion_endpoint] 调用对话接口失败, 状态码: {deepseek_resp.status_code}"
            )
            deepseek_resp.close()
            time.sleep(1)
            attempts += 1
    return None
