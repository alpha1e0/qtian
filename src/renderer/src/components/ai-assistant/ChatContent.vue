<template>
  <div class="chat-content">
    <!-- 消息展示区域 -->
    <div class="messages-container" ref="messagesContainer">
      <div v-for="(msg, idx) in displayMessages" :key="idx" :class="getMessageClass(msg.role)">
        <ChatMessage :message="msg" :all-messages="messages" />
      </div>
      <!-- 加载指示器 -->
      <div v-if="isChatting" class="loading-indicator">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-container">
      <el-input
        v-model="userInput"
        type="textarea"
        :rows="3"
        placeholder="输入消息... (Ctrl+Enter 发送)"
        @keydown.ctrl.enter.exact="handleSend"
        :disabled="isChatting"
        aria-label="消息输入框"
      />
      <div class="input-actions">
        <el-button @click="$emit('pop-message')" :disabled="isChatting || displayMessages.length === 0" size="small">
          回退
        </el-button>
        <el-button @click="$emit('regenerate')" :disabled="isChatting || displayMessages.length === 0" size="small">
          重新生成
        </el-button>
        <el-button
          v-if="isChatting"
          type="danger"
          @click="$emit('stop-chat')"
          size="small"
        >
          停止
        </el-button>
        <el-button v-else type="primary" @click="handleSend" size="small">
          发送
        </el-button>
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
  },
  emits: ['send-message', 'regenerate', 'pop-message', 'stop-chat'],
  data() {
    return {
      userInput: '',
    };
  },
  computed: {
    /** 过滤掉 system 和 tool 消息，只展示给用户 */
    displayMessages() {
      return this.messages.filter((msg) => msg.role !== 'system' && msg.role !== 'tool');
    },
  },
  methods: {
    handleSend() {
      if (!this.userInput.trim() || this.isChatting) return;
      const message = this.userInput;
      this.userInput = '';
      this.$emit('send-message', message);
      this.scrollToBottom();
    },
    getMessageClass(role) {
      if (role === 'user') return 'message user-message';
      if (role === 'assistant') return 'message assistant-message';
      return 'message';
    },
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
  height: 100vh;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #fafafa;
}

.message {
  margin-bottom: 16px;
  max-width: 80%;
}

.user-message {
  margin-left: auto;
}

.assistant-message {
  margin-right: auto;
}

.loading-indicator {
  text-align: center;
  padding: 10px;
  color: #999;
}

.input-container {
  padding: 16px 20px;
  border-top: 1px solid #e0e0e0;
  background: white;
}

.input-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
