#!/usr/bin/env node
/**
 * Redis 延迟测试工具
 * 用于比较不同 Redis 提供商的性能
 */

const Redis = require('ioredis')

// 测试配置
const redisConfigs = [
  {
    name: 'Heroku Redis',
    url: process.env.REDIS_URL || process.env.HEROKU_REDIS_URL,
    enabled: !!(process.env.REDIS_URL || process.env.HEROKU_REDIS_URL)
  },
  {
    name: 'Upstash Redis',
    url: process.env.UPSTASH_REDIS_URL,
    enabled: !!process.env.UPSTASH_REDIS_URL
  },
  {
    name: 'Redis Cloud',
    url: process.env.REDIS_CLOUD_URL,
    enabled: !!process.env.REDIS_CLOUD_URL
  }
]

async function testRedisLatency(name, url) {
  console.log(`\n🧪 测试 ${name}...`)
  console.log(`📍 URL: ${url.replace(/:[^:@]+@/, ':****@')}`)

  const client = new Redis(url, {
    lazyConnect: true,
    retryStrategy: () => null
  })

  try {
    // 连接测试
    const connectStart = Date.now()
    await client.connect()
    const connectTime = Date.now() - connectStart
    console.log(`✅ 连接时间: ${connectTime}ms`)

    // PING 测试（50次）
    const pingTimes = []
    for (let i = 0; i < 50; i++) {
      const start = Date.now()
      await client.ping()
      pingTimes.push(Date.now() - start)
    }

    const avgPing = (pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length).toFixed(2)
    const minPing = Math.min(...pingTimes)
    const maxPing = Math.max(...pingTimes)
    console.log(`📊 PING 延迟: 平均 ${avgPing}ms, 最小 ${minPing}ms, 最大 ${maxPing}ms`)

    // SET/GET 测试（50次）
    const setGetTimes = []
    for (let i = 0; i < 50; i++) {
      const start = Date.now()
      await client.set(`test:${i}`, `value-${i}`)
      await client.get(`test:${i}`)
      setGetTimes.push(Date.now() - start)
    }

    const avgSetGet = (setGetTimes.reduce((a, b) => a + b, 0) / setGetTimes.length).toFixed(2)
    console.log(`📊 SET+GET 延迟: 平均 ${avgSetGet}ms`)

    // 清理测试数据
    await client.del(...Array.from({ length: 50 }, (_, i) => `test:${i}`))

    await client.quit()
    return {
      name,
      success: true,
      connectTime,
      avgPing: parseFloat(avgPing),
      avgSetGet: parseFloat(avgSetGet),
      minPing,
      maxPing
    }
  } catch (error) {
    console.error(`❌ 错误: ${error.message}`)
    try {
      await client.quit()
    } catch (e) {
      // ignore
    }
    return {
      name,
      success: false,
      error: error.message
    }
  }
}

async function main() {
  console.log('=== Redis 延迟性能测试 ===')
  console.log('📝 请设置环境变量进行测试：')
  console.log('   REDIS_URL / HEROKU_REDIS_URL - Heroku Redis')
  console.log('   UPSTASH_REDIS_URL            - Upstash Redis')
  console.log('   REDIS_CLOUD_URL              - Redis Cloud')
  console.log('')

  const enabledConfigs = redisConfigs.filter((c) => c.enabled)

  if (enabledConfigs.length === 0) {
    console.log('⚠️  未找到任何 Redis 配置，请设置环境变量')
    process.exit(1)
  }

  const results = []
  for (const config of enabledConfigs) {
    const result = await testRedisLatency(config.name, config.url)
    results.push(result)
  }

  // 汇总结果
  console.log('\n\n=== 测试结果汇总 ===\n')

  const successResults = results.filter((r) => r.success)
  if (successResults.length > 0) {
    console.log('┌─────────────────────┬──────────┬──────────┬──────────────┐')
    console.log('│ Redis 提供商        │ 连接时间 │ 平均PING │ 平均SET+GET  │')
    console.log('├─────────────────────┼──────────┼──────────┼──────────────┤')

    successResults.forEach((r) => {
      const name = r.name.padEnd(19)
      const connect = `${r.connectTime}ms`.padEnd(8)
      const ping = `${r.avgPing}ms`.padEnd(8)
      const setget = `${r.avgSetGet}ms`.padEnd(12)
      console.log(`│ ${name} │ ${connect} │ ${ping} │ ${setget} │`)
    })

    console.log('└─────────────────────┴──────────┴──────────┴──────────────┘')

    // 推荐
    const fastest = successResults.reduce((min, r) => (r.avgPing < min.avgPing ? r : min))
    console.log(`\n🏆 推荐: ${fastest.name} (平均延迟 ${fastest.avgPing}ms)`)
  }

  const failedResults = results.filter((r) => !r.success)
  if (failedResults.length > 0) {
    console.log('\n❌ 失败的测试:')
    failedResults.forEach((r) => {
      console.log(`   • ${r.name}: ${r.error}`)
    })
  }

  console.log('\n💡 建议:')
  console.log('   • 生产环境延迟应 < 5ms（Heroku Redis 通常 < 1ms）')
  console.log('   • 外部 Redis 延迟 5-20ms 可接受（取决于区域匹配）')
  console.log('   • 延迟 > 50ms 会显著影响 API 响应速度')
}

main().catch(console.error)
