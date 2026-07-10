<template>
  <el-dialog
    :model-value="visible"
    title="编辑文档信息"
    width="560px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="handleOpen"
  >
    <div v-loading="loading" class="meta-dialog-body">
      <div v-if="!loading && formData" class="meta-form">
        <!-- 标题 -->
        <div class="meta-field">
          <label class="meta-label">标题</label>
          <el-input
            v-model="formData.title"
            :maxlength="NOTE_DOC_TITLE_MAX_LENGTH"
            show-word-limit
            word-limit-position="outside"
            placeholder="文档标题"
          />
        </div>

        <!-- 分类 + 收藏 -->
        <div class="meta-row">
          <div class="meta-field meta-field--half">
            <label class="meta-label">分类</label>
            <el-cascader
              v-model="categoryPath"
              :options="categoryOptions"
              :props="cascaderProps"
              placeholder="选择分类"
              clearable
              class="full-width"
            />
          </div>
          <div class="meta-field meta-field--half">
            <label class="meta-label">收藏</label>
            <el-button
              :type="formData.isFavorite ? 'warning' : 'default'"
              plain
              class="full-width"
              @click="formData.isFavorite = !formData.isFavorite"
            >
              <el-icon><StarFilled v-if="formData.isFavorite" /><Star v-else /></el-icon>
              {{ formData.isFavorite ? '已收藏' : '未收藏' }}
            </el-button>
          </div>
        </div>

        <!-- 标签 -->
        <div class="meta-field">
          <label class="meta-label">标签</label>
          <el-select
            v-model="formData.labelIds"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="选择或创建标签"
            popper-class="note-label-popper"
            class="full-width"
          >
            <el-option
              v-for="label in allLabels"
              :key="label.id"
              :label="label.name"
              :value="label.id"
            />
          </el-select>
        </div>

        <!-- 摘要 -->
        <div class="meta-field">
          <label class="meta-label">摘要</label>
          <el-input
            v-model="formData.summary"
            type="textarea"
            :rows="3"
            :maxlength="NOTE_DOC_SUMMARY_MAX_LENGTH"
            show-word-limit
            word-limit-position="outside"
            placeholder="一句话概述这篇文档（可选）"
          />
        </div>

        <!-- AI 任务描述 -->
        <div class="meta-field">
          <label class="meta-label">AI 任务描述</label>
          <el-input
            v-model="formData.taskPrompt"
            type="textarea"
            :rows="2"
            placeholder="描述你希望 AI 基于这篇文档执行的任务（Phase 2 仅存档）"
          />
        </div>

        <!-- 时间戳 -->
        <div class="meta-timestamps">
          <span>创建：{{ formatTime(formData.createdAt) }}</span>
          <span class="ts-divider">·</span>
          <span>修改：{{ formatTime(formData.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';
import { Star, StarFilled } from '@element-plus/icons-vue';
import {
  NOTE_DOC_TITLE_MAX_LENGTH,
  NOTE_DOC_SUMMARY_MAX_LENGTH,
} from './constants';

/**
 * NoteMetadataDialog —— 文档元数据编辑模态框。
 *
 * 从侧边栏右键菜单 "编辑元数据" 打开，集中编辑：
 * 标题 / 分类 / 收藏 / 标签 / 摘要 / AI 任务描述。
 */
export default {
  name: 'NoteMetadataDialog',
  components: { Star, StarFilled },
  emits: ['update:visible', 'saved'],
  props: {
    visible: { type: Boolean, default: false },
    docId: { type: Number, default: null },
    allLabels: { type: Array, default: () => [] },
    categoryOptions: { type: Array, default: () => [] },
  },
  data() {
    return {
      NOTE_DOC_TITLE_MAX_LENGTH,
      NOTE_DOC_SUMMARY_MAX_LENGTH,
      formData: null,
      loading: false,
      saving: false,
      cascaderProps: {
        checkStrictly: true,
        emitPath: true,
        value: 'id',
        label: 'name',
        children: 'children',
      },
    };
  },
  computed: {
    categoryPath: {
      get() {
        if (!this.formData?.categoryId) return [];
        return this.resolveCategoryPath(this.categoryOptions, this.formData.categoryId);
      },
      set(pathVal) {
        if (!this.formData) return;
        const targetId = Array.isArray(pathVal) && pathVal.length > 0
          ? pathVal[pathVal.length - 1]
          : null;
        this.formData.categoryId = targetId;
      },
    },
  },
  methods: {
    async handleOpen() {
      if (!this.docId) return;
      this.loading = true;
      try {
        const doc = await window.noteApp.getDoc(this.docId);
        if (!doc) {
          ElMessage.warning('文档不存在');
          this.$emit('update:visible', false);
          return;
        }
        this.formData = {
          title: doc.title || '',
          summary: doc.summary || '',
          taskPrompt: doc.task_prompt || '',
          categoryId: doc.category_id ?? null,
          labelIds: [...(doc.label_ids || [])],
          isFavorite: !!doc.is_favorite,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
        };
      } catch (err) {
        console.error('load doc for metadata failed', err);
        ElMessage.error('加载文档信息失败');
      } finally {
        this.loading = false;
      }
    },
    async handleSave() {
      if (!this.formData || !this.docId) return;
      this.saving = true;
      try {
        const resolvedLabelIds = await this.resolveLabelIds(this.formData.labelIds);
        await window.noteApp.updateDoc(this.docId, {
          title: this.formData.title.trim() || '无标题',
          summary: this.formData.summary,
          task_prompt: this.formData.taskPrompt,
          category_id: this.formData.categoryId,
          label_ids: resolvedLabelIds,
        });
        // 同步收藏状态（如果发生了变化）
        const latestDoc = await window.noteApp.getDoc(this.docId);
        if (latestDoc && !!latestDoc.is_favorite !== this.formData.isFavorite) {
          await window.noteApp.toggleFavorite(this.docId);
        }
        ElMessage.success('文档信息已保存');
        this.$emit('saved', { id: this.docId, ...this.formData, labelIds: resolvedLabelIds });
        this.$emit('update:visible', false);
      } catch (err) {
        console.error('save metadata failed', err);
        ElMessage.error(err?.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
    async resolveLabelIds(ids) {
      const result = [];
      const newNames = [];
      for (const item of ids) {
        if (typeof item === 'number') {
          result.push(item);
        } else if (typeof item === 'string' && item.trim()) {
          newNames.push(item.trim());
        }
      }
      for (const name of newNames) {
        try {
          const created = await window.noteApp.createLabel({ name });
          result.push(created.id);
        } catch {
          const existing = this.allLabels.find((l) => l.name === name);
          if (existing) result.push(existing.id);
        }
      }
      return result;
    },
    resolveCategoryPath(options, targetId, path = []) {
      for (const node of options) {
        const currentPath = [...path, node.id];
        if (node.id === targetId) return currentPath;
        if (node.children?.length) {
          const found = this.resolveCategoryPath(node.children, targetId, currentPath);
          if (found) return found;
        }
      }
      return [];
    },
    formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  },
};
</script>

<style scoped>
.meta-dialog-body {
  min-height: 200px;
}

.meta-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-field--half {
  flex: 1;
}

.meta-row {
  display: flex;
  gap: 16px;
}

.full-width {
  width: 100%;
}

.meta-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary, #909399);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.meta-timestamps {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  padding-top: 4px;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.ts-divider {
  opacity: 0.5;
}

.meta-field :deep(.el-input__wrapper),
.meta-field :deep(.el-textarea__inner),
.meta-field :deep(.el-select__wrapper) {
  border-radius: 8px;
}
</style>

<style>
.note-label-popper {
  z-index: 3000 !important;
}
</style>
