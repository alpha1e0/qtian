<template>
  <div class="ai-assistant-page">
    <!-- 模拟标题栏（frameless 窗口） -->
    <TitleBar />

    <div class="ai-assistant-body">
      <!-- 左侧栏：仅对话历史列表 -->
      <ChatSidebar
      v-if="selectedAgent"
      :histories="historySummaries"
      :selected-history="selectedHistory"
      @history-change="handleHistoryChange"
      @create-history="handleCreateHistory"
    />

    <!-- 右侧主区域 -->
    <div class="main-container" v-if="selectedAgent">
      <!-- 消息列表（有历史时显示） -->
      <ChatContent
        v-if="selectedHistory"
        ref="chatContentRef"
        :messages="messages"
        :is-chatting="isChatting"
        :agent-name="currentAgentName"
        :llm-config-name="currentLlmConfigDisplayName"
        @edit-message="handleEditMessage"
        @delete-message="handleDeleteMessage"
        @regenerate="handleRegenerate"
      />
      <!-- 未选择历史时的提示 -->
      <div class="placeholder-inner" v-else>
        <el-empty description="请新建对话或选择已有对话" />
      </div>
      <!-- 输入区域 -->
      <ChatInput
        :agents="agentObjects"
        :selected-agent="selectedAgent"
        :llm-configs="llmConfigObjects"
        :selected-llm-config="selectedLlmConfig"
        :is-chatting="isChatting"
        @send-message="handleSendMessage"
        @agent-change="handleAgentChange"
        @llm-change="handleLlmChange"
        @stop-chat="handleStopChat"
      />
    </div>

    <!-- 未选择提示 -->
      <div class="placeholder" v-else>
        <el-empty description="请选择Agent并新建对话" />
      </div>
    </div>
  </div>
</template>

<script>
import ChatSidebar from './ChatSidebar.vue';
import ChatContent from './ChatContent.vue';
import ChatInput from './ChatInput.vue';
import TitleBar from '../common/TitleBar.vue';
import { ElMessage } from 'element-plus';

export default {
  name: 'AiAssistantPage',
  emits: ['navigate'],
  components: { ChatSidebar, ChatContent, ChatInput, TitleBar },
  props: {
    initialMessage: {
      type: String,
      default: '',
    },
    initialAgentId: {
      type: String,
      default: '',
    },
    initialLlmConfig: {
      type: String,
      default: '',
    },
    /** 从快捷模式转换来时携带的历史 ID */
    initialHistoryId: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      agents: [],
      agentObjects: [],
      selectedAgent: '',
      llmConfigs: [],
      llmConfigObjects: [],
      selectedLlmConfig: '',
      historySummaries: [],
      selectedHistory: '',
      messages: [],
      isChatting: false,
    };
  },
  computed: {
    /** 当前选中 Agent 的名称 */
    currentAgentName() {
      const agent = this.agentObjects.find((a) => a.name === this.selectedAgent);
      return agent ? agent.alias || agent.name : '';
    },
    /** 当前选中 LLM 配置的展示名称 (alias > model) */
    currentLlmConfigDisplayName() {
      const config = this.llmConfigObjects.find((c) => c._configName === this.selectedLlmConfig);
      return config ? (config.alias || config.model) : '';
    },
  },
  async mounted() {
    await this.loadLlmConfigs();
    await this.loadAgents();

    // 选择 Agent：传入参数 > qtian.json default_agent > 列表第一个
    if (this.initialAgentId && this.agents.includes(this.initialAgentId)) {
      this.selectedAgent = this.initialAgentId;
    } else if (this.agents.length > 0 && !this.selectedAgent) {
      const appConfig = await window.electron.getConfig();
      const defaultAgent = appConfig?.aiAssistant?.defaultAgent;
      if (defaultAgent && this.agents.includes(defaultAgent)) {
        this.selectedAgent = defaultAgent;
      } else {
        this.selectedAgent = this.agents[0];
      }
    }

    // 若从首页传入了模型配置，优先使用
    if (this.initialLlmConfig && this.llmConfigs.includes(this.initialLlmConfig)) {
      this.selectedLlmConfig = this.initialLlmConfig;
    }

    if (this.selectedAgent) {
      await this.loadHistorySummaries();
    }

    // 若从快捷模式转来携带了历史 ID，直接选中该历史
    if (this.initialHistoryId) {
      this.selectedHistory = this.initialHistoryId;
      await this.initChat();
    }

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
     * 处理从首页传入的初始消息：选择默认 Agent、创建对话并发送消息
     * @param {string} message - 用户输入的初始消息
     */
    async handleInitialMessage(message) {
      if (!message || this.agents.length === 0) return;

      // 使用已选中的 Agent（可能来自首页传入的 initialAgentId）
      if (!this.selectedAgent) {
        this.selectedAgent = this.agents[0];
      }
      await this.loadHistorySummaries();

      // 创建新对话，以消息内容作为标题（截取前 20 个字符）
      const title = message.length > 10 ? message.substring(0, 10) + '...' : message;
      await this.handleCreateHistory(title);

      // 发送初始消息
      await this.handleSendMessage(message);
    },

    async loadLlmConfigs() {
      try {
        this.llmConfigs = await window.aiAssistant.listLlmConfigs();
        // 加载每个 LLM 配置的完整对象（包含 alias、model），供下拉列表展示
        this.llmConfigObjects = await Promise.all(
          this.llmConfigs.map(async (name) => {
            try {
              const config = await window.aiAssistant.getLlmConfig(name);
              // 附加配置文件名作为内部标识
              return { ...config, _configName: name };
            } catch {
              return { _configName: name, model: name };
            }
          })
        );
        if (this.llmConfigs.length > 0 && !this.selectedLlmConfig) {
          // 优先使用 qtian.json 中配置的 default_llm_config
          const appConfig = await window.electron.getConfig();
          const defaultConfig = appConfig?.aiAssistant?.defaultLlmConfig;
          if (defaultConfig && this.llmConfigs.includes(defaultConfig)) {
            this.selectedLlmConfig = defaultConfig;
          } else {
            this.selectedLlmConfig = this.llmConfigs[0];
          }
        }
      } catch (err) {
        console.error('加载 LLM 配置失败:', err);
      }
    },
    async loadAgents() {
      try {
        this.agents = await window.aiAssistant.listAgents();
        // 加载每个 Agent 的完整对象（包含 name），供 ChatInput 和 ChatMessage 使用
        this.agentObjects = await Promise.all(
          this.agents.map(async (id) => {
            try {
              return await window.aiAssistant.getAgent(id);
            } catch {
              return { name: id, description: id, tools: [], instructions: '' };
            }
          })
        );
      } catch (err) {
        console.error('加载Agent失败:', err);
      }
    },
    async handleAgentChange(agentId) {
      this.selectedAgent = agentId;
      this.selectedHistory = '';
      this.messages = [];
      await this.loadHistorySummaries();
    },
    async handleLlmChange(configName) {
      this.selectedLlmConfig = configName;
      if (this.selectedAgent && this.selectedHistory) {
        await this.initChat();
      }
    },
    async handleHistoryChange(historyId) {
      this.selectedHistory = historyId;
      await this.initChat();
    },
    async handleCreateHistory(historyTitle) {
      if (!this.selectedAgent) return;

      // 未提供标题时使用默认值
      const title = historyTitle || '新对话';

      try {
        const historyId = `chat_${Date.now()}`;
        const historyData = {
          id: historyId,
          agent_id: this.selectedAgent,
          title: title,
          messages: [],
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        await window.aiAssistant.createHistory(this.selectedAgent, historyId, historyData);
        await this.loadHistorySummaries();
        this.selectedHistory = historyId;
        await this.initChat();
      } catch (err) {
        console.error('创建对话失败:', err);
      }
    },
    async loadHistorySummaries() {
      if (!this.selectedAgent) return;

      try {
        this.historySummaries = await window.aiAssistant.listHistorySummaries(this.selectedAgent);
      } catch (err) {
        console.error('加载对话历史摘要失败:', err);
        this.historySummaries = [];
      }
    },
    async initChat() {
      try {
        await window.aiAssistant.initChat(
          this.selectedAgent,
          this.selectedHistory,
          this.selectedLlmConfig
        );
        this.messages = await window.aiAssistant.getMessages(
          this.selectedAgent,
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
          this.selectedAgent,
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
        await window.aiAssistant.regenerate(this.selectedAgent, this.selectedHistory);
      } catch (err) {
        this.isChatting = false;
        console.error('重新生成失败:', err);
      }
    },
    async handleStopChat() {
      try {
        await window.aiAssistant.stopChat(this.selectedAgent, this.selectedHistory);
        this.isChatting = false;
      } catch (err) {
        console.error('停止对话失败:', err);
      }
    },
    /**
     * 编辑指定消息的内容并持久化
     * @param {number} displayIndex - 消息在 displayMessages 中的索引
     * @param {string} newContent - 新的消息内容
     */
    async handleEditMessage(displayIndex, newContent) {
      // displayIndex 是过滤后 (不含 system/tool) 的索引，需要映射到原始 messages 索引
      const originalIndex = this.getOriginalMessageIndex(displayIndex);
      if (originalIndex < 0) return;

      this.messages[originalIndex].content = newContent;
      this.messages[originalIndex].timestamp = Date.now();

      // 持久化保存
      await this.persistMessages();
    },
    /**
     * 删除指定消息并持久化
     * @param {number} displayIndex - 消息在 displayMessages 中的索引
     */
    async handleDeleteMessage(displayIndex) {
      const originalIndex = this.getOriginalMessageIndex(displayIndex);
      if (originalIndex < 0) return;

      this.messages.splice(originalIndex, 1);
      await this.persistMessages();
    },
    /**
     * 将 displayMessages 索引映射到原始 messages 数组索引
     * displayMessages 过滤掉了 system 和 tool 消息
     */
    getOriginalMessageIndex(displayIndex) {
      let displayCount = 0;
      for (let i = 0; i < this.messages.length; i++) {
        const msg = this.messages[i];
        if (msg.role !== 'system' && msg.role !== 'tool') {
          if (displayCount === displayIndex) return i;
          displayCount++;
        }
      }
      return -1;
    },
    /**
     * 将当前消息列表持久化到历史文件
     */
    async persistMessages() {
      try {
        const history = await window.aiAssistant.getHistory(
          this.selectedAgent,
          this.selectedHistory
        );
        history.messages = this.messages;
        history.updated_at = Date.now();
        await window.aiAssistant.saveHistory(
          this.selectedAgent,
          this.selectedHistory,
          history
        );
        // 刷新侧边栏摘要
        await this.loadHistorySummaries();
      } catch (err) {
        console.error('保存消息失败:', err);
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
    },
    async onChatComplete({ messages }) {
      this.messages = messages;
      this.isChatting = false;
      // 刷新侧边栏摘要（标题可能已由后端自动重命名）
      await this.loadHistorySummaries();
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
  flex-direction: column;
  height: 100vh;
  background: #f8f9fa;
  border-radius: 8px;
  overflow: hidden;
}

.ai-assistant-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-inner {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
