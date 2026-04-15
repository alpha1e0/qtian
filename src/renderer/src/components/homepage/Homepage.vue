<template>
  <div class="homepage-container">
    <!-- 对话输入区域 -->
    <div class="chat-input-section">
      <el-input
        v-model="message"
        type="textarea"
        placeholder="输入你想问的问题..."
        class="chat-input"
        :autosize="{ minRows: 3, maxRows: 8 }"
        @keydown="handleKeyDown"
        aria-label="对话输入框"
      />
      <el-button
        type="primary"
        class="send-button"
        :disabled="!message.trim()"
        @click="handleSend"
        aria-label="发送"
      >
        发送
      </el-button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Homepage',

  emits: ['navigate'],

  data() {
    return {
      message: '',
    };
  },

  methods: {
    /**
     * 处理键盘事件，Ctrl+Enter 发送消息
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        this.handleSend();
      }
    },

    /**
     * 发送消息并跳转到 AI 助手页面
     */
    handleSend() {
      const trimmedMessage = this.message.trim();
      if (!trimmedMessage) return;

      this.$emit('navigate', 'ai-assistant', { message: trimmedMessage });
      this.message = '';
    },
  },
};
</script>

<style scoped>
.homepage-container {
  width: 100%;
  height: 100vh;
  padding: 40px;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 对话输入区域 */
.chat-input-section {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.chat-input {
  width: 100%;
}

.chat-input :deep(.el-textarea__inner) {
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  font-size: 16px;
  padding: 16px;
  resize: none;
}

.send-button {
  width: 120px;
  height: 40px;
  border-radius: 20px;
  font-size: 16px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .homepage-container {
    padding: 20px;
  }

  .chat-input-section {
    max-width: 100%;
  }
}
</style>
