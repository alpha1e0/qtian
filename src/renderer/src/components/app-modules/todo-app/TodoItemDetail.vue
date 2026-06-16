<template>
  <div class="todo-item-detail-inner">
    <div v-if="loading" class="loading-hint">加载中...</div>
    <div v-else-if="!formData" class="empty-hint">条目不存在</div>
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

      <!-- 文档编辑器弹窗 -->
      <el-dialog
        v-model="docEditorVisible"
        :title="editingDoc ? editingDoc.name : '新建文档'"
        width="80%"
        top="5vh"
        destroy-on-close
      >
        <TodoDocumentEditor
          v-if="docEditorVisible"
          :doc-id="editingDoc ? editingDoc.id : null"
          :item-id="itemId"
          @saved="handleDocSaved"
        />
      </el-dialog>
    </div>
  </div>
</template>

<script>
import { Plus, Document } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import TodoDocumentEditor from './TodoDocumentEditor.vue';

export default {
  name: 'TodoItemDetail',
  components: { Plus, Document, TodoDocumentEditor },
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
      docEditorVisible: false,
      editingDoc: null,
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
    handleCreateDoc() {
      this.editingDoc = null;
      this.docEditorVisible = true;
    },
    handleOpenDoc(doc) {
      this.editingDoc = doc;
      this.docEditorVisible = true;
    },
    async handleDocSaved() {
      await this.loadDocuments();
    },
  },
};
</script>

<style scoped>
.todo-item-detail-inner {
  padding: 12px;
  height: 100%;
  overflow-y: auto;
}

.loading-hint,
.empty-hint {
  color: var(--text-on-dark-muted, #666);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.progress-row .el-slider {
  flex: 1;
}

.progress-value {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #aaa);
  min-width: 32px;
  text-align: right;
}

.manual-progress-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #aaa);
}

.docs-section {
  margin-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 12px;
}

.docs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-on-dark-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
}

.doc-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.doc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
