<template>
  <!--
    自封装右键菜单：fixed 定位跟随鼠标 (clientX, clientY)。
    抛弃 el-dropdown 是因为它的 popper 锚到触发元素而非鼠标坐标，无法实现真正跟随。
    视觉沿用 Element Plus dropdown 样式（class 名复用），保持 UI 一致。

    关键点：
    - 视口边界翻转：右/下放不下时翻到左/上
    - 点外面 / ESC / 滚动 / 再次右键 → 关闭
    - 子元素点击后由父组件决定是否关闭（command 处理后调 close）
  -->
  <ul
    v-if="visible"
    ref="menuRef"
    class="el-dropdown-menu todo-ctx-menu"
    :style="menuStyle"
    role="menu"
    @click.stop
    @contextmenu.prevent.stop="onReContext"
  >
    <template v-for="(item, idx) in items" :key="item.command + '-' + idx">
      <li v-if="item.divided" class="el-dropdown-menu__item--divided el-popper-divider" />
      <li
        class="el-dropdown-menu__item todo-ctx-item"
        :class="{ 'is-disabled': item.disabled }"
        role="menuitem"
        @click="onItemClick(item)"
      >
        <el-icon v-if="item.icon" class="todo-ctx-icon">
          <component :is="item.icon" />
        </el-icon>
        <span>{{ item.label }}</span>
      </li>
    </template>
  </ul>
</template>

<script>
import { markRaw } from 'vue';

/**
 * 通用右键菜单（跟鼠标）。
 * items 结构：{ command, label, icon?, disabled?, divided? }
 */
export default {
  name: 'TodoContextMenu',
  props: {
    visible: { type: Boolean, default: false },
    // 鼠标 clientX
    x: { type: Number, default: 0 },
    // 鼠标 clientY
    y: { type: Number, default: 0 },
    // 菜单项数组，按渲染顺序展示
    items: { type: Array, default: () => [] },
  },
  emits: ['command', 'close'],
  data() {
    return {
      // 计算后的渲染坐标（边界翻转后）
      renderX: 0,
      renderY: 0,
    };
  },
  computed: {
    menuStyle() {
      return {
        left: `${this.renderX}px`,
        top: `${this.renderY}px`,
      };
    },
  },
  watch: {
    visible(v) {
      if (v) {
        // 先按鼠标原始坐标占位，下一帧 DOM 测量后翻转
        this.renderX = this.x;
        this.renderY = this.y;
        this.$nextTick(() => {
          this.adjustForViewport();
          this.attachListeners();
        });
      } else {
        this.detachListeners();
      }
    },
  },
  beforeUnmount() {
    this.detachListeners();
  },
  methods: {
    /**
     * 视口边界翻转：菜单右/下方向放不下时翻到左/上。
     * 必须在 DOM 渲染后调用，否则 menuRef 无尺寸。
     */
    adjustForViewport() {
      const el = this.$refs.menuRef;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = this.x;
      let y = this.y;
      if (x + rect.width > vw - 4) {
        x = Math.max(4, this.x - rect.width);
      }
      if (y + rect.height > vh - 4) {
        y = Math.max(4, this.y - rect.height);
      }
      this.renderX = x;
      this.renderY = y;
    },
    onItemClick(item) {
      if (item.disabled) return;
      // icon 用 markRaw 透传，组件对象不应进入响应式
      this.$emit('command', { command: item.command, icon: markRaw(item.icon) });
      this.$emit('close');
    },
    /**
     * 在已打开菜单上再次右键：关闭当前，让外层 contextmenu handler 重开（位置切换）。
     * 这里不直接消费新坐标，避免和外部 handler 抢事件。
     */
    onReContext() {
      this.$emit('close');
    },
    onDocClick() {
      this.$emit('close');
    },
    onEsc() {
      this.$emit('close');
    },
    onScroll() {
      // 滚动时位置会失真，直接关闭
      this.$emit('close');
    },
    attachListeners() {
      // nextTick 后绑定，避免触发的 click/contextmenu 同帧把菜单立刻关掉。
      // 不用 capture：菜单内 @click.stop 会阻止内嵌点击冒泡到 document，
      // 只有外部点击/右键才会到这里 → 关闭。
      document.addEventListener('click', this.onDocClick);
      document.addEventListener('contextmenu', this.onDocClick);
      document.addEventListener('keydown', this.onEsc);
      window.addEventListener('scroll', this.onScroll, true);
      window.addEventListener('resize', this.onScroll, true);
    },
    detachListeners() {
      document.removeEventListener('click', this.onDocClick);
      document.removeEventListener('contextmenu', this.onDocClick);
      document.removeEventListener('keydown', this.onEsc);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('resize', this.onScroll, true);
    },
  },
};
</script>

<style scoped>
/* fixed 定位，z-index 高于 el-tree 与 dialog */
.todo-ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  padding: 6px 0;
  margin: 0;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  list-style: none;
  user-select: none;
}

.todo-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  cursor: pointer;
  transition: background 0.15s ease;
}

.todo-ctx-item:hover {
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-color-primary, #409eff);
}

.todo-ctx-item.is-disabled {
  color: var(--el-text-color-disabled, #c0c4cc);
  cursor: not-allowed;
}

.todo-ctx-item.is-disabled:hover {
  background: transparent;
  color: var(--el-text-color-disabled, #c0c4cc);
}

.todo-ctx-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.todo-ctx-menu .el-popper-divider {
  height: 1px;
  margin: 4px 0;
  padding: 0;
  background: var(--el-border-color-lighter, #ebeef5);
}
</style>
