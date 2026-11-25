# 交接：通用2D播放器与人物切换源码

## 最新追加：02真实双服装包

首个试点已按用户选择生成02制服＋便服八张透明原图，保存提示词并导出224×278 RGBA；单人物双服装manifest、独立外观/rig/性格、来源声明及维护脚本在character-packs/zero-two。真实包预览入口visual-character-pack.html，详细证据见../docs/zero-two-pilot.md。10项真实包浏览器检查、16项Node、原有9项视觉及7项同步浏览器检查通过；2D noEmit为12个根文件零诊断。修复新人物眼白固定高度、花边袖口强加、idle压眨眼和108键预设抚摸轨迹。源图由内置image_gen生成；制服结构对照授权商品，针织便服是桌宠改编。原生MCP/导入/重启/系统输入/OBS仍未验收，不安装环境、不生成EXE、不暂存/提交/推送。


## 当前目标与连续同步阶段

用户已设置完整人物系统目标为active，原文保存于../docs/character-system-goal.txt，逐项证据与缺口在../docs/character-system-status.md。用户已明确首个试点“02：原作制服＋便服”；旧14角色/21草稿仍未验收，不把大肥鱼测试图片当02素材。

连续状态同步新增characterSync.ts、character_sync.rs、桌面发布/OBS消费、身份/epoch/序号/隐私/2秒TTL门控及重连恢复。5项同步Node检查和7项真实Edge检查通过，后者包括双画面及生产OBS前端在模拟SSE/资源端点下加载真实PNG。原有9项播放器/引擎和9项浏览器预览回归通过。详见../docs/character-sync-2d.md。真实IPC/SSE和系统输入、菜单、MCP、持久化及OBS应用仍未运行，Rust仅AST；不安装环境、不生成EXE、不暂存/提交/推送继续有效。当前源码测试与预览不能满足完整目标的最终运行验收。


## 最新追加：浏览器视觉验收

用户在获知无需EXE的独立浏览器视觉方案后明确回复“可以”。已建立visual-2d.html，使用固定Git基线虚拟模块并排对比，真实PNG解码，模拟时钟/随机种子与交互控件。现有Edge实际通过9项浏览器检查，已看待机/抚摸/隐私/布局截图，修复持续抚摸举手和暂停resize清屏；没有安装环境、生成EXE或Git提交/推送。入口与证据见../docs/visual-2d-preview.md，临时材料在tmp/visual-preview，正式截图在outputs/2d-visual-review.png。桌面原生与MCP/OBS仍未运行。


更新日期：2026-11-24（Asia/Shanghai）。项目：D:\Vibe codinng\kurocat，版本5.0.1，HEAD 20be633。以下均为未提交工作区状态；未pull/fetch。

## 共享播放器阶段：最新状态（2026-11-24）

最新授权原文：“继续接入通用 2D 播放器，让大肥鱼先读取外置动作协议，验证动作和互动链路，再接人物包激活与切换。继续不安装环境、不生成新 EXE、不提交或推送，能做的静态检查先做。”此前阶段限制中“尚不实现播放器/激活”由本次授权和进度取代；安装、EXE、Git限制继续有效。

源码已将内置大肥鱼改为共享播放器+外置JSON；人物包完整解码后切换，保留性格/服装差异，隐私/切换/重连清理输入。MCP新增switch_character、set_character_outfit；import可在发布后单独尝试激活。桌面、独立菜单、托盘和OBS资源接入源码。选择独立写character-selection.json并投影settings，防止旧整份设置覆盖；旧猫咪显式激活清除人物选择。原生命中改用当前协议布局并对齐Canvas缩放。仅程序式2D+bodySprites服装可激活，帧包继续存取。

验证：Node播放器/引擎测试、2D范围TS5.9.3 noEmit、协议静态检查、11个Rust文件AST及离线锁定metadata。全项目TS仍有6个既有3D诊断，原因是复用旧依赖目录缺three及其类型。未编译、未运行Rust测试或真实MCP/UI/OBS；OBS连续抚摸/情绪/反应快照仍待实现。详见 ../docs/character-player-2d.md。本轮没有写AppData、安装环境、生成EXE、暂存/提交/推送或新增临时产物。下列各节是历史方案与阶段记录，冲突状态以本节及播放器说明为准。

## 源码与入口

- 格式/导入/注册表：src-tauri/src/characters.rs、character_import.rs；内存快照校验、不可变修订、共享OS锁、原子注册表。原有导入审查修复继续保留，见../docs/character-pack-v1.md。
- 动作契约：src-tauri/protocol/motion-2d.schema.json、dafeiyu-motion-2d.json、calm-motion-2d.json；生成类型与校验器见../docs/character-motion-2d.md。
- 播放器：src/proceduralCharacterRenderer.ts、characterInteraction.ts；dafeiyuRenderer.ts为内置素材/JSON适配，catEngine.ts负责键鼠桥接、尾键分配与绘制层级。
- 加载与选择：src/characterLoader.ts；src-tauri/src/character_selection.rs；config/lib/mcp提供选择投影、刷新、接口及旧猫咪兼容。菜单在characterMenu.ts、main/menuMain、tray；OBS在obsMain/obs.rs。
- 实际行为、MCP参数、故障回退、存储、检查和未验收项集中在../docs/character-player-2d.md。大肥鱼原基线清单在../docs/dafeiyu-reference.md。

## 环境与实际验证

隔离Rust/Cargo 1.100.0位于C:\Users\江户川\Documents\Codex\2026-11-24\k\work\toolchain，MSVC/SDK/WebView2此前核验存在。依赖缓存不齐；不运行cargo build/check/test或tauri dev/build。此次仅Rust编译器AST语法解析和cargo metadata --no-deps --offline --locked，不展开宏、不检查类型/链接。

只读复用C:\Users\江户川\Documents\Codex\2026-11-24\k\kurocat-anime\node_modules内TS5.9.3，项目本身未创建node_modules。2D范围8个根文件0诊断；完整18个源文件6诊断（既有3D文件缺three/类型及衍生implicit-any），没有补装依赖。

Node24测试使用录制型Canvas、图片/浏览器事件替身，覆盖抚摸、并行输入、隐私/退出、性格、资源竞态/失败释放、真实引擎切换及协议消费；不代表视觉或原生集成通过。协议Python检查为2套配置、10个负例、往返和生成一致性。Rust回归测试源码存在，但从未执行。最终测试数量和复现命令见播放器说明；不要把源码测试称作已安装版可用。

## 后续工作与边界

1. 允许构建后先核对Rust类型/宏/链接，再验证选择持久化、并发发布/选择、HTTP/stdio和400ms热刷新、旧猫咪激活回归。
2. 操作真实窗口验证4表情、65/108键布局、朝向、缩放、抚摸/拖动、键鼠尾巴、隐私、菜单/独立菜单/托盘、资源失败和切换。
3. OBS资源/选择与隐私键鼠源码已接，连续抚摸能量/情绪/反应进度尚未同步，需继续实现后再验收一致性。
4. 仅帧动画播放器、ZIP和真正3D均未实现。14角色/21组旧草稿仍未验收；不复用旧EXE作为新交付，不批量替换人物性格。海梦仅采用正片实际服装的约束继续有效。

本轮未写入实际应用数据、安装/下载依赖、生成EXE、Git暂存/提交/推送；未创建临时文件或备份。design-archive/manifest.csv随文档更新内容哈希，旧资产不移动、不删除。实施授权可核对上方用户原文，若需解除构建限制仍由用户明确授权。


## 2026-11-24 后续实施状态（优先于上方历史阶段说明）

用户已选择试点02，原作制服＋便服；当前02真实双服装八张PNG、完整包、共享播放器、菜单/托盘入口及OBS连续状态同步源码已存在。进度以 docs/character-system-status.md 为准；完整目标见 docs/character-system-goal.txt，目标仍未完成。旧14人物/21草稿不是验收资产。

本轮继续修正持久化：注册表增加可选默认服装元数据并兼容旧记录；更新移除服装时投影默认服装但保留原偏好；33处旧设置保存使用共享OS锁重读并合并明确字段；显式选猫与清除人物选择在同一锁内，删除猫咪的备用设置保留人物。文件各自替换，不承诺跨文件事务。OBS发布先读取应用设置，再获取同步缓存锁，避免与设置事件形成反向锁顺序。契约、错误和未验证项见 docs/character-persistence.md。

实际检查：33入口静态审计、10个Rust文件AST语法解析、16项Node、12个2D根文件TS零诊断、2套动作/11负例、02包八张RGBA PNG检查通过。新增Rust并发/兼容/失败恢复测试仅源码，未编译执行；本轮未重跑浏览器。既有浏览器阶段证据见 docs/zero-two-pilot.md 和 docs/character-sync-2d.md。

授权边界继续：不安装环境、不生成新EXE、不运行Cargo build/check/test或Tauri dev/build、不暂存/提交/推送；不写实际AppData，不删除旧文件。真实桌面、HTTP/stdio MCP、系统输入、重启、OBS仍待后续授权和原生验证。


### 后续：加载失败恢复与MCP工作流

OBS加载失败现明确显示备用猫咪、错误码和重试按钮，成功/选猫清提示；OBS资源错误仅返回稳定码，不泄露文件路径，过期修订409触发一次重读。共享加载器修复失败后选旧猫提示残留。MCP格式说明更新为实际共享播放器能力，新增制作/读改存工作流，不覆盖校验与导入的不同工具语义；新增只读复用已安装PNG的完整配置更新测试源码。

实际检查：18项Node、9项同步浏览器（含故意404/409、重试和选猫恢复）、12个2D根文件TS零诊断；相关Rust仅AST。故意网络错误单独记入tmp/visual-sync/report.json，errors为空仅表示无意外异常。截图tmp/visual-sync/obs-load-error.png已查看。当前连接KuroCat MCP仍只暴露7个旧猫咪工具，尚不具备人物导入入口。无需代码的后续操作与前提见docs/zero-two-pilot.md，目标保持active；原生MCP/重启/桌面/OBS未验证。约束不变。


### 后续：输入投影与双服装矩阵

先通过Node复现按住键切换朝向后手部仍占旧键位，再修复程序式人物布局/朝向切换统一清旧输入与抚摸，重复事件不补播。18项Node通过，其中02双服装全部映射VK在两布局/两朝向下共852组按下/repeat/松开检查通过。02真实Edge现12项，新增16组布局/朝向/缩放配置×双服装（32场景）真实键鼠检查及浏览器DPR2命中；原有基准9项和同步9项回归通过，12根2D TS零诊断。详细报告tmp/zero-two/browser-report.json、截图hidpi-2x.png及说明docs/zero-two-pilot.md。

原生暂停分支释放已按住键鼠的路径仅阅读，未运行；浏览器DPR模拟不代表Windows多屏/DPI或系统全局输入已验证。原生MCP/桌面/重启/OBS最终门槛仍未满足，目标active，授权限制不变；不批量制作其他角色来代替试点原生闭环。


### 后续：人物菜单显示与失败恢复

修复普通设置UI覆盖人物/服装标题、人物2D却高亮旧3D、缺包说明隐藏和过期刷新失败覆盖新结果；重新打开菜单重试目录读取，选猫恢复原控件。正式独立菜单7项Edge检查通过、12根2D TS零诊断，真实menu.html/CSS/menuMain/characterMenu执行，原生IPC与开发服务器热更新为替身。桌面main同类显示改动尚未在原生窗口运行。证据tmp/character-menu/report.json与选择/恢复截图，详情docs/character-player-2d.md。原生菜单/托盘/存取仍待验收，授权限制不变，目标未完成。


### 授权更新与原生阶段（覆盖此前禁止构建的历史边界）

用户明确回复“允许本地原生编译和测试”，范围是复用已有隔离工具链/缓存，离线编译测试并生成运行本地调试EXE，数据/端口隔离；仍不安装/下载依赖、不提交/推送、不自动清理。AGENTS.md已记录该授权。

cargo check/build离线通过，Rust库测试60通过、1需要联网用例跳过；首次JSON的12/12.0表示断言失败已修正，仅测试比较改变。新EXE的真实stdio MCP共8项通过，包含真实PNG导入/更新、旧猫咪接口、源目录移动后读回、两个进程并发发布/设置与重启恢复。工作区内stdio发布rename错误5连续复现，Node延迟探针也失败；系统临时隔离数据通过，尚未查明具体目录占用者，不声称问题修复。阶段错误上下文已补充。

详见docs/native-character-validation.md及tmp/native-validation/summary.json。主编译产物约5.13GB，Rust夹具/失败现场保留；另有C:/Users/江户川/AppData/Local/Temp/kurocat-native-validation内stdio夹具。真实桌面/托盘/HTTP/系统输入/OBS仍未运行，前端已有依赖缺Three.js，不能自动补装。目标保持active，不回退为旧的“禁止所有EXE”授权理解。


### 后续：真实桌面、HTTP及原生OBS传输

在已有Vite/Tauri API上运行正式源码的1420开发前端和真实隔离EXE，8项原生集成通过（HTTP换装、stdio400ms刷新、原生IPC/SSE/PNG、旧猫咪恢复、真实菜单窗口打开/换装/关闭、持久化选择读回）。同名包菜单/托盘增加ID，窄菜单文字换行；共享菜单浏览器现8项，TS12根零诊断，Rust再构建/测试60通过1联网跳过。具体脚本、证据及活会话指针见docs/native-character-validation.md和tmp/native-validation/desktop-session.json。

Three.js仍缺，未全量生产构建；原生37421/obs.html为404，开发OBS页面代理到真实原生传输不能代替静态资源或实际OBS软件验收。默认OBS路径未找到程序；Windows全局输入/密码隐私、暂停隐藏/穿透拖动/多屏DPI、托盘仍未实际验收。当前原生会话数据在系统临时目录desktop-1795513814815-2572，前端1420、MCP37420、OBS37421、调试9225。只在确认进程/会话终止后恢复服务；不因超时重复启动。用户真实AppData和已安装程序未更改，约束仍不安装/下载依赖、不提交/推送，目标未完成。


### 后续：真实Windows输入/密码隐私用户验收

用户在专用本地Win32普通EDIT/ES_PASSWORD框完成固定测试键操作，明确确认普通手势、闭眼捂眼、返回恢复均正常。真实SSE聚合为3次匿名密码反馈、私有期0普通键事件、2次隐私切换、97帧合规私有显示；未记录键值。活动为02并发测试副本native-race/uniform，不计额外人物交付。Computer Use窗口激活恢复失败后停止自动输入，由用户配合，没有改用PowerShell UI Automation；额度导致的审批失败在恢复时间后正常重审通过。

证据tmp/native-validation/input-monitor-report.json、input-verification.json，详情docs/native-character-validation.md。监视器已正常停止；隔离桌面复用同一AppData恢复，当前会话记录desktop-session.json，活性需核验。现已请求补齐锁定three/@types三方本地前端依赖的授权；用户未答复前仍不安装/下载。完整目标active，静态OBS/真实OBS、托盘/窗口行为/多屏等仍未完成。


### 2026-11-24生产前端与真实OBS更新

用户已授权锁定的项目本地前端依赖、官方OBS 33.0.3便携验收。全量生产构建及离线嵌入EXE通过，原生OBS静态200且不依赖Vite。真实OBS已观察02双服装/透明度、旧猫咪往返、KuroCat重启后自动重连、经典Win32密码样式框捂眼/键盘遮罩及退出恢复。普通OBS键鼠动作仍未完整验，托盘/窗口行为/多屏及工作区目录发布拒绝访问未解决；3D后续，不提交推送或全局安装、不录制推流。报告与实际范围见docs/native-character-validation.md末节及tmp/native-validation/obs-real-report.json；历史未运行描述不代表当前状态。临时产物保留，无删除。


### 原生窗口及坏资源恢复后续

新增窗口4项和损坏资源恢复4项真实原生检查通过。单屏150%DPI下布局/朝向/窗口缩放、仅OBS显示的隐藏/持续状态/恢复已验；穿透仅验证设置可开关，不冒称物理穿透/Alt、拖动、托盘暂停或多屏通过。隔离已安装PNG副本临时损坏后桌面及正式OBS页面明确错误，原字节finally恢复；加强新人物身份帧断言并复跑，截图确认为02已恢复。OBS恢复页面测试是Edge+真实原生传输，独立于真实OBS软件已验的切换/重连/隐私。证据见docs/native-character-validation.md末节、window-report.json、recovery-report.json；备份及拖动基线保留，无删除。


### 人工鼠标验收等待结论

用户已同意配合；独立mouse-monitor三分钟已结束。实际zero-two/uniform抚摸能量接近1、93帧pet反应、最终能量0，无原始输入记录。用户询问穿透/Alt预期，已说明，最终操作与OBS视觉答复仍待；不标记通过。自动拖动因透明窗口落到下层未进入Canvas，自动OBS捕获被其他应用遮挡，均不算应用通过/失败证据。见docs/native-character-validation.md末节及mouse-verification.json。


### 人工拖动/双端摸头确认及发布路径对照

用户在简化的拖动、桌面/OBS摸头步骤后回复“测试没问题”，已记录为通过；Alt覆盖/解锁未含在最新步骤，仍待。测试窗口未置顶+穿透导致难找，实际visible=true；IPC已置顶/解锁，启动器同步默认置顶。最小六项rename控制通过，但工作区真实MCP导入仍在stdio-1795520686680-8432返回Windows5，不能宣称解决。保留publication-path-report.json和原现场，未重试/改权限/清理。详细证据见docs/native-character-validation.md末节。


## v5.1.0整合最新状态

用户已明确选择整合v5.1.0并保留人物扩展，固定上游41f3de0，27文件已合并，Git HEAD未移动、不提交推送。原始快照及候选在tmp/upstream-v5.1.0。修复复现的上游首次鼠标坐标溢出；新版本Rust65通过/1跳过、Node18、菜单浏览器9、真实stdio8、原生桌面8、窗口4、资源恢复4、模式3通过。真实OBS已刷新并确认02制服展示。当前隔离进程报告5.1.0；旧版用户确认拖动/双端摸头/Alt恢复证据保留，新版受影响人工输入/隐私/Alt和托盘暂停仍待验。工作区发布Windows5仍未定位，最小控制不等同真实发布。完整记录与限制见docs/upstream-v5.1.0-integration.md；原始目标保持未完成。


### v5.1.0热更新资源闭环

新增真实MCP资源更新5项通过，当前独立副本native-race/uniform。另存PNG源后替换idle，validate/import，桌面及正式OBS解码新字节，旧请求409但旧文件不变，完整manifest读回，最后经MCP恢复原修订。真实OBS已观察更新/恢复，全程无手动刷新。报告与保留的临时源见docs/native-character-validation.md末节、live-update-report.json及obs-real-live-update-report.json。测试版托盘已加悬停标识，暂停验收正询问用户方便，未开始监视或宣称通过。


### v5.1.0原生托盘暂停实测完成

用户在重新找到测试输入框和明确标记的托盘后，完成普通输入→托盘暂停隐藏→左键托盘恢复，确认表现正常。真实visibility三态，隐藏约26秒0输入事件、260帧连续状态，恢复7/7键事件。监视已终止、不保存键值；第一轮缺入口只有baseline，不算通过。详情见tray-verification.json及docs/native-character-validation.md末节；托盘人物/服装选择、其他新版人工验证仍待，目标未完成。


### MCP第9项与新版隐私边界

真实stdio新增“帧包导入成功/激活失败分别报告”运行检查，完整读回并保持旧活动人物，共9项通过，stdio-latest指向新系统临时夹具。新版自动密码样式框聚焦未成功，没发送测试键，privacy-v510-monitor仅baseline且已停止；等待用户答复人工配合，不算通过。详见docs/native-character-validation.md末节，目标保持未完成。


### 发布路径诊断新证据

真实02导入单测在工作区TMP/TEMP复现Windows5；当前旧夹具9文件占用查询0，源/目标目录所需访问权GRANTED；最小Rust加根锁五项通过。最长目标文件249字符，未据此定性根因。仍无GUI/MCP传输依赖解释，未改发布算法、重试或权限，失败现场与新诊断小EXE均保留。见publication-diagnostic-summary.json、rust-workspace-import.log及docs/native-character-validation.md末节。隐私配合答复仍待，不发送新测试输入。


### 最新发布策略与工作区实测

去掉整目录rename：先在未登记revision写齐校验快照，sync后原子替换注册表，未提交目录不被API读取。已登记不可变；未登记中断写入只有已有字节全匹配才补齐，损坏拒绝。旧暂存/修订不删除。工作区Rust67通过/1跳过，工作区MCP改源内容模式9项、系统临时移动源目录模式9项、新EXE桌面8项与热更新恢复5项通过。工作区测试驱动的源目录移动仍EPERM，系统限制未定性；不能把替代模式冒称目录移动通过。细节见character-pack-v1.md最新发布流程、native-character-validation.md末节及publication-fix-report.json。


### MCP复制配置与当前操作文档

修复stdio导出缺少当前数据目录绑定：只加入Windows APPDATA/其他平台HOME绝对路径，保留原command/args/url，不导出其他环境，不改客户端设置。旧EXE断言env缺失后停止，新EXE实际配置启动stdio客户端3项通过，保留用户当前旧猫咪选择并核验目录及包修订同源。旧实例退出码0后同数据启动；mcp-config-report.json和失败报告保留。现有Codex连接仍为旧猫咪工具，没有自动接入新人物服务。status文档已整理为当前11项表，历史快照在tmp/native-validation/status-before-current-summary.md；zero-two-pilot顶部为实际菜单及隔离启动入口。详见docs/native-character-validation.md末节。
