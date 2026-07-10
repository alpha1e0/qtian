<template>
  <!--
    AI 任务悬浮按钮：固定在右下角。
    Phase 2 仅落库 task_prompt 字段（不接 TaskManager）。
    点击展开弹出框编辑任务描述。
  -->
  <div class="note-ai-task-fab">
    <transition name="ai-panel">
      <div v-if="panelVisible" class="ai-task-panel">
        <div class="panel-header">
          <span class="panel-title">AI 任务</span>
          <el-button text size="small" class="panel-close" @click="panelVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div class="panel-body">
          <div v-if="!docId" class="panel-empty">
            请先选择一个文档
          </div>
          <template v-else>
            <el-input
              v-model="taskPrompt"
              type="textarea"
              :rows="5"
              placeholder="描述你希望 AI 基于这篇文档执行的任务，例如：总结全文、提取要点、生成大纲…"
              @blur="handleSavePrompt"
            />
            <div class="panel-hint">
              Phase 2 仅保存任务描述，Phase 3 将接入 Agent 执行
            </div>
          </template>
        </div>
      </div>
    </transition>

    <button
      class="fab-button"
      :class="{ 'is-active': panelVisible }"
      :title="docId ? 'AI 任务' : '请先选择文档'"
      aria-label="AI 任务"
      @click="handleTogglePanel"
    >
      <el-icon><MagicStick /></el-icon>
    </button>
  </div>
</template>

<script>
import { MagicStick, Close } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

/**
 * NoteAiTaskButton —— 右下角浮动 AI 任务按钮。
 *
 * Phase 2 仅落库 note_doc.task_prompt 字段，不接 TaskManager。
 * 点击展开弹出框编辑任务描述，失焦自动保存。
 */
export default {
  name: 'NoteAiTaskButton',
  components: { MagicStick, Close },
  emits: ['updated'],
  props: {
    docId: { type: Number, default: null },
  },
  data() {
    return {
      panelVisible: false,
      taskPrompt: '',
      loadedDocId: null,
    };
  },
  watch: {
    docId(val) {
      if (val) {
        this.loadTaskPrompt();
      } else {
        this.taskPrompt = '';
        this.loadedDocId = null;
      }
    },
  },
  methods: {
    handleTogglePanel() {
      this.panelVisible = !this.panelVisible;
      if (this.panelVisible && this.docId && this.loadedDocId !== this.docId) {
        this.loadTaskPrompt();
      }
    },
    async loadTaskPrompt() {
      if (!this.docId) return;
      try {
        const doc = await window.noteApp.getDoc(this.docId);
        this.taskPrompt = doc?.task_prompt || '';
        this.loadedDocId = this.docId;
      } catch (err) {
        console.error('load task prompt failed', err);
      }
    },
    async handleSavePrompt() {
      if (!this.docId || this.loadedDocId !== this.docId) return;
      try {
        await window.noteApp.updateDoc(this.docId, { task_prompt: this.taskPrompt });
        this.$emit('updated');
      } catch (err) {
        console.error('save task prompt failed', err);
        ElMessage.error('保存任务描述失败');
      }
    },
  },
};
</script>

<style scoped>
.note-ai-task-fab {
  position: absolute;
  bottom: 24px;
  right: 28px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}

.note-ai-task-fab > * {
  pointer-events: auto;
}

/* ===== 浮动按钮 ===== */
.fab-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  font-size: 22px;
  box-shadow:
    0 4px 14px rgba(99, 102, 241, 0.35),
    0 2px 6px rgba(99, 102, 241, 0.20);
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.fab-button:hover {
  transform: translateY(-2px) scale(1.06);
  box-shadow:
    0 6px 20px rgba(99, 102, 241, 0.45),
    0 3px 10px rgba(99, 102, 241, 0.28);
}

.fab-button:active {
  transform: translateY(0) scale(1.02);
}

.fab-button.is-active {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
}

/* ===== 弹出面板 ===== */
.ai-task-panel {
  width: 360px;
  background: var(--surface-card, #ffffff);
  border-radius: 12px;
  box-shadow:
    0 8px 32px rgba(30, 27, 50, 0.18),
    0 2px 8px rgba(30, 27, 50, 0.08);
  overflow: hidden;
  border: 1px solid rgba(99, 102, 241, 0.12);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.06));
  border-bottom: 1px solid rgba(99, 102, 241, 0.08);
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.04em;
}

.panel-close {
  padding: 2px;
  color: var(--text-on-dark-muted, #908e9f);
}

.panel-body {
  padding: 12px 14px;
}

.panel-empty {
  padding: 20px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-on-dark-muted, #908e9f);
  font-style: italic;
}

.panel-hint {
  margin-top: 8px;
  font-size: 10px;
  color: var(--text-on-dark-muted, #908e9f);
  letter-spacing: 0.02em;
}

.panel-body :deep(.el-textarea__inner) {
  background: rgba(99, 102, 241, 0.03);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.12) inset;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-on-dark, #1f1e2e);
}

.panel-body :deep(.el-textarea__inner:focus) {
  background: rgba(99, 102, 241, 0.05);
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

/* ===== 过渡动画 ===== */
.ai-panel-enter-active,
.ai-panel-leave-active {
  transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.ai-panel-enter-from,
.ai-panel-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}

@media (prefers-reduced-motion: reduce) {
  .fab-button {
    transition: none;
  }
  .ai-panel-enter-active,
  .ai-panel-leave-active {
    transition: none;
  }
}
</style>
