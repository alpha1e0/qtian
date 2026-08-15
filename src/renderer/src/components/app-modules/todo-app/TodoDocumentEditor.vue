<template>
  <!--
    文档编辑抽屉：从右往左展开，覆盖 app 页面 3/4 宽度（spec §9.x 优化）。
    使用 el-drawer 替代原右栏 600px 固定宽布局，给 vditor 编辑器更宽裕的横向空间。
    启用 modal 遮罩并依赖默认 close-on-click-modal，点击抽屉外空白区域可关闭抽屉。
    vditor 初始化推迟到 @opened，避免在隐藏容器上初始化导致尺寸为 0。
  -->
  <el-drawer
    v-model="drawerVisible"
    direction="rtl"
    size="75%"
    :with-header="false"
    append-to-body
    class="todo-doc-drawer"
    @opened="onDrawerOpened"
    @closed="onDrawerClosed"
  >
    <div class="todo-doc-editor">
      <!--
        顶部工具条：标题路径（左）+ 字数统计 + 保存 + 关闭（右）。
        关闭按钮与保存按钮成组放在右上角，符合常见编辑器布局；
        关闭显式带"关闭"文字 + x 图标，避免原纯图标按钮不易识别。
      -->
      <div class="md-editor-toolbar">
        <el-text size="small" type="primary" truncated class="title-path">
          {{ titlePath || docName || '未命名文档' }}
        </el-text>
        <el-text size="small" type="info" class="word-count">{{ contentLength }} 字</el-text>
        <el-button-group>
          <el-button
            size="small"
            :loading="saving"
            type="primary"
            plain
            aria-label="保存文档"
            class="save-btn"
            @click="handleManualSave"
          >
            <el-icon><Select /></el-icon>
          </el-button>
          <el-button
            size="small"
            type="info"
            plain
            aria-label="关闭文档编辑（Esc）"
            class="close-btn"
            @click="handleClose"
          >
            <el-icon><Close /></el-icon>
          </el-button>
        </el-button-group>
        
      </div>

      <el-input
        v-model="docName"
        placeholder="文档名称"
        size="small"
        suffix-icon="Edit"
        class="doc-name-input"
      />

      <!--
        编辑器区域：外层 wrapper 承载 v-loading 遮罩（不能直接挂在 vditor 容器上，
        vditor 构造会接管容器内部 DOM，遮罩会被冲掉）。
        容器带 :key="docId"：切换文档时强制替换整个元素——vditor 的构造/init 是
        异步链（CDN 拉 i18n + lute 脚本），上次会话若在 init 未完成时关闭抽屉，
        迟到的 init 仍会把旧文档渲染进容器（"僵尸" DOM），仅清空状态无法根治，
        必须连同容器元素一起换掉。
        遮罩条件覆盖完整加载窗口：IPC 拉取（isLoadingDoc）+ vditor 异步 init（loaded）。
      -->
      <div
        class="vditor-wrapper"
        v-loading="isLoadingDoc || !loaded"
        element-loading-text="文档加载中..."
      >
        <div :key="docId ?? 'new'" ref="editorRef" class="vditor-container" />
      </div>

      <!-- 文本替换对话框 -->
      <el-dialog
        v-model="replacementVisible"
        width="350"
        draggable
        append-to-body
        @keyup.enter.stop="doReplace"
        @opened="onReplaceDialogOpened"
      >
        <template #header>
          <div class="custom-dialog-header">
            <el-text type="info" size="large">替换</el-text>
          </div>
        </template>
        <el-form :model="replacementForm">
          <el-form-item label="源" label-width="50px">
            <el-input
              ref="replaceSourceInput"
              v-model="replacementForm.source"
              autocomplete="off"
              placeholder="输入要查找的文本（支持正则）"
              aria-label="源文本"
            />
          </el-form-item>
          <el-form-item label="替换为" label-width="50px">
            <el-input
              v-model="replacementForm.dst"
              autocomplete="off"
              placeholder="输入替换后的内容"
              aria-label="目标文本"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <div class="dialog-footer">
            <el-button type="primary" @click="doReplace" aria-label="确认替换">确认</el-button>
            <el-button @click="cancelReplace" aria-label="取消替换">取消</el-button>
          </div>
        </template>
      </el-dialog>
    </div>
  </el-drawer>
</template>

<script>
import { ElMessage } from 'element-plus';
import { Select, Close } from '@element-plus/icons-vue';
// 静态导入 vditor 主类（与 qmin/VditorPanel.vue 同款），由 Vite 打包进产物。
// 动态 import('vditor') 在抽屉这种延迟挂载场景下，race 风险高（用户在 await
// 期间关抽屉、ref 失效等），静态导入消除了这一类时序问题。
import Vditor from 'vditor';
// 显式静态引入 vditor 样式，避免运行时 cdn 加载失败导致编辑器"白板"。
// vditor 默认通过 options.cdn 异步注入 CSS，dev 模式下路径解析不稳定；
// 静态 import 由 Vite 接管，产物中恒定存在，编辑器首屏即可见。
import 'vditor/dist/index.css';

/** 自动保存间隔（毫秒） */
const AUTO_SAVE_INTERVAL = 30000;
/** 支持的图片扩展名（小写） */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

/**
 * TodoDocumentEditor — vditor Markdown 编辑器（el-drawer 抽屉版）
 *
 * 设计变更：
 * - 由原右栏 600px 固定宽布局，改为从右往左展开的 el-drawer，覆盖 app 2/3 宽度
 * - non-modal：保留对底层详情的可交互性，便于跨条目复制资料
 * - vditor 初始化推迟到 drawer @opened，确保容器有真实尺寸
 * - 关闭时销毁 vditor 实例，避免后台持有 DOM / 定时器
 *
 * 保留生产力功能（沿用原实现）：
 * - 顶部工具条：标题路径 + 字数统计 + 手动保存
 * - 自动保存（30s 间隔，加载中跳过）
 * - 手动保存 Ctrl+S
 * - 文本替换 Ctrl+R（支持正则）
 * - 图片样式替换（markdown img → <img> 标签）
 * - 纯文本粘贴（追加剪贴板文本）
 * - 附件上传：file.path 走主进程读文件，剪贴板走 buffer
 *
 * 协议策略：统一使用 `local-resource://`（项目复用），不引入 `local-resource-md://`。
 */
export default {
  name: 'TodoDocumentEditor',
  components: { Select, Close },
  props: {
    /** 抽屉可见性（v-model:visible） */
    visible: { type: Boolean, default: false },
    docId: { type: Number, default: null },
    itemId: { type: Number, default: null },
    listId: { type: Number, default: null },
    /** 顶部展示的标题路径（例如 "待办条目标题 / 文档名"），由父组件拼装 */
    titlePath: { type: String, default: '' },
  },
  emits: ['update:visible', 'saved'],
  data() {
    return {
      vditor: null,
      docName: '',
      currentContent: '',
      saving: false,
      loaded: false,
      contentLength: 0,
      autoSaveTimerId: null,
      isLoadingDoc: false,
      /** 加载请求序号：快速连续切换文档时只应用最后一次请求的响应，防旧响应晚到覆盖 */
      loadSeq: 0,
      replacementVisible: false,
      replacementForm: { source: '', dst: '' },
    };
  },
  computed: {
    /** v-model:visible 代理 — 把 prop 转 emit */
    drawerVisible: {
      get() {
        return this.visible;
      },
      set(v) {
        this.$emit('update:visible', v);
      },
    },
  },
  watch: {
    /**
     * 抽屉打开/关闭切换：
     * - 打开（false→true）：预加载文档内容到 currentContent（vditor 尚未初始化，
     *   真正初始化由 @opened → onDrawerOpened 完成，此时容器已有真实尺寸）
     * - 关闭（true→false）：由 onDrawerClosed（@closed）兜底销毁 vditor
     *
     * 注意：不要在 visible 翻 true 时立刻 initEditor —— el-drawer 此时刚开始
     * 开启动画，body 尚未渲染，$refs.editorRef 为 undefined，会导致 vditor 以
     * undefined 元素构造，后续 destroy 抛 "Cannot read properties of undefined"。
     */
    visible(v) {
      if (v) {
        this.loadDocument();
      }
    },
    /**
     * docId 变化（用户在抽屉已打开时点击另一个文档 chip）：
     * - 抽屉已开：走 switchDocument —— 销毁旧 vditor + 重拉内容 + 在替换后的
     *   新容器元素上重建。不能只 setValue 复用实例：vditor init 是异步
     *   （CDN 拉 i18n/lute），上一个实例若在 init 未完成时被关闭会成为
     *   "僵尸"，其 DOM 仍渲染旧文档，必须连同容器元素（模板 :key）一起替换。
     * - 抽屉未开：什么都不做，content 由 visible watch 在打开时拉取
     */
    docId() {
      if (this.visible) {
        this.switchDocument();
      }
    },
  },
  async mounted() {
    document.addEventListener('keydown', this.handleKeyDown);
    // 若挂载时抽屉已是打开态（如搜索跳转直开），直接加载并等待 @opened 初始化
    if (this.visible) {
      await this.loadDocument();
    }
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.stopAutoSave();
    this.destroyEditor();
  },
  methods: {
    /**
     * 抽屉打开状态下切换文档：销毁旧实例 → 拉取新内容 → 等待 :key 替换后的
     * 新容器元素 → 重新初始化 vditor。
     * 全程 loaded=false（destroyEditor 置位），v-loading 遮罩持续覆盖，
     * 用户只看到 loading，不会看到旧文档残留或半初始化状态。
     */
    async switchDocument() {
      this.destroyEditor();
      await this.loadDocument();
      // 等待 :key 变化触发元素替换、$refs.editorRef 指向新元素
      await this.$nextTick();
      // 加载期间用户可能已关闭抽屉
      if (!this.visible || !this.$refs.editorRef) return;
      await this.initEditor();
    },
    /**
     * 加载已有文档内容；新建时给默认值。
     *
     * 防旧内容闪现：请求发出前先同步清空标题 / 内容 / 已就绪的 vditor ——
     * 否则 IPC 往返窗口内编辑器仍显示上一篇文档。
     * 防乱序覆盖：loadSeq 序号守卫，快速连续切换时丢弃晚到的旧响应。
     */
    async loadDocument() {
      this.docName = '';
      this.currentContent = '';
      // 仅对"已就绪"的实例 setValue：vditor 构造后内部 init 未完成时
      // setValue 会因内部状态缺失抛错，此时由 after 回调兜底同步 currentContent
      if (this.vditor && this.loaded) {
        this.vditor.setValue('');
      }
      if (!this.docId) {
        this.docName = '新文档';
        return;
      }
      this.isLoadingDoc = true;
      const requestSeq = ++this.loadSeq;
      try {
        const doc = await window.todoApp.getDocument(this.docId);
        // 已发起更新的加载请求，本次响应作废
        if (requestSeq !== this.loadSeq) return;
        if (doc) {
          this.docName = doc.name;
          this.currentContent = doc.content || '';
          // 已就绪实例直接同步值；未就绪时由 initEditor 的 value/after 兜底同步
          if (this.vditor && this.loaded) {
            this.vditor.setValue(this.currentContent || '');
          }
        }
      } catch (err) {
        ElMessage.error('加载文档失败');
        console.error(err);
      } finally {
        if (requestSeq === this.loadSeq) {
          this.isLoadingDoc = false;
        }
      }
    },
    /**
     * 抽屉完全展开后初始化 vditor（此时容器已有真实尺寸）。
     * 重复调用幂等：已初始化时跳过。
     * 先 await loadDocument 确保 currentContent 就绪再构造 —— vditor 的
     * value 只在构造时刻读取一次，之后依赖 after 回调二次同步，晚到内容
     * 会以 setValue 追加一次可见跳变，先就绪可让首屏即最终内容。
     */
    async onDrawerOpened() {
      if (this.vditor) return;
      await this.loadDocument();
      await this.$nextTick();
      if (!this.$refs.editorRef) {
        console.warn('TodoDocumentEditor: editorRef missing on @opened, skip init');
        return;
      }
      await this.initEditor();
      this.startAutoSave();
    },
    /**
     * 抽屉关闭动画结束后销毁 vditor + 停止自动保存（保留组件实例以便再次打开）。
     * 用 @closed 而非 @close：避免动画进行中删除 vditor DOM 造成视觉跳动。
     */
    onDrawerClosed() {
      this.stopAutoSave();
      this.destroyEditor();
    },
    /**
     * 销毁 vditor 实例并清理状态。
     * 始终尝试 destroy（内部会解绑全局监听）：元素即使已脱离 DOM，对其做
     * innerHTML 还原等操作也无害；真正的风险是内部 init 未完成时内部状态
     * 缺失、destroy 抛错 —— 此时实例连同容器元素一起被丢弃（:key 替换 /
     * 组件卸载），残留 DOM 不可见，仅告警不阻塞。
     */
    destroyEditor() {
      if (this.vditor) {
        try {
          this.vditor.destroy();
        } catch (err) {
          console.warn('vditor destroy failed', err);
        }
        this.vditor = null;
      }
      this.loaded = false;
    },
    /** 初始化 vditor 实例 */
    async initEditor() {
      if (this.vditor) return;
      // 容器必须存在且在 DOM 中，否则 vditor 构造会以 undefined 元素落库，
      // 后续 destroy / setValue 全部失败（"Cannot read properties of undefined"）。
      if (!this.$refs.editorRef || !this.$refs.editorRef.isConnected) {
        console.warn('TodoDocumentEditor: editorRef unavailable, skip init');
        return;
      }
      // 防御性清空容器：残留的"僵尸" vditor DOM（init 未完成即关闭抽屉、
      // 迟到的 init 渲染结果）会污染新实例，并被误存为 originalInnerHTML
      // 在下次 destroy 时还原成旧文档。对干净容器此操作为幂等 no-op。
      if (this.$refs.editorRef.innerHTML.trim() || this.$refs.editorRef.classList.contains('vditor')) {
        this.$refs.editorRef.innerHTML = '';
        this.$refs.editorRef.classList.remove('vditor');
        this.$refs.editorRef.removeAttribute('style');
      }

      this.vditor = new Vditor(this.$refs.editorRef, {
        minHeight: 400,
        height: '100%',
        mode: 'ir',
        placeholder: '在此输入 Markdown...',
        value: this.currentContent,
        // 显式中文（vditor 默认即 zh_CN，写出来便于排错）
        lang: 'zh_CN',
        // 不设置 cdn —— 使用 vditor 默认在线 CDN（jsdelivr）。
        //
        // 为什么不像原代码那样设 'node_modules/vditor'：
        // 1. vditor 内部 URL 形如 `${cdn}/dist/<sub>`（i18n / math / icons 等），
        //    历史配置 'node_modules/vditor/dist' 会拼出 `dist/dist/...` 双重 dist 404；
        // 2. 即便修正为 'node_modules/vditor'，Vite dev server 对 /node_modules/<pkg>/<path>
        //    的直接 URL 服务策略不稳定（HMR 期间偶发 404、被依赖优化器拦截等）；
        // 3. 生产打包后 /node_modules/ 路径完全不存在（产物只在 dist-electron/renderer/），
        //    需要额外的 vite 插件把 vditor/dist 复制过去才能工作；
        // 4. 参考 qmin/VditorPanel.vue 的成熟做法：不设 cdn，让 vditor 走在线 CDN，
        //    逻辑最简单且 dev/prod 行为一致，离线场景作为后续可选增强。
        cache: { enable: false },
        counter: {
          enable: true,
          after: (length) => {
            this.contentLength = length;
          },
        },
        toolbar: [
          'edit-mode', '|',
          'headings', 'bold', 'italic', 'strike', 'link', '|',
          'emoji', 'check', 'table', 'list', 'ordered-list', 'outdent', 'indent', '|',
          'quote', 'line', 'code', 'inline-code', 'insert-before', '|',
          'undo', 'redo',
          {
            name: 'text-replace',
            tipPosition: 's',
            tip: '文本替换 (Ctrl+R)',
            className: 'text-replace-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8Zm15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0ZM5.5 4.002h3.11c1.71 0 2.741.973 2.741 2.46 0 1.138-.667 1.94-1.495 2.24L11.5 12H9.98L8.52 8.924H6.836V12H5.5V4.002Zm1.335 1.09v2.777h1.549c.995 0 1.573-.463 1.573-1.36 0-.913-.596-1.417-1.537-1.417H6.835Z"/></svg>',
            click: () => { this.replacementVisible = true; },
          },
          {
            name: 'img-replace',
            tipPosition: 's',
            tip: '图片样式替换',
            className: 'img-replace-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882L3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l2.922-1.559a.5.5 0 0 0 0-.882l-7.5-4zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"/></svg>',
            click: () => this.doReplaceImg(),
          },
          {
            name: 'raw-paste',
            tipPosition: 's',
            tip: '纯文本粘贴',
            className: 'raw-paste-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 1.5V13a1 1 0 0 0 1 1V1.5a.5.5 0 0 1 .5-.5H14a1 1 0 0 0-1-1H1.5A1.5 1.5 0 0 0 0 1.5z"/><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v11A1.5 1.5 0 0 0 3.5 16h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 16 9.586V3.5A1.5 1.5 0 0 0 14.5 2h-11zm6 8.5a1 1 0 0 1 1-1h4.396a.25.25 0 0 1 .177.427l-5.146 5.146a.25.25 0 0 1-.427-.177V10.5z"/></svg>',
            click: () => this.rawPaste(),
          },
          { name: 'more', toolbar: ['export', 'outline', 'preview', 'help'] },
        ],
        upload: {
          accept: 'image/*,.mp3,.wav',
          max: 8 * 1024 * 1024,
          fieldName: 'file',
          handler: (files) => this.handleUpload(files),
        },
        after: () => {
          // 同步初始内容到编辑器，避免 value 未生效。
          // init 等待期间组件可能已销毁实例（快速关闭/切换文档），需判空；
          // loaded 置位同时是 v-loading 遮罩的解除条件
          if (this.vditor) {
            this.vditor.setValue(this.currentContent || '');
            this.loaded = true;
          }
        },
      });
    },
    /** 启动自动保存定时器（防重） */
    startAutoSave() {
      this.stopAutoSave();
      this.autoSaveTimerId = setInterval(() => this.autoSaveDocument(), AUTO_SAVE_INTERVAL);
    },
    stopAutoSave() {
      if (this.autoSaveTimerId) {
        clearInterval(this.autoSaveTimerId);
        this.autoSaveTimerId = null;
      }
    },
    /** 自动保存：加载中或无 docId 时跳过 */
    async autoSaveDocument() {
      if (!this.docId || this.isLoadingDoc || this.saving) return;
      try {
        await this.persistDocument(true);
      } catch (err) {
        console.error('auto save failed:', err);
      }
    },
    /** 手动保存（按钮或 Ctrl+S）：含 UI 反馈 */
    async handleManualSave() {
      if (this.saving) return;
      if (!this.docName || !this.docName.trim()) {
        ElMessage.warning('请输入文档名称');
        return;
      }
      this.saving = true;
      try {
        await this.persistDocument(false);
        ElMessage.success('文档已保存');
        this.$emit('saved');
      } catch (err) {
        ElMessage.error(err.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
    /**
     * 持久化文档到主进程。
     * - 新建（无 docId）：创建后由父组件通过 saved 事件重新打开
     * - 已存在：仅更新 name + content
     * @param isAuto - 自动保存为 true，跳过空内容保存并吞掉异常
     */
    async persistDocument(isAuto) {
      const content = this.vditor ? this.vditor.getValue() : this.currentContent;
      // 空内容不持久化，避免覆盖历史
      if (!content || !content.trim()) {
        return;
      }
      const payload = {
        id: this.docId || undefined,
        name: this.docName.trim(),
        content,
        todo_item_id: this.itemId ?? null,
        todo_list_id: this.listId ?? null,
      };
      await window.todoApp.saveDocument(payload);
      if (isAuto) {
        // 自动保存静默通知父组件可刷新标题
        this.$emit('saved');
      }
    },
    /**
     * 附件上传 handler：
     * - file.path 存在（用户选择文件）→ 走 saveAttachmentFromPath，主进程读盘，避免 IPC buffer 序列化
     * - 否则（剪贴板粘贴）→ 渲染进程读取 arrayBuffer 后走 saveAttachment
     * 返回 null 表示全部成功，非空字符串作为 vditor 错误提示。
     *
     * 图片走 `local-resource://` 伪协议，由主进程注册的 protocol handler 解析为本地文件流。
     */
    async handleUpload(files) {
      if (!files || files.length === 0) return null;
      let hasError = false;
      for (const file of files) {
        try {
          let url;
          if (file.path) {
            url = await window.todoApp.saveAttachmentFromPath(file.path);
          } else {
            const buf = await file.arrayBuffer();
            const ext = this.getExtension(file.name);
            url = await window.todoApp.saveAttachment(
              Array.from(new Uint8Array(buf)),
              ext,
            );
          }
          const ext = this.getExtension(file.name);
          const md = this.isImageExt(ext)
            ? `![${file.name}](${url})\n`
            : `[${file.name}](${url})\n`;
          this.vditor.insertValue(md);
        } catch (err) {
          hasError = true;
          ElMessage.error(`上传失败: ${file.name}`);
          console.error(err);
        }
      }
      return hasError ? '部分文件上传失败' : null;
    },
    /** 文本替换：支持正则，提示替换次数 */
    doReplace() {
      if (!this.vditor) return;
      if (!this.replacementForm.source) {
        ElMessage.error('替换内容不能为空');
        this.replacementVisible = false;
        return;
      }
      let count = 0;
      let regex;
      try {
        regex = new RegExp(this.replacementForm.source, 'g');
      } catch (err) {
        ElMessage.error('正则表达式无效');
        return;
      }
      const original = this.vditor.getValue();
      const next = original.replace(regex, () => {
        count++;
        return this.replacementForm.dst;
      });
      if (count > 0) {
        this.vditor.setValue(next);
        ElMessage.success(`替换成功 ${count} 处`);
      } else {
        ElMessage.info(`未找到 ${this.replacementForm.source}`);
      }
      this.cancelReplace();
    },
    cancelReplace() {
      this.replacementForm.source = '';
      this.replacementForm.dst = '';
      this.replacementVisible = false;
    },
    onReplaceDialogOpened() {
      this.$nextTick(() => {
        this.$refs.replaceSourceInput?.focus?.();
      });
    },
    /** 图片样式替换：将 markdown ![]() 转为 <img height=400> 标签 */
    doReplaceImg() {
      if (!this.vditor) return;
      const original = this.vditor.getValue();
      let count = 0;
      const regex = /!\[(.*?)\]\((.*?)\)/g;
      const next = original.replace(regex, (_m, p1, p2) => {
        count++;
        return `<img src='${p2}' height='400' alt='${p1}'/>`;
      });
      if (count > 0) {
        this.vditor.setValue(next);
        ElMessage.success(`成功替换 ${count} 处`);
      } else {
        ElMessage.info('未找到可替换内容');
      }
    },
    /** 纯文本粘贴：从剪贴板读取文本并追加到当前内容末尾 */
    async rawPaste() {
      if (!this.vditor) return;
      try {
        const text = await navigator.clipboard.readText();
        const original = this.vditor.getValue();
        this.vditor.setValue(original + text);
        ElMessage.success('已粘贴纯文本');
      } catch (err) {
        ElMessage.error('剪贴板读取失败');
        console.error(err);
      }
    },
    /** 关闭抽屉：仅切换 visible，由 el-drawer 触发 @close → onDrawerClose 清理 vditor */
    handleClose() {
      this.$emit('update:visible', false);
    },
    /** 全局键盘快捷键：Ctrl+S 保存，Ctrl+R 替换 */
    handleKeyDown(event) {
      if (!this.visible) return; // 抽屉关闭时不响应
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        this.handleManualSave();
      } else if (key === 'r') {
        event.preventDefault();
        this.replacementVisible = true;
      }
    },
    getExtension(filename) {
      const idx = filename.lastIndexOf('.');
      return idx >= 0 ? filename.slice(idx) : '';
    },
    isImageExt(ext) {
      return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
    },
  },
};
</script>

<style scoped>
/*
 * 抽屉主体：在 el-drawer__body 内构建独立滚动列，承担编辑器纵向布局。
 * el-drawer 默认 __body 有 padding，这里覆盖为 0 以让编辑器贴边铺满。
 */
.todo-doc-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 8px 16px 16px;
  box-sizing: border-box;
  background: var(--surface-card, #ffffff);
}

.md-editor-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 6px 0;
  gap: 10px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(99, 102, 241, 0.10);
}

.title-path {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: var(--text-on-dark, #1f1e2e);
}

.word-count {
  flex-shrink: 0;
  opacity: 0.7;
  font-feature-settings: 'tnum';
}

.close-btn,
.save-btn {
  flex-shrink: 0;
}

/*
 * 文档名称输入框：宽度 70% + 水平居中，suffix Edit 图标作"可编辑"语义提示。
 * 父容器 .todo-doc-editor 为 flex column，故用 align-self:center 实现水平居中。
 * 内层用 :deep() 注入柔和底色与圆角，让标题区从工具条到编辑器之间有视觉缓冲。
 */
.doc-name-input {
  flex-shrink: 0;
  width: 70%;
  align-self: center;
  margin: 6px 0 10px;
}
.doc-name-input :deep(.el-input__wrapper) {
  background: rgba(99, 102, 241, 0.04);
  border-radius: 18px;
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.18) inset;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}
.doc-name-input :deep(.el-input__wrapper:hover) {
  background: rgba(99, 102, 241, 0.07);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.32) inset;
}
.doc-name-input :deep(.el-input__wrapper.is-focus) {
  background: var(--surface-card, #ffffff);
  box-shadow: 0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 3px rgba(99, 102, 241, 0.12);
}
.doc-name-input :deep(.el-input__inner) {
  text-align: center;
  letter-spacing: 0.2px;
}
.doc-name-input :deep(.el-input__suffix) {
  color: var(--accent, #6366f1);
  opacity: 0.7;
}

/*
 * vditor 外层 wrapper：接管 flex 剩余高度并承载 v-loading 遮罩（遮罩需 position:relative 宿主）。
 * 内层容器铺满 wrapper，高度链保持 flex column + height:100% 不变。
 */
.vditor-wrapper {
  position: relative;
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
}

/* 遮罩用不透明底色：半透明遮罩下旧内容残影仍可见，起不到遮蔽作用 */
.vditor-wrapper :deep(.el-loading-mask) {
  background-color: var(--surface-card, #ffffff);
}

/*
 * vditor 容器：占据 wrapper 剩余高度。
 * height:100% 依赖父容器有明确高度，因此上面 .todo-doc-editor 用 flex column + height:100%。
 */
.vditor-container {
  flex: 1;
  min-height: 320px;
  border: 1px solid rgba(99, 102, 241, 0.16);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-card, #ffffff);
}

.custom-dialog-header {
  margin: 3px 8px 10px 10px;
}
</style>

<!--
  全局样式（unscoped）：覆盖 el-drawer 默认 body padding，让 .todo-doc-editor 铺满。
  仅作用于本应用挂载的 .todo-doc-drawer，避免污染其他 el-drawer。
  遮罩层叠加 backdrop-filter 与 indigo 色调，与 Aurora 主题氛围一致。
-->
<style>
.todo-doc-drawer .el-drawer__body {
  padding: 0;
  display: flex;
  flex-direction: column;
}
/* 仅对本抽屉的遮罩做轻微模糊 + indigo 染色，强化"浮层"层级感 */
.el-overlay:has(.todo-doc-drawer) {
  background-color: rgba(30, 27, 50, 0.42);
  backdrop-filter: blur(2px);
}
</style>
