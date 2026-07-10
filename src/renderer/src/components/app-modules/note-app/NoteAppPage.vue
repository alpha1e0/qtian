<template>
  <div class="note-app-page">
    <!-- 顶部搜索栏：横跨两栏上方 -->
    <div class="search-bar-row">
      <NoteSearchBar
        @jump-to-result="handleJumpToResult"
      />
    </div>

    <!-- 两栏布局：左导航 / 右编辑区 -->
    <div class="columns-row">
      <!-- 左侧导航 -->
      <NoteSidebar
        ref="sidebar"
        class="note-sidebar"
        :category-tree="mergedTree"
        :category-options="categoryOptions"
        :labels="labels"
        :selected-node-key="currentNodeKey"
        :selected-label-id="selectedLabelId"
        @tree-select="handleTreeSelect"
        @create-category="handleCreateCategory"
        @rename-category="handleRenameCategory"
        @delete-category="handleDeleteCategory"
        @create-doc="handleCreateDoc"
        @rename-doc="handleRenameDoc"
        @delete-doc="handleDeleteDoc"
        @edit-metadata-doc="handleOpenMetadata"
        @select-label="handleSelectLabel"
        @select-doc="handleSelectDoc"
        @open-trash="trashDialogVisible = true"
      />

      <!-- 右侧编辑区：选中文档时显示内联编辑器 -->
      <NoteDocEditor
        v-if="selectedDocId"
        :key="`doc-${selectedDocId}-${editorKey}`"
        ref="docEditor"
        class="note-doc-editor"
        :doc-id="selectedDocId"
        @updated="handleDocUpdated"
        @open-metadata="handleOpenMetadata"
      />
      <div v-else class="note-doc-editor note-doc-editor-empty">
        <el-empty description="请在左侧选择或新建文档" />
      </div>
    </div>

    <!-- AI 任务悬浮按钮（右下角） -->
    <NoteAiTaskButton
      :doc-id="selectedDocId"
      @updated="handleDocUpdated"
    />

    <!-- 回收站对话框 -->
    <NoteTrashDialog
      v-model:visible="trashDialogVisible"
      @restored="handleTrashRestored"
      @emptied="handleTrashChanged"
      @purged="handleTrashChanged"
    />

    <!-- 元数据编辑对话框 -->
    <NoteMetadataDialog
      v-model:visible="metadataDialogVisible"
      :doc-id="metadataDialogDocId"
      :all-labels="labels"
      :category-options="categoryOptions"
      @saved="handleMetadataSaved"
    />
  </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import NoteSearchBar from './NoteSearchBar.vue';
import NoteSidebar from './NoteSidebar.vue';
import NoteDocEditor from './NoteDocEditor.vue';
import NoteTrashDialog from './NoteTrashDialog.vue';
import NoteAiTaskButton from './NoteAiTaskButton.vue';
import NoteMetadataDialog from './NoteMetadataDialog.vue';

/**
 * NoteAppPage —— 笔记应用主页面（两栏布局）。
 *
 * 左：分类树（含 doc 叶子节点）/ 标签 / 收藏（NoteSidebar）
 * 右：文档编辑区（NoteDocEditor，内联 Vditor）
 *
 * 右下角浮动 AI 任务按钮（NoteAiTaskButton）
 */
export default {
  name: 'NoteAppPage',
  components: { NoteSearchBar, NoteSidebar, NoteDocEditor, NoteTrashDialog, NoteAiTaskButton, NoteMetadataDialog },
  data() {
    return {
      categoryTree: [],
      allDocs: [],
      labels: [],
      selectedCategoryId: null,
      selectedLabelId: null,
      selectedDocId: null,
      editorKey: 0,
      trashDialogVisible: false,
      metadataDialogVisible: false,
      metadataDialogDocId: null,
    };
  },
  computed: {
    /**
     * 合并 category + doc 为统一树。
     * category 作为分支节点，其下 doc 作为叶子节点。
     * 深拷贝避免污染原始数据；doc 节点用复合 nodeKey 区分。
     */
    mergedTree() {
      const realTree = this.buildMergedTree(this.categoryTree);
      // 在树顶部插入虚拟"无分类"节点（category_id=null 的文档）
      const uncategorizedDocs = this.allDocs
        .filter((d) => d.category_id == null)
        .map((d) => ({
          __type: 'doc',
          nodeKey: `doc_${d.id}`,
          id: d.id,
          name: d.title,
          category_id: null,
        }));
      const uncategorizedNode = {
        __type: 'category',
        nodeKey: 'cat_0',
        id: 0,
        name: '无分类',
        doc_count: uncategorizedDocs.length,
        children: uncategorizedDocs,
      };
      return [uncategorizedNode, ...realTree];
    },
    categoryOptions() {
      return this.flattenCategoryTree(this.categoryTree);
    },
    currentNodeKey() {
      if (this.selectedDocId) {
        return `doc_${this.selectedDocId}`;
      }
      if (this.selectedCategoryId !== null) {
        return `cat_${this.selectedCategoryId}`;
      }
      return null;
    },
  },
  mounted() {
    this.loadAll();
  },
  methods: {
    // ====================================================================
    // 数据加载
    // ====================================================================
    async loadAll() {
      await Promise.all([this.loadCategoryTree(), this.loadLabels(), this.loadAllDocs()]);
    },
    async loadCategoryTree() {
      try {
        this.categoryTree = await window.noteApp.getCategoryTree();
      } catch (err) {
        console.error('load category tree failed', err);
        ElMessage.error('加载分类失败');
      }
    },
    async loadLabels() {
      try {
        this.labels = await window.noteApp.listLabels();
      } catch (err) {
        console.error('load labels failed', err);
      }
    },
    /**
     * 一次性加载全部文档（不按 category 分批拉）。
     * mergedTree computed 在渲染时按 category_id 分组挂载到对应 category 节点。
     */
    async loadAllDocs() {
      try {
        this.allDocs = await window.noteApp.listDocs();
      } catch (err) {
        console.error('load all docs failed', err);
      }
    },
    /**
     * 递归构建 mergedTree。
     * 对每个 category 深拷贝并挂上直属 doc 叶子节点。
     */
    buildMergedTree(nodes) {
      if (!Array.isArray(nodes)) return [];
      return nodes.map((node) => {
        const catNode = {
          __type: 'category',
          nodeKey: `cat_${node.id}`,
          id: node.id,
          name: node.name,
          doc_count: node.doc_count ?? 0,
          children: [],
        };
        catNode.children = this.buildMergedTree(node.children);
        const docs = this.allDocs
          .filter((d) => d.category_id === node.id)
          .map((d) => ({
            __type: 'doc',
            nodeKey: `doc_${d.id}`,
            id: d.id,
            name: d.title,
            category_id: node.id,
          }));
        catNode.children.push(...docs);
        return catNode;
      });
    },
    flattenCategoryTree(tree, result = []) {
      for (const node of tree) {
        const item = { id: node.id, name: node.name, children: [] };
        if (node.children?.length) {
          item.children = this.flattenCategoryTree(node.children);
        }
        result.push(item);
      }
      return result;
    },

    // ====================================================================
    // 树节点选择
    // ====================================================================
    handleTreeSelect({ type, id }) {
      if (type === 'category') {
        this.selectedCategoryId = id;
        this.selectedLabelId = null;
        this.selectedDocId = null;
      } else if (type === 'doc') {
        this.handleSelectDoc(id);
      }
    },
    handleSelectLabel(labelId) {
      this.selectedLabelId = labelId;
      this.selectedCategoryId = null;
    },
    handleSelectDoc(docId) {
      this.selectedDocId = docId;
    },

    // ====================================================================
    // Category CRUD
    // ====================================================================
    async handleCreateCategory({ parentId, name }) {
      try {
        await window.noteApp.createCategory({ name, parent_id: parentId ?? null });
        await this.loadCategoryTree();
        ElMessage.success('分类已创建');
      } catch (err) {
        ElMessage.error(err?.message || '创建失败');
      }
    },
    async handleRenameCategory({ id, name }) {
      try {
        await window.noteApp.updateCategory(id, { name });
        await this.loadCategoryTree();
        ElMessage.success('已重命名');
      } catch (err) {
        ElMessage.error(err?.message || '重命名失败');
      }
    },
    async handleDeleteCategory(id) {
      try {
        await ElMessageBox.confirm(
          '将该分类及其子分类、关联文档移至回收站，确认删除？',
          '移至回收站',
          { type: 'warning', confirmButtonText: '移至回收站', cancelButtonText: '取消' },
        );
        await window.noteApp.deleteCategory(id);
        await this.loadCategoryTree();
        await this.loadAllDocs();
        if (this.selectedCategoryId === id) {
          this.selectedCategoryId = null;
          this.selectedDocId = null;
        }
        ElMessage.success('已移至回收站');
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err?.message || '删除失败');
        }
      }
    },

    // ====================================================================
    // Doc CRUD
    // ====================================================================
    async handleCreateDoc(payload) {
      try {
        const categoryId = payload?.categoryId ?? this.selectedCategoryId ?? null;
        const name = payload?.name?.trim();
        if (!name) return;
        const created = await window.noteApp.createDoc({
          title: name,
          category_id: categoryId,
          label_ids: [],
        });
        if (Array.isArray(payload.labelIds) && payload.labelIds.length > 0) {
          const resolvedIds = await this.resolveLabelIds(payload.labelIds);
          await window.noteApp.updateDoc(created.id, { label_ids: resolvedIds });
          await this.loadLabels();
        }
        await this.loadAllDocs();
        await this.loadCategoryTree();
        // 选中新文档
        this.selectedCategoryId = null;
        this.selectedDocId = created.id;
        ElMessage.success('文档已创建');
      } catch (err) {
        ElMessage.error(err?.message || '创建失败');
      }
    },
    async handleRenameDoc({ id, name }) {
      try {
        await window.noteApp.updateDoc(id, { title: name });
        await this.loadAllDocs();
        await this.$refs.sidebar?.refreshLabelDocs?.();
        await this.$refs.sidebar?.refreshFavoriteDocs?.();
        if (this.selectedDocId === id) {
          this.editorKey += 1;
        }
        ElMessage.success('已重命名');
      } catch (err) {
        ElMessage.error(err?.message || '重命名失败');
      }
    },
    async handleDeleteDoc(id) {
      try {
        await ElMessageBox.confirm(
          '将该文档移至回收站，确认删除？',
          '移至回收站',
          { type: 'warning', confirmButtonText: '移至回收站', cancelButtonText: '取消' },
        );
        await window.noteApp.deleteDoc(id);
        await this.loadAllDocs();
        await this.loadCategoryTree();
        await this.$refs.sidebar?.refreshLabelDocs?.();
        await this.$refs.sidebar?.refreshFavoriteDocs?.();
        if (this.selectedDocId === id) {
          this.selectedDocId = null;
        }
        ElMessage.success('已移至回收站');
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err?.message || '删除失败');
        }
      }
    },
    async handleDocUpdated() {
      await this.loadAllDocs();
      await this.loadCategoryTree();
      await this.$refs.sidebar?.refreshLabelDocs?.();
      await this.$refs.sidebar?.refreshFavoriteDocs?.();
      await this.loadLabels();
    },

    // ====================================================================
    // 元数据编辑
    // ====================================================================
    handleOpenMetadata(docId) {
      if (!docId) return;
      this.metadataDialogDocId = docId;
      this.metadataDialogVisible = true;
    },
    async handleMetadataSaved() {
      await this.loadAllDocs();
      await this.loadCategoryTree();
      await this.$refs.sidebar?.refreshLabelDocs?.();
      await this.$refs.sidebar?.refreshFavoriteDocs?.();
      await this.loadLabels();
      // 同步编辑器工具栏标题
      if (this.$refs.docEditor?.refreshTitle) {
        this.$refs.docEditor.refreshTitle();
      }
    },

    // ====================================================================
    // 搜索跳转
    // ====================================================================
    async handleJumpToResult(result) {
      if (!result || result.type !== 'doc') return;
      try {
        const doc = await window.noteApp.getDoc(result.id);
        if (!doc) {
          ElMessage.warning('该文档不存在或已删除');
          return;
        }
        this.selectedCategoryId = null;
        this.selectedLabelId = null;
        this.selectedDocId = result.id;
      } catch (err) {
        console.error('jump to result failed', err);
        ElMessage.error('跳转失败');
      }
    },

    // ====================================================================
    // 回收站
    // ====================================================================
    async handleTrashRestored(item) {
      if (!item) return;
      if (item.type === 'category' || item.type === 'doc') {
        await this.loadCategoryTree();
      }
      if (item.type === 'label') {
        await this.loadLabels();
      }
      await this.loadAllDocs();
    },
    async handleTrashChanged() {
      await Promise.all([this.loadCategoryTree(), this.loadLabels(), this.loadAllDocs()]);
    },

    // ====================================================================
    // 工具方法
    // ====================================================================
    async resolveLabelIds(ids) {
      const result = [];
      for (const item of ids) {
        if (typeof item === 'number') {
          result.push(item);
        } else if (typeof item === 'string' && item.trim()) {
          try {
            const created = await window.noteApp.createLabel({ name: item.trim() });
            result.push(created.id);
          } catch {
            const existing = this.labels.find((l) => l.name === item.trim());
            if (existing) result.push(existing.id);
          }
        }
      }
      return result;
    },
  },
};
</script>

<style scoped>
/*
 * Aurora Library 视觉基调（与 todo-app 一致）
 */
.note-app-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-dark);
  color: var(--text-on-dark);
  isolation: isolate;
}

.note-app-page::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(900px 540px at 8% -6%,
      rgba(99, 102, 241, 0.10),
      transparent 60%),
    radial-gradient(720px 480px at 102% 108%,
      rgba(139, 92, 246, 0.07),
      transparent 62%),
    radial-gradient(520px 360px at 50% 140%,
      rgba(99, 102, 241, 0.04),
      transparent 70%);
  opacity: 0.9;
}

.search-bar-row {
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  background: linear-gradient(
    180deg,
    rgba(243, 241, 236, 0.55) 0%,
    rgba(243, 241, 236, 0.15) 100%
  );
  border-bottom: 1px solid rgba(99, 102, 241, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: aurora-fade-down 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.columns-row {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.note-sidebar {
  position: relative;
  flex: 4;
  min-width: 0;
  border-right: 1px solid rgba(99, 102, 241, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(243, 241, 236, 0.55);
  animation: aurora-fade-up 0.5s 0.05s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.note-doc-editor {
  position: relative;
  flex: 20;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: aurora-fade-up 0.5s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.note-doc-editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(243, 241, 236, 0.55);
}

.note-doc-editor-empty :deep(.el-empty__description) {
  color: var(--text-on-dark-secondary);
  letter-spacing: 0.02em;
}

@keyframes aurora-fade-down {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes aurora-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .search-bar-row,
  .note-sidebar,
  .note-doc-editor {
    animation: none;
  }
}
</style>
