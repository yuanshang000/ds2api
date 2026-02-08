# -*- coding: utf-8 -*-
"""模型定义模块 - 集中管理所有支持的模型"""

# DeepSeek 模型列表（官方模型名称）
DEEPSEEK_MODELS = [
    {
        "id": "deepseek-chat",
        "object": "model",
        "created": 1677610602,
        "owned_by": "deepseek",
        "permission": [],
    },
    {
        "id": "deepseek-reasoner",
        "object": "model",
        "created": 1677610602,
        "owned_by": "deepseek",
        "permission": [],
    },
    {
        "id": "deepseek-chat-search",
        "object": "model",
        "created": 1677610602,
        "owned_by": "deepseek",
        "permission": [],
    },
    {
        "id": "deepseek-reasoner-search",
        "object": "model",
        "created": 1677610602,
        "owned_by": "deepseek",
        "permission": [],
    },
]

# Claude 模型映射列表
CLAUDE_MODELS = [
    {
        "id": "claude-sonnet-4-20250514",
        "object": "model",
        "created": 1715635200,
        "owned_by": "anthropic",
    },
    {
        "id": "claude-sonnet-4-20250514-fast",
        "object": "model",
        "created": 1715635200,
        "owned_by": "anthropic",
    },
    {
        "id": "claude-sonnet-4-20250514-slow",
        "object": "model",
        "created": 1715635200,
        "owned_by": "anthropic",
    },
]


def get_model_config(model: str) -> tuple[bool, bool]:
    """根据模型名称获取配置
    
    Args:
        model: 模型名称
        
    Returns:
        (thinking_enabled, search_enabled) 元组
    """
    model_lower = model.lower()
    
    if model_lower == "deepseek-chat":
        return False, False
    elif model_lower == "deepseek-reasoner":
        return True, False
    elif model_lower == "deepseek-chat-search":
        return False, True
    elif model_lower == "deepseek-reasoner-search":
        return True, True
    else:
        return None, None  # 不支持的模型


def get_openai_models_response() -> dict:
    """获取 OpenAI 格式的模型列表响应"""
    return {"object": "list", "data": DEEPSEEK_MODELS}


def get_claude_models_response() -> dict:
    """获取 Claude 格式的模型列表响应"""
    return {"object": "list", "data": CLAUDE_MODELS}

