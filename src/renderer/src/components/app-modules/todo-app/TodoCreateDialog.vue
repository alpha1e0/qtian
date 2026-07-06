<template>
  <!--
    统一新建 / 重命名对话框（替换原 4 处新建 + 2 处重命名的 ElMessageBox.prompt）。
    按 mode 渲染不同字段集合；组件本身不调 IPC，confirm 事件由调用方分流。
    visible 用 v-model 配套（update:visible）；append-to-body 避免被父容器 overflow 裁切。
  -->
  <el-dialog
    :model-value="visible"
    width="440px"
    :show-close="true"
    :close-on-click-modal="false"
    append-to-body
    class="todo-create-dialog"
    :class="`mode-${mode}`"
    @update:model-value="onVisibleChange"
    @opened="onDialogOpened"
  >
    <!-- 自定义标题：图标 + 主标题 + 副标题（parentName）
         比 ElMessageBox.prompt 信息量更大，副标题明示归属父级。
         重命名 mode 不展示副标题：原名称已预填到输入框，避免冗余。 -->
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
          @keydown.enter.prevent="handleConfirm"
        />
      </el-form-item>

      <!-- list 模式：标签（多选 + allow-create，沿用 TodoListDetail 模式） -->
      <el-form-item v-if="mode === 'list'" label="标签">
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

      <!-- item 模式：优先级 + 截止时间（沿用 TodoItemDetail 样式） -->
      <template v-if="mode === 'item'">
        <el-form-item label="优先级">
          <el-radio-group v-model="form.priority" class="priority-group">
            <el-radio value="urgent" class="prio-radio prio-urgent">紧急</el-radio>
            <el-radio value="important" class="prio-radio prio-important">重要</el-radio>
            <el-radio value="normal" class="prio-radio prio-normal">普通</el-radio>
            <el-radio value="hint" class="prio-radio prio-hint">提示</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker
            v-model="form.dueAt"
            type="datetime"
            placeholder="选择截止时间（可选）"
            format="YYYY-MM-DD HH:mm"
            value-format="x"
            class="due-picker"
          />
        </el-form-item>
      </template>
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
import { Plus, FolderAdd, DocumentAdd, Edit } from '@element-plus/icons-vue';
import { markRaw } from 'vue';

/**
 * TodoCreateDialog —— 4 种新建 + 2 种重命名入口的统一模态对话框。
 *
 * 设计动机（详见 docs/specs/100_todo-app-design.md §9.4 / Q-MISC-8）：
 * 原 ElMessageBox.prompt 仅支持单行输入，"新建待办项目"无法创建时打标签、
 * "新建待办条目"无法设定优先级/截止时间，"重命名分类 / 待办项目"也只用了简陋的
 * 单行 prompt，样式固定、无法与 todo-app Aurora 浅色基调及表单视觉语言统一。
 * 本组件按 mode 渲染不同字段集合，复用 TodoItemDetail / TodoListDetail 的表单样式，
 * 让 dialog 与详情面板观感一致。
 *
 * 支持的 mode：
 *   - 新建：root-category / child-category / list（含标签）/ item（含优先级 + 截止时间）
 *   - 重命名：rename-category / rename-list（仅名称字段，由 initialName 预填）
 *
 * 组件不直接调 IPC：用户点"创建 / 保存"且名称非空时 emit confirm(payload)，由调用方分流。
 */
export default {
  name: 'TodoCreateDialog',
  // v-model:visible 配套；confirm 不直接调 IPC，由调用方按 mode 处理
  emits: ['update:visible', 'confirm'],
  props: {
    /** 对话框显隐（v-model:visible） */
    visible: { type: Boolean, default: false },
    /** 决定标题图标、字段集合与按钮文案 */
    mode: {
      type: String,
      default: 'root-category',
      validator: (v) => [
        'root-category', 'child-category', 'list', 'item',
        'rename-category', 'rename-list',
      ].includes(v),
    },
    /** child-category / list 模式副标题展示的父级名称（重命名 mode 不展示） */
    parentName: { type: String, default: '' },
    /** 重命名 mode 打开时预填的当前名称 */
    initialName: { type: String, default: '' },
    /** list 模式标签下拉选项（与 TodoListDetail allLabels 同源） */
    allLabels: { type: Array, default: () => [] },
  },
  data() {
    return {
      // 表单状态：所有 mode 共用一份字段，按 mode 决定渲染哪些。
      // 打开对话框时（watch visible false→true）整体重置，避免上次输入残留。
      form: this.buildDefaultForm(),
    };
  },
  computed: {
    /** mode → 标题文案 */
    titleText() {
      const map = {
        'root-category': '新建根分类',
        'child-category': '新建子分类',
        list: '新建待办项目',
        item: '新建待办条目',
        'rename-category': '重命名分类',
        'rename-list': '重命名待办项目',
      };
      return map[this.mode] || '新建';
    },
    /**
     * mode → 标题图标（markRaw 避免 Vue 将其代理成响应式）。
     * 分类用 FolderAdd（目录语义），项目用 DocumentAdd（文件语义），条目用 Plus，
     * 重命名两种均用 Edit（铅笔语义）。
     */
    titleIcon() {
      const map = {
        'root-category': markRaw(FolderAdd),
        'child-category': markRaw(FolderAdd),
        list: markRaw(DocumentAdd),
        item: markRaw(Plus),
        'rename-category': markRaw(Edit),
        'rename-list': markRaw(Edit),
      };
      return map[this.mode] || markRaw(Plus);
    },
    /** 是否为重命名 mode（用于决定副标题是否展示、按钮文案等差异化行为） */
    isRenameMode() {
      return this.mode === 'rename-category' || this.mode === 'rename-list';
    },
    /** 主按钮文案：重命名 mode 为"保存"，新建 mode 为"创建" */
    confirmButtonText() {
      return this.isRenameMode ? '保存' : '创建';
    },
    /** 名称字段 label：分类/项目用"名称"，条目用"标题"（与既有 prompt 文案对齐） */
    nameFieldLabel() {
      return this.mode === 'item' ? '标题' : '名称';
    },
    /** 名称输入框 placeholder */
    namePlaceholder() {
      if (this.mode === 'item') return '请输入待办条目标题';
      if (this.mode === 'list' || this.mode === 'rename-list') return '请输入待办项目名称';
      return '请输入分类名称';
    },
    /** 名称非空（trim 后）才允许提交 */
    canConfirm() {
      return Boolean(this.form.name && this.form.name.trim());
    },
  },
  watch: {
    /**
     * visible 由 false → true 时重置表单到默认值，避免上次输入残留。
     * 不在 @open 事件里做：@open 触发时表单已渲染，重置会闪一下旧值。
     *
     * 重命名 mode 额外把 initialName 预填进名称输入框，用户打开即可在原名基础上编辑，
     * 而非从空白开始（与原 ElMessageBox.prompt 的 inputValue 行为对齐）。
     */
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
    /** 构造表单默认值（集中一处，避免字面量散落） */
    buildDefaultForm() {
      return {
        name: '',
        // list 模式：标签 id 数组（allow-create 输入的新标签名以字符串形式入列）
        labelIds: [],
        // item 模式：优先级默认 normal（与 TodoItemDetail 一致）
        priority: 'normal',
        // item 模式：截止时间，value-format="x" 的字符串时间戳；null = 不设
        dueAt: null,
      };
    },
    /**
     * 对话框打开动画结束后聚焦名称输入框，提升连续创建 / 重命名的效率。
     *
     * 必须用 @opened 而非 @open：@open 在动画起始立即触发，el-dialog 内置的
     * focus trap 会在过渡过程中再次抢占焦点，导致手动 focus() 失效；
     * @opened 在动画结束、focus trap 稳定后才触发，此时 focus 才会持久。
     * 重命名 mode 额外 select() 全选原名：方便用户直接覆盖输入或仅修改局部。
     */
    onDialogOpened() {
      const ref = this.$refs.nameInputRef;
      // el-input 暴露 focus()；防御性判空避免钩子顺序差异导致报错
      if (!ref || typeof ref.focus !== 'function') return;
      ref.focus();
      if (this.isRenameMode) {
        // el-input 的 focus 不接受 select 参数；通过底层 input ref 全选
        // 防御性 try/catch：少数版本/场景下 input 可能未暴露 select
        try {
          ref.input?.select();
        } catch {
          // 忽略：选中失败不影响功能，名称已预填可手动编辑
        }
      }
    },
    /** v-model:visible 透传 */
    onVisibleChange(val) {
      this.$emit('update:visible', val);
    },
    /** 取消：关闭对话框（由父组件通过 v-model 同步 visible=false） */
    handleCancel() {
      this.$emit('update:visible', false);
    },
    /**
     * 提交（创建 / 保存）：名称非空时按 mode 组装 payload emit confirm，并关闭对话框。
     * 由调用方（TodoCategoryTree / TodoListPanel）负责实际 IPC 与后续刷新。
     */
    handleConfirm() {
      if (!this.canConfirm) return;
      const name = this.form.name.trim();
      let payload;
      if (this.mode === 'list') {
        payload = { name, labelIds: [...this.form.labelIds] };
      } else if (this.mode === 'item') {
        payload = {
          name,
          priority: this.form.priority,
          dueAt: this.form.dueAt, // 字符串时间戳或 null
        };
      } else {
        // root-category / child-category / rename-category / rename-list
        payload = { name };
      }
      this.$emit('confirm', payload);
      this.$emit('update:visible', false);
    },
  },
};
</script>

<!--
  非 scoped 样式：el-dialog 启用 append-to-body 后将 .el-overlay/.el-dialog 等
  容器 teleport 到 document.body，scoped 的 [data-v-xxx] 祖先选择器失效。
  所有规则以唯一的 .todo-create-dialog 为命名空间前缀，避免污染其他组件。
  视觉语言沿用 Aurora 浅色基调（与 TodoItemDetail / TodoListDetail / TodoAppPage 一致：
  暖白纸张底 + 深墨文字 + indigo accent；变量名 --text-on-dark* / --surface-dark*
  虽保留历史命名，但已在 App.vue 重映射为浅色值）。
-->
<style>
/*
 * 对话框容器：白底 + indigo 细描边 + 柔和投影，与 app 的浅色纸张底一致。
 * 不再使用深色/毛玻璃（app 整体是浅色 Aurora 基调）。
 */
.todo-create-dialog.el-dialog {
  background: #ffffff;
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: 14px;
  box-shadow:
    0 20px 50px rgba(99, 102, 241, 0.12),
    0 6px 16px rgba(31, 30, 46, 0.06);
  overflow: hidden;
}

/* 遮罩层：柔和暖灰，不喧宾夺主（浅色主题对应） */
.el-overlay:has(.todo-create-dialog) {
  background: rgba(31, 30, 46, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

/* 入场动画：scale + fade（与 TodoAppPage 的 aurora-fade-up 同语言） */
.todo-create-dialog {
  animation: create-dialog-enter 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes create-dialog-enter {
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
  .todo-create-dialog {
    animation: none;
  }
}

/* ===== 标题区 ===== */
.todo-create-dialog .el-dialog__header {
  margin: 0;
  padding: 18px 20px 12px;
  position: relative;
}

/* 标题区底部渐隐细线（与详情面板章节分隔同语言） */
.todo-create-dialog .el-dialog__header::after {
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

.todo-create-dialog .create-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 图标圆角容器：indigo accent 浅底 + 深色主色图标 */
.todo-create-dialog .header-icon-wrap {
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

.todo-create-dialog .header-icon {
  font-size: 18px;
  color: var(--accent-text, #4f46e5);
}

.todo-create-dialog .header-text {
  flex: 1;
  min-width: 0;
}

.todo-create-dialog .header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.todo-create-dialog .header-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-on-dark-secondary, #5f5e6f);
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右上角关闭按钮 */
.todo-create-dialog .el-dialog__headerbtn {
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
}

.todo-create-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--text-on-dark-muted, #908e9f);
  font-size: 16px;
  transition: color 0.18s ease;
}

.todo-create-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--text-on-dark, #1f1e2e);
}

/* ===== 表单主体 ===== */
.todo-create-dialog .el-dialog__body {
  padding: 18px 20px 8px;
  color: var(--text-on-dark, #1f1e2e);
}

.todo-create-dialog .el-form-item {
  margin-bottom: 16px;
}

.todo-create-dialog .el-form-item:last-child {
  margin-bottom: 4px;
}

/* eyebrow 章节标题（与 TodoItemDetail / TodoListDetail 一致） */
.todo-create-dialog .el-form-item__label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #908e9f);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

/*
 * 输入框 / 选择器 / 文本域：浅色 Aurora 样式（复用 TodoItemDetail 同款）。
 * rgba(99,102,241,0.04) 在白底上是极淡的 indigo 晕染，与详情面板输入框完全一致。
 */
.todo-create-dialog .el-input__wrapper,
.todo-create-dialog .el-textarea__inner,
.todo-create-dialog .el-select__wrapper {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.12) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.todo-create-dialog .el-input__wrapper:hover,
.todo-create-dialog .el-textarea__inner:hover,
.todo-create-dialog .el-select__wrapper:hover {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.24) inset;
}

.todo-create-dialog .el-input__wrapper.is-focus,
.todo-create-dialog .el-textarea__inner:focus,
.todo-create-dialog .el-select__wrapper.is-focused {
  background: rgba(99, 102, 241, 0.06);
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-create-dialog .el-input__inner,
.todo-create-dialog .el-textarea__inner {
  color: var(--text-on-dark, #1f1e2e);
  font-size: 13px;
  letter-spacing: 0.01em;
}

.todo-create-dialog .el-input__inner::placeholder,
.todo-create-dialog .el-textarea__inner::placeholder {
  color: var(--text-on-dark-muted, #908e9f);
}

.todo-create-dialog .el-select {
  width: 100%;
}

/* 截止时间 picker：撑满表单宽度 */
.todo-create-dialog .due-picker,
.todo-create-dialog .due-picker.el-input.el-input--default {
  width: 100%;
}

/*
 * 优先级 radio：完整复用 TodoItemDetail 的 .priority-group / .prio-* 配色，
 * 让 dialog 与详情页观感一致（用户在两边看到完全相同的优先级视觉语言）。
 * 四档颜色（danger/warning/accent/muted）在浅底上对比清晰。
 */
.todo-create-dialog .priority-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  width: 100%;
}

.todo-create-dialog .priority-group .el-radio__label {
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* label 常驻显示该优先级颜色（与 TodoItemRow priority-dot 配色一致） */
.todo-create-dialog .prio-urgent .el-radio__label { color: var(--color-danger, #ef4444); }
.todo-create-dialog .prio-important .el-radio__label { color: var(--color-warning, #f59e0b); }
.todo-create-dialog .prio-normal .el-radio__label { color: var(--accent, #6366f1); }
.todo-create-dialog .prio-hint .el-radio__label { color: var(--text-on-dark-muted, #908e9f); }

/* 选中态圆点同色（对应 priority-dot 实色点） */
.todo-create-dialog .prio-urgent .el-radio__input.is-checked .el-radio__inner {
  background-color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}
.todo-create-dialog .prio-important .el-radio__input.is-checked .el-radio__inner {
  background-color: var(--color-warning, #f59e0b);
  border-color: var(--color-warning, #f59e0b);
}
.todo-create-dialog .prio-normal .el-radio__input.is-checked .el-radio__inner {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}
.todo-create-dialog .prio-hint .el-radio__input.is-checked .el-radio__inner {
  background-color: var(--text-on-dark-muted, #908e9f);
  border-color: var(--text-on-dark-muted, #908e9f);
}

/* ===== footer ===== */
.todo-create-dialog .el-dialog__footer {
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.todo-create-dialog .create-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* 次按钮（取消）：indigo 浅底 + 描边 */
.todo-create-dialog .create-dialog-footer .el-button:not(.el-button--primary) {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.24);
  color: var(--text-on-dark-secondary, #5f5e6f);
  letter-spacing: 0.04em;
}

.todo-create-dialog .create-dialog-footer .el-button:not(.el-button--primary):hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.40);
  color: var(--text-on-dark, #1f1e2e);
}

/* 主按钮（创建）：indigo accent 渐变 + 白字（浅底上的主操作按钮） */
.todo-create-dialog .create-dialog-footer .el-button--primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.06em;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.28);
  transition: all 0.18s ease;
}

.todo-create-dialog .create-dialog-footer .el-button--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.38);
}

.todo-create-dialog .create-dialog-footer .el-button--primary:disabled,
.todo-create-dialog .create-dialog-footer .el-button--primary.is-disabled {
  background: rgba(99, 102, 241, 0.16);
  border-color: transparent;
  color: #ffffff;
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
  opacity: 0.7;
}
</style>
