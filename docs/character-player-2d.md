# 通用 2D 播放器与人物切换

2026-11-25。本页描述当前共享播放器实现。隔离测试版已原生编译运行；实际检查结果与边界见 [当前状态](character-system-status.md)，复现方式见 [通用验证说明](character-fixture-validation.md)。现有安装版与既有客户端不会自动获得新接口。真正人物3D留待后续阶段。

## 实现与数据流

`dafeiyuRenderer.ts` 现在是内置素材适配器，直接读取 `src-tauri/protocol/dafeiyu-motion-2d.json`。原专用程序绘制迁入 `proceduralCharacterRenderer.ts`，内置大肥鱼与导入人物使用同一个播放器；不按人物 ID 增加渲染分支。`characterInteraction.ts` 管理抚摸笔划、能量、反应权重及冷却，服装自己的 motion2d 决定锚点、布局、配色、动作和性格。

全局输入 → CatEngine → 共享播放器 → 身体四 PNG、眼睛/手/可选尾巴及粒子。键盘与鼠标继续使用主引擎绘制。角色包不包含可执行代码。只有同时包含有效 `motion2d` 和 `bodySprites` 的服装可激活；旧帧/图集包继续支持校验、保存及读取，尚无帧动画播放器。程序式播放由 motion2d 控制，旧 actions/animations/behavior 数据继续校验保存，尚不驱动帧状态机，也不为大肥鱼新增原本没有的睡眠动画。

当前消费规则：

- 键鼠及尾巴分别保持和释放；repeat 不重复击打。忙碌、Enter 收尾与边缘选键读取协议；尾巴关闭时不获取按键。
- 悬停不增加抚摸能量，按住左右鼠标时不计笔划；反转笔划达到阈值才增长能量。人物反应有独立权重、冷却、位移、角度和表情；抚摸可打断待机/打字反应。
- 隐私抢占表情、输入、粒子与普通反应；进入/退出均清理输入、手速与旧反应。换人物、换服装和 OBS 断线/重连清理旧输入，repeat 不补播上一个状态的按键。
- `characterLoader.ts` 在四张 PNG 全部解码后替换播放器；较早异步请求不能覆盖较新选择，同一 ID/revision/outfit 不重建状态，所有对象 URL 在任务结束时释放。修订过期重读一次。
- 资源失败时桌面显示备用猫咪及错误提示，保留人物选择，用户可重选人物或点击猫咪恢复。失败回调不清除持久化选择，避免误清除稍后发起的切换。OBS 仅记录本页加载错误，不修改桌面选择。

默认大肥鱼保持原有四图与主要动作参数。当前是程序动作迁移及录制型 Canvas 检查，没有完成真实窗口逐帧视觉对比。旧实现中固定的程序几何仍作为该 profile 的绘制算法；这不是任意人体骨架或 Cubism 播放器。

## 激活、换装和兼容

MCP 新增：

```json
{"name":"switch_character","arguments":{"id":"dafeiyu-reference","outfitId":"dafeiyu"}}
```

```json
{"name":"set_character_outfit","arguments":{"id":"my-character","outfitId":"casual"}}
```

switch_character 激活指定人物，省略 outfitId 时优先使用记忆的服装，否则使用默认服装。set_character_outfit 保存指定人物的服装；该人物正在激活时立即换装，否则只记忆偏好。显式不存在的服装返回 OUTFIT_NOT_FOUND，不静默改选。选择前重新验证已发布的完整修订与可播放能力。

`import_character_package(..., activate=true)` 在发布成功后尝试激活。若激活失败，返回已经导入的 entry、`activated=false` 及 `activationError`，不把已完成发布误报成整个导入失败。`activationSupported` 表示至少一套服装可播放，不保证默认/记忆的那一套一定可激活；可播放服装 ID 另见 `entry.playableOutfits`。需要确定服装时单独调用 switch_character。

桌面菜单、独立菜单窗口与原生托盘新增人物/服装入口。无可播放能力的服装不提供激活。包激活期间强制 2D，并使用包内尾巴/部件配置；原来的 renderMode 设置保留，切回普通猫后恢复。点击旧猫咪入口、MCP switch_cat、activate=true 的 upsert_cat，以及显式 catBreed 设置更新都会清除人物选择；普通猫咪修改与删除不取消正在激活的人物。

选择写入应用数据根目录的 `character-selection.json`，字段为 activeCharacterId 和 characterOutfits。与包发布、猫咪目录修改共用 OS 文件锁，完整写入临时文件、sync 后替换；失败临时文件保留，不自动删除。settings.json 对外投影这两个字段，但旧整份设置写入不拥有它们；前端改为发送实际设置补丁。后续已将 33 处旧设置写入口迁移为共享锁内重读并只合并明确字段，更新默认服装投影及猫咪选择顺序；保存契约和部分成功边界见 [持久化说明](character-persistence.md)。

400ms 轮询检查注册表 generation 和完整选择值，覆盖 stdio；HTTP 成功调用立即通知。更新包的修订变化会重新加载资源。原生命中循环缓存验证后的布局，按 Canvas 的右下锚定/缩放映射坐标，并使用当前服装的抚摸椭圆与键鼠区域，不在每个光标周期解码包。

## OBS 边界

源码已接配置/选择刷新、共享播放器、修订资源及隐私/键鼠输入：

- `/characters/<id>/manifest`：仅返回当前激活人物，去掉本地 packagePath。
- `/characters/<id>/<revision>/assets/...`：仅提供已声明身体 PNG，校验完整内容修订及路径；响应 no-store。
- 选择通过原设置快照/SSE传递；断线/重连清输入，包激活时 OBS 强制 2D。

连续状态快照跟随抚摸能量、情绪、性格反应进度、眨眼和基础动画相位；Node、模拟传输浏览器及真实原生IPC/SSE已有对应检查。本轮没有重新操作真实OBS应用。手部物理与粒子仍独立，范围与边界见 [连续同步说明](character-sync-2d.md)。

## 验证和维护

当前使用内置大肥鱼与通用测试夹具，无需已删除人物资源。测试声明的primary/alternate两种配置复用相同四图，验证独立性格、袖口与配置切换；不声称是两套新美术服装。

```text
node --test scripts/test-character-player.mjs scripts/test-character-sync.mjs scripts/test-engine-integration.mjs
python scripts/generate-motion-types.py --check
python scripts/check-motion-contract.py
python scripts/check-character-fixture.py
npm run build
```

原生编译及stdio、桌面、更新、恢复的先后顺序和独立数据目录见[通用验证说明](character-fixture-validation.md)。Rust/Node/浏览器/原生HTTP的结果各自有覆盖范围，不替代物理系统输入或真实OBS软件的人工验收。

布局/朝向切换会清理旧按键、鼠标按住、手速和抚摸；repeat不重建旧输入。菜单选择后显示实际身份及2D模式，失败保留原选择并展示错误，切回猫咪恢复旧设置。导入人物与角色外观标题共用menu-scale-label；长名称单行省略、完整悬停提示、固定按钮高度及细滚动条由共享样式维护。

程序式2D仍受dafeiyu-body-v1几何算法约束；真正3D、任意骨架及帧动画播放未纳入本实现。
