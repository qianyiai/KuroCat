# v5.1.0 源码整合记录

2026-11-24，用户明确选择“整合 v5.1.0 并保留人物扩展（建议）”。原人物系统目标及2D范围保持，3D人物后续；不提交、推送或全局安装。

上游固定为 [41f3de0](https://github.com/qianyiai/kurocat/commit/41f3de0bc7fc3eecfd6e289988d45e81c33849a3)，相对原20be633多7个提交、27个修改文件。通过GitHub连接读取，不执行git pull/fetch/rebase。每个下载文件按Git blob SHA校验；原始本地文件、基线、上游、合并候选和指纹保存在 `tmp/upstream-v5.1.0/`。这些快照用于恢复和比较，不自动清理。本地Git HEAD仍是20be633，工作区源码已整合v5.1.0。

## 保留与合并

保留独立角色注册表/选择、MCP角色工具、目录导入、并发显式字段保存、通用2D播放器、02双服装、隐私和连续OBS状态。接入上游渲染/输入节流、旧猫咪3D优化、双标签菜单、托盘勾选同步、更新器、穿透锁重启记忆、`--unlock`及解锁提示。

8个文件与人物改动重叠；去除换行差异后4个文件有5处文本冲突。合并保留人物布局/命中元数据，结合上游布局简化；桌面hover缓存分开维护2D/3D命中；菜单同时初始化人物入口及上游平台提示；CSS同时保留人物样式和双标签布局。更新时逐文件核验本地原指纹，未覆盖并行修改。

发现上游Windows鼠标钩子的首次坐标差使用i32::MIN初值，减法发生在哨兵判断之前。针对性回归先复现“attempt to subtract with overflow”，再用abs_diff修复；保留24ms门控、微小抖动过滤和u32时钟回绕语义。两个新增测试覆盖首次采样/大坐标及节流/回绕，失败日志 `mouse-overflow-before.log` 保留。

## 实际验证

- 全量TypeScript、生产tsc+Vite构建通过；已有Three大分块提示保留，未新增前端依赖。
- 离线Cargo check/build通过；Rust库65通过、0失败、1既有联网更新检查跳过。
- Node播放器/互动/同步18项通过；含02双服装、两种布局/朝向852组映射按键情况。
- 正式菜单页面9项通过，新增切换系统页再回外观页时保留人物及服装的检查；IPC仍为替身，不与原生证据混淆。
- 新EXE真实stdio8项通过；原生桌面/HTTP/400ms轮询/IPC/SSE/PNG/菜单8项通过，原生OBS静态200。
- 新EXE原生窗口4项、损坏资源恢复4项、人物固定2D/旧猫咪真实Three.js/大肥鱼2D模式3项通过。
- 真实OBS软件已点击浏览器源刷新，观察到加载过渡后02制服恢复，截图 `tmp/upstream-v5.1.0/obs-refreshed.png`。未录制或推流。此项只证明刷新后的人物展示，不等同于新版本全套互动视觉验收。

旧隔离进程正常退出码0后重建；新实例复用同一AppData，`get_app_version`实测5.1.0。会话以 `tmp/native-validation/desktop-session.json` 为准。合并前的小型报告保存在 `pre-merge-reports/`，保留版本范围。

窗口脚本首次在异步人物帧尚为空时读取sequence失败；已改为等待真实身份帧后再检查隐藏2.4秒仍持续发布，4项重跑通过。该失败保存在 `tmp/native-validation/window-failure.json`，没有将工具取值错误解释为产品故障。

## 尚未完成

用户已确认旧调试版物理拖动、桌面/真实OBS摸头及Alt恢复正常；这是旧版人工证据，新合并版受输入节流、命中与菜单变更影响的手动输入/隐私/Alt、真实托盘暂停/恢复已通过（见追加实测），其他托盘选择入口仍待验。当前硬件仅单屏150%DPI，多屏与其他DPI没有实机结论。上游宣称的GPU/CPU性能提升未实测量化。

工作区真实stdio目录发布仍有Windows5错误，系统临时目录完整导入通过。Node/Rust的最小文件/目录/PNG及跨父目录控制存在不同结果，工作区Node PNG曾通过也曾EPERM，最小Rust通过；尚未定位占用或环境因素，未放宽校验或加入盲重试。新原生MCP测试仍使用已授权系统临时夹具。

角色扩展的完整最终目标保持未完成，其余归档人物仍不是已验收交付。

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
