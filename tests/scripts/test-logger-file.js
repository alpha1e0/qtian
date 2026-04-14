/**
 * 直接测试 Logger 的文件日志功能
 */

const path = require('path');

// 设置环境
process.env.QTIAN_WORKSPACE = path.join(__dirname, '../resource/workspace');
process.env.NODE_ENV = 'production';
process.env.IS_TEST = 'true';

console.log('========================================');
console.log('Logger 文件日志功能测试');
console.log('========================================');
console.log('工作目录:', process.env.QTIAN_WORKSPACE);

// 导入编译后的主进程代码
const mainCode = require('../../dist-electron/main/index.js');

// 由于代码被打包，我们无法直接导入 Logger 类
// 让我们通过运行主进程来测试
console.log('注意：代码已打包，无法单独测试 Logger');
console.log('需要通过实际运行应用来测试日志功能');

// 创建 logger 实例
const logger = new Logger('test-file-logging', LogLevel.INFO, true);

console.log('\n开始测试日志写入...\n');

// 写入几条日志
logger.info('测试日志 1');
logger.info('测试日志 2', { data: 'some data' });
logger.warn('警告日志');
logger.error('错误日志', new Error('测试错误'));

console.log('日志已写入，等待 1 秒...\n');

// 等待一下，确保文件写入完成
setTimeout(() => {
  const fs = require('fs');
  const logDir = path.join(process.env.QTIAN_WORKSPACE, 'log');

  console.log('检查日志目录:', logDir);

  try {
    const files = fs.readdirSync(logDir);
    console.log(`\n✅ 日志目录中的文件数: ${files.length}`);

    if (files.length > 0) {
      console.log('日志文件列表:');
      files.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f}`);

        // 读取并显示内容
        const filePath = path.join(logDir, f);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        console.log(`     内容 (${lines.length} 行):`);
        lines.slice(0, 5).forEach((line, j) => {
          try {
            const logEntry = JSON.parse(line);
            console.log(`       ${j + 1}. [${logEntry.level}] [${logEntry.category}] ${logEntry.message}`);
          } catch {
            console.log(`       ${j + 1}. ${line.substring(0, 80)}...`);
          }
        });
      });

      console.log('\n✅ Logger 文件日志功能正常!');
    } else {
      console.log('❌ 日志目录为空');
    }
  } catch (err) {
    console.error('❌ 错误:', err.message);
  }

  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
}, 1000);
