#!/usr/bin/env node
/**
 * Heroku 扩展时机监控工具
 * 帮助判断何时需要增加 dyno 数量
 *
 * 使用方法：
 *   node scripts/monitor-scaling-metrics.js
 *
 * 或设置为定时任务（每5分钟）：
 *   */5 * * * * cd /path/to/project && node scripts/monitor-scaling-metrics.js >> logs/scaling-metrics.log
 */

const axios = require('axios')
const config = require('../config/config')
const logger = require('../src/utils/logger')
const redisClient = require('../src/models/redis')

// 扩展阈值配置
const THRESHOLDS = {
  // 响应时间（毫秒）
  responseTime: {
    warning: 1000, // 1秒
    critical: 3000 // 3秒
  },
  // 内存使用率（百分比）
  memory: {
    warning: 70,
    critical: 85
  },
  // Redis 连接数（百分比）
  redisConnections: {
    warning: 70,
    critical: 90
  },
  // 错误率（百分比）
  errorRate: {
    warning: 1,
    critical: 5
  },
  // 并发请求数（估算）
  concurrentRequests: {
    warning: 50,
    critical: 100
  }
}

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
}

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`
}

function getStatusEmoji(level) {
  switch (level) {
    case 'ok':
      return '✅'
    case 'warning':
      return '⚠️'
    case 'critical':
      return '🚨'
    default:
      return 'ℹ️'
  }
}

function assessLevel(value, threshold) {
  if (value >= threshold.critical) return 'critical'
  if (value >= threshold.warning) return 'warning'
  return 'ok'
}

async function getMemoryUsage() {
  const used = process.memoryUsage()
  return {
    heapUsed: Math.round((used.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotal: Math.round((used.heapTotal / 1024 / 1024) * 100) / 100,
    rss: Math.round((used.rss / 1024 / 1024) * 100) / 100,
    external: Math.round((used.external / 1024 / 1024) * 100) / 100
  }
}

async function getRedisMetrics() {
  try {
    const client = redisClient.getClientSafe()

    // Redis INFO 命令获取统计信息
    const info = await client.info('stats')
    const clients = await client.info('clients')

    // 解析连接数
    const connectedClientsMatch = clients.match(/connected_clients:(\d+)/)
    const connectedClients = connectedClientsMatch ? parseInt(connectedClientsMatch[1]) : 0

    // 解析命令统计
    const totalCommandsMatch = info.match(/total_commands_processed:(\d+)/)
    const totalCommands = totalCommandsMatch ? parseInt(totalCommandsMatch[1]) : 0

    // 获取并发请求数（从你的项目的 concurrency keys）
    const concurrencyKeys = await client.keys('concurrency:*')
    let totalConcurrent = 0

    for (const key of concurrencyKeys) {
      const count = await client.zcard(key)
      totalConcurrent += count
    }

    return {
      connectedClients,
      totalCommands,
      concurrentRequests: totalConcurrent
    }
  } catch (error) {
    logger.error('获取 Redis 指标失败:', error)
    return null
  }
}

async function getApplicationMetrics() {
  try {
    // 从你的 /metrics 端点获取数据
    const metricsUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/metrics`
      : 'http://localhost:3000/metrics'

    const response = await axios.get(metricsUrl, {
      timeout: 5000,
      headers: {
        'x-admin-key': config.security?.masterKey || ''
      }
    })

    return response.data
  } catch (error) {
    // 本地运行可能无法访问，不算错误
    return null
  }
}

async function calculateAverageResponseTime() {
  try {
    const client = redisClient.getClientSafe()

    // 从最近的请求日志中计算平均响应时间
    // 这里假设你在 Redis 中记录了响应时间
    const recentResponseTimes = await client.lrange('response_times:recent', 0, 99)

    if (recentResponseTimes.length === 0) {
      return null
    }

    const sum = recentResponseTimes.reduce((acc, time) => acc + parseFloat(time), 0)
    return Math.round((sum / recentResponseTimes.length) * 100) / 100
  } catch (error) {
    return null
  }
}

function generateScalingRecommendation(metrics) {
  const recommendations = []
  let overallStatus = 'ok'

  // 分析内存
  if (metrics.memory?.heapUsedPercent) {
    const memLevel = assessLevel(metrics.memory.heapUsedPercent, THRESHOLDS.memory)
    if (memLevel === 'critical') {
      recommendations.push({
        priority: 'HIGH',
        reason: `内存使用率 ${metrics.memory.heapUsedPercent}% 已达临界值`,
        action: '立即扩展：增加 Standard-2X dyno 或增加 dyno 数量'
      })
      overallStatus = 'critical'
    } else if (memLevel === 'warning') {
      recommendations.push({
        priority: 'MEDIUM',
        reason: `内存使用率 ${metrics.memory.heapUsedPercent}% 偏高`,
        action: '准备扩展：监控趋势，考虑增加 dyno 数量'
      })
      if (overallStatus !== 'critical') overallStatus = 'warning'
    }
  }

  // 分析响应时间
  if (metrics.responseTime) {
    const rtLevel = assessLevel(metrics.responseTime, THRESHOLDS.responseTime)
    if (rtLevel === 'critical') {
      recommendations.push({
        priority: 'HIGH',
        reason: `平均响应时间 ${metrics.responseTime}ms 过长`,
        action: '立即扩展：增加 dyno 数量进行负载分担'
      })
      overallStatus = 'critical'
    } else if (rtLevel === 'warning') {
      recommendations.push({
        priority: 'MEDIUM',
        reason: `平均响应时间 ${metrics.responseTime}ms 开始变慢`,
        action: '准备扩展：关注高峰时段性能'
      })
      if (overallStatus !== 'critical') overallStatus = 'warning'
    }
  }

  // 分析并发请求
  if (metrics.redis?.concurrentRequests) {
    const concLevel = assessLevel(metrics.redis.concurrentRequests, THRESHOLDS.concurrentRequests)
    if (concLevel === 'critical') {
      recommendations.push({
        priority: 'HIGH',
        reason: `并发请求数 ${metrics.redis.concurrentRequests} 接近极限`,
        action: '立即扩展：增加 dyno 数量以提升并发处理能力'
      })
      overallStatus = 'critical'
    } else if (concLevel === 'warning') {
      recommendations.push({
        priority: 'MEDIUM',
        reason: `并发请求数 ${metrics.redis.concurrentRequests} 偏高`,
        action: '准备扩展：预计流量增长，提前规划扩容'
      })
      if (overallStatus !== 'critical') overallStatus = 'warning'
    }
  }

  // 分析 Redis 连接数
  if (metrics.redis?.connectedClients) {
    // Heroku Redis Premium-0 大约支持 500 个连接
    const maxConnections = 500
    const connectionPercent = (metrics.redis.connectedClients / maxConnections) * 100
    const connLevel = assessLevel(connectionPercent, THRESHOLDS.redisConnections)

    if (connLevel === 'critical') {
      recommendations.push({
        priority: 'HIGH',
        reason: `Redis 连接数 ${metrics.redis.connectedClients}/${maxConnections} (${Math.round(connectionPercent)}%)`,
        action: '考虑升级 Redis 或优化连接池配置'
      })
      overallStatus = 'critical'
    } else if (connLevel === 'warning') {
      recommendations.push({
        priority: 'LOW',
        reason: `Redis 连接数 ${metrics.redis.connectedClients}/${maxConnections} (${Math.round(connectionPercent)}%)`,
        action: '监控连接数增长趋势'
      })
      if (overallStatus === 'ok') overallStatus = 'warning'
    }
  }

  return {
    status: overallStatus,
    recommendations
  }
}

function displayMetrics(metrics, recommendation) {
  console.log('\n' + colorize('━'.repeat(70), 'cyan'))
  console.log(
    colorize('📊 Heroku 扩展监控报告', 'bold') +
      colorize(` - ${new Date().toLocaleString('zh-CN')}`, 'blue')
  )
  console.log(colorize('━'.repeat(70), 'cyan'))

  // 系统状态
  const statusEmoji = getStatusEmoji(recommendation.status)
  const statusText =
    recommendation.status === 'ok'
      ? colorize('正常', 'green')
      : recommendation.status === 'warning'
        ? colorize('警告', 'yellow')
        : colorize('严重', 'red')

  console.log(`\n${statusEmoji} 系统状态: ${statusText}\n`)

  // 内存指标
  if (metrics.memory) {
    console.log(colorize('💾 内存使用:', 'cyan'))
    console.log(`   堆内存: ${metrics.memory.heapUsed}MB / ${metrics.memory.heapTotal}MB`)
    if (metrics.memory.heapUsedPercent) {
      const memLevel = assessLevel(metrics.memory.heapUsedPercent, THRESHOLDS.memory)
      const memColor = memLevel === 'ok' ? 'green' : memLevel === 'warning' ? 'yellow' : 'red'
      console.log(`   使用率: ${colorize(`${metrics.memory.heapUsedPercent}%`, memColor)}`)
    }
    console.log(`   RSS: ${metrics.memory.rss}MB\n`)
  }

  // Redis 指标
  if (metrics.redis) {
    console.log(colorize('🔴 Redis 指标:', 'cyan'))
    console.log(`   连接数: ${metrics.redis.connectedClients}`)
    console.log(`   总命令数: ${metrics.redis.totalCommands.toLocaleString()}`)
    console.log(`   当前并发: ${metrics.redis.concurrentRequests}\n`)
  }

  // 响应时间
  if (metrics.responseTime) {
    console.log(colorize('⏱️  性能指标:', 'cyan'))
    const rtLevel = assessLevel(metrics.responseTime, THRESHOLDS.responseTime)
    const rtColor = rtLevel === 'ok' ? 'green' : rtLevel === 'warning' ? 'yellow' : 'red'
    console.log(`   平均响应时间: ${colorize(`${metrics.responseTime}ms`, rtColor)}\n`)
  }

  // 扩展建议
  if (recommendation.recommendations.length > 0) {
    console.log(colorize('💡 扩展建议:', 'yellow'))
    recommendation.recommendations.forEach((rec, index) => {
      const priorityColor =
        rec.priority === 'HIGH' ? 'red' : rec.priority === 'MEDIUM' ? 'yellow' : 'blue'
      console.log(
        `\n   ${index + 1}. ${colorize(`[${rec.priority}]`, priorityColor)} ${rec.reason}`
      )
      console.log(`      → ${rec.action}`)
    })
  } else {
    console.log(colorize('✅ 当前性能良好，无需扩展', 'green'))
  }

  console.log('\n' + colorize('━'.repeat(70), 'cyan'))

  // 快速扩展命令
  if (recommendation.status !== 'ok') {
    console.log(colorize('\n🚀 快速扩展命令:', 'bold'))
    console.log(colorize('   # 扩展到 2 个 dyno', 'blue'))
    console.log('   heroku ps:scale web=2:standard-1x -a your-app-name')
    console.log(colorize('\n   # 扩展到 3 个 dyno', 'blue'))
    console.log('   heroku ps:scale web=3:standard-1x -a your-app-name')
    console.log(colorize('\n   # 升级到更大内存', 'blue'))
    console.log('   heroku ps:type web=standard-2x -a your-app-name')
    console.log('')
  }
}

async function main() {
  try {
    console.log(colorize('\n🔍 正在收集系统指标...', 'blue'))

    // 收集指标
    const memory = await getMemoryUsage()
    const redis = await getRedisMetrics()
    const responseTime = await calculateAverageResponseTime()
    const appMetrics = await getApplicationMetrics()

    // 计算内存使用率
    const heapUsedPercent = Math.round((memory.heapUsed / memory.heapTotal) * 100)

    const metrics = {
      memory: {
        ...memory,
        heapUsedPercent
      },
      redis,
      responseTime,
      appMetrics
    }

    // 生成建议
    const recommendation = generateScalingRecommendation(metrics)

    // 显示结果
    displayMetrics(metrics, recommendation)

    // 记录到日志
    logger.info('Scaling metrics collected', {
      status: recommendation.status,
      metrics: {
        memoryPercent: heapUsedPercent,
        responseTime,
        concurrentRequests: redis?.concurrentRequests
      },
      recommendationsCount: recommendation.recommendations.length
    })

    // 退出码
    process.exit(recommendation.status === 'critical' ? 1 : 0)
  } catch (error) {
    console.error(colorize('❌ 监控脚本执行失败:', 'red'), error.message)
    logger.error('Scaling monitor error:', error)
    process.exit(1)
  } finally {
    // 关闭 Redis 连接
    try {
      await redisClient.quit()
    } catch (e) {
      // ignore
    }
  }
}

// 如果直接运行
if (require.main === module) {
  main()
}

module.exports = { main }
