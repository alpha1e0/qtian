<template>
  <div class="todo-doc-editor">
    <div ref="editorRef" class="vditor-container" />
    <div class="editor-footer">
      <el-input v-model="docName" placeholder="文档名称" size="small" class="doc-name-input" />
      <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
    </div>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus';

/**
 * TodoDocumentEditor — vditor Markdown 编辑器
 *
 * - 支持新建 / 编辑已存在文档
 * - 附件（图片）上传：调用 saveAttachment 落盘并插入 local-resource:// URL
 * - CDN 本地化：指定 cdn 为 vditor 包的 dist 路径（electron-vite 开发模式可解析）
 *
 * 注意：打包时需将 vditor/dist 复制到 resources，并将 cdn 指向打包路径。
 *       本期先使用 npm 包路径，Phase 6 打磨时处理打包资源。
 */
export default {
  name: 'TodoDocumentEditor',
  props: {
    docId: { type: Number, default: null },
    itemId: { type: Number, default: null },
    categoryId: { type: Number, default: null },
  },
  data() {
    return {
      vditor: null,
      docName: '',
      currentContent: '',
      saving: false,
      loaded: false,
    };
  },
  async mounted() {
    await this.loadDocument();
    await this.initEditor();
  },
  beforeUnmount() {
    if (this.vditor) {
      this.vditor.destroy();
      this.vditor = null;
    }
  },
  methods: {
    async loadDocument() {
      if (this.docId) {
        try {
          const doc = await window.todoApp.getDocument(this.docId);
          if (doc) {
            this.docName = doc.name;
            this.currentContent = doc.content || '';
          }
        } catch (err) {
          ElMessage.error('加载文档失败');
          console.error(err);
        }
      } else {
        this.docName = '新文档';
        this.currentContent = '';
      }
    },
    async initEditor() {
      // 动态导入 vditor（体积大，按需加载）
      const VditorModule = await import('vditor');
      const Vditor = VditorModule.default;

      this.vditor = new Vditor(this.$refs.editorRef, {
        height: '70vh',
        mode: 'ir',
        placeholder: '在此输入 Markdown...',
        value: this.currentContent,
        // CDN 本地化：指向 node_modules/vditor/dist
        // 开发环境 Vite dev server 可解析；生产打包需复制到 resources
        cdn: 'node_modules/vditor/dist',
        cache: { enable: false },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', '|',
          'line', 'quote', 'list', 'ordered-list', 'check', '|',
          'code', 'inline-code', 'link', 'table', '|',
          'upload', 'record', 'preview', 'fullscreen',
        ],
        upload: {
          handler: (files) => this.handleUpload(files),
        },
        after: () => {
          this.vditor.setValue(this.currentContent);
          this.loaded = true;
        },
      });
    },
    /**
     * 附件上传处理：将文件二进制传给主进程保存，
     * 返回 local-resource:// URL 后插入到编辑器。
     */
    async handleUpload(files) {
      if (!files || files.length === 0) return;
      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          const ext = this.getExtension(file.name);
          const url = await window.todoApp.saveAttachment(
            Array.from(new Uint8Array(buffer)),
            ext,
          );
          // 插入 Markdown
          if (this.isImageExt(ext)) {
            this.vditor.insertValue(`![${file.name}](${url})\n`);
          } else {
            this.vditor.insertValue(`[${file.name}](${url})\n`);
          }
        } catch (err) {
          ElMessage.error(`上传失败: ${file.name}`);
          console.error(err);
        }
      }
    },
    getExtension(filename) {
      const idx = filename.lastIndexOf('.');
      return idx >= 0 ? filename.slice(idx) : '';
    },
    isImageExt(ext) {
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(
        ext.toLowerCase(),
      );
    },
    async handleSave() {
      if (!this.docName.trim()) {
        ElMessage.warning('请输入文档名称');
        return;
      }
      this.saving = true;
      try {
        const content = this.vditor ? this.vditor.getValue() : this.currentContent;
        await window.todoApp.saveDocument({
          id: this.docId || undefined,
          name: this.docName.trim(),
          content,
          todo_item_id: this.itemId ?? null,
          todo_category_id: this.categoryId ?? null,
        });
        ElMessage.success('文档已保存');
        this.$emit('saved');
      } catch (err) {
        ElMessage.error(err.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
.todo-doc-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vditor-container {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.editor-footer {
  display: flex;
  gap: 8px;
  align-items: center;
}

.doc-name-input {
  flex: 1;
}
</style>
