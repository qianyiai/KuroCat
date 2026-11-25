# 桌面与 OBS 的 2D 连续状态同步

2026-11-25。连续同步已通过Node、浏览器、真实原生IPC/SSE及部分实际OBS验证；具体轮次与限制见 [当前交付状态](character-system-status.md)。复现步骤见[通用验证说明](character-fixture-validation.md)。当前目标只验通链路，不新增人物或配置客户端。

## 入口

原版对照：<http://127.0.0.1:1422/visual-2d.html>。
双画面同步：<http://127.0.0.1:1422/visual-sync-2d.html>。
沿用 scripts/preview-character-2d.mjs 和已有 Vite 启动；不安装依赖或构建 Tauri。双画面使用真实 PNG/Canvas、生产发送器/接收器和播放器，传输及包切换由本页模拟，不代表原生服务联调通过。

## 传递的内容

characterSync.ts 的 CharacterStateFrame 为短期运行快照，version=1：

- identity：人物 ID、内容修订、服装 ID；内置大肥鱼使用固定 builtin-2d-v1 身份。
- epoch：原生进程产生的十进制代次；sequence：该代次中的递增序号；capturedAt：本机 Unix 毫秒。
- state：privacy、petEnergy、petInside、moodTier、typingHeat、blushLevel、blinkRemainingMs、phaseMs，以及可为空的 reaction。
- reaction：事件池 idle/typing/pet、池内索引及 elapsedMs；接收端从相同修订的协议取动作，不接收外部表达式或动作代码。

快照没有键值、键名、按住列表、图片字节、本地路径或台词。它不保存到磁盘，不加入可导入的人物包。现有键鼠 input SSE 继续承担输入事件，新增快照只补连续状态。

TypeScript 和 Rust 边界均拒绝未知字段，检查版本、ID、修订、代次、序号、时间、有限数值、范围及隐私约束。privacy=true 时普通能量、情绪和反应必须清空。双方数值检查有针对性 JS 测试及 Rust 测试源码；Rust 类型及运行契约仍待编译验证。

## 发送、失效与消费

桌面 main.ts 在 OBS 开启且当前使用程序式 2D 时，最多每100ms发送一次；同一发送器只允许一条 IPC 请求链在途。先取得原生 epoch，再从实际已加载的播放器截取状态。人物资源未加载完成时不冒用目标人物身份。

Rust character_sync.rs 只允许主桌面窗口通过 IPC 发布，核对当前人物/服装/注册修订、隐私状态、序号和时间。它缓存最新一帧，发送 characterState SSE，并加入新连接的初始 state 快照。缓存有效期2秒。

主窗口发布器重启、设置刷新或隐私切换使旧缓存失效，广播 characterReset。原生快照发布和 reset 按同一锁顺序发出。接收端拒绝旧 epoch、乱序/重复序号、超过2秒的快照及不匹配的身份/隐私状态。

导入素材异步加载时只保留最新、仍然新鲜的待用快照；身份匹配后再应用。断线和超时清输入与连续状态，重连接受当前快照，不恢复旧按住按键。新 EventSource 连接重置代次比较基准，使原生进程重启后的较小 epoch 也能恢复；旧连接的事件不跨入新连接。

OBS 播放器不再独立抽取性格反应或计算手速情绪。抚摸能量按来源的区域状态衰减，反应按 elapsedMs 继续，眨眼按剩余时间继续，呼吸/举手/隐私摇摆/尾巴待机使用对齐的动画时间。隐私事件继续优先于快照。

显式 OBS breed 查询覆盖表示独立展示该猫咪，关闭桌面人物加载及连续状态跟随，保留既有覆盖入口。

## 一致性范围

已实现的跟随对象是人物身份、抚摸能量、情绪等级、热度、腮红、反应选择/进度、眨眼和基础动画相位。延迟造成的能量/反应进度差按消息年龄补偿。

手部/身体弹簧、输入到达时机、粒子及水纹仍分别模拟，不同步所有顶点和随机粒子，不承诺逐像素相同。OBS 自定义布局/朝向/缩放可改变投影；切换和重连清按住状态是明确行为。原生隐藏窗口的定时器、系统输入、队列溢出与实际 OBS 浏览器源仍须真实运行验证。

## 检查与恢复

```text
node --test scripts/test-character-sync.mjs scripts/test-character-player.mjs scripts/test-engine-integration.mjs
node scripts/test-visual-sync.cjs <已有Playwright所在node_modules>
```

先按[通用验证说明](character-fixture-validation.md)启动本地预览服务。浏览器测试的SSE与资源端点为替身，真实原生IPC/SSE由独立桌面测试验证；具体结果以[当前状态](character-system-status.md)为准。

缺素材、解码失败或修订过期时显示可见提示并提供重试，选猫后清除人物提示。过期修订重读一次元数据再加载；普通错误不静默清除桌面选择。故意注入的404/409单独记录为预期请求错误，不等同于零网络失败。

截图和报告统一写入tmp/visual-sync/；不依赖本机历史报告或开发机路径。物理鼠标笔划与真实OBS浏览器源的效果仍须按其实际运行证据判断。
