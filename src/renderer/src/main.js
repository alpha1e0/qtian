import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';

import App from './App.vue';
import {
  initConsoleInterceptor,
  setupGlobalErrorHandler,
  setupVueErrorHandler,
} from './utils/error-handler';

// 初始化 Console 拦截器（仅 dev 模式）
initConsoleInterceptor();

// 设置全局错误处理器
setupGlobalErrorHandler();

const app = createApp(App);

// 设置 Vue 错误处理器
setupVueErrorHandler(app);

// 注册 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(ElementPlus);
app.mount('#app');
