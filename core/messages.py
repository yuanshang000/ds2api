# -*- coding: utf-8 -*-
"""消息处理模块"""
import re

from .config import CONFIG, logger

# Claude 默认模型
CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-20250514"

# 预编译正则表达式（性能优化）
_MARKDOWN_IMAGE_PATTERN = re.compile(r"!\[(.*?)\]\((.*?)\)")


# ----------------------------------------------------------------------
# 消息预处理函数，将多轮对话合并成最终 prompt
# ----------------------------------------------------------------------
def messages_prepare(messages: list) -> str:
    """处理消息列表，合并连续相同角色的消息，并添加角色标签：
    - 对于 assistant 消息，加上 <｜Assistant｜> 前缀及 <｜end▁of▁sentence｜> 结束标签；
    - 对于 user/system 消息（除第一条外）加上 <｜User｜> 前缀；
    - 如果消息 content 为数组，则提取其中 type 为 "text" 的部分；
    - 最后移除 markdown 图片格式的内容。
    """
    processed = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, list):
            texts = [
                item.get("text", "") for item in content if item.get("type") == "text"
            ]
            text = "\n".join(texts)
        else:
            text = str(content)
        processed.append({"role": role, "text": text})
    if not processed:
        return ""
    # 合并连续同一角色的消息
    merged = [processed[0]]
    for msg in processed[1:]:
        if msg["role"] == merged[-1]["role"]:
            merged[-1]["text"] += "\n\n" + msg["text"]
        else:
            merged.append(msg)
    # 添加标签
    parts = []
    for idx, block in enumerate(merged):
        role = block["role"]
        text = block["text"]
        if role == "assistant":
            parts.append(f"<｜Assistant｜>{text}<｜end▁of▁sentence｜>")
        elif role in ("user", "system"):
            if idx > 0:
                parts.append(f"<｜User｜>{text}")
            else:
                parts.append(text)
        else:
            parts.append(text)
    final_prompt = "".join(parts)
    # 仅移除 markdown 图片格式(不全部移除 !）- 使用预编译的正则表达式
    final_prompt = _MARKDOWN_IMAGE_PATTERN.sub(r"[\1](\2)", final_prompt)
    return final_prompt


# ----------------------------------------------------------------------
# OpenAI到Claude格式转换函数
# ----------------------------------------------------------------------
def convert_claude_to_deepseek(claude_request: dict) -> dict:
    """将Claude格式的请求转换为DeepSeek格式（基于现有OpenAI接口）"""
    messages = claude_request.get("messages", [])
    model = claude_request.get("model", CLAUDE_DEFAULT_MODEL)

    # 从配置文件读取Claude模型映射
    claude_mapping = CONFIG.get(
        "claude_model_mapping", {"fast": "deepseek-chat", "slow": "deepseek-chat"}
    )

    # Claude模型映射到DeepSeek模型 - 基于配置和模型特征判断
    if (
        "opus" in model.lower()
        or "reasoner" in model.lower()
        or "slow" in model.lower()
    ):
        deepseek_model = claude_mapping.get("slow", "deepseek-chat")
    else:
        deepseek_model = claude_mapping.get("fast", "deepseek-chat")

    deepseek_request = {"model": deepseek_model, "messages": messages.copy()}

    # 处理system消息 - 将system参数转换为system role消息
    if "system" in claude_request:
        system_msg = {"role": "system", "content": claude_request["system"]}
        deepseek_request["messages"].insert(0, system_msg)

    # 添加可选参数
    if "temperature" in claude_request:
        deepseek_request["temperature"] = claude_request["temperature"]
    if "top_p" in claude_request:
        deepseek_request["top_p"] = claude_request["top_p"]
    if "stop_sequences" in claude_request:
        deepseek_request["stop"] = claude_request["stop_sequences"]
    if "stream" in claude_request:
        deepseek_request["stream"] = claude_request["stream"]

    return deepseek_request


def convert_deepseek_to_claude_format(
    deepseek_response: dict, original_claude_model: str = CLAUDE_DEFAULT_MODEL
) -> dict:
    """将DeepSeek响应转换为Claude格式的OpenAI响应"""
    # DeepSeek响应已经是OpenAI格式，只需要修改模型名称
    if isinstance(deepseek_response, dict):
        claude_response = deepseek_response.copy()
        claude_response["model"] = original_claude_model
        return claude_response

    return deepseek_response
