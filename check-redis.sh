#!/bin/bash
# 检查 Heroku Redis 配置

APP_NAME="${1:-}"

if [ -z "$APP_NAME" ]; then
    echo "用法: ./check-redis.sh <app-name>"
    echo ""
    echo "或者手动运行："
    echo "  heroku addons -a <app-name>"
    echo "  heroku config:get REDIS_URL -a <app-name>"
    exit 1
fi

echo "=== 检查 Heroku Redis 配置 ==="
echo ""

echo "📦 已安装的插件："
heroku addons -a "$APP_NAME"
echo ""

echo "🔗 Redis 连接信息："
heroku config:get REDIS_URL -a "$APP_NAME"
echo ""

echo "📊 Redis 信息（如果已安装）："
heroku redis:info -a "$APP_NAME" 2>/dev/null || echo "未找到 Heroku Redis 插件"
echo ""

echo "💡 如需安装 Heroku Redis："
echo "   heroku addons:create heroku-redis:premium-0 -a $APP_NAME"
