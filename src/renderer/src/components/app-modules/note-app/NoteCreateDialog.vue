<template>
  <!--
    统一新建 / 重命名对话框。
    按 mode 渲染不同字段集合；组件本身不调 IPC，confirm 事件由调用方分流。
  -->
  <el-dialog
    :model-value="visible"
    width="440px"
    :show-close="true"
    :close-on-click-modal="false"
    append-to-body
    class="note-create-dialog"
    :class="`mode-${mode}`"
    @update:model-value="onVisibleChange"
    @opened="onDialogOpened"
  >
    <template #header>
      <div class="create-dialog-header">
        <div class="header-icon-wrap">
          <el-icon class="header-icon"><component :is="titleIcon" /></el-icon>
        </div>
        <div class="header-text">
          <div class="header-title">{{ titleText }}</div>
          <div v-if="parentName && !isRenameMode" class="header-subtitle">
            在「{{ parentName }}」下新建
          </div>
        </div>
      </div>
    </template>

    <el-form label-position="top" size="small">
      <el-form-item :label="nameFieldLabel">
        <el-input
          ref="nameInputRef"
          v-model="form.name"
          :placeholder="namePlaceholder"
          :maxlength="nameMaxLength"
          show-word-limit
          @keydown.enter.prevent="handleConfirm"
        />
      </el-form-item>

      <!-- doc 模式：标签（多选 + allow-create） -->
      <el-form-item v-if="mode === 'doc'" label="标签">
        <el-select
          v-model="form.labelIds"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="选择或创建标签（可选）"
        >
          <el-option
            v-for="label in allLabels"
            :key="label.id"
            :label="label.name"
            :value="label.id"
          />
        </el-select>
      </el-form-item>

      <!-- doc 模式：分类（可选） -->
      <el-form-item v-if="mode === 'doc'" label="分类">
        <el-tree-select
          v-model="form.categoryId"
          :data="categoryOptions"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          clearable
          placeholder="选择分类（可选）"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="create-dialog-footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" :disabled="!canConfirm" @click="handleConfirm">
          {{ confirmButtonText }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { Plus, FolderAdd, DocumentAdd, Edit, PriceTag } from '@element-plus/icons-vue';
import { markRaw } from 'vue';
import {
  NOTE_DOC_TITLE_MAX_LENGTH,
  NOTE_LABEL_NAME_MAX_LENGTH,
} from './constants';

/**
 * NoteCreateDialog —— 新建 / 重命名入口的统一模态对话框。
 *
 * 支持的 mode：
 *   - 新建：root-category / child-category / doc / label
 *   - 重命名：rename-category / rename-doc / rename-label
 *
 * 组件不直接调 IPC：用户点"创建 / 保存"且名称非空时 emit confirm(payload)。
 */
export default {
  name: 'NoteCreateDialog',
  emits: ['update:visible', 'confirm'],
  props: {
    visible: { type: Boolean, default: false },
    mode: {
      type: String,
      default: 'root-category',
      validator: (v) => [
        'root-category', 'child-category', 'doc', 'label',
        'rename-category', 'rename-doc', 'rename-label',
      ].includes(v),
    },
    parentName: { type: String, default: '' },
    initialName: { type: String, default: '' },
    allLabels: { type: Array, default: () => [] },
    categoryOptions: { type: Array, default: () => [] },
  },
  data() {
    return {
      form: this.buildDefaultForm(),
    };
  },
  computed: {
    titleText() {
      const map = {
        'root-category': '新建根分类',
        'child-category': '新建子分类',
        doc: '新建文档',
        label: '新建标签',
        'rename-category': '重命名分类',
        'rename-doc': '重命名文档',
        'rename-label': '重命名标签',
      };
      return map[this.mode] || '新建';
    },
    titleIcon() {
      const map = {
        'root-category': markRaw(FolderAdd),
        'child-category': markRaw(FolderAdd),
        doc: markRaw(DocumentAdd),
        label: markRaw(PriceTag),
        'rename-category': markRaw(Edit),
        'rename-doc': markRaw(Edit),
        'rename-label': markRaw(Edit),
      };
      return map[this.mode] || markRaw(Plus);
    },
    isRenameMode() {
      return this.mode === 'rename-category' || this.mode === 'rename-doc' || this.mode === 'rename-label';
    },
    confirmButtonText() {
      return this.isRenameMode ? '保存' : '创建';
    },
    nameFieldLabel() {
      if (this.mode === 'doc' || this.mode === 'rename-doc') return '标题';
      return '名称';
    },
    namePlaceholder() {
      if (this.mode === 'doc' || this.mode === 'rename-doc') return '请输入文档标题';
      if (this.mode === 'label' || this.mode === 'rename-label') return '请输入标签名称';
      return '请输入分类名称';
    },
    nameMaxLength() {
      if (this.mode === 'doc' || this.mode === 'rename-doc') return NOTE_DOC_TITLE_MAX_LENGTH;
      if (this.mode === 'label' || this.mode === 'rename-label') return NOTE_LABEL_NAME_MAX_LENGTH;
      return undefined;
    },
    canConfirm() {
      return Boolean(this.form.name && this.form.name.trim());
    },
  },
  watch: {
    visible(val) {
      if (val) {
        this.form = this.buildDefaultForm();
        if (this.isRenameMode) {
          this.form.name = this.initialName || '';
        }
      }
    },
  },
  methods: {
    buildDefaultForm() {
      return {
        name: '',
        labelIds: [],
        categoryId: null,
      };
    },
    onDialogOpened() {
      const ref = this.$refs.nameInputRef;
      if (!ref || typeof ref.focus !== 'function') return;
      ref.focus();
      if (this.isRenameMode) {
        try {
          ref.input?.select();
        } catch {
          // 选中失败不影响功能
        }
      }
    },
    onVisibleChange(val) {
      this.$emit('update:visible', val);
    },
    handleCancel() {
      this.$emit('update:visible', false);
    },
    handleConfirm() {
      if (!this.canConfirm) return;
      const name = this.form.name.trim();
      let payload;
      if (this.mode === 'doc') {
        payload = { name, labelIds: [...this.form.labelIds], categoryId: this.form.categoryId };
      } else {
        payload = { name };
      }
      this.$emit('confirm', payload);
      this.$emit('update:visible', false);
    },
  },
};
</script>

<!--
  非 scoped 样式：el-dialog append-to-body 后 teleport 到 body，scoped 选择器失效。
  以 .note-create-dialog 为命名空间前缀。
-->
<style>
.note-create-dialog.el-dialog {
  background: #ffffff;
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: 14px;
  box-shadow:
    0 20px 50px rgba(99, 102, 241, 0.12),
    0 6px 16px rgba(31, 30, 46, 0.06);
  overflow: hidden;
}

.el-overlay:has(.note-create-dialog) {
  background: rgba(31, 30, 46, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.note-create-dialog {
  animation: note-dialog-enter 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes note-dialog-enter {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .note-create-dialog { animation: none; }
}

.note-create-dialog .el-dialog__header {
  margin: 0;
  padding: 18px 20px 12px;
  position: relative;
}

.note-create-dialog .el-dialog__header::after {
  content: '';
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.32), rgba(99, 102, 241, 0.02));
}

.note-create-dialog .create-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.note-create-dialog .header-icon-wrap {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(139, 92, 246, 0.08));
  border: 1px solid rgba(99, 102, 241, 0.20);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.10);
}

.note-create-dialog .header-icon {
  font-size: 18px;
  color: var(--accent-text, #4f46e5);
}

.note-create-dialog .header-text {
  flex: 1;
  min-width: 0;
}

.note-create-dialog .header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.note-create-dialog .header-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-on-dark-secondary, #5f5e6e);
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-create-dialog .el-dialog__headerbtn {
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
}

.note-create-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--text-on-dark-muted, #908e9f);
  font-size: 16px;
  transition: color 0.18s ease;
}

.note-create-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--text-on-dark, #1f1e2e);
}

.note-create-dialog .el-dialog__body {
  padding: 18px 20px 8px;
  color: var(--text-on-dark, #1f1e2e);
}

.note-create-dialog .el-form-item {
  margin-bottom: 16px;
}

.note-create-dialog .el-form-item:last-child {
  margin-bottom: 4px;
}

.note-create-dialog .el-form-item__label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #908e9f);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

.note-create-dialog .el-input__wrapper,
.note-create-dialog .el-textarea__inner,
.note-create-dialog .el-select__wrapper {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.12) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.note-create-dialog .el-input__wrapper:hover,
.note-create-dialog .el-textarea__inner:hover,
.note-create-dialog .el-select__wrapper:hover {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.24) inset;
}

.note-create-dialog .el-input__wrapper.is-focus,
.note-create-dialog .el-textarea__inner:focus,
.note-create-dialog .el-select__wrapper.is-focused {
  background: rgba(99, 102, 241, 0.06);
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.note-create-dialog .el-input__inner,
.note-create-dialog .el-textarea__inner {
  color: var(--text-on-dark, #1f1e2e);
  font-size: 13px;
  letter-spacing: 0.01em;
}

.note-create-dialog .el-input__inner::placeholder,
.note-create-dialog .el-textarea__inner::placeholder {
  color: var(--text-on-dark-muted, #908e9f);
}

.note-create-dialog .el-select {
  width: 100%;
}

.note-create-dialog .el-tree-select {
  width: 100%;
}

.note-create-dialog .el-dialog__footer {
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.note-create-dialog .create-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.note-create-dialog .create-dialog-footer .el-button:not(.el-button--primary) {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.24);
  color: var(--text-on-dark-secondary, #5f5e6e);
  letter-spacing: 0.04em;
}

.note-create-dialog .create-dialog-footer .el-button:not(.el-button--primary):hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.40);
  color: var(--text-on-dark, #1f1e2e);
}

.note-create-dialog .create-dialog-footer .el-button--primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.06em;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.28);
  transition: all 0.18s ease;
}

.note-create-dialog .create-dialog-footer .el-button--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.38);
}

.note-create-dialog .create-dialog-footer .el-button--primary:disabled,
.note-create-dialog .create-dialog-footer .el-button--primary.is-disabled {
  background: rgba(99, 102, 241, 0.16);
  border-color: transparent;
  color: #ffffff;
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
  opacity: 0.7;
}
</style>
