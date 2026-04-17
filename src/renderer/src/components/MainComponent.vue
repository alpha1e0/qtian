<template>
  <component
    :is="currentComponent"
    @navigate="handleNavigate"
    :initial-message="initialMessage"
    :initial-agent-id="initialAgentId"
    :initial-llm-config="initialLlmConfig"
    :initial-history-id="initialHistoryId"
  />
</template>

<script>
import QuickModePage from './quick-mode/QuickModePage.vue';
import AiAssistantPage from './ai-assistant/AiAssistantPage.vue';

export default {
  name: 'MainComponent',

  components: {
    QuickModePage,
    AiAssistantPage,
  },

  data() {
    return {
      currentComponent: 'QuickModePage',
      pendingMessage: '',
      pendingAgentId: '',
      pendingLlmConfig: '',
      pendingHistoryId: '',
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
     * 仅在切换到 AiAssistantPage 时传递初始 Agent ID
     */
    initialAgentId() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingAgentId : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递初始模型配置
     */
    initialLlmConfig() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingLlmConfig : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递历史 ID（从快捷模式转来）
     */
    initialHistoryId() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingHistoryId : '';
    },
  },

  methods: {
    /**
     * 切换到快捷模式
     */
    switchToQuickMode() {
      this.currentComponent = 'QuickModePage';
      this.clearPending();
    },

    /**
     * 切换到 AI 助手（普通模式）
     */
    switchToAiAssistant() {
      this.currentComponent = 'AiAssistantPage';
    },

    /**
     * 清空待传递参数
     */
    clearPending() {
      this.pendingMessage = '';
      this.pendingAgentId = '';
      this.pendingLlmConfig = '';
      this.pendingHistoryId = '';
    },

    /**
     * 处理来自子组件的导航请求
     * @param {string} target - 目标组件名称
     * @param {object} params - 导航参数
     */
    handleNavigate(target, params) {
      console.log('导航到:', target, params);
      switch (target) {
        case 'quick-mode':
          this.switchToQuickMode();
          break;
        case 'ai-assistant':
          this.pendingMessage = params?.message || '';
          this.pendingAgentId = params?.agentId || '';
          this.pendingLlmConfig = params?.llmConfig || '';
          this.pendingHistoryId = params?.historyId || '';
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
        if (event.key === 'a') {
          this.switchToAiAssistant();
        }
      }
    },
  },

  mounted() {
    window.electron.ipcRendererOn('switch-to-quick-mode', this.switchToQuickMode);
    window.electron.ipcRendererOn('switch-to-aiassistant', this.switchToAiAssistant);

    document.addEventListener('keydown', this.handleKeyDown);
  },

  unmounted() {
    window.electron.ipcRendererOff('switch-to-quick-mode', this.switchToQuickMode);
    window.electron.ipcRendererOff('switch-to-aiassistant', this.switchToAiAssistant);

    document.removeEventListener('keydown', this.handleKeyDown);
  },
};
</script>
