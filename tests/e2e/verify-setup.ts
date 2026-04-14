/**
 * Playwright设置验证脚本
 * 运行此脚本以验证Playwright测试环境是否正确配置
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 验证Playwright测试环境...\n');

const checks = [];

// 检查1: 依赖是否安装
const packageJsonPath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const hasPlaywright = packageJson.devDependencies && (
  packageJson.devDependencies['@playwright/test'] ||
  packageJson.devDependencies['playwright']
);

checks.push({
  name: 'Playwright依赖',
  status: hasPlaywright ? '✅' : '❌',
  message: hasPlaywright ? '已安装' : '未安装，请运行: npm install -D @playwright/test playwright'
});

// 检查2: 配置文件
const configFiles = [
  'tests/e2e/playwright.config.ts',
  'tests/e2e/tsconfig.json',
  'tests/e2e/fixtures/app.fixture.ts',
  'tests/e2e/helpers/electron-helper.ts'
];

configFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, '../..', file));
  checks.push({
    name: `配置文件 ${file}`,
    status: exists ? '✅' : '❌',
    message: exists ? '存在' : '不存在'
  });
});

// 检查3: 测试文件
const testFiles = [
  'tests/e2e/smoke/app.spec.ts',
  'tests/e2e/smoke/navigation.spec.ts',
  'tests/e2e/smoke/modules.spec.ts',
  'tests/e2e/smoke/basic.spec.ts'
];

testFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, '../..', file));
  checks.push({
    name: `测试文件 ${file}`,
    status: exists ? '✅' : '❌',
    message: exists ? '存在' : '不存在'
  });
});

// 检查4: npm脚本
const scripts = packageJson.scripts || {};
const requiredScripts = [
  'test:e2e',
  'test:e2e:ui',
  'test:e2e:debug',
  'test:smoke'
];

requiredScripts.forEach(script => {
  const exists = scripts[script];
  checks.push({
    name: `npm脚本 ${script}`,
    status: exists ? '✅' : '❌',
    message: exists ? '已配置' : '未配置'
  });
});

// 检查5: .gitignore
const gitignorePath = path.join(__dirname, '../../.gitignore');
const gitignore = fs.readFileSync(gitignorePath, 'utf8');
const hasE2EIgnore = gitignore.includes('tests/e2e/test-results/') &&
                    gitignore.includes('tests/e2e/playwright-report/');

checks.push({
  name: '.gitignore配置',
  status: hasE2EIgnore ? '✅' : '❌',
  message: hasE2EIgnore ? '已配置E2E测试忽略规则' : '未配置E2E测试忽略规则'
});

// 输出结果
console.log('检查结果:');
console.log('='.repeat(50));

let allPassed = true;
checks.forEach(check => {
  console.log(`${check.status} ${check.name}: ${check.message}`);
  if (check.status === '❌') allPassed = false;
});

console.log('='.repeat(50));

if (allPassed) {
  console.log('\n✅ 所有检查通过！Playwright测试环境已正确配置。');
  console.log('\n📝 下一步:');
  console.log('1. 确保浏览器已安装: npx playwright install');
  console.log('2. 运行冒烟测试: npm run test:smoke');
  console.log('3. 或使用UI模式: npm run test:e2e:ui');
} else {
  console.log('\n❌ 部分检查未通过，请修复上述问题。');
  process.exit(1);
}

module.exports = { checks };
