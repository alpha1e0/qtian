<template>
  <div class="todo-item-detail-inner">
    <!--
      内部滚动容器：根元素 .todo-item-detail-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 flex:9 横向占位）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .item-detail-scroll 专门承担滚动，与 .todo-sidebar / .todo-list-panel 同款。
      之前的 bug：表单 + 关联文档 + AI 任务按钮全部塞在根元素里，
      当表单字段较多时总高度超出，"运行任务"按钮被挤出可视区，滚到底也只看到 1/5。
    -->
    <div class="item-detail-scroll">
      <div v-if="loading" class="loading-hint">加载中...</div>
      <div v-else-if="!formData" class="empty-hint">待办条目不存在</div>
      <div v-else class="detail-content">
        <el-form label-position="top" size="small">
          <el-form-item label="标题">
            <el-input v-model="formData.title" @blur="handleSave" />
          </el-form-item>

          <el-form-item label="状态">
            <el-select v-model="formData.status" @change="handleStatusChange">
              <el-option label="初始" value="init" />
              <el-option label="进行中" value="in_progress" />
              <el-option label="已完成" value="done" />
              <el-option label="已放弃" value="abandoned" />
            </el-select>
          </el-form-item>

          <el-form-item label="优先级">
            <el-select v-model="formData.priority" @change="handleSave">
              <el-option label="紧急" value="urgent" />
              <el-option label="重要" value="important" />
              <el-option label="普通" value="normal" />
              <el-option label="提示" value="hint" />
            </el-select>
          </el-form-item>

          <el-form-item label="截止时间">
            <el-date-picker
              v-model="formData.dueAt"
              type="datetime"
              placeholder="选择截止时间"
              format="YYYY-MM-DD HH:mm"
              value-format="x"
              @change="handleSave"
            />
          </el-form-item>

          <el-form-item label="描述">
            <el-input
              v-model="formData.description"
              type="textarea"
              :rows="3"
              @blur="handleSave"
            />
          </el-form-item>

          <el-form-item label="任务提示词（task_prompt）">
            <el-input
              v-model="formData.task_prompt"
              type="textarea"
              :rows="3"
              placeholder="驱动 AI 任务时的上下文提示词"
              @blur="handleSave"
            />
          </el-form-item>

          <el-form-item label="进度">
            <div class="progress-row">
              <el-slider
                v-model="formData.progress"
                :disabled="formData.is_manual_progress === false && hasChildren"
                @change="handleSave"
              />
              <span class="progress-value">{{ formData.progress }}%</span>
            </div>
          </el-form-item>

          <el-form-item>
            <div class="manual-progress-toggle">
              <el-switch v-model="formData.is_manual_progress" @change="handleManualToggle" />
              <span class="toggle-label">手动设置进度（关闭则由子项平均）</span>
            </div>
          </el-form-item>

          <el-form-item label="标签">
            <el-select
              v-model="formData.labelIds"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或创建标签"
              @change="handleLabelChange"
            >
              <el-option
                v-for="label in allLabels"
                :key="label.id"
                :label="label.name"
                :value="label.id"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <!-- 文档区域 -->
        <div class="docs-section">
          <div class="docs-header">
            <span class="section-title">关联文档</span>
            <el-button size="small" text @click="handleCreateDoc">
              <el-icon><Plus /></el-icon> 新建
            </el-button>
          </div>
          <div v-if="documents.length === 0" class="empty-hint">暂无文档</div>
          <div
            v-for="doc in documents"
            :key="doc.id"
            class="doc-item"
            @click="handleOpenDoc(doc)"
          >
            <el-icon><Document /></el-icon>
            <span class="doc-name">{{ doc.name }}</span>
          </div>
        </div>

        <!-- AI 任务区段（Phase 5） -->
        <div class="task-section">
          <div class="docs-header">
            <span class="section-title">AI 任务</span>
          </div>
          <el-button
            v-if="!formData.agent_task_id"
            type="primary"
            size="small"
            @click="$emit('run-task')"
          >
            <el-icon><VideoPlay /></el-icon> 运行任务
          </el-button>
          <div v-else class="task-actions">
            <el-button size="small" @click="$emit('view-task')">
              <el-icon><View /></el-icon> 查看任务面板
            </el-button>
            <el-button size="small" @click="$emit('rerun-task')">
              <el-icon><Refresh /></el-icon> 重跑
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Plus, Document, VideoPlay, View, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoItemDetail',
  components: { Plus, Document, VideoPlay, View, Refresh },
  emits: ['updated', 'open-doc', 'run-task', 'view-task', 'rerun-task'],
  props: {
    itemId: { type: Number, required: true },
  },
  data() {
    return {
      loading: true,
      formData: null,
      allLabels: [],
      documents: [],
      hasChildren: false,
      saveTimer: null,
    };
  },
  watch: {
    itemId() {
      this.loadDetail();
    },
  },
  async mounted() {
    await this.loadDetail();
    await this.loadLabels();
  },
  methods: {
    async loadDetail() {
      this.loading = true;
      try {
        const item = await window.todoApp.getTodoItem(this.itemId);
        if (item) {
          this.formData = {
            title: item.title,
            description: item.description,
            task_prompt: item.task_prompt,
            status: item.status,
            progress: item.progress,
            priority: item.priority,
            dueAt: item.due_at ? String(item.due_at) : null,
            is_manual_progress: item.is_manual_progress,
            labelIds: [...(item.label_ids || [])],
            agent_task_id: item.agent_task_id ?? null,
          };
          await this.loadDocuments();
        } else {
          this.formData = null;
        }
      } catch (err) {
        ElMessage.error('加载详情失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    async loadLabels() {
      try {
        this.allLabels = await window.todoApp.listLabels();
      } catch (err) {
        console.error(err);
      }
    },
    async loadDocuments() {
      try {
        this.documents = await window.todoApp.listDocsByItem(this.itemId);
      } catch (err) {
        console.error(err);
      }
    },
    async handleSave() {
      if (!this.formData) return;
      try {
        await window.todoApp.updateTodoItem(this.itemId, {
          title: this.formData.title,
          description: this.formData.description,
          task_prompt: this.formData.task_prompt,
          priority: this.formData.priority,
          due_at: this.formData.dueAt ? parseInt(this.formData.dueAt, 10) : null,
        });
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err.message || '保存失败');
      }
    },
    async handleStatusChange(status) {
      try {
        await window.todoApp.updateTodoItemStatus(this.itemId, status);
        await this.loadDetail();
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err.message || '状态更新失败');
        await this.loadDetail();
      }
    },
    async handleManualToggle(val) {
      try {
        await window.todoApp.updateTodoItem(this.itemId, {
          is_manual_progress: val,
          progress: this.formData.progress,
        });
        await this.loadDetail();
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err.message || '保存失败');
      }
    },
    async handleLabelChange(labelIds) {
      try {
        await window.todoApp.updateTodoItem(this.itemId, { label_ids: labelIds });
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err.message || '标签更新失败');
      }
    },
    /**
     * 新建文档：先弹框收集名称，落库后通知父组件切换到编辑器视图。
     * 这里采用"创建+打开"两步，保证父组件能拿到真实 docId。
     */
    async handleCreateDoc() {
      try {
        const { value } = await ElMessageBox.prompt('请输入文档名称', '新建关联文档', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (!value || !value.trim()) return;
        const created = await window.todoApp.saveDocument({
          name: value.trim(),
          content: '',
          todo_item_id: this.itemId,
          todo_category_id: null,
        });
        await this.loadDocuments();
        this.$emit('open-doc', {
          id: created.id,
          itemId: this.itemId,
          titlePath: `${this.formData?.title || ''} / ${created.name}`,
        });
        ElMessage.success('文档已创建');
      } catch (err) {
        if (err === 'cancel') return;
        ElMessage.error(err.message || '创建失败');
      }
    },
    handleOpenDoc(doc) {
      this.$emit('open-doc', {
        id: doc.id,
        itemId: this.itemId,
        titlePath: `${this.formData?.title || ''} / ${doc.name}`,
      });
    },
  },
};
</script>

<style scoped>
/*
 * 三段式布局（与 .todo-sidebar / .todo-list-panel 同款）：
 *   .todo-item-detail (来自父组件 TodoAppPage；flex:9, overflow-y:auto)
 *     └─ .todo-item-detail-inner (与 .todo-item-detail 合并到同一 DOM 元素：Vue attribute inheritance)
 *          └─ .item-detail-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 *
 * 之前的 bug：根元素既当外层 wrapper 又当滚动容器，导致 padding+height:100% 在 attribute
 * inheritance 下高度链不收敛，"运行任务"按钮被挤出可视区。
 */
.todo-item-detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 真正的滚动容器：承担所有可滚动内容（表单 + 关联文档 + AI 任务） */
.item-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 28px;
}

/* 表单输入与深色 Aurora 基底对齐 */
.todo-item-detail-inner :deep(.el-form-item__label) {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

.todo-item-detail-inner :deep(.el-input__wrapper),
.todo-item-detail-inner :deep(.el-textarea__inner),
.todo-item-detail-inner :deep(.el-select__wrapper) {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.10) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.todo-item-detail-inner :deep(.el-input__wrapper:hover),
.todo-item-detail-inner :deep(.el-textarea__inner:hover),
.todo-item-detail-inner :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset;
}

.todo-item-detail-inner :deep(.el-input__wrapper.is-focus),
.todo-item-detail-inner :deep(.el-textarea__inner:focus),
.todo-item-detail-inner :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-item-detail-inner :deep(.el-input__inner),
.todo-item-detail-inner :deep(.el-textarea__inner) {
  color: var(--text-on-dark, #e4e4ed);
  font-size: 13px;
  letter-spacing: 0.01em;
}

.loading-hint,
.empty-hint {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 13px;
  font-style: italic;
  text-align: center;
  padding: 32px 0;
  letter-spacing: 0.02em;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.progress-row .el-slider {
  flex: 1;
}

/* slider 颜色与新主色对齐 */
.progress-row :deep(.el-slider__runway) {
  background-color: rgba(99, 102, 241, 0.12);
}

.progress-row :deep(.el-slider__bar) {
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
}

.progress-row :deep(.el-slider__button) {
  border-color: var(--accent, #6366f1);
}

.progress-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-on-dark-secondary, #8b8aa0);
  font-feature-settings: 'tnum';
  min-width: 36px;
  text-align: right;
  letter-spacing: 0.04em;
}

.manual-progress-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.manual-progress-toggle :deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}

.toggle-label {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #8b8aa0);
  letter-spacing: 0.01em;
}

/* 章节分隔：渐隐细线代替生硬的实色 border */
.docs-section,
.task-section {
  margin-top: 22px;
  padding-top: 14px;
  position: relative;
}

.docs-section::before,
.task-section::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.20),
    rgba(99, 102, 241, 0.02)
  );
}

.docs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.task-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* eyebrow 章节标题 */
.section-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/* 文档卡片：浮起的档案条目 */
.doc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 6px;
  color: var(--text-on-dark, #e4e4ed);
}

.doc-item:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.10);
}

.doc-item :deep(.el-icon) {
  color: var(--accent);
}

.doc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}
</style>
