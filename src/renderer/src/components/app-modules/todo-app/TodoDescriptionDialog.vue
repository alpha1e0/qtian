<template>
  <!--
    描述最大化编辑对话框：被 TodoItemDetail / TodoListDetail 复用。
    宽 640px，承载 rows=20 的大 textarea + 1200 字硬上限。
    草稿隔离：打开时把 modelValue 快照到 draft，关闭不回写；保存才 emit confirm。
    append-to-body 避免被父容器 overflow 裁切。
  -->
  <el-dialog
    :model-value="visible"
    width="840px"
    :show-close="true"
    :close-on-click-modal="false"
    append-to-body
    class="todo-description-dialog"
    @update:model-value="onVisibleChange"
    @opened="onDialogOpened"
  >
    <!-- 自定义标题：标题文案明示归属父级（条目标题 / 项目名） -->
    <template #header>
      <div class="desc-dialog-header">
        <div class="header-icon-wrap">
          <el-icon class="header-icon"><EditPen /></el-icon>
        </div>
        <div class="header-text">
          <div class="header-title">编辑 - “{{ parentName || '描述' }}” - 描述信息</div>
          <div class="header-subtitle">最多 {{ TODO_DESCRIPTION_MAX_LENGTH }} 字</div>
        </div>
      </div>
    </template>

    <el-form label-position="top" size="small">
      <el-form-item>
        <el-input
          ref="textareaRef"
          v-model="draft"
          type="textarea"
          :rows="20"
          :maxlength="TODO_DESCRIPTION_MAX_LENGTH"
          show-word-limit
          placeholder="请输入详细描述信息"
          resize="vertical"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="desc-dialog-footer">
        <el-button type="primary" @click="handleConfirm">
          <el-icon><Check /></el-icon>
          <span>保存</span>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { Check, EditPen } from '@element-plus/icons-vue';
import { TODO_DESCRIPTION_MAX_LENGTH } from './constants';

/**
 * TodoDescriptionDialog —— 描述字段最大化编辑对话框。
 *
 * 设计动机（详见 docs/specs/100_todo-app-design.md §9.4「描述最大化编辑」）：
 * 详情面板内联 textarea `:rows="9"` 长 description 需反复滚动，且前端既未设
 * maxlength 也未启用 show-word-limit，用户无法感知 spec 规定的 1200 字上限。
 * 本对话框给描述一个全屏编辑入口，并补齐字数统计与硬上限。
 *
 * 草稿隔离：visible 由 false → true 时把 modelValue 快照到 draft，
 *   - 取消 / Esc / 点遮罩：仅关闭对话框，draft 丢弃，不 emit confirm、不写 modelValue；
 *   - 保存：emit confirm(draft) 后由父组件写入 formData.description 并复用既有
 *     handleSave() 流程（保持「编辑自动激活 init→in_progress」「save-status-bar 反馈」
 *     「updated emit」等副作用），本组件不直接调 IPC。
 *
 * v-model:visible 配套 update:visible；v-model(modelValue) 配套 update:modelValue
 *   仅在保存时触发，作为父组件的一种监听方式（confirm 与 update:modelValue 同步发出）。
 */
export default {
  name: 'TodoDescriptionDialog',
  components: { Check, EditPen },
  emits: ['update:visible', 'update:modelValue', 'confirm'],
  props: {
    /** 对话框显隐（v-model:visible） */
    visible: { type: Boolean, default: false },
    /** v-model 绑定的描述内容（与父组件 formData.description 双向同步） */
    modelValue: { type: String, default: '' },
    /** 标题占位的父级名称（条目标题 / 项目名），用于「编辑 {parentName} 描述信息」 */
    parentName: { type: String, default: '' },
  },
  data() {
    return {
      // 暴露给模板的常量（spec 上限，单一来源）
      TODO_DESCRIPTION_MAX_LENGTH,
      // 内部草稿：打开时从 modelValue 快照，编辑期间不污染父组件 formData
      draft: '',
    };
  },
  watch: {
    /**
     * visible 由 false → true 时把 modelValue 快照到 draft，避免：
     *   1. 上次打开的草稿残留；
     *   2. 编辑过程中双向绑定污染父表单（取消时应整体丢弃）。
     * 在 watch 而非 @open 里做：watch 在属性变化时同步触发，时序更可控。
     */
    visible(val) {
      if (val) {
        this.draft = this.modelValue || '';
      }
    },
  },
  methods: {
    /** v-model:visible 透传 */
    onVisibleChange(val) {
      this.$emit('update:visible', val);
    },
    /**
     * 对话框打开动画结束后聚焦 textarea，提升连续编辑效率。
     * 必须用 @opened 而非 @open：el-dialog 的 focus trap 在动画过程中会
     * 抢占焦点，@opened 在动画结束、trap 稳定后才触发，focus 才持久。
     */
    onDialogOpened() {
      const ref = this.$refs.textareaRef;
      if (!ref || typeof ref.focus !== 'function') return;
      ref.focus();
    },
    /**
     * 保存：emit confirm(draft) 由父组件处理 IPC（复用 handleSave 流程），
     * 同步 emit update:modelValue 让 v-model 也感知到新值，然后关闭对话框。
     */
    handleConfirm() {
      this.$emit('update:modelValue', this.draft);
      this.$emit('confirm', this.draft);
      this.$emit('update:visible', false);
    },
  },
};
</script>

<!--
  非 scoped 样式：el-dialog 启用 append-to-body 后将 .el-overlay/.el-dialog
  容器 teleport 到 document.body，scoped 的 [data-v-xxx] 祖先选择器失效。
  所有规则以唯一的 .todo-description-dialog 为命名空间前缀，避免污染其他组件。
  视觉语言沿用 TodoCreateDialog 的浅色 Aurora 基调（白底 + indigo 细描边）。
-->
<style>
.todo-description-dialog.el-dialog {
  background: #ffffff;
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: 14px;
  box-shadow:
    0 20px 50px rgba(99, 102, 241, 0.12),
    0 6px 16px rgba(31, 30, 46, 0.06);
  overflow: hidden;
}

/* 遮罩层：柔和暖灰，不喧宾夺主 */
.el-overlay:has(.todo-description-dialog) {
  background: rgba(31, 30, 46, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

/* 入场动画：与 TodoCreateDialog 同语言 */
.todo-description-dialog {
  animation: desc-dialog-enter 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes desc-dialog-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .todo-description-dialog {
    animation: none;
  }
}

/* ===== 标题区 ===== */
.todo-description-dialog .el-dialog__header {
  margin: 0;
  padding: 18px 20px 12px;
  position: relative;
}

/* 标题区底部渐隐细线 */
.todo-description-dialog .el-dialog__header::after {
  content: '';
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.32),
    rgba(99, 102, 241, 0.02)
  );
}

.todo-description-dialog .desc-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 图标圆角容器：与 TodoCreateDialog 同款 */
.todo-description-dialog .header-icon-wrap {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.14),
    rgba(139, 92, 246, 0.08)
  );
  border: 1px solid rgba(99, 102, 241, 0.20);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.10);
}

.todo-description-dialog .header-icon {
  font-size: 18px;
  color: var(--accent-text, #4f46e5);
}

.todo-description-dialog .header-text {
  flex: 1;
  min-width: 0;
}

.todo-description-dialog .header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.02em;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-description-dialog .header-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-on-dark-secondary, #5f5e6f);
  letter-spacing: 0.04em;
}

/* 右上角关闭按钮 */
.todo-description-dialog .el-dialog__headerbtn {
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
}

.todo-description-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--text-on-dark-muted, #908e9f);
  font-size: 16px;
  transition: color 0.18s ease;
}

.todo-description-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--text-on-dark, #1f1e2e);
}

/* ===== body ===== */
.todo-description-dialog .el-dialog__body {
  padding: 18px 20px 8px;
  color: var(--text-on-dark, #1f1e2e);
}

.todo-description-dialog .el-form-item {
  margin-bottom: 4px;
}

/*
 * 大 textarea：浅色 Aurora 样式（复用 TodoCreateDialog 同款配色）。
 * rgba(99,102,241,0.04) 在白底上是极淡的 indigo 晕染。
 */
.todo-description-dialog .el-textarea__inner {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.12) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
  color: var(--text-on-dark, #1f1e2e);
  font-size: 13px;
  line-height: 1.6;
  letter-spacing: 0.01em;
}

.todo-description-dialog .el-textarea__inner:hover {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.24) inset;
}

.todo-description-dialog .el-textarea__inner:focus {
  background: rgba(99, 102, 241, 0.06);
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-description-dialog .el-textarea__inner::placeholder {
  color: var(--text-on-dark-muted, #908e9f);
}

/* 字数统计：indigo 弱化色 */
.todo-description-dialog .el-input__count,
.todo-description-dialog .el-input__count-inner {
  color: var(--text-on-dark-muted, #908e9f);
  background: transparent;
}

/* ===== footer ===== */
.todo-description-dialog .el-dialog__footer {
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.todo-description-dialog .desc-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* 主按钮（保存）：indigo accent 渐变 + 白字（与 TodoCreateDialog 主按钮一致） */
.todo-description-dialog .desc-dialog-footer .el-button--primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.06em;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.28);
  transition: all 0.18s ease;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.todo-description-dialog .desc-dialog-footer .el-button--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.38);
}
</style>
