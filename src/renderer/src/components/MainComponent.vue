<template>
  <component :is="currentComponent" @navigate="handleNavigate" />
</template>

<script>
import Homepage from './homepage/Homepage.vue';
import AiAssistantPage from './ai-assistant/AiAssistantPage.vue';

export default {
  name: 'MainComponent',

  components: {
    Homepage,
    AiAssistantPage,
  },

  data() {
    return {
      currentComponent: 'Homepage',
    };
  },

  methods: {
    /**
     * 切换到首页
     */
    switchToHomepage() {
      this.currentComponent = 'Homepage';
    },

    /**
     * 切换到 AI 助手
     */
    switchToAiAssistant() {
      this.currentComponent = 'AiAssistantPage';
    },

    /**
     * 处理来自子组件的导航请求
     * @param {string} target - 目标组件名称
     * @param {object} params - 导航参数
     */
    handleNavigate(target, params) {
      console.log('导航到:', target, params);
      switch (target) {
        case 'homepage':
          this.switchToHomepage();
          break;
        case 'ai-assistant':
          this.switchToAiAssistant();
          break;
        default:
          console.warn('未知的导航目标:', target);
      }
    },

    /**
     * 处理键盘快捷键
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.altKey) {
        if (event.key == 'h') {
          this.switchToHomepage();
        }
        if (event.key == 'a') {
          this.switchToAiAssistant();
        }
      }
    },
  },

  mounted() {
    window.electron.ipcRendererOn('switch-to-homepage', this.switchToHomepage);
    window.electron.ipcRendererOn('switch-to-aiassistant', this.switchToAiAssistant);

    document.addEventListener('keydown', this.handleKeyDown);
  },

  unmounted() {
    window.electron.ipcRendererOff('switch-to-homepage', this.switchToHomepage);
    window.electron.ipcRendererOff('switch-to-aiassistant', this.switchToAiAssistant);

    document.removeEventListener('keydown', this.handleKeyDown);
  },
};
</script>
