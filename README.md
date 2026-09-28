# 键盘焦点巡检（Keyboard Focus Inspector）

Chrome Manifest V3 扩展，帮助验收人员在动态页面上追踪真实键盘焦点：记录每次焦点进入的序号、时间、元素与可访问名称，识别正 tabindex、焦点进入 aria-hidden 区域、按钮/链接无名称等问题，并支持滚动定位、问题筛选与 JSON 导出。

## 加载扩展

1. 运行 npm ci 安装锁定依赖。
2. 运行 npm run build 构建到 dist/ 目录。
3. 打开 chrome://extensions，开启「开发者模式」，点击「加载已解压的扩展程序」，选择 dist 目录。

## 启动示例页

扩展只在 http/https 页面注入，不能直接打开 file:// 页面：

    npx serve examples

然后访问终端提示的 http://localhost:.../demo.html。示例页包含普通控件、名称优先级、正 tabindex、aria-hidden、无名称链接、动态删除/插回节点、布局变化与 iframe 场景。

## 核心操作

1. 在示例页（或任意 http/https 标签页）点击工具栏图标打开弹窗。
2. 点击「开始巡检」后才会注入内容脚本并监听；重复开始不会重复监听。
3. 用 Tab / Shift+Tab 移动焦点，或用鼠标点击控件；列表实时出现记录。
4. 「暂停」停止记录但保留历史，「继续」恢复；「清空」停止巡检、删除历史并移除页面描边。
5. 勾选「只看问题项」筛选问题；点击任意历史项，页面滚动到原元素并显示红色描边，滚动、缩放和布局变化时持续跟随。
6. 原元素被删除时该条标记「已移除」，不会因为选择器或文字相同而误绑到新元素；把同一 DOM 节点插回后可再次定位。
7. 点击「导出 JSON」下载全部记录快照（名称、问题与依据均为事件发生时的快照）。
8. 关闭弹窗后记录继续；重新打开弹窗自动恢复当前标签页状态。各标签页相互独立。整页导航后内容脚本随页面卸载，自动停止并清空。
9. 在 chrome://、Chrome 网上应用店、file:// 等受限页面，弹窗会显示明确提示且不注入。

## 记录规则

- 来源：焦点进入前最后一次按键为 Tab / Shift+Tab 时标记对应键盘来源；mousedown 时间窗内的焦点标记「鼠标」；其余（如脚本 focus()）标记「其他」。扩展只监听，不拦截按键、不改变焦点，并忽略扩展自身元素。
- 名称优先级：aria-labelledby 引用文本 → aria-label → 关联 label（labels / 包裹 / for）→ 元素自身文本；绝不读取输入框 value。
- 问题依据在事件发生时快照：正 tabindex（值大于 0）、焦点元素自身或祖先带 aria-hidden（值不为 "false"）、无名称的 button/a。
- 范围：只检查顶层普通文档中的 DOM；iframe 内部与 Shadow DOM 内部未检查，弹窗底部常驻该提示。

## 代码结构

- src/shared/messages.ts：消息、状态与记录 DTO。
- src/content/naming.ts：可访问名称解析。
- src/content/recorder.ts：focusin 采集、来源判定、问题检测、WeakRef 节点追踪。
- src/content/highlight.ts：跟随滚动/缩放的 fixed 描边层。
- src/content/index.ts：内容脚本入口，重复注入保护与消息分发。
- src/popup/：React 弹窗（控制、列表、筛选、导出）与注入/通信 API。

## 测试

运行 npm test，使用 Vitest + jsdom 执行名称解析、采集/状态机、来源判定、问题快照、节点删除/插回与受限页面识别等 19 个用例。
