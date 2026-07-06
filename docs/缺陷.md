## 缺陷

### D0001 vditor无法离线使用

vditor需要连接到cdn，因此在没有网络的环境中无法使用vidtor组件

对于离线使用，后续改进方案是安装 vite-plugin-static-copy 并配置它将 node_modules/vditor/dist/* 复制到 public/vditor/*，然后将 cdn:
   '/vditor' 设置为指向该路径。但这是一个独立的选择性增强功能 — 目前的在线 CDN 方案可以工作，且这正是 qmin 一直在使用的方案。