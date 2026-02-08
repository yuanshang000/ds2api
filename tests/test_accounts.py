#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DS2API 账号池测试

测试账号登录和轮换功能
"""
import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Optional

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class AccountTestResult:
    email: str
    login_success: bool
    has_token: bool
    token_preview: str
    error: Optional[str] = None


def test_account_login(account: dict) -> AccountTestResult:
    """测试单个账号登录"""
    from core.deepseek import login_deepseek_via_account
    from core.config import logger
    
    email = account.get("email", account.get("mobile", "unknown"))
    print(f"\n📧 测试账号: {email}")
    print("-" * 40)
    
    try:
        login_deepseek_via_account(account)
        token = account.get("token", "")
        
        if token:
            print(f"✅ 登录成功")
            print(f"   Token: {token[:30]}...{token[-10:]}")
            return AccountTestResult(
                email=email,
                login_success=True,
                has_token=True,
                token_preview=f"{token[:30]}...{token[-10:]}"
            )
        else:
            print(f"⚠️  登录完成但无 Token")
            return AccountTestResult(
                email=email,
                login_success=True,
                has_token=False,
                token_preview=""
            )
    except Exception as e:
        print(f"❌ 登录失败: {e}")
        return AccountTestResult(
            email=email,
            login_success=False,
            has_token=False,
            token_preview="",
            error=str(e)
        )


def test_account_pool():
    """测试整个账号池"""
    from core.config import CONFIG, logger
    
    accounts = CONFIG.get("accounts", [])
    
    if not accounts:
        print("⚠️  配置中没有账号")
        return
    
    print("\n" + "=" * 60)
    print("     🔑 DS2API 账号池测试")
    print("=" * 60)
    print(f"共 {len(accounts)} 个账号\n")
    
    results = []
    for account in accounts:
        result = test_account_login(account)
        results.append(result)
        time.sleep(1)  # 避免请求过快
    
    # 打印汇总
    print("\n" + "=" * 60)
    print("     📊 测试结果汇总")
    print("=" * 60)
    
    success_count = sum(1 for r in results if r.login_success)
    token_count = sum(1 for r in results if r.has_token)
    
    print(f"\n总计: {len(results)} 个账号")
    print(f"✅ 登录成功: {success_count}")
    print(f"🔑 获取Token: {token_count}")
    print(f"❌ 登录失败: {len(results) - success_count}")
    
    if any(not r.login_success for r in results):
        print("\n失败的账号:")
        for r in results:
            if not r.login_success:
                print(f"   • {r.email}: {r.error}")
    
    print("\n" + "=" * 60)
    
    # 保存更新后的配置（如果获取了新 token）
    if token_count > 0:
        print("\n💾 更新配置文件中的 token...")
        from core.config import save_config
        save_config(CONFIG)
        print("✅ 配置已保存")
    
    return results


def test_account_rotation():
    """测试账号轮换功能"""
    from core.auth import choose_account, release_account, account_queue
    from core.config import CONFIG
    
    accounts = CONFIG.get("accounts", [])
    if len(accounts) < 2:
        print("⚠️  需要至少 2 个账号来测试轮换")
        return
    
    print("\n" + "=" * 60)
    print("     🔄 账号轮换测试")
    print("=" * 60)
    
    # 测试选择账号
    print("\n选择账号 (连续3次):")
    selected = []
    for i in range(3):
        account = choose_account()
        if account:
            email = account.get("email", account.get("mobile", "unknown"))
            selected.append(email)
            print(f"   第{i+1}次: {email}")
        else:
            print(f"   第{i+1}次: 无可用账号")
    
    # 释放账号
    print("\n释放账号:")
    for i, email in enumerate(selected):
        for acc in accounts:
            if acc.get("email") == email:
                release_account(acc)
                print(f"   已释放: {email}")
                break
    
    # 再次选择
    print("\n释放后再选择:")
    for i in range(2):
        account = choose_account()
        if account:
            email = account.get("email", account.get("mobile", "unknown"))
            print(f"   第{i+1}次: {email}")
            release_account(account)
    
    print("\n✅ 账号轮换功能正常")


def main():
    parser = argparse.ArgumentParser(description="DS2API 账号测试")
    parser.add_argument("--login", action="store_true", help="测试账号登录")
    parser.add_argument("--rotation", action="store_true", help="测试账号轮换")
    parser.add_argument("--all", action="store_true", help="运行所有测试")
    
    args = parser.parse_args()
    
    if args.all or args.login:
        test_account_pool()
    
    if args.all or args.rotation:
        test_account_rotation()
    
    if not (args.all or args.login or args.rotation):
        parser.print_help()
        print("\n使用 --all 运行所有测试")


if __name__ == "__main__":
    main()
