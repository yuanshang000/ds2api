# -*- coding: utf-8 -*-
"""公共工具函数模块"""


def get_account_identifier(account: dict) -> str:
    """返回账号的唯一标识，优先使用 email，否则使用 mobile"""
    return account.get("email", "").strip() or account.get("mobile", "").strip()


def estimate_tokens(text) -> int:
    """估算文本的 token 数量（简单估算：字符数/4）
    
    Args:
        text: 字符串或其他类型
        
    Returns:
        估算的 token 数量，最小为 1
    """
    if isinstance(text, str):
        return max(1, len(text) // 4)
    elif isinstance(text, list):
        return sum(
            estimate_tokens(item.get("text", ""))
            if isinstance(item, dict)
            else estimate_tokens(str(item))
            for item in text
        )
    else:
        return max(1, len(str(text)) // 4)
