<template>
  <component
    :is="currentComponent"
    @navigate="handleNavigate"
    :initial-message="initialMessage"
    :initial-scenario-id="initialScenarioId"
    :initial-llm-config="initialLlmConfig"
  />
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
      pendingMessage: '',
      pendingScenarioId: '',
      pendingLlmConfig: '',
    };
  },

  computed: {
    /**
     * 仅在切换到 AiAssistantPage 时传递初始消息
     */
    initialMessage() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingMessage : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递初始场景 ID
     */
    initialScenarioId() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingScenarioId : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递初始模型配置
     */
    initialLlmConfig() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingLlmConfig : '';
    },
  },

  methods: {
    /**
     * 切换到首页
     */
    switchToHomepage() {
      this.currentComponent = 'Homepage';
      this.pendingMessage = '';
      this.pendingScenarioId = '';
      this.pendingLlmConfig = '';
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
          this.pendingMessage = params?.message || '';
          this.pendingScenarioId = params?.scenarioId || '';
          this.pendingLlmConfig = params?.llmConfig || '';
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
