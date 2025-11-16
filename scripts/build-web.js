#!/usr/bin/env node

/**
 * 🏗️ Web 前端构建脚本
 * 自动读取 ADMIN_PATH 环境变量并传递给 Vite 构建
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// 读取配置
require('dotenv').config()

const adminPath = process.env.ADMIN_PATH || '/admin-next'

console.log('🏗️ Building Web Admin SPA...')
console.log(`📍 Admin Path: ${adminPath}`)

// 设置 Vite 环境变量
process.env.VITE_APP_BASE_URL = adminPath

// 切换到前端目录
const webDir = path.join(__dirname, '..', 'web', 'admin-spa')

// 检查前端目录是否存在
if (!fs.existsSync(webDir)) {
  console.error('❌ Web admin-spa directory not found!')
  console.error(`   Expected at: ${webDir}`)
  process.exit(1)
}

// 检查是否已安装依赖
const nodeModulesPath = path.join(webDir, 'node_modules')
if (!fs.existsSync(nodeModulesPath)) {
  console.log('📦 Installing dependencies...')
  try {
    execSync('npm install', { cwd: webDir, stdio: 'inherit' })
  } catch (error) {
    console.error('❌ Failed to install dependencies')
    process.exit(1)
  }
}

// 执行构建
try {
  console.log('🔨 Running build...')
  execSync('npm run build', {
    cwd: webDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_APP_BASE_URL: adminPath
    }
  })

  console.log('✅ Web build completed successfully!')
  console.log(`📦 Output directory: ${path.join(webDir, 'dist')}`)
  console.log(`🌐 Admin interface will be available at: ${adminPath}/`)
} catch (error) {
  console.error('❌ Build failed!')
  process.exit(1)
}
