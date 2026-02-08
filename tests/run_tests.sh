#!/bin/bash
# DS2API 测试运行器

set -e

cd "$(dirname "$0")/.."

echo "=================================================="
echo "     🧪 DS2API 测试套件"
echo "=================================================="
echo ""

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查服务是否运行
check_service() {
    echo -e "${YELLOW}检查服务状态...${NC}"
    if curl -s http://localhost:5001/ > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 服务运行中${NC}"
        return 0
    else
        echo -e "${RED}❌ 服务未运行${NC}"
        echo "请先启动服务: python dev.py"
        return 1
    fi
}

# 运行单元测试
run_unit_tests() {
    echo ""
    echo "=================================================="
    echo "     📋 单元测试"
    echo "=================================================="
    python3 -m pytest tests/test_unit.py -v --tb=short 2>/dev/null || python3 tests/test_unit.py
}

# 运行 API 测试
run_api_tests() {
    echo ""
    echo "=================================================="
    echo "     🌐 API 集成测试"
    echo "=================================================="
    python3 tests/test_all.py "$@"
}

# 运行账号测试
run_account_tests() {
    echo ""
    echo "=================================================="
    echo "     🔑 账号测试"
    echo "=================================================="
    python3 tests/test_accounts.py --all
}

# 显示帮助
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  unit       只运行单元测试"
    echo "  api        只运行 API 测试"
    echo "  api --quick 快速 API 测试"
    echo "  accounts   只运行账号测试"
    echo "  all        运行所有测试"
    echo "  help       显示此帮助"
    echo ""
    echo "示例:"
    echo "  $0 unit"
    echo "  $0 api --quick"
    echo "  $0 all"
}

# 主逻辑
case "${1:-all}" in
    unit)
        run_unit_tests
        ;;
    api)
        if check_service; then
            shift
            run_api_tests "$@"
        fi
        ;;
    accounts)
        run_account_tests
        ;;
    all)
        run_unit_tests
        echo ""
        if check_service; then
            run_api_tests --quick
        fi
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "未知选项: $1"
        show_help
        exit 1
        ;;
esac

echo ""
echo "=================================================="
echo "     ✨ 测试完成"
echo "=================================================="
