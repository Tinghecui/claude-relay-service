#!/bin/bash
# Heroku Dyno 快速扩展脚本
#
# 使用方法:
#   ./scripts/scale-dyno.sh <app-name> <dyno-count> [dyno-type]
#
# 示例:
#   ./scripts/scale-dyno.sh my-app 2              # 扩展到2个 standard-1x
#   ./scripts/scale-dyno.sh my-app 3 standard-2x  # 扩展到3个 standard-2x
#   ./scripts/scale-dyno.sh my-app 1              # 缩减到1个
#

set -e

APP_NAME="${1:-}"
DYNO_COUNT="${2:-}"
DYNO_TYPE="${3:-standard-1x}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$APP_NAME" ] || [ -z "$DYNO_COUNT" ]; then
    echo -e "${RED}❌ 使用方法错误${NC}"
    echo ""
    echo "使用方法:"
    echo "  $0 <app-name> <dyno-count> [dyno-type]"
    echo ""
    echo "示例:"
    echo "  $0 my-app 2                # 扩展到2个 standard-1x"
    echo "  $0 my-app 3 standard-2x    # 扩展到3个 standard-2x"
    echo "  $0 my-app 1                # 缩减到1个"
    exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🚀 Heroku Dyno 扩展工具${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 显示当前配置
echo -e "${YELLOW}📊 当前配置:${NC}"
heroku ps -a "$APP_NAME"
echo ""

# 计算成本
case "$DYNO_TYPE" in
    eco)
        UNIT_COST=5
        ;;
    basic)
        UNIT_COST=7
        ;;
    standard-1x)
        UNIT_COST=25
        ;;
    standard-2x)
        UNIT_COST=50
        ;;
    performance-m)
        UNIT_COST=250
        ;;
    performance-l)
        UNIT_COST=500
        ;;
    *)
        UNIT_COST=25
        ;;
esac

TOTAL_COST=$((UNIT_COST * DYNO_COUNT))

echo -e "${YELLOW}📋 扩展计划:${NC}"
echo "   应用名称: $APP_NAME"
echo "   Dyno 类型: $DYNO_TYPE"
echo "   Dyno 数量: $DYNO_COUNT"
echo "   预估成本: \$$TOTAL_COST/月"
echo ""

# 确认
read -p "$(echo -e ${YELLOW}确认执行扩展? [y/N]: ${NC})" -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ 扩展已取消${NC}"
    exit 0
fi

# 执行扩展
echo ""
echo -e "${GREEN}⏳ 正在执行扩展...${NC}"
heroku ps:scale web=${DYNO_COUNT}:${DYNO_TYPE} -a "$APP_NAME"

# 等待几秒让 dyno 启动
echo ""
echo -e "${GREEN}⏳ 等待 dyno 启动...${NC}"
sleep 5

# 显示新配置
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 扩展成功！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📊 新配置:${NC}"
heroku ps -a "$APP_NAME"
echo ""

# 监控建议
echo -e "${BLUE}💡 接下来:${NC}"
echo "   1. 监控应用性能: heroku logs --tail -a $APP_NAME"
echo "   2. 查看 metrics: heroku metrics:dashboard -a $APP_NAME"
echo "   3. 运行监控脚本: node scripts/monitor-scaling-metrics.js"
echo ""
echo -e "${BLUE}   回滚命令（如需要）:${NC}"
echo "   heroku ps:scale web=1:standard-1x -a $APP_NAME"
echo ""
