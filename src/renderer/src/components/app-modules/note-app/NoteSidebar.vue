<template>
  <div class="note-sidebar-inner">
    <div class="sidebar-top">
      <el-radio-group v-model="view" size="small" class="view-toggle">
        <el-radio-button value="category">分类</el-radio-button>
        <el-radio-button value="label">标签</el-radio-button>
        <el-radio-button value="favorite">收藏</el-radio-button>
      </el-radio-group>

      <div class="sidebar-scroll">
        <NoteCategoryTree
          ref="categoryTree"
          v-if="view === 'category'"
          :tree-data="categoryTree"
          :selected-node-key="selectedNodeKey"
          :labels="labels"
          :category-options="categoryOptions"
          @select="$emit('tree-select', $event)"
          @create-category="$emit('create-category', $event)"
          @rename-category="$emit('rename-category', $event)"
          @delete-category="$emit('delete-category', $event)"
          @create-doc="$emit('create-doc', $event)"
          @rename-doc="$emit('rename-doc', $event)"
          @delete-doc="$emit('delete-doc', $event)"
          @edit-metadata-doc="$emit('edit-metadata-doc', $event)"
        />

        <!-- 标签 tab：分栏视图 -->
        <div v-else-if="view === 'label'" class="label-split" :class="{ 'has-selection': !!selectedLabelId }">
          <div class="label-cloud-pane">
            <NoteLabelCloud
              :labels="labels"
              :selected-id="selectedLabelId"
              @select-label="$emit('select-label', $event)"
            />
          </div>

          <div v-if="selectedLabelId" class="label-lists-pane">
            <div class="label-lists-scroll">
              <div v-if="labelDocs.length === 0" class="label-lists-empty">
                该标签暂无关联文档
              </div>
              <div
                v-for="doc in labelDocs"
                :key="doc.id"
                class="label-list-item"
                :title="`查看「${doc.title}」`"
                @click="$emit('select-doc', doc.id)"
                @contextmenu="onLabelDocContextMenu($event, doc)"
              >
                <el-icon><Document /></el-icon>
                <div class="label-list-meta">
                  <div class="label-list-name">{{ doc.title }}</div>
                  <div v-if="doc.summary" class="label-list-desc">{{ doc.summary }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 收藏 tab -->
        <div v-else-if="view === 'favorite'" class="favorite-pane">
          <div class="favorite-scroll">
            <div v-if="favoriteDocs.length === 0" class="label-lists-empty">
              暂无收藏的文档
            </div>
            <div
              v-for="doc in favoriteDocs"
              :key="doc.id"
              class="label-list-item"
              :title="`查看「${doc.title}」`"
              @click="$emit('select-doc', doc.id)"
              @contextmenu="onLabelDocContextMenu($event, doc)"
            >
              <el-icon><Document /></el-icon>
              <div class="label-list-meta">
                <div class="label-list-name">{{ doc.title }}</div>
                <div v-if="doc.summary" class="label-list-desc">{{ doc.summary }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <el-button
        size="small"
        plain
        class="trash-btn"
        @click="$emit('open-trash')"
      >
        <el-icon><Delete /></el-icon>
        <span>回收站</span>
      </el-button>
    </div>

    <NoteContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @command="onContextMenuCommand"
      @close="ctxMenu.visible = false"
    />

    <NoteCreateDialog
      v-model:visible="renameDialog.visible"
      mode="rename-doc"
      :initial-name="renameDialog.targetDoc?.title || ''"
      @confirm="onRenameDialogConfirm"
    />
  </div>
</template>

<script>
import NoteCategoryTree from './NoteCategoryTree.vue';
import NoteLabelCloud from './NoteLabelCloud.vue';
import NoteContextMenu from './NoteContextMenu.vue';
import NoteCreateDialog from './NoteCreateDialog.vue';
import { Delete, Document, Edit, InfoFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { markRaw } from 'vue';

/**
 * NoteSidebar —— 左侧导航（分类树 / 标签 / 收藏）。
 */
export default {
  name: 'NoteSidebar',
  components: { NoteCategoryTree, NoteLabelCloud, NoteContextMenu, NoteCreateDialog, Delete, Document },
  emits: [
    'tree-select',
    'create-category', 'rename-category', 'delete-category',
    'create-doc', 'rename-doc', 'delete-doc', 'edit-metadata-doc',
    'select-label', 'select-doc', 'open-trash',
  ],
  props: {
    categoryTree: { type: Array, default: () => [] },
    categoryOptions: { type: Array, default: () => [] },
    labels: { type: Array, default: () => [] },
    selectedNodeKey: { type: String, default: null },
    selectedLabelId: { type: Number, default: null },
  },
  data() {
    return {
      view: 'category',
      labelDocs: [],
      favoriteDocs: [],
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
        targetDoc: null,
        items: [],
      },
      icons: {
        edit: markRaw(Edit),
        delete: markRaw(Delete),
        info: markRaw(InfoFilled),
      },
      renameDialog: {
        visible: false,
        targetDoc: null,
      },
    };
  },
  watch: {
    selectedLabelId(val) {
      if (val) {
        this.loadLabelDocs(val);
      } else {
        this.labelDocs = [];
      }
    },
    view(val) {
      if (val === 'favorite') {
        this.loadFavoriteDocs();
      }
    },
  },
  methods: {
    async loadLabelDocs(labelId) {
      try {
        this.labelDocs = await window.noteApp.listDocsByLabel(labelId);
      } catch (err) {
        ElMessage.error('加载标签文档失败');
        console.error(err);
        this.labelDocs = [];
      }
    },
    refreshLabelDocs() {
      if (this.selectedLabelId) {
        return this.loadLabelDocs(this.selectedLabelId);
      }
      this.labelDocs = [];
      return Promise.resolve();
    },
    async loadFavoriteDocs() {
      try {
        this.favoriteDocs = await window.noteApp.listFavorites();
      } catch (err) {
        ElMessage.error('加载收藏文档失败');
        console.error(err);
        this.favoriteDocs = [];
      }
    },
    refreshFavoriteDocs() {
      return this.loadFavoriteDocs();
    },
    onLabelDocContextMenu(event, doc) {
      if (!doc) return;
      event.preventDefault();
      event.stopPropagation();
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.targetDoc = doc;
      this.ctxMenu.items = [
        { command: 'rename', label: '重命名文档', icon: this.icons.edit },
        { command: 'edit-metadata', label: '编辑元数据', icon: this.icons.info },
        { command: 'delete', label: '删除文档', icon: this.icons.delete, divided: true },
      ];
      this.ctxMenu.visible = true;
    },
    onContextMenuCommand({ command }) {
      const doc = this.ctxMenu.targetDoc;
      this.ctxMenu.visible = false;
      if (!doc) return;
      switch (command) {
        case 'rename':
          this.renameDialog = { visible: true, targetDoc: doc };
          break;
        case 'edit-metadata':
          this.$emit('edit-metadata-doc', doc.id);
          break;
        case 'delete':
          this.$emit('delete-doc', doc.id);
          break;
      }
    },
    onRenameDialogConfirm({ name }) {
      const doc = this.renameDialog.targetDoc;
      if (!doc) return;
      this.$emit('rename-doc', { id: doc.id, name });
    },
  },
};
</script>

<style scoped>
.note-sidebar-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 14px 12px 12px;
}

.sidebar-top {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-footer {
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.trash-btn {
  width: 100%;
  letter-spacing: 0.04em;
  --el-button-bg-color: rgba(239, 68, 68, 0.06);
  --el-button-hover-bg-color: rgba(239, 68, 68, 0.12);
  --el-button-border-color: rgba(239, 68, 68, 0.18);
  --el-button-hover-border-color: rgba(239, 68, 68, 0.32);
  --el-button-text-color: var(--color-danger, #ef4444);
  --el-button-hover-text-color: var(--color-danger, #ef4444);
}

.view-toggle {
  width: 100%;
  flex-shrink: 0;
  margin-bottom: 14px;
  --el-radio-button-checked-bg-color: rgba(99, 102, 241, 0.14);
  --el-radio-button-checked-text-color: var(--accent-text);
  --el-radio-button-checked-border-color: rgba(99, 102, 241, 0.36);
  --el-radio-button-input-border-color: rgba(99, 102, 241, 0.16);
}

.view-toggle :deep(.el-radio-button) {
  width: 33.3333%;
}

.view-toggle :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: rgba(99, 102, 241, 0.03);
  border-color: rgba(99, 102, 241, 0.16);
  color: var(--text-on-dark-secondary);
  transition: all 0.2s ease;
}

.view-toggle :deep(.el-radio-button__inner:hover) {
  color: var(--text-on-dark);
}

/* 标签 tab 分栏 */
.label-split {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.label-cloud-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.label-split.has-selection .label-cloud-pane {
  flex: 0 0 auto;
  max-height: 50%;
}

.label-lists-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.label-lists-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px;
}

.favorite-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.favorite-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px;
}

.label-lists-empty {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 12px;
  font-style: italic;
  padding: 14px 8px;
  letter-spacing: 0.02em;
}

.label-list-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 6px;
  color: var(--text-on-dark, #1f1e2e);
}

.label-list-item:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.10);
}

.label-list-item :deep(.el-icon) {
  color: var(--text-on-dark-muted, #908e9f);
  flex-shrink: 0;
  margin-top: 2px;
}

.label-list-meta {
  flex: 1;
  min-width: 0;
}

.label-list-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label-list-desc {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-on-dark-muted, #908e9f);
  letter-spacing: 0.01em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
