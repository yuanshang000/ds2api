#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DS2API 配置生成器

交互式工具，用于批量配置账号和 API Keys。
支持导出为 JSON 和 Base64 格式，方便 Vercel 部署配置。

使用方法:
    python tools/config_generator.py
"""
import base64
import json
import os
import sys

# 默认配置结构
DEFAULT_CONFIG = {"keys": [], "accounts": []}


def clear_screen():
    """清屏"""
    os.system("cls" if os.name == "nt" else "clear")


def print_header():
    """打印标题"""
    print("\n" + "=" * 50)
    print("       DS2API 配置生成器")
    print("=" * 50)


def print_menu():
    """打印菜单"""
    print("\n📋 请选择操作：")
    print("  1. 添加 API Key")
    print("  2. 添加账号 (Email)")
    print("  3. 添加账号 (手机号)")
    print("  4. 删除 API Key")
    print("  5. 删除账号")
    print("  6. 查看当前配置")
    print("  7. 导出 JSON (可直接用于环境变量)")
    print("  8. 导出 Base64 (推荐用于 Vercel)")
    print("  9. 从 config.json 导入")
    print("  10. 保存到 config.json")
    print("  0. 退出")
    print()


def add_api_key(config):
    """添加 API Key"""
    print("\n➕ 添加 API Key")
    print("  提示：API Key 是你自定义的密钥，用于调用此 API 服务")
    key = input("  请输入 API Key: ").strip()
    if key:
        if key in config["keys"]:
            print("  ⚠️  该 Key 已存在")
        else:
            config["keys"].append(key)
            print(f"  ✅ 已添加 Key: {key[:8]}...")
    else:
        print("  ❌ 输入为空，未添加")


def add_account_email(config):
    """添加 Email 账号"""
    print("\n➕ 添加 DeepSeek 账号 (Email)")
    email = input("  Email: ").strip()
    password = input("  密码: ").strip()
    if email and password:
        # 检查是否已存在
        for acc in config["accounts"]:
            if acc.get("email") == email:
                print("  ⚠️  该账号已存在")
                return
        config["accounts"].append({"email": email, "password": password, "token": ""})
        print(f"  ✅ 已添加账号: {email}")
    else:
        print("  ❌ 输入不完整，未添加")


def add_account_mobile(config):
    """添加手机号账号"""
    print("\n➕ 添加 DeepSeek 账号 (手机号)")
    mobile = input("  手机号: ").strip()
    password = input("  密码: ").strip()
    if mobile and password:
        # 检查是否已存在
        for acc in config["accounts"]:
            if acc.get("mobile") == mobile:
                print("  ⚠️  该账号已存在")
                return
        config["accounts"].append({"mobile": mobile, "password": password, "token": ""})
        print(f"  ✅ 已添加账号: {mobile}")
    else:
        print("  ❌ 输入不完整，未添加")


def delete_api_key(config):
    """删除 API Key"""
    if not config["keys"]:
        print("\n  ⚠️  当前没有 API Key")
        return
    print("\n🗑️  删除 API Key")
    for i, key in enumerate(config["keys"], 1):
        print(f"  {i}. {key[:8]}...")
    try:
        idx = int(input("  选择要删除的序号 (0 取消): "))
        if 0 < idx <= len(config["keys"]):
            removed = config["keys"].pop(idx - 1)
            print(f"  ✅ 已删除: {removed[:8]}...")
        elif idx != 0:
            print("  ❌ 无效选择")
    except ValueError:
        print("  ❌ 无效输入")


def delete_account(config):
    """删除账号"""
    if not config["accounts"]:
        print("\n  ⚠️  当前没有账号")
        return
    print("\n🗑️  删除账号")
    for i, acc in enumerate(config["accounts"], 1):
        identifier = acc.get("email") or acc.get("mobile", "未知")
        print(f"  {i}. {identifier}")
    try:
        idx = int(input("  选择要删除的序号 (0 取消): "))
        if 0 < idx <= len(config["accounts"]):
            removed = config["accounts"].pop(idx - 1)
            identifier = removed.get("email") or removed.get("mobile", "未知")
            print(f"  ✅ 已删除: {identifier}")
        elif idx != 0:
            print("  ❌ 无效选择")
    except ValueError:
        print("  ❌ 无效输入")


def view_config(config):
    """查看当前配置"""
    print("\n📄 当前配置")
    print("-" * 40)
    print(f"  API Keys ({len(config['keys'])}个):")
    for key in config["keys"]:
        print(f"    • {key[:8]}...")
    print(f"\n  账号 ({len(config['accounts'])}个):")
    for acc in config["accounts"]:
        identifier = acc.get("email") or acc.get("mobile", "未知")
        token_status = "✓ 有Token" if acc.get("token") else "✗ 无Token"
        print(f"    • {identifier} [{token_status}]")
    print("-" * 40)


def export_json(config):
    """导出 JSON"""
    json_str = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    print("\n📤 JSON 格式 (可直接设置为 DS2API_CONFIG_JSON 环境变量):")
    print("-" * 50)
    print(json_str)
    print("-" * 50)
    
    # 复制到剪贴板（如果可用）
    try:
        import subprocess
        process = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        process.communicate(json_str.encode("utf-8"))
        print("  ✅ 已复制到剪贴板 (macOS)")
    except Exception:
        pass


def export_base64(config):
    """导出 Base64"""
    json_str = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    b64_str = base64.b64encode(json_str.encode("utf-8")).decode("utf-8")
    print("\n📤 Base64 格式 (推荐用于 Vercel 环境变量):")
    print("-" * 50)
    print(b64_str)
    print("-" * 50)
    
    # 复制到剪贴板（如果可用）
    try:
        import subprocess
        process = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        process.communicate(b64_str.encode("utf-8"))
        print("  ✅ 已复制到剪贴板 (macOS)")
    except Exception:
        pass


def import_from_file(config):
    """从 config.json 导入"""
    # 尝试多个可能的路径
    paths = [
        "config.json",
        "../config.json",
        os.path.join(os.path.dirname(__file__), "..", "config.json"),
    ]
    
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                config["keys"] = loaded.get("keys", [])
                config["accounts"] = loaded.get("accounts", [])
                print(f"\n  ✅ 已从 {path} 导入配置")
                print(f"     Keys: {len(config['keys'])}个, 账号: {len(config['accounts'])}个")
                return
            except Exception as e:
                print(f"\n  ❌ 导入失败: {e}")
                return
    
    print("\n  ⚠️  未找到 config.json 文件")


def save_to_file(config):
    """保存到 config.json"""
    # 确定保存路径
    path = "config.json"
    if not os.path.exists(path):
        parent_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
        if os.path.exists(os.path.dirname(parent_path)):
            path = parent_path
    
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"\n  ✅ 已保存到 {path}")
    except Exception as e:
        print(f"\n  ❌ 保存失败: {e}")


def main():
    """主函数"""
    config = DEFAULT_CONFIG.copy()
    config["keys"] = []
    config["accounts"] = []

    print_header()
    print("\n💡 提示：此工具帮助你生成 DS2API 配置")
    print("   生成的配置可用于本地 config.json 或 Vercel 环境变量")

    while True:
        print_menu()
        choice = input("请输入选项: ").strip()

        if choice == "1":
            add_api_key(config)
        elif choice == "2":
            add_account_email(config)
        elif choice == "3":
            add_account_mobile(config)
        elif choice == "4":
            delete_api_key(config)
        elif choice == "5":
            delete_account(config)
        elif choice == "6":
            view_config(config)
        elif choice == "7":
            export_json(config)
        elif choice == "8":
            export_base64(config)
        elif choice == "9":
            import_from_file(config)
        elif choice == "10":
            save_to_file(config)
        elif choice == "0":
            print("\n👋 再见！\n")
            break
        else:
            print("\n  ❌ 无效选项，请重新选择")

        input("\n按 Enter 继续...")


if __name__ == "__main__":
    main()
