<template>
  <div class="ai-assistant-page">
    <!-- 左侧栏 -->
    <ChatSidebar
      :scenarios="scenarios"
      :selected-scenario="selectedScenario"
      :llm-configs="llmConfigs"
      :selected-llm-config="selectedLlmConfig"
      :histories="histories"
      :selected-history="selectedHistory"
      @scenario-change="handleScenarioChange"
      @llm-change="handleLlmChange"
      @history-change="handleHistoryChange"
      @create-history="handleCreateHistory"
    />
    <!-- 右侧对话区域 -->
    <ChatContent
      v-if="selectedScenario && selectedHistory"
      :messages="messages"
      :is-chatting="isChatting"
      @send-message="handleSendMessage"
      @regenerate="handleRegenerate"
      @pop-message="handlePopMessage"
      @stop-chat="handleStopChat"
    />
    <!-- 未选择提示 -->
    <div class="placeholder" v-else>
      <el-empty description="请选择场景并新建对话" />
    </div>
  </div>
</template>

<script>
import ChatSidebar from './ChatSidebar.vue';
import ChatContent from './ChatContent.vue';
import { ElMessage } from 'element-plus';

export default {
  name: 'AiAssistantPage',
  emits: ['navigate'],
  components: { ChatSidebar, ChatContent },
  props: {
    initialMessage: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      scenarios: [],
      selectedScenario: '',
      llmConfigs: [],
      selectedLlmConfig: '',
      histories: [],
      selectedHistory: '',
      messages: [],
      isChatting: false,
    };
  },
  async mounted() {
    await this.loadLlmConfigs();
    await this.loadScenarios();

    // 监听对话流式事件
    window.electron.ipcRendererOn('qtian:ai:chat-chunk', this.onChatChunk);
    window.electron.ipcRendererOn('qtian:ai:chat-complete', this.onChatComplete);
    window.electron.ipcRendererOn('qtian:ai:chat-error', this.onChatError);

    // 若从首页携带了初始消息，自动创建对话并发送
    if (this.initialMessage) {
      await this.handleInitialMessage(this.initialMessage);
    }
  },
  unmounted() {
    window.electron.ipcRendererOff('qtian:ai:chat-chunk', this.onChatChunk);
    window.electron.ipcRendererOff('qtian:ai:chat-complete', this.onChatComplete);
    window.electron.ipcRendererOff('qtian:ai:chat-error', this.onChatError);
  },
  methods: {
    /**
     * 处理从首页传入的初始消息：选择默认场景、创建对话并发送消息
     * @param {string} message - 用户输入的初始消息
     */
    async handleInitialMessage(message) {
      if (!message || this.scenarios.length === 0) return;

      // 选择默认场景（第一个场景）
      this.selectedScenario = this.scenarios[0];
      await this.loadHistories();

      // 创建新对话，以消息内容作为标题（截取前 20 个字符）
      const title = message.length > 20 ? message.substring(0, 20) + '...' : message;
      await this.handleCreateHistory(title);

      // 发送初始消息
      await this.handleSendMessage(message);
    },

    async loadLlmConfigs() {
      try {
        this.llmConfigs = await window.aiAssistant.listLlmConfigs();
        if (this.llmConfigs.length > 0 && !this.selectedLlmConfig) {
          this.selectedLlmConfig = this.llmConfigs[0];
        }
      } catch (err) {
        console.error('加载 LLM 配置失败:', err);
      }
    },
    async loadScenarios() {
      try {
        this.scenarios = await window.aiAssistant.listScenarios();
      } catch (err) {
        console.error('加载场景失败:', err);
      }
    },
    async handleScenarioChange(scenarioId) {
      this.selectedScenario = scenarioId;
      this.selectedHistory = '';
      this.messages = [];
      await this.loadHistories();
    },
    async handleLlmChange(configName) {
      this.selectedLlmConfig = configName;
      if (this.selectedScenario && this.selectedHistory) {
        await this.initChat();
      }
    },
    async handleHistoryChange(historyId) {
      this.selectedHistory = historyId;
      await this.initChat();
    },
    async handleCreateHistory(historyTitle) {
      if (!this.selectedScenario || !historyTitle) return;

      try {
        const historyId = `chat_${Date.now()}`;
        const historyData = {
          id: historyId,
          scenario_id: this.selectedScenario,
          title: historyTitle,
          messages: [],
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        await window.aiAssistant.createHistory(this.selectedScenario, historyId, historyData);
        await this.loadHistories();
        this.selectedHistory = historyId;
        await this.initChat();
      } catch (err) {
        console.error('创建对话失败:', err);
      }
    },
    async loadHistories() {
      if (!this.selectedScenario) return;

      try {
        this.histories = await window.aiAssistant.listHistories(this.selectedScenario);
      } catch (err) {
        console.error('加载对话历史失败:', err);
      }
    },
    async initChat() {
      try {
        await window.aiAssistant.initChat(
          this.selectedScenario,
          this.selectedHistory,
          this.selectedLlmConfig
        );
        this.messages = await window.aiAssistant.getMessages(
          this.selectedScenario,
          this.selectedHistory
        );
      } catch (err) {
        console.error('初始化对话失败:', err);
      }
    },
    async handleSendMessage(message) {
      if (!message.trim()) return;

      // 乐观更新：立即显示用户消息，无需等待 IPC 往返
      this.messages.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });
      this.isChatting = true;

      try {
        await window.aiAssistant.chatMessage(
          this.selectedScenario,
          this.selectedHistory,
          message
        );
      } catch (err) {
        this.isChatting = false;
        console.error('发送消息失败:', err);
      }
    },
    async handleRegenerate() {
      this.isChatting = true;
      try {
        await window.aiAssistant.regenerate(this.selectedScenario, this.selectedHistory);
      } catch (err) {
        this.isChatting = false;
        console.error('重新生成失败:', err);
      }
    },
    async handleStopChat() {
      try {
        await window.aiAssistant.stopChat(this.selectedScenario, this.selectedHistory);
        this.isChatting = false;
      } catch (err) {
        console.error('停止对话失败:', err);
      }
    },
    async handlePopMessage() {
      try {
        await window.aiAssistant.popMessage(this.selectedScenario, this.selectedHistory);
        this.messages = await window.aiAssistant.getMessages(
          this.selectedScenario,
          this.selectedHistory
        );
      } catch (err) {
        console.error('回退失败:', err);
      }
    },
    onChatChunk({ chunk }) {
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
        lastMsg.content += chunk;
      } else {
        this.messages.push({
          role: 'assistant',
          content: chunk,
          timestamp: Date.now(),
        });
      }
      this.$emit('scroll-to-bottom');
    },
    onChatComplete({ messages }) {
      this.messages = messages;
      this.isChatting = false;
      this.$emit('scroll-to-bottom');
    },
    onChatError({ error }) {
      this.isChatting = false;
      console.error('AI 对话出错:', error);
      ElMessage.error(error || 'AI 对话出错');
    },
  },
};
</script>

<style scoped>
.ai-assistant-page {
  display: flex;
  height: 100vh;
  background: #f8f9fa;
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
