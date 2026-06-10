<template>
  <div class="chat-content">
    <!-- 消息展示区域 -->
    <div class="messages-container" ref="messagesContainer">
      <div v-for="(msg, idx) in displayMessages" :key="idx" :class="getMessageClass(msg.role)">
        <ChatMessage
          :message="msg"
          :message-index="idx"
          :all-messages="messages"
          :agent-name="agentName"
          :llm-config-name="llmConfigName"
          @edit-message="(index, content) => $emit('edit-message', index, content)"
          @delete-message="(index) => $emit('delete-message', index)"
          @regenerate="$emit('regenerate')"
        />
      </div>
      <!-- 加载指示器 -->
      <div v-if="isChatting" class="loading-indicator">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
    </div>
  </div>
</template>

<script>
import { Loading } from '@element-plus/icons-vue';
import ChatMessage from './ChatMessage.vue';

export default {
  name: 'ChatContent',
  components: { ChatMessage, Loading },
  props: {
    messages: { type: Array, default: () => [] },
    isChatting: { type: Boolean, default: false },
    agentName: { type: String, default: '' },
    llmConfigName: { type: String, default: '' },
  },
  emits: ['edit-message', 'delete-message', 'regenerate'],
  computed: {
    /** 过滤掉 system 和 tool 消息，只展示给用户 */
    displayMessages() {
      return this.messages.filter((msg) => msg.role !== 'system' && msg.role !== 'tool');
    },
  },
  methods: {
    getMessageClass(role) {
      if (role === 'user') return 'message user-message';
      if (role === 'assistant') return 'message assistant-message';
      return 'message';
    },
    /**
     * 滚动消息列表到底部
     */
    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.messagesContainer;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
  },
  watch: {
    messages: {
      deep: true,
      handler() {
        this.scrollToBottom();
      },
    },
  },
};
</script>

<style scoped>
.chat-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  background:
    radial-gradient(ellipse at 15% 30%, rgba(99, 102, 241, 0.025) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 70%, rgba(139, 92, 246, 0.02) 0%, transparent 50%),
    var(--surface-base);
}

.message {
  margin-bottom: 20px;
  max-width: 80%;
  animation: messageSlideIn 0.3s ease-out;
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.user-message {
  margin-left: auto;
}

.assistant-message {
  margin-right: auto;
}

.loading-indicator {
  text-align: center;
  padding: 16px;
  color: var(--accent);
  font-size: 18px;
}
</style>
