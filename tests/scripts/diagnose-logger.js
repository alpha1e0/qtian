/**
 * Logger 文件日志诊断脚本
 *
 * 用于测试 logger 的文件日志功能是否正常工作
 */

const path = require('path');
const fs = require('fs');

// 模拟测试环境
process.env.QTIAN_WORKSPACE = path.join(__dirname, '../resource/workspace');
process.env.NODE_ENV = 'production';
process.env.IS_TEST = 'true';

console.log('========================================');
console.log('Logger 文件日志诊断');
console.log('========================================');
console.log('工作目录:', process.env.QTIAN_WORKSPACE);
console.log('');

// 测试 1: 检查日志目录
const logDir = path.join(process.env.QTIAN_WORKSPACE, 'log');
console.log('测试 1: 检查日志目录');
console.log('  日志目录路径:', logDir);

try {
  fs.accessSync(logDir);
  console.log('  ✅ 日志目录存在');
} catch (err) {
  console.log('  ❌ 日志目录不存在，尝试创建...');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    console.log('  ✅ 日志目录创建成功');
  } catch (createErr) {
    console.log('  ❌ 无法创建日志目录:', createErr.message);
    process.exit(1);
  }
}

// 测试 2: 检查目录权限
console.log('');
console.log('测试 2: 检查目录权限');
try {
  fs.accessSync(logDir, fs.constants.W_OK);
  console.log('  ✅ 日志目录可写');
} catch (err) {
  console.log('  ❌ 日志目录不可写:', err.message);
}

// 测试 3: 尝试直接写入日志文件
console.log('');
console.log('测试 3: 直接写入日志文件');
const testLogFile = path.join(logDir, 'test-diagnostic.log');
const testContent = `[
  {"timestamp":"${new Date().toISOString()}","level":"INFO","category":"test","message":"Test log entry"}
]\n`;

try {
  fs.writeFileSync(testLogFile, testContent, 'utf-8');
  console.log('  ✅ 成功写入测试日志文件');

  // 验证写入
  const content = fs.readFileSync(testLogFile, 'utf-8');
  console.log('  ✅ 验证写入成功，内容长度:', content.length);

  // 清理测试文件
  fs.unlinkSync(testLogFile);
  console.log('  ✅ 测试文件已清理');
} catch (err) {
  console.log('  ❌ 写入失败:', err.message);
  console.log('     错误详情:', err);
}

// 测试 4: 测试异步写入
console.log('');
console.log('测试 4: 异步写入测试');
const asyncTestFile = path.join(logDir, 'async-test.log');

fs.promises.writeFile(asyncTestFile, testContent, 'utf-8')
  .then(() => {
    console.log('  ✅ 异步写入成功');

    // 读取验证
    return fs.promises.readFile(asyncTestFile, 'utf-8');
  })
  .then((content) => {
    console.log('  ✅ 异步读取验证成功，内容长度:', content.length);

    // 清理
    return fs.promises.unlink(asyncTestFile);
  })
  .then(() => {
    console.log('  ✅ 测试文件已清理');

    console.log('');
    console.log('========================================');
    console.log('诊断完成');
    console.log('========================================');
  })
  .catch((err) => {
    console.log('  ❌ 异步操作失败:', err.message);
    console.log('     错误详情:', err);
  });
