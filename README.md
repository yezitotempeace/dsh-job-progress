# dsh-job-progress

后台任务（下载、构建、渲染……）一跑起来，会话右下角就出现一张浮动卡片：
每个任务一行，带进度条、百分比、耗时和最新输出；全部结束后自动消失。

## 显示什么

| 部分 | 说明 |
| --- | --- |
| 标签 | 任务标签，通常是启动它的命令 |
| 状态 | 圆点：绿=运行中、黄=停止中、红=失败、灰=已结束 |
| 进度条 | 优先用任务自带的 `progress`；没有就从输出尾部解析 `45%`、curl 表格行、`1.2 GB / 3.4 GB`；都认不出就显示不确定进度条 |
| 百分比 | 有数字时显示在右侧 |
| 耗时 | 运行中实时走秒，结束后定格 |
| 最新输出 | 最后一行（去 ANSI、压缩空白、截断 180 字符），有 ETA 时附「剩余 3m 20s」 |

最多显示 4 行，多出来的显示「还有 N 个」。

## 交互

- 点标题栏收起成右下角小胶囊：`后台任务 2 个` + 总进度条 + 平均百分比；再点展开。
- **整张卡片可以拖动**：按住标题栏拖到屏幕任意位置，位置记在浏览器（`localStorage` 的 `dsh-job-progress/position`），刷新后还在；收起后的胶囊也能拖。拖出屏幕会被拉回可视区。
- 任务结束后保留 **8 秒**显示最终状态，然后卡片消失（没有任务时完全不渲染）。
- 只观察**当前会话**的任务；输出流按需订阅，卡片卸载或任务结束即释放。

## 能认出哪些进度

wget、curl（默认表格和 `-#` 进度条）、apt、pip、npm，以及任何往标准输出打 `NN%` 的程序。
识别是启发式的：

- 优先用 DSH 任务自身的 `progress` 字段（有的任务会自己上报）；
- 否则扫输出尾部 40 行找百分比，兼容 `\r` 刷新的进度；
- 再不行就显示不确定进度条 + 最新输出，至少能看到它在动。

## 实现要点

| 部分 | 做法 |
| --- | --- |
| 数据 | `ctx.jobs.state`（roster）+ `ctx.jobs.watchRows(sessionId)` + `ctx.jobs.observe(sessionId, id)` |
| 挂载 | `conversation.session.header.actions`（只取 `sessionId`），内容用 `createPortal` 渲染到 `document.body` |
| 进度解析 | 纯函数 `parseProgress(text)`：去 ANSI → 按 `\r\n` 切 → 从尾部找 `%` / curl 表格 → 速度、ETA、字节比 |
| 渲染 | 固定定位，`z-index: 60`，默认右下角（`bottom` 含安全区偏移），主题 token 取色 |
| 拖动 | pointer 事件 + `setPointerCapture`；移动超过 4px 才算拖，否则算点击；位置钳制在视口内并写 `localStorage` |

不读会话内容，不发额外网络请求（只订阅任务输出流）。

## 测试

```bash
node test/smoke.mjs
# [job-progress] PASS    （19 项）
```

覆盖：bundle 注册与 inject、`parseProgress` 的 wget/apt/curl 表格/curl 进度条/pip/ANSI/
`\r` 刷新/字节比/ETA、普通日志不误判、空输出、拖动位置的边界钳制。

## 安装

```bash
dsh plugin --profile web add github:yezitotempeace/dsh-job-progress
```

然后把 `dsh-job-progress` 加进 profile `package.json` 的 `dsh.profile.bundles`，重启 Web。
（`plugin add` 只装依赖，bundle 不会自动挂载。）

本机开发：仓库放进 `/root/dsh-job-progress`，`dependencies` 写
`"dsh-job-progress": "link:/root/dsh-job-progress"`，`dsh.profile.bundles` 加 `dsh-job-progress`，
建 `node_modules/dsh-job-progress` 链接，重启 Web。

## 限制

- 任务必须往标准输出打进度才能解析出百分比；写进文件的进度看不到。
- 卡片固定右下角，窄屏上位于输入框上方，可收起成胶囊。
- 输出流由 DSH 的 `job.follow` 提供，卡片关闭后不再保留输出。

## 许可

MIT
