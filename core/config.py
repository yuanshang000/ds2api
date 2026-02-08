# -*- coding: utf-8 -*-
"""配置管理模块"""
import base64
import json
import logging
import os
import sys

import transformers

# -------------------------- 获取项目根目录 --------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_VERCEL = bool(os.getenv("VERCEL")) or bool(os.getenv("NOW_REGION"))


def resolve_path(env_key: str, default_rel: str) -> str:
    """解析路径，支持环境变量覆盖"""
    raw = os.getenv(env_key)
    if raw:
        return raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)
    return os.path.join(BASE_DIR, default_rel)


# -------------------------- 日志配置 --------------------------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)
logger = logging.getLogger("ds2api")

# -------------------------- 初始化 tokenizer --------------------------
chat_tokenizer_dir = resolve_path("DS2API_TOKENIZER_DIR", "")
tokenizer = transformers.AutoTokenizer.from_pretrained(
    chat_tokenizer_dir, trust_remote_code=True
)

# ----------------------------------------------------------------------
# 配置文件的读写函数
# ----------------------------------------------------------------------
CONFIG_PATH = resolve_path("DS2API_CONFIG_PATH", "config.json")


def load_config() -> dict:
    """加载配置。

    优先从环境变量读取：
      - DS2API_CONFIG_JSON / CONFIG_JSON: 直接 JSON 字符串，或 base64 编码后的 JSON

    若未提供环境变量，再从 CONFIG_PATH 指向的文件读取。
    """
    raw_cfg = os.getenv("DS2API_CONFIG_JSON") or os.getenv("CONFIG_JSON")
    if raw_cfg:
        try:
            return json.loads(raw_cfg)
        except json.JSONDecodeError:
            try:
                decoded = base64.b64decode(raw_cfg).decode("utf-8")
                return json.loads(decoded)
            except Exception as e:
                logger.warning(f"[load_config] 环境变量配置解析失败: {e}")
                return {}

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"[load_config] 无法读取配置文件({CONFIG_PATH}): {e}")
        return {}


def save_config(cfg: dict) -> None:
    """将配置写回 config.json。

    Vercel 环境文件系统通常是只读的；且如果配置来自环境变量，也无法回写。
    所以这里失败不应影响主流程。
    """
    if os.getenv("DS2API_CONFIG_JSON") or os.getenv("CONFIG_JSON"):
        logger.info("[save_config] 配置来自环境变量，跳过写回")
        return

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except PermissionError as e:
        logger.warning(f"[save_config] 配置文件不可写({CONFIG_PATH}): {e}")
    except Exception as e:
        logger.exception(f"[save_config] 写入 config.json 失败: {e}")


# 全局配置
CONFIG = load_config()
if not CONFIG:
    logger.warning(
        "[config] 未加载到有效配置，请提供 config.json（路径可用 DS2API_CONFIG_PATH 指定）或设置环境变量 DS2API_CONFIG_JSON"
    )

# WASM 模块文件路径
WASM_PATH = resolve_path("DS2API_WASM_PATH", "sha3_wasm_bg.7b9ca65ddd.wasm")

# 模板目录
TEMPLATES_DIR = resolve_path("DS2API_TEMPLATES_DIR", "templates")

# WebUI 静态文件目录
STATIC_ADMIN_DIR = resolve_path("DS2API_STATIC_ADMIN_DIR", "static/admin")
