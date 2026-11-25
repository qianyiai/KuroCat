# 人物系统原生验收记录

2026-11-24，用户明确授权“允许本地原生编译和测试”：仅复用已有隔离工具链与缓存，可生成、运行本地调试 EXE；仍不安装或下载依赖、不暂存/提交/推送。此前文档的“不生成EXE、Rust未执行”属于历史阶段，不再代表本轮授权或证据。

## 已完成

- 隔离 Rust/Cargo 1.100，`--target x86_64-pc-windows-msvc --offline --locked`，真实 `cargo check` 通过。
- `cargo test --lib`：60 通过、0 失败、1 跳过。跳过的是原有需要访问 GitHub 的在线更新测试，没有开启网络或把它计为通过。
- 初次测试有1项失败：旧JSON往返断言将12与12.0判为不同。修正仅限测试的JSON数值比较，仍递归核对全部字段、数组长度和数值；首次失败日志保留。
- `cargo build --bin KuroCat` 离线成功，生成本地调试程序；没有替换或重新打包已安装应用。
- 使用新程序的真实 `--mcp` stdio，8项检查通过：初始化及7个人物工具、8张真实PNG校验/双服装发布激活、重名和坏服装拒绝、移动复制源后完整字节/声明读回、内联完整配置更新与失败保留旧版、双进程并发发布/独立设置保存、旧猫咪接口兼容、进程重启后恢复人物/服装/完整配置。

stdio检查是直接运行新EXE，通过真实JSON-RPC管道、真实文件系统与OS文件锁完成；不是浏览器传输替身。它没有验证桌面窗口、400ms轮询、原生托盘、HTTP MCP、系统键鼠输入或OBS。

## 路径与复现

工具链仍为 `C:\Users\江户川\Documents\Codex\2026-11-24\k\work\toolchain`；仅在执行进程中设置CARGO_HOME、RUSTUP_HOME和PATH，使用已有cache，未修改全局环境。

主产物在 `tmp/native-validation/`：cargo-check.log、cargo-test.log、cargo-test-first-failure.log、cargo-build.log、summary.json、stdio-latest.json及target/。调试程序为 `target/x86_64-pc-windows-msvc/debug/KuroCat.exe`，指纹记录在summary.json。

Rust测试APPDATA、LOCALAPPDATA、TEMP/TMP隔离到该目录。测试创建的包/目录夹具保留，已移除两个新夹具析构函数中的自动删除行为。

真实stdio复现：

```powershell
node scripts/test-native-character-mcp.mjs '<本地调试EXE绝对路径>' '<隔离测试数据父目录>'
```

脚本只移动自己复制的约0.7MB输入，不修改character-packs/zero-two或真实AppData；每轮使用新数据目录，关闭自己启动的stdio进程，保留数据。最后一轮通过报告路径由stdio-latest.json记录。

## 尚未解决的目录环境差异

把stdio数据放在工作区tmp/native-validation下，真实包校验通过，但暂存目录发布rename连续返回Windows错误5（拒绝访问），失败暂存保留。独立Node目录重命名探针也失败，等待100/500/1000ms仍失败，因此没有盲目加入重试。已为导入错误补充“Cannot publish staged character revision”阶段上下文。

仅把隔离stdio数据移到系统临时目录 `C:\Users\江户川\AppData\Local\Temp\kurocat-native-validation` 后，同一EXE和相同素材的8项检查通过。目录监控是待验证假设，尚未定位具体占用者，不能宣称工作区目录问题已修复或所有路径均通过。Rust测试在工作区的独立夹具中能通过，这一差异同样保留。

系统临时目录的最新通过数据为 `stdio-1795513489170-31228`，报告包含具体证据。该目录是为定位环境差异使用的例外位置；未改真实用户配置，未停止共享预览服务。

## 原生桌面、HTTP和OBS传输阶段

复用已有Vite和@tauri-apps/api，`scripts/preview-native-2d.mjs`启动1420开发前端；正式main/menu/obs源码执行，没有替换渲染器或使用旧前端包。仅OBS开发页的/obs/events和/characters/代理到真实原生37421端口。Three.js仍未安装，不能据此声称全量生产前端已构建。

`scripts/run-native-character.mjs`复制已验证stdio数据到独立系统临时目录，启动新EXE。APPDATA、LOCALAPPDATA、WebView2和TEMP隔离；使用37420 MCP、37421 OBS、9225本机WebView调试端口，测试实例不置顶、不自动启动系统登录。`--resume`复用同一AppData；先确认旧PID已退出，避免重复启动。真实用户AppData和已安装程序未修改。

`scripts/test-native-character-desktop.cjs '<已有Playwright node_modules>'`通过8项：原生进程读取持久化选择、原生桌面解码真实PNG并通过Tauri IPC发布连续状态、HTTP换装到桌面和OBS身份、Origin拒绝、独立stdio写入被400ms监视器刷新、OBS正式前端经真实SSE/manifest/PNG展示、旧猫咪退出与人物恢复、真实Tauri右键菜单窗口的可见性/换装/关闭。截图desktop-character.png、obs-native-transport.png、native-menu.png及desktop-report.json已保存并查看。

该场景发现两个合法包可有相同显示名：菜单/托盘重名时增加角色ID，窄菜单的长标签改为换行；真实菜单检查确认ID/服装不会横向截断。独立菜单浏览器回归现8项，2D TypeScript 12根文件零诊断；Rust重新离线构建及60通过/1跳过回归。托盘标签修复已编译，尚未实际操作原生托盘。

报告errors=[]表示无意外错误；开发页缺favicon的404及选猫期间在途旧manifest请求的404单独记录在expectedNetworkErrors，恢复后桌面/OBS无加载错误提示。没有把所有网络请求称为零错误。

曾确认首个原生进程正常退出后复用同一数据重启；另有1420开发服务器退出码1导致一次检查失败，确认其会话终止后恢复同一服务再跑，最终8项通过。保留desktop-failure.json，不以连接超时直接重启存活进程。

## 当前缺口

原生37421/obs.html返回404，因为还没有当前源码的dist生产包。通过的是开发页面接真实原生传输，不是真实OBS软件或打包静态资源。默认OBS安装位置未找到程序，未据此断言所有磁盘均未安装。已有前端依赖目录和已检查候选位置缺Three.js，不能自动安装、下载或用旧包替代。

仍须验收：全量前端与原生静态OBS资源、真实OBS软件、Windows全局键鼠/密码隐私、暂停/隐藏/拖动/穿透、多屏/DPI、原生托盘、缺资源与重连、工作区目录发布错误的具体原因。当前应用连接仍是旧MCP工具，新调试实例的真实HTTP/stdio已测；没有改用户的MCP连接配置。

target当前约5.12GB，均为本轮本地构建产物；失败日志、工作区stdio/probe夹具及上述系统临时夹具也保留，没有自动清理或备份。清理target会需要重新编译，清理夹具会失去对应故障现场，均等待用户明确要求。最终目标保持未完成。

当前测试会话指针在tmp/native-validation/desktop-session.json，数据根为系统临时目录kurocat-native-validation/desktop-1795513814815-2572。1420服务和隔离原生实例可继续用于后续测试；活性必须检查句柄/端口，不能只凭记录文件重启。主汇总summary.json记录当前EXE指纹；截图、日志和所有夹具不自动清理。

## 用户配合的真实Windows输入与密码隐私

本轮原生桌面实例在确认前一进程退出码0后，使用同一隔离AppData恢复。专用测试界面由scripts/native-input-fixture.rs使用已有rustc和Windows系统库编译，只有普通EDIT、ES_PASSWORD样式EDIT和关闭按钮，没有账户、网络、文本读取或存储。未安装依赖。

Computer Use曾因会话内核重置重新初始化；刷新句柄后仍返回coordinate input geometry is unavailable / failed to activate captured window，因此停止自动输入，没有改用PowerShell UI Automation绕过技能边界。自动审批另曾因额度未能完成，恢复时间过后通过正常审批重新核验，没有绕过审查。

用户明确回复“现在配合验收”，按三步手动在普通框/密码样式框按固定测试键并回到普通框，随后回复“已完成”。用户另确认普通按键手部有动作、密码框闭眼捂眼、回普通框恢复，均正常。

真实原生SSE聚合记录：普通keyDown 24/keyUp 11，密码期间privacyTyping 3、普通keyDown/keyUp 0，进入/退出隐私共2次，97帧隐私显示状态符合零热度/情绪/抚摸及无反应要求，最终privacy=false。计数来自用户操作时间段内的全局钩子，可能包含其他输入及repeat，不能称为24个测试按键。监视器丢弃所有键值，未记录文本；匿名脉冲没有额外字段，人物显示帧未出现rawKeys/heldKeys/keyLabel/packagePath。

活动人物为并发回归副本native-race的uniform，复用02素材和动作配置；它是隔离测试数据，不作为额外人物交付。原生普通输入及这个经典Win32密码框的隐私/恢复链路通过，不能外推到所有浏览器UIA控件或所有物理设备。此次没有运行真实OBS软件，私人模式的真实OBS画面仍待验收。

复现与证据：monitor-native-input.mjs限时三分钟收集种类/数量，check-native-input-report.mjs核对数据；input-monitor-report.json和input-verification.json保存在tmp/native-validation。用户视觉确认单独记在后者及本记录，数据校验器本身不能证明视觉。监视器已正常停止，测试窗口可通过自身Close test window按钮关闭；不删除EXE/夹具。

下一生产前端门槛：现有锁文件指定three及@types/three均为0.187.0，旧可用依赖缺失，已请求用户授权补齐本地依赖。未获准前不安装/下载。后续仍需原生静态OBS、真实OBS软件、托盘/拖动/穿透/暂停隐藏/多屏DPI等验收，不将本轮输入结果当作完整目标完成。

## 生产前端及便携OBS实测更新（2026-11-24）

本节取代前面阶段记录中“依赖未授权/原生OBS静态404/真实OBS未运行”的当前状态。用户已明确允许补齐项目本地前端依赖，并允许官方OBS 33.0.3便携版验收；仍无全局安装、提交、推送、录制或推流。

按原package-lock在tmp/native-validation/frontend-deps安装26个包，复用旧npm缓存，根node_modules为指向该目录的Junction；正式锁文件未修改。全量23个TypeScript文件零诊断，tsc+Vite生产构建通过（保留Three大分块提示）。使用已有隔离Rust离线构建tauri/custom-protocol调试EXE，桌面运行于http://tauri.localhost/；1420开发服务已停止。原生37421/obs.html为200。最新真实stdio8项、生产前端桌面/HTTP/SSE/菜单8项通过；Three软件WebGL旧猫咪/人物2D/大肥鱼2D的3项模式检查通过。Rust库60通过/1既有联网用例跳过。

官方OBS ZIP为235774237字节，SHA-256为18a68c325adbda6f6082d5281021a8d1e35a6432842800618e8690b71925c107；解压到tmp/native-validation/obs-portable-33.0.3，原始展开616829610字节。配置、缓存及环境均隔离。启动时先修正cwd解决locale错误，再将Node spawn的windowsHide改为false解决主窗口隐藏；只停止了路径核验后的该便携实例，随后正常启动。未增加系统安装或第三方插件。

真实OBS场景只含静音浏览器源与纯色透明度测试底层，无音频/摄像头/桌面采集。已实际观察并保存：02便服/制服同步切换、底色透出、旧黑猫切换与人物恢复；KuroCat正常退出并复用同一AppData重启，OBS无手动刷新即收到后续制服切换。专用空Win32密码样式框使privacy=true，OBS闭眼双手捂眼、键盘隐私遮罩；回普通框后privacy=false、手放下且遮罩消失。恢复截图恰逢自然眨眼，不据此声称该帧睁眼。未读取输入内容。普通按键动作追加检查遇到用户输入检测，停止自动操作，未将该项记为真实OBS已验。

证据：tmp/native-validation/obs-real-report.json及obs-real-*.png；desktop-report.json保留自身自动化范围realObsApplicationTested=false，真实软件证据在独立报告。断线期间仍显示已加载人物，不据此声称有离线提示。仍待：真实OBS普通键鼠/抚摸等完整动作、托盘、暂停隐藏/拖动穿透、多屏DPI、其他密码控件、缺资源实际恢复与工作区目录发布错误定位。人物3D后续。便携OBS和隔离KuroCat保持运行，实时句柄以各session.json核验。

临时产物全部保留：OBS ZIP/解压配置、frontend-deps及node_modules Junction、target、截图日志、系统临时测试夹具。删除需另获授权；target清理需重新编译、夹具清理会失去故障现场。最新体积和EXE指纹见summary.json。最终目标保持未完成。

## 原生窗口与坏资源恢复（追加实测）

窗口4项、坏资源恢复4项通过，脚本和范围见character-system-status.md末节。window-report.json记录实际单屏150%DPI，native-window-layout.png为原生Canvas截图；recovery-report.json及native-corrupt-resource.png、obs-native-corrupt-resource.png、native-resource-restored.png记录真实解析拒绝和恢复。首次恢复截图仍是备用猫，已识别其断言不足并增强为恢复后新身份帧，再重跑4项通过、查看截图确认为02。测试只改隔离副本，finally还原字节；recovery-sprite-original.png和recovery-target.json保留恢复依据，无删除。drag-baseline.json仅记录原位置，未执行拖动，不能当作拖动通过。原生透明窗口的Computer Use捕获有时只显示下层画面，因此未凭旧坐标盲拖。

## 人工鼠标验收进行中

用户同意配合鼠标验收，mouse-monitor独立文件限时三分钟监视已正常结束，未覆盖原input-monitor证据。真实人物zero-two/uniform记录1801帧，220帧位于抚摸区域，最高能量0.999956、93帧抚摸性格反应，最终能量回到0；无原始键值/文本存储。证明原生鼠标抚摸到连续显示状态的链路，不能单凭计数证明OBS视觉。用户询问穿透/Alt预期，已解释，最终人工结论仍待回复。

Computer Use自动拖动没有DOM mousedown或位置变化，重试明确报告落点在下层ChatGPT窗口而非目标；未将其判断为应用拖动Bug，未修改拖动逻辑。OBS尝试捕获得到遮挡应用画面，obs-real-manual-petting.png不计为OBS证据。未在用户操作期间继续发送鼠标输入。mouse-monitor-report.json和mouse-verification.json保留实际范围及待验项；监视已停止，不持续记录。

## 用户确认拖动与双端摸头、测试窗口恢复

用户在“先不用开启穿透锁；拖动身体、额头来回约10秒并观察桌面/OBS”的简化步骤后回复“测试没问题”。据此确认物理拖动及桌面/真实OBS摸头反应正常；不能据此确认前一批未完成的Alt临时操作或解锁。mouse-verification.json已分开记录用户视觉确认与匿名状态证据，未把被遮挡的自动截图当作OBS证据。

此前用户问“怎么自动隐藏了”，真实窗口查询为visible=true、alwaysOnTop=false、obsHidePet=false、clickThroughLocked=true，属于未置顶且穿透的测试状态，未证明触发自动隐藏。仅通过测试版IPC恢复alwaysOnTop=true、clickThroughLocked=false并show；未改已安装程序。manual-window-recovery.json保留结果。run-native-character.mjs的新建/恢复测试实例默认改为置顶、关闭穿透，避免恢复脚本又强制取消置顶。该改动仅验收启动器，node语法检查通过，不为此重启当前用户验收实例。

目录发布诊断新增probe-native-publication.mjs，严格限于项目/已授权系统临时新夹具，六项最小文件/空目录/带文本目录rename均通过，不改权限、不清理、不重试。随后完整真实MCP在工作区stdio-1795520686680-8432仍于不可变目录发布返回Windows错误5，故不能关闭问题。publication-path-report.json记录对照与失败边界；TXT最小控制未覆盖真实PNG包内容和原生进程环境，不据此排除文件占用或其他环境差异。系统临时目录的既有完整8项通过证据保留。


## v5.1.0整合最新状态

用户已明确选择整合v5.1.0并保留人物扩展，固定上游41f3de0，27文件已合并，Git HEAD未移动、不提交推送。原始快照及候选在tmp/upstream-v5.1.0。修复复现的上游首次鼠标坐标溢出；新版本Rust65通过/1跳过、Node18、菜单浏览器9、真实stdio8、原生桌面8、窗口4、资源恢复4、模式3通过。真实OBS已刷新并确认02制服展示。当前隔离进程报告5.1.0；旧版用户确认拖动/双端摸头/Alt恢复证据保留，新版受影响人工输入/隐私/Alt和托盘暂停仍待验。工作区发布Windows5仍未定位，最小控制不等同真实发布。完整记录与限制见docs/upstream-v5.1.0-integration.md；原始目标保持未完成。

## v5.1.0真实资源更新闭环

新增scripts/test-native-character-update.cjs，通过5项真实MCP资源热更新检查：完整读出manifest，另存八张PNG和配置到临时源，将当前服装idle替换为同角色已有happy PNG，validate/import replace=true但不重新激活；活动人物与服装不变，桌面/正式OBS页面均解码新PNG；旧revision请求返回409 STALE_REVISION，旧文件字节仍完整；完整读回动作、性格、服装及来源字段不变；最后经MCP恢复旧修订，两端重新解码原idle。所有旧修订和临时源保留，未直接修改已安装修订文件。

当前选中的是用户操作后的隔离副本native-race/uniform。首次因脚本假定zero-two而在修改前停止，保留live-update-failure.json；随后使用已核验位于独立AppData中的实际试点ID，通过5项。测试过程不强制改变用户人物选择。

--hold在更新后最多停留60秒，供只读观察真实OBS，再通过控制文件继续或超时恢复。已观察真实OBS新表情及恢复原表情，全程没有刷新浏览器源、录制或推流。obs-real-live-update-report.json单独记录人工观察范围；自动化live-update-report.json的realObsApplication=false保留其自身范围。恢复第一次截图被其他应用遮挡，已排除；第二次激活OBS后得到有效画面obs-real-live-update-restored-visible.png。

测试版托盘通过已有Tauri API设置悬停提示“KuroCat 测试版 5.1.0（独立验收）”，便于区分安装版，身份记录tray-test-identity.json。已询问用户是否方便托盘暂停验收，未开始持续监视或标记通过。

## v5.1.0真实托盘暂停与恢复通过

首轮用户找不到测试入口，监视仅有baseline，主动停止并保留tray-monitor-no-ui-report.json，不当作通过。专用输入窗口未出现在可用窗口列表，重新启动已有fixture，用户确认已找到带测试版悬停提示的托盘。第二轮监视成功分段baseline/hidden/restored，用户按普通框固定测试键、托盘暂停/隐藏、左键托盘恢复后回复“已完成，隐藏和恢复正常”。

真实窗口可见性为true→false→true，隐藏约26047ms期间没有任何记录到的输入事件（0键盘、0鼠标），仍有260帧人物连续状态；恢复后收到7次keyDown/7次keyUp，普通阶段15/15。计数覆盖全局时间段，含其他操作和repeat，不能声称就是固定测试键的数量。活动人物为native-race/uniform，已恢复原修订。该项证明合并版原生托盘暂停/隐藏与左键恢复监听/显示链路；不等同于已通过托盘人物/服装选择。

监视正常退出码0并停止，不保存键值或文本。monitor-native-tray.cjs、tray-monitor-report.json及tray-verification.json记录实际过程。暂停/恢复会恢复默认托盘提示，后续验收须重新给测试版打标签，不能只凭旧tray-test-identity.json判断当前提示。专用输入窗口保留供后续密码控件验收，无清理。

## 导入/激活分别报告及新版隐私回归边界

真实stdio检查增加第9项：另一个独立帧包通过校验并以activate=true导入，返回有效entry和activated=false、activationError.code=ACTIVATION_UNAVAILABLE；随后完整manifest读回且integrityChecked=true、activationSupported=false，原活动人物不变。隔离frame-only测试包不是新角色交付，不修改当前桌面实例。9项完整stdio回归通过，最新报告指针已更新。

v5.1.0自动隐私回归时，Computer Use激活/点击专用空测试窗口后，AX焦点仍为窗口而非编辑框，真实privacy=false；未发送任何测试键，不据此判断产品失败。privacy-v510-monitor只取得baseline后主动停止，真实托盘/旧版隐私通过证据不被覆盖。已请求用户配合经典Win32普通/密码样式框的新版验证，答复仍待。不能将该次监视计为隐私通过。

## 发布错误进一步对照（仍未修复）

新增scripts/native-file-users.rs，按本机Windows SDK RestartManager.h结构/签名构建，只查询旧失败夹具9个文件的使用进程，不调用Shutdown/Restart。结果当前受影响进程0；仅打开并关闭目录句柄的访问权检查，源目录移动权限与目标父目录增加子目录权限均GRANTED。不能据此排除目录句柄或历史瞬时占用。API临时查询会话已结束，无权限修改或文件删除。file-users.exe及file-users-report.log保留。

把现有真实02导入Rust测试的进程TMP/TEMP指向tmp/native-validation/rust-workspace-fixtures后，直接在同一publish代码复现Windows5；说明不依赖Tauri界面/MCP传输。最长目标文件路径实测249字符，未据此定性路径过长。标准系统临时目录下的65通过/1跳过与stdio9项证据仍保持各自环境范围。定向工作区测试失败保留rust-workspace-import.log，不把它算作通过或覆盖旧报告。

最小Rust程序新增--catalog-lock对照，保持与产品类似的根目录锁文件后五项文件/目录/真实PNG及跨父目录操作仍通过；锁文件本身不足以复现真实import失败。新证据汇总publication-diagnostic-summary.json，故障原因仍未确定，没有改应用发布算法、增加重试或放宽校验。所有小夹具及诊断EXE保留。新版隐私人工配合问题仍待用户答复；没有重启监视或继续控制输入窗口。

## 工作区导入发布修复与验证

真实包发布改为：在目录锁下，把校验过的内存快照写入未登记内容修订，所有文件sync后原子替换注册表。资源/MCP读取均先检查注册表当前修订，因此提交前目录不对调用方可见。去掉整目录rename依赖，未削弱注册表发布边界。已登记修订不修改；未登记中断目录仅在所有已有引用字节匹配时补齐缺失文件，已有文件不覆盖，损坏拒绝。旧character-import-staging和旧修订全部保留，无删除。

此前同一路径失败的真实02导入测试通过；完整Rust测试在工作区TMP/TEMP下67通过/1既有联网检查跳过。新测试覆盖未完成更新时仍读旧版本、恢复缺失文件且已存在文件mtime不变、损坏未登记内容不覆盖或登记。新的调试EXE离线构建通过，旧实例退出码0后复用同一AppData启动。quit_app的CDP调用曾因页面正常关闭报Target closed，进程句柄已证实正常退出，没有重复退出或强杀。

工作区真实MCP越过原发布失败后，原测试脚本在移动其素材源目录时仍遇到外部EPERM；不能把该脚本失败称为全部通过。保留原移动模式在系统临时目录的9项通过；另加--source-edit模式，在工作区导入后故意改坏复制源PNG并确认源校验失败，而已安装字节/完整配置可读，9项通过。两个模式的sourceIndependenceMode写入各自报告，未将改源内容冒称移动目录已成功。

修复版真实桌面/HTTP/IPC/SSE/菜单8项及资源热更新/原包恢复5项通过。桌面驱动首次无输出退出1；确认原生进程仍活后对同一实例重跑，通过且没有重启程序；desktop-publication-check.log保留实际重跑结果。新发布保证及恢复策略已同步character-pack-v1.md。publication-fix-report.json记录全部范围，外部系统目录移动限制的原因仍未断言。未放宽校验、改权限或加入盲重试。

## 复制MCP配置绑定当前数据目录

复核不读写代码的入口时，发现get_mcp_config的stdio配置原先只有command/args和HTTP地址，没有数据目录环境变量。客户端从其他环境启动时可能读默认用户目录，出现当前桌面人物不在客户端目录中的情况。新增test-native-mcp-config.cjs先断言配置必须绑定当前隔离APPDATA，旧EXE实际失败于env缺失，未启动子进程或触碰真实用户目录；失败保留mcp-config-failure.json。

修复沿用原命令、参数、HTTP字段，Windows仅输出APPDATA、其他平台仅输出HOME；值按config::app_data_dir的同一输入解析为绝对路径，不导出其他环境或密钥。没有修改用户.env、客户端设置或当前Codex连接。离线Cargo check/build通过，旧隔离进程正常退出码0后复用数据启动。Windows实际导出配置启动stdio客户端3项通过：精确EXE/端口和唯一数据根变量、选择/服装偏好一致、人物目录修订一致及已安装包完整性。当前用户选旧猫咪，检查保留该选择，通过目录/包读回确认同源。未改剪贴板。

该检查验证了导出内容与stdio实际启动，不宣称每个第三方客户端均接受混合配置或已配置当前连接。当前Codex KuroCat连接经工具元数据核验仍仅7个旧猫咪工具；新人物服务需要在客户端接入。macOS/Linux分支仅源码逻辑，未在这些平台运行。

按technical-writing技能整理现有文档：character-system-status.md改为当前11项目标表和证据入口，旧阶段汇总快照保留status-before-current-summary.md；zero-two-pilot.md顶部增加实际双标签菜单、MCP/OBS和隔离启动说明，移除已经过时的“未来才能运行”。详细历史测试与失败日志仍保留在本记录及原文件中，无删除。新版隐私与托盘人物/服装操作仍待验，完整目标未完成。

## Esc停止后的状态核验与托盘错误提示修复

privacy-v2夹具增加可见F7普通框/F8密码样式框切换，已观察到实际编辑框焦点；但随后的电脑操作被用户按Esc停止，没有发送测试字母。匿名监视控制stop=true，原监视句柄56178已不存在；报告仅baseline、1800帧、privacyTransitions=0，不能算隐私验收。继续保留旧版人工隐私证据的原范围。未继续操作应用恢复临时选择，原选择保存在privacy-v2-selection-before.json，测试版临时为02制服。此次没有再调用Computer Use。

沿托盘选择失败路径发现choose失败只写eprintln，已补kuro-character-selection-error事件：桌面提示、已存在的人物菜单和托盘悬停文字呈现错误代码/原因/重试或重导入建议，失败不改选择；托盘或菜单成功切换清除提示，托盘成功分支保留暂停状态提示。菜单刷新不清除仍待恢复的托盘错误。

新增3项真实Edge菜单检查：收到托盘错误后显示原因并保持实际选择，重新打开仍可见；菜单成功恢复后清除；托盘成功通知后清除。共12项通过，正式HTML/CSS/menuMain/characterMenu执行，原生IPC/事件仍为替身。首次受沙箱限制Edge启动失败；按现有本地验证授权在沙箱外重跑通过，未安装浏览器。全量23个TS源文件零诊断，隔离Rust离线cargo check --locked通过（5项现有未使用警告），日志tray-error-cargo-check.log。当前运行EXE没有重建或重启，本次新增的原生托盘事件/悬停和桌面提示未实机验收。character-pack-v1.md与character-player-2d.md开头的过期未编译声明同步更新，历史记录保留。

## 2026-11-25恢复：提示修复嵌入原生验收

暂停期间发起的Rust回归被自动审批按暂停状态拒绝，未执行；恢复active后重新按既有授权运行，工作区隔离TMP/TEMP下67通过、1既有联网用例跳过。日志tray-error-cargo-test.log。生产前端构建及离线cargo build --features tauri/custom-protocol通过，仅原有Three分块大小和5项Rust未使用警告。原PID35332已不存在后，以同一测试数据恢复，PID28216、执行会话72128；没有安装依赖或操作安装版。新EXE SHA-256为92b78b0926289fd0f40c52931c5997c1a51a3d86fc5ad32ccb4cf24342bb4819。

test-native-character-desktop.cjs增加2项，总计10通过：通过实际Tauri IPC请求不存在服装，返回Unknown outfit且人物/服装选择不变；随后通过实际事件桥注入错误通知，确认桌面和独立菜单均显示；点击当前已选服装，实际原生命令成功后两处提示清除。此前HTTP/stdio/400ms轮询/真实PNG/生产OBS静态页和独立菜单回归仍通过，OBS HTML 200，页面错误0。一次选猫瞬间的旧manifest请求404按既有竞态分类记录，旧异步结果不覆盖新人物。desktop-report.json明确traySelectionClicked=false、selectionErrorNotificationInjected=true；未据此宣称真实托盘错误路径或OBS软件通过。当前测试版停留02便服，没有启动全局输入监视。

已请求用户配合真实托盘人物/服装选择，答复待收。当前工具元数据不再提供KuroCat连接（列表为空），未修改客户端配置；独立原生stdio/HTTP验收不受此变化影响。summary.json更新新EXE哈希及10项范围，历史OBS/隐私证据保留原版本范围。

## 2026-11-25真实托盘双服装与选中标记通过

用户回复“现在配合验收”后，通过现有Tauri API仅给PID28216的kuro-tray设置提示“KuroCat 测试版 5.1.0（人物换装验收）”。monitor-native-character-selection.cjs只轮询OBS快照里的选择/显示身份，不订阅输入；上限3分钟，固定报告和stop控制文件。用户通过系统托盘将02便服切为制服，再切回便服，并明确回复“两套服装及选中标记都正常”。

原生settings身份顺序casual→uniform→casual，显示身份顺序相同，修订始终8014f6cd8e075018c3466d51dfbb3d351f38629551287596249922ec0147187b。每次切换时快照显示身份有一次空值，约下一次200ms轮询恢复，属于切换门控；不据此承诺逐帧无闪烁或OBS软件已验收。收到用户结果后stop控制结束监视，执行句柄53112正常退出0，report.stopped=true。派生校验确认两组序列匹配且inputSubscribed=false、recordsRawInput=false。原报告tray-selection-report.json及tray-selection-verification.json保留。当前02便服；首次选择后提示恢复默认KuroCat，未再冒用旧测试标签判断图标身份。本轮只证明真实托盘选择和标记，未故意破坏资源触发托盘错误，不延伸为新版隐私或OBS软件回归通过。

### 托盘勾选不挤占文字

用户截图指出行内“✓”造成已选服装文字缩进。refresh_character_menu改用CheckMenuItem原生勾选列，所有人物/服装项的label只保留名称，选中状态通过checked参数传入；保留原菜单ID和选择处理。离线cargo check/build通过，日志tray-alignment-check.log、tray-alignment-build.log。原隔离实例正常退出0后，同一数据恢复PID34796、执行会话59726；新EXE哈希写入summary.json。未重跑不受影响的全套动作测试，真实菜单对齐视觉待核对；之前托盘双服装切换验收保留为上一构建证据。本轮无输入监视或安装版操作。

### 2026-11-25对齐视觉与新版经典密码框通过

用户明确确认修复后的菜单“已对齐，显示正常”，完成原生勾选列的文字对齐视觉验收。

新版隐私回归先尝试自动操作夹具：activate_window返回failed to activate captured window；重新取窗口后AX焦点仍为窗口，截图实际为被遮挡的Codex内容，不能当夹具或桌宠证据；F7尝试被工具以user input was detected in this window拒绝。本轮自动操作没有发送测试字母，也没有据此判断产品失败。转由用户操作，用户明确回复“现在配合隐私验收”后才启动privacy-v510-final匿名监视。

用户按F7普通→F8密码样式→F7普通并输入固定测试键，回复“输入动作、捂眼和恢复均正常”。监视取得2次隐私切换、4次匿名privacyTyping脉冲，隐私keyDown/keyUp均0，118帧隐私显示状态的heat/mood/pet/reaction符合归零规则；未发现raw显示字段或带额外字段的匿名脉冲。普通阶段监视计数5个down/4个up是有界全局区间总数，不宣称精确覆盖用户每一枚测试键。最终服务privacy=false、characterState.state.privacy=false，身份为zero-two/casual、原修订不变。三分钟有界监视正常退出0，stop控制亦已置true，无键值/文本保存。

check-native-input-report.mjs现在接受可选监视名称，严格限定便携名称、按指定报告校验并写独立verification；无参数仍读旧input-monitor-report.json并写input-verification.json，保留旧入口兼容。命令node scripts/check-native-input-report.mjs privacy-v510-final实际通过，结果privacy-v510-final-verification.json，用户视觉结论另行写明。只证明当前合并版桌面与经典Win32测试框，不能推广到浏览器/其他密码控件或真实OBS软件；后者新版仍待验收。

### 合并版真实OBS隐私视觉补验通过

确认旧OBS PID5792已退出、原生PID34796仍活且服务privacy=false后，复用既有便携33.0.3和独立KuroCat Validation配置启动PID38564、执行会话96273。此前启动调用的functions cell仍在等待返回，按同一cell等待取得结果，没有重复启动。初次get_window_state虽AX为OBS但截图被Codex遮挡，不作为证据；激活确切OBS窗口后已实际看到02便服、独立纯色底、键盘鼠标与透明背景，录制/直播计时均0。

用户在经典Win32专用夹具按F8、固定测试键、F7操作，明确答复“OBS 捂眼、遮罩和恢复都正常”。monitor-native-obs-privacy.mjs只读服务privacy、显示privacy与人物修订身份，不订阅输入，不保存按键。监视14次状态变化中有两条显示帧为空：一次在隐私进入时、一次在用户切换到内置大肥鱼时；源代码snapshot按隐私/TTL门控并在身份切换清帧，不能把null当作privacy=false。首次派生校验把null也要求相等而失败，未据此标产品失败；按既有契约对所有非空帧检查，无不一致，空帧原样保留。期间02/casual的隐私进入与退出均有有效显示帧，最终privacy=false；末尾用户自行选大肥鱼，未自动改回。

monitor执行会话29553在stop=true后正常退出0，report.stopped=true，派生obs-privacy-v510-verification.json记录用户视觉确认、完整标志序列、2条空帧和最终身份。脚本首次运行ready日志因条件放置重复输出，已将源码移至首次成功采样分支，未重启已在运行的监视；日志不含键值。监视脚本node --check通过。此结论限合并v5.1.0、02便服、经典Win32测试框及实际OBS软件，无录制/推流，也无其他密码控件或逐帧物理同步承诺。

用户另要求只读排查选择菜单勾选，已列出旧猫咪、键盘配列、方向、尾巴模式、缩放五组缺项及动态自定义猫、人物尾巴禁用建议；未借该分析请求实施这些建议。

### 等待托盘故障验收期间补充定位计算回归

monitor-native-tray-recovery.cjs已准备并通过node --check，等待用户选择验收时间，尚未执行或损坏任何资源。脚本限定已安装包在隔离会话根目录内、要求当前不是02，备份原PNG字节，最多三分钟损坏阶段后自动恢复；退出finally也恢复，之后最多两分钟观察用户重选。只读人物选择和桌面错误文字，不订阅输入。仅准备脚本不作为故障链路通过证据。

windows_display.rs原有两项测试已覆盖150%DPI左侧副屏和失联显示器偏好回退；新增两项分别验证上方副屏的108键尺寸在125%/200%DPI下使用目标工作区和负Y坐标，以及工作区小于窗口时不发生无符号下溢、起点保留在该工作区原点。没有修改运行时代码或系统显示设置。离线cargo test --lib windows_display::tests实际4通过（66其他用例过滤），日志display-geometry-test.log；没有把定向结果冒称完整69项已重跑。单屏实机证据仍只有150%，多屏和其他DPI操作系统实测继续未验证，不用这些纯计算结果替代硬件验收。无需为cfg(test)改动重建当前运行EXE。

### 损坏已登记资源通过新修订恢复

源码核查确认，select_cat设置写入在共享锁内重新检查猫咪存在，导入发布也先校验完整快照；未发现需要新增并发防护的证据。character-persistence.md顶部仍称未编译，已按实际67项库测试、两份9项stdio和10项原生桌面报告更新，早期静态记录保留。

新增单项Rust回归damaged_registered_revision_recovers_through_new_inline_revision：只在独立夹具损坏已登记body PNG，原样replace导入返回INVALID_REGISTRY且原注册表/人物选择不变；从健康源素材和完整内联manifest修改version发布新修订，完整manifest读回、重新激活、服装偏好保留通过，旧损坏文件不覆盖。首次断言直接比较未补默认字段的原始JSON而失败，失败日志new-revision-recovery-before.log保留；将期望按既有Manifest类型规范化后定向重跑1通过、70其他用例过滤，日志new-revision-recovery-test.log。没有改运行时逻辑、原安装包或当前桌面数据。该证据是存储/选择层，不代替待进行的用户真实托盘失败验收。

### 手速情绪与连续状态复核

两份原生隐私报告里的普通阶段手速峰值为0或接近0。源码与02配置确认2.8秒采样窗、cpsStart=2.6，分开按三次A低于热度起点，不能据此判断未收到手部输入或发布丢失；这些人工检查也没有验证持续快打的情绪升档。

test-character-player.mjs新增按实际cadence驱动的回归，覆盖内置大肥鱼与02两套服装：1次/秒保持冷静，20次/秒持续9秒达到tier2，停键12秒按滞回冷却，7秒重复键事件不能重新升温。每个50ms更新把真实计算的连续状态送给时钟相差30秒的跟随播放器，逐次核对moodTier、typingHeat、blushLevel一致，没有手工指定热度结果。三个相关Node套件合计19通过，仍含852组映射按键；日志typing-cadence-tests.log。Canvas/时钟与图片为测试替身，证明协议逻辑和跟随一致，不声称真实系统持续高速输入或OBS软件热度视觉已经验收。运行时代码与当前人物选择未改。

### 目标恢复后：真实MCP新修订恢复与大肥鱼参考包

test-native-character-mcp.mjs追加真实stdio恢复检查，先在新的隔离副本损坏已登记02图片；get返回INVALID_PNG，同内容replace返回INVALID_REGISTRY，注册表/服装偏好不变。以保留的健康旧修订PNG和完整内联manifest的新version发布，返回activated=true，完整manifest读回一致，旧损坏字节保留；新的stdio进程恢复02便服及完整恢复版。首次扩展10项通过，stdio-recovery-check.log及其报告保留。

随后追加get_character_schema的dafeiyuReferencePackage端到端：以只读src目录和完整参考manifest验证4张PNG、导入独立dafeiyu-reference并激活；读回完整motion2d及原始assetNotice，已安装与原源PNG均逐字节一致。旧switch_cat(dafeiyu)退出包模式，随后还原本夹具的02便服，未操作当前桌面实例。完整stdio现11项通过，工作区source-edit模式报告tmp/native-validation/stdio-1795572941151-35868/report.json，日志stdio-recovery-reference-check.log。源码大肥鱼图片未改、没有新人物或安装版资源变动。基准以MCP schema提供的完整内联包复用原素材，避免工程里为交付重复复制；激活通过仍不等同于包模式实际视觉已验证。

本次没有把未答复的托盘人工验收或菜单实施范围当成已确认；自动恢复托盘脚本仍未执行。原来的系统临时目录源移动模式9项报告保留其历史范围，不冒称已重跑到11项。

### 大肥鱼参考包真实桌面加载

test-native-bigfish-reference.cjs在当前隔离测试版先确认未处于隐私输入，再通过真实MCP导入参考包（已存在时只读核对协议与声明，不覆盖），临时选择dafeiyu-reference/dafeiyu。生产WebView中的实际drawImage来自已解码224×278 PNG，字节SHA与四张原大肥鱼表情之一匹配；角色加载提示为空，实际原生IPC发布/OBS快照身份为dafeiyu-reference、dafeiyu、fd59c57a11ab47fa2e22d473b890646f3c576de0ac1acae99ccbc697e478647e。3项检查通过，最后通过MCP恢复原选择并撤销绘制探针；若用户独立切换会保留其新选择。本次实际selectionRestored=true。

结果bigfish-reference-desktop-report.json及bigfish-reference-desktop.log。未记录键值、未保存截图、不触碰安装版。参考包保存在隔离AppData，源码PNG和当前原角色选择未改。证明真实加载/绘制数据来源/状态身份及恢复，不宣称手脚全部动作逐帧视觉或大肥鱼包模式的物理输入全量已验收；内置与共享播放器的其余证据保持各自原范围。测试脚本将“已尝试选择”标记置于RPC前，避免提交成功而响应失败时漏掉finally恢复检查，未改应用运行代码。

## 按用户修订的链路目标完成核对

用户随后明确“不要新建角色”“不用接入人物，把链路打通就行”，并要求调整目标。当前目标已写入character-system-goal.txt：只交付通用2D角色包/MCP链路，以已有样例验证；人物批量制作、当前客户端接入、额外菜单优化及全硬件人工边界不作为本次完成前置条件。原目标留有备份，不把收敛后的完成解释为14个人物或所有硬件均已验收。

收尾完整Rust库离线回归70通过、1既有联网检查跳过，日志final-chain-cargo-test.log。全项目TS5.9.3检查23个源文件零诊断，日志final-chain-typescript.log。生成协议类型一致性、2套参考配置/11个负例、33处设置写入归属、02八张PNG CRC/RGBA/动作隐私来源静态检查均实际通过。Node播放器/同步/引擎19项及852组映射按键保留此前实际通过记录，无新增运行代码后不重复全套浏览器验证。

最后仅向当前HTTP服务请求tools/list，HTTP200且七个人物工具均存在，未导入、激活或修改数据，记录final-chain-http-tools.json。按本轮源码、实际断言、报告和用户已确认视觉范围逐项核对六组链路要求，15份关键证据SHA-256写入completion-audit.json。stdio11、原生桌面10、参考包桌面3、资源热更新5、真实OBS及隐私/托盘用户确认共同支持修订范围的完成；任何单项绿色或模拟事件不用于替代其他范围。

当前交付状态已整理为character-system-status.md；共享同步说明和02 README的过期未编译/未导入表述更新，历史记录保留各自当时范围。本次未新建或接入正式人物、未配置客户端、未替换安装版、未提交推送、未删除文件，也未录制推流。真实托盘故障事件、合并版物理Alt、持续高速打字视觉及其他硬件/密码控件保持未验证，作为后续边界而非本次主链路阻塞。

## 菜单选择状态与紧凑按钮后续修正（2026-11-25）

用户在链路完成后另行要求修正选择勾选及按钮样式。原生托盘的内置猫咪、键盘配列、方向、尾巴模式及缩放预设改用独立勾选栏，并监听设置刷新；人物模式不标记旧猫咪或旧尾巴设置。按用户明确修正，76%等非预设缩放不勾选任何档位，不增加“当前自定义”选项；父菜单保留当前比例文字。托盘改动已通过离线检查及编译，最终系统菜单视觉仍待用户查看，不以代码检查替代人工确认。

导入人物与内置猫咪按钮统一26 CSS像素高度，长名称单行省略，悬停提示保留完整名称、服装和ID。选择列表使用5像素半透明灰色圆角滚动条、透明轨道、无上下箭头。未新增或导入人物，未改变选择行为。

实际验证：test-character-menu.cjs共13项通过（含260/360像素宽度、长名称、多行列表滚动及滚动条样式），前端生产构建通过；离线原生调试构建通过，保留5项既有警告。test-native-compact-menu.cjs在嵌入生产资源的实际WebView测得内置及5个人物选项全部26像素、单行省略、完整提示、5像素滚动条，无角色切换。原生截图compact-menu-native.png、报告compact-menu-native-report.json；浏览器紧凑布局截图在tmp/character-menu/。不将本次针对性检查表述为重新执行完整Rust或MCP回归。

隔离测试版已恢复运行，托盘提示“KuroCat 测试版（紧凑菜单验收）”；安装版未替换。临时构建、报告及截图沿用tmp/native-validation/和tmp/character-menu/保留，未删除文件、安装依赖、提交或推送。

## 托盘勾选复核修正（2026-11-25）

复核发现人物子菜单仅在托盘点击时重建，设置切换后没有立即更新已存在项；改为kuro-settings事件直接同步人物/服装勾选，原生人物菜单事件无论成功或失败均按实际选择恢复勾选，避免重复点击当前项或失败操作留下原生自动切换的错误标记。内置猫咪保存失败时也广播恢复的设置；开机启动操作失败时恢复原勾选，但本次未操作系统开机启动设置。

缩放初始化与后续刷新均改为精确匹配固定预设，76%、74.9999%、75.0001%等均不勾选任何预设，不添加自定义选项。新增2项Rust针对性测试覆盖六档预设唯一选择、近预设自定义值、人物身份及服装切换、退出人物恢复无人物勾选；实际离线通过。最终离线调试构建通过（5项既有警告），测试版恢复运行，托盘提示“KuroCat 测试版（托盘勾选修复）”。本次未逐项人工点击系统托盘，未验证真实保存失败或开机启动失败；规则测试和编译不替代原生菜单视觉验收。

日志为tmp/native-validation/tray-check-regression.log和tray-check-build.log，沿用固定构建目录，无新依赖、正式人物、安装版替换、Git暂存提交推送或文件删除。

## 系统托盘实际操作验收（2026-11-25）

本轮由用户实际操作独立测试版的系统托盘，agent只读记录匿名设置变化。用户确认：内置小黑猫/大肥鱼切换、已有02制服/便服切换及重复点击当前服装、人物模式下旧猫咪全部无勾选、退出人物恢复、108/65配列、猫咪/观众方向、尾巴off/smart和50%/75%缩放预设均正确更新勾选。状态记录捕获相应切换；无状态变化的重复选择只依据用户视觉确认，不由状态采样推断已点击。

另通过真实HTTP MCP将scale单独设为0.76并读回验证；本轮状态记录也包含用户自选0.63。用户最后注释“测试了，正常”确认非预设无勾选，并覆盖此前笼统的异常选项；未额外强制设置83%。用户随后将缩放恢复为75%；最终保留该当前值和用户独立选择的尾巴off，不强制回滚。原生窗口截图曾显示托盘主菜单，但最终截图菜单已关闭；子菜单勾选视觉证据来自用户确认，不宣称agent已截图逐项看见。

自动托盘专用工具遭PERM_DENIED（private file DACL grants an untrusted principal）；Sky对菜单点击因非目标窗口归属拒绝，未成功自动点选，也未修改权限。实际操作由用户配合完成。报告tmp/native-validation/tray-live-verification.json、匿名状态记录tray-live-monitor.json、MCP设置读回tray-custom-scale-states.json；监视限定6分钟且只记录变化，无按键内容、录屏或新人物。未提交或推送。此次不覆盖开机启动系统操作、隐私开关或失败注入。


## 删除人物资源后的通用夹具回归（2026-11-25）

用户确认删除源码中的人物目录后，已清理活跃源码/测试对原目录的依赖。新增scripts/fixtures/dafeiyu-package.json及character-test-fixture.mjs，复用内置四张大肥鱼PNG/MIT声明，以primary/alternate两种动作和性格配置测试；只有显式测试在临时目录物化导入源，不恢复正式人物或生成美术。旧人物专用制作/校验/预览脚本改为通用夹具准备/校验/预览，旧美术导出入口移至tmp保留。历史长记录中的旧人物路径只表述当时证据，不能作为现在的操作入口。

Rust完整库72通过、1既有联网检查跳过；Node19项及852组映射通过；真实stdio11、原生桌面10、热更新5、损坏恢复4通过；新原生会话使用新stdio独立目录，不覆盖此前会话数据，旧会话指针备份desktop-session-before-fixture-cleanup.json。原生窗口首次因预设只允许固定夹具身份而拒绝用户已切换的大肥鱼参考包；已按当前实际参考包身份验证并保留，4项通过。该失败在fixture-window.log后被针对性重跑结果更新，不据此声称额外物理硬件覆盖。

菜单浏览器13通过、通用夹具浏览器5通过、基准9及同步9通过。夹具预览不再使用旧人物美术阈值；测试原图加载/眨眼、配置切换、隐私及显式重试，不等同于旧人物的16组视觉矩阵。输入、抚摸和状态机覆盖由Node及基准/同步用例承担。前端生产构建和离线嵌入式原生构建通过。导入人物标题复用menu-scale-row/menu-scale-label；真实WebView计算样式确认字号/颜色/字重/行高一致，26像素按钮及5像素滚动条保留，截图compact-menu-native.png已实际查看。

本轮报告fixture-cleanup-report.json，日志fixture-*，浏览器夹具报告tmp/motion-fixture/browser-report.json。未重做真实OBS软件及物理系统输入；此前人工证据保留各自范围。当前提交候选77个文件，分源码30、协议/生成工具4、测试/数据/预览32、文档11，见docs/submission-file-list.md；不含临时产物、人物美术、无关改动或纯上游整合文件。未暂存、提交或推送。
