<template>
  <el-dialog
    :model-value="visible"
    title="回收站"
    width="720px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="handleOpen"
  >
    <div v-loading="loading" class="trash-body">
      <div v-if="items.length === 0 && !loading" class="trash-empty">
        <el-empty description="回收站为空" :image-size="80" />
      </div>

      <div
        v-for="item in items"
        :key="`${item.type}-${item.id}`"
        class="trash-row"
      >
        <el-icon class="row-icon">
          <component :is="typeIcon(item.type)" />
        </el-icon>
        <div class="row-main">
          <div class="row-title">
            <span class="row-name" :title="item.name">{{ item.name }}</span>
            <el-tag size="small" :type="typeTagType(item.type)" class="row-tag">
              {{ typeLabel(item.type) }}
            </el-tag>
          </div>
          <div class="row-meta">删除于 {{ formatTime(item.deleted_at) }}</div>
        </div>
        <div class="row-actions">
          <el-button size="small" type="primary" plain @click="handleRestore(item)">
            恢复
          </el-button>
          <el-button size="small" type="danger" plain @click="handlePurge(item)">
            彻底删除
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          v-if="items.length > 0"
          type="danger"
          plain
          @click="handleEmpty"
        >
          清空回收站
        </el-button>
        <el-button @click="$emit('update:visible', false)">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Folder,
  Document,
  PriceTag,
} from '@element-plus/icons-vue';

/**
 * 回收站跨表展示对话框。
 *
 * 聚合展示 3 类已软删除实体（category / doc / label）。
 */
export default {
  name: 'NoteTrashDialog',
  components: { Folder, Document, PriceTag },
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['update:visible', 'restored', 'purged', 'emptied'],
  data() {
    return {
      items: [],
      loading: false,
    };
  },
  watch: {
    visible(val) {
      if (val) {
        this.loadTrash();
      }
    },
  },
  methods: {
    handleOpen() {
      this.loadTrash();
    },
    async loadTrash() {
      this.loading = true;
      try {
        this.items = await window.noteApp.listTrash();
      } catch (err) {
        console.error('load trash failed', err);
        ElMessage.error('加载回收站失败');
        this.items = [];
      } finally {
        this.loading = false;
      }
    },
    async handleRestore(item) {
      try {
        await RESTORE_API_MAP[item.type](item.id);
        ElMessage.success('已恢复');
        this.$emit('restored', { type: item.type, id: item.id });
        await this.loadTrash();
      } catch (err) {
        ElMessage.error(err?.message || '恢复失败');
      }
    },
    async handlePurge(item) {
      try {
        await ElMessageBox.confirm(
          `确认彻底删除 "${item.name}" 吗？此操作不可恢复。`,
          '彻底删除',
          { type: 'warning' },
        );
      } catch (cancel) {
        return;
      }
      try {
        await window.noteApp.purgeTrash(item.type, item.id);
        ElMessage.success('已彻底删除');
        this.$emit('purged', { type: item.type, id: item.id });
        await this.loadTrash();
      } catch (err) {
        ElMessage.error(err?.message || '删除失败');
      }
    },
    async handleEmpty() {
      try {
        await ElMessageBox.confirm(
          '将物理删除回收站内的所有条目，此操作不可恢复，确认？',
          '清空回收站',
          { type: 'warning' },
        );
      } catch (cancel) {
        return;
      }
      try {
        const result = await window.noteApp.emptyTrash();
        ElMessage.success(`已清空 ${result?.removed ?? 0} 条`);
        this.$emit('emptied');
        await this.loadTrash();
      } catch (err) {
        ElMessage.error(err?.message || '清空失败');
      }
    },
    typeIcon(type) {
      return TYPE_ICON_MAP[type] || 'Document';
    },
    typeLabel(type) {
      return TYPE_LABEL_MAP[type] || type;
    },
    typeTagType(type) {
      return TYPE_TAG_TYPE_MAP[type] || 'info';
    },
    formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  },
};

const TYPE_ICON_MAP = {
  category: 'Folder',
  doc: 'Document',
  label: 'PriceTag',
};

const TYPE_LABEL_MAP = {
  category: '分类',
  doc: '文档',
  label: '标签',
};

const TYPE_TAG_TYPE_MAP = {
  category: 'success',
  doc: 'primary',
  label: 'danger',
};

const RESTORE_API_MAP = {
  category: (id) => window.noteApp.restoreCategory(id),
  doc: (id) => window.noteApp.restoreDoc(id),
  label: (id) => window.noteApp.restoreLabel(id),
};
</script>

<style scoped>
.trash-body {
  min-height: 200px;
  max-height: 60vh;
  overflow-y: auto;
}

.trash-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
}

.trash-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.trash-row + .trash-row {
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.trash-row:hover {
  background: var(--el-fill-color-light, #f5f7fa);
}

.row-icon {
  flex-shrink: 0;
  font-size: 18px;
  color: var(--el-color-info, #909399);
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 380px;
}

.row-tag {
  flex-shrink: 0;
}

.row-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted, #909399);
}

.row-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>
