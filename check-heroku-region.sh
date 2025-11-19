#!/bin/bash
# 检查 Heroku 应用区域

echo "=== Heroku 应用区域检查 ==="
echo ""

# 方法1: 通过 Heroku CLI
if command -v heroku &> /dev/null; then
    echo "📍 通过 Heroku CLI 查询："
    heroku apps:info --json | grep -E '"region"|"name"' | head -2
    echo ""
fi

# 方法2: 通过应用 URL 查询
echo "💡 你也可以通过 Heroku Dashboard 查看："
echo "   https://dashboard.heroku.com/apps -> 选择你的应用 -> Settings -> Region"
echo ""

echo "🌍 Heroku 美国区域："
echo "   • us (Virginia)      - 弗吉尼亚，对应 AWS us-east-1"
echo "   • us-west (Oregon)   - 俄勒冈，对应 AWS us-west-2"
echo ""
