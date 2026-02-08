#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DS2API 开发服务器 - 统一启动后端和前端

使用方法:
    python dev.py             # 同时启动后端和前端
    python dev.py --backend   # 仅启动后端
    python dev.py --frontend  # 仅启动前端
    python dev.py --install   # 安装所有依赖

环境变量:
    PORT - 后端服务端口，默认 5001
    LOG_LEVEL - 日志级别，默认 INFO
"""
import os
import sys
import signal
import subprocess
import time
from pathlib import Path

# 配置
BACKEND_PORT = int(os.getenv("PORT", "5001"))
FRONTEND_PORT = 5173
HOST = os.getenv("HOST", "0.0.0.0")
LOG_LEVEL = os.getenv("LOG_LEVEL", "info").lower()
PROJECT_DIR = Path(__file__).parent
WEBUI_DIR = PROJECT_DIR / "webui"
REQUIREMENTS_FILE = PROJECT_DIR / "requirements.txt"

processes = []


def install_dependencies():
    """安装所有 Python 和 Node.js 依赖"""
    print("\n📦 安装 Python 依赖...")
    subprocess.run([
        sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE), "-q"
    ], check=True)
    print("✅ Python 依赖安装完成")
    
    if WEBUI_DIR.exists():
        print("\n📦 安装前端依赖...")
        subprocess.run(["npm", "install"], cwd=WEBUI_DIR, check=True)
        print("✅ 前端依赖安装完成")
    
    print("\n🎉 所有依赖安装完成！运行 `python dev.py` 启动服务\n")


def signal_handler(sig, frame):
    """处理退出信号，终止所有子进程"""
    print("\n\n🛑 正在关闭所有服务...")
    for proc in processes:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    print("👋 已退出\n")
    sys.exit(0)


def start_backend():
    """启动后端服务"""
    print(f"🚀 启动后端服务... http://localhost:{BACKEND_PORT}")
    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn",
            "app:app",
            "--host", HOST,
            "--port", str(BACKEND_PORT),
            "--reload",
            "--reload-dir", str(PROJECT_DIR),
            "--log-level", LOG_LEVEL,
        ],
        cwd=PROJECT_DIR,
    )
    processes.append(proc)
    return proc


def start_frontend():
    """启动前端开发服务器"""
    if not WEBUI_DIR.exists():
        print("⚠️  webui 目录不存在，跳过前端启动")
        return None
    
    node_modules = WEBUI_DIR / "node_modules"
    if not node_modules.exists():
        print("📦 安装前端依赖...")
        subprocess.run(["npm", "install"], cwd=WEBUI_DIR, check=True)
    
    print(f"🎨 启动前端服务... http://localhost:{FRONTEND_PORT}")
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=WEBUI_DIR,
    )
    processes.append(proc)
    return proc


def main():
    # 解析参数
    if "--install" in sys.argv or "-i" in sys.argv:
        install_dependencies()
        return
    
    backend_only = "--backend" in sys.argv or "-b" in sys.argv
    frontend_only = "--frontend" in sys.argv or "-f" in sys.argv
    
    # 注册信号处理
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print("\n" + "=" * 50)
    print("       DS2API 开发服务器")
    print("=" * 50)
    
    if frontend_only:
        start_frontend()
    elif backend_only:
        start_backend()
    else:
        # 同时启动
        start_backend()
        time.sleep(1)  # 等待后端启动
        start_frontend()
    
    print("\n" + "-" * 50)
    if not frontend_only:
        print(f"📡 后端 API:  http://localhost:{BACKEND_PORT}")
    if not backend_only:
        print(f"🎨 管理界面: http://localhost:{FRONTEND_PORT}")
    print("-" * 50)
    print("按 Ctrl+C 停止所有服务\n")
    
    # 等待进程结束
    try:
        while processes:
            for proc in processes[:]:
                if proc.poll() is not None:
                    processes.remove(proc)
            time.sleep(0.5)
    except KeyboardInterrupt:
        signal_handler(None, None)


if __name__ == "__main__":
    main()
