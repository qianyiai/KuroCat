# 自定义角色包与 MCP 导入方案

## 最新追加：02真实双服装包

首个试点已按用户选择生成02制服＋便服八张透明原图，保存提示词并导出224×278 RGBA；单人物双服装manifest、独立外观/rig/性格、来源声明及维护脚本在character-packs/zero-two。真实包预览入口visual-character-pack.html，详细证据见../docs/zero-two-pilot.md。10项真实包浏览器检查、16项Node、原有9项视觉及7项同步浏览器检查通过；2D noEmit为12个根文件零诊断。修复新人物眼白固定高度、花边袖口强加、idle压眨眼和108键预设抚摸轨迹。源图由内置image_gen生成；制服结构对照授权商品，针织便服是桌宠改编。原生MCP/导入/重启/系统输入/OBS仍未验收，不安装环境、不生成EXE、不暂存/提交/推送。


## 当前目标与连续同步阶段

用户已设置完整人物系统目标为active，原文保存于../docs/character-system-goal.txt，逐项证据与缺口在../docs/character-system-status.md。用户已明确首个试点“02：原作制服＋便服”；旧14角色/21草稿仍未验收，不把大肥鱼测试图片当02素材。

连续状态同步新增characterSync.ts、character_sync.rs、桌面发布/OBS消费、身份/epoch/序号/隐私/2秒TTL门控及重连恢复。5项同步Node检查和7项真实Edge检查通过，后者包括双画面及生产OBS前端在模拟SSE/资源端点下加载真实PNG。原有9项播放器/引擎和9项浏览器预览回归通过。详见../docs/character-sync-2d.md。真实IPC/SSE和系统输入、菜单、MCP、持久化及OBS应用仍未运行，Rust仅AST；不安装环境、不生成EXE、不暂存/提交/推送继续有效。当前源码测试与预览不能满足完整目标的最终运行验收。


## 最新追加：浏览器视觉验收

用户在获知无需EXE的独立浏览器视觉方案后明确回复“可以”。已建立visual-2d.html，使用固定Git基线虚拟模块并排对比，真实PNG解码，模拟时钟/随机种子与交互控件。现有Edge实际通过9项浏览器检查，已看待机/抚摸/隐私/布局截图，修复持续抚摸举手和暂停resize清屏；没有安装环境、生成EXE或Git提交/推送。入口与证据见../docs/visual-2d-preview.md，临时材料在tmp/visual-preview，正式截图在outputs/2d-visual-review.png。桌面原生与MCP/OBS仍未运行。


## 共享播放器阶段：最新状态（2026-11-24）

最新授权原文：“继续接入通用 2D 播放器，让大肥鱼先读取外置动作协议，验证动作和互动链路，再接人物包激活与切换。继续不安装环境、不生成新 EXE、不提交或推送，能做的静态检查先做。”此前阶段限制中“尚不实现播放器/激活”由本次授权和进度取代；安装、EXE、Git限制继续有效。

源码已将内置大肥鱼改为共享播放器+外置JSON；人物包完整解码后切换，保留性格/服装差异，隐私/切换/重连清理输入。MCP新增switch_character、set_character_outfit；import可在发布后单独尝试激活。桌面、独立菜单、托盘和OBS资源接入源码。选择独立写character-selection.json并投影settings，防止旧整份设置覆盖；旧猫咪显式激活清除人物选择。原生命中改用当前协议布局并对齐Canvas缩放。仅程序式2D+bodySprites服装可激活，帧包继续存取。

验证：Node播放器/引擎测试、2D范围TS5.9.3 noEmit、协议静态检查、11个Rust文件AST及离线锁定metadata。全项目TS仍有6个既有3D诊断，原因是复用旧依赖目录缺three及其类型。未编译、未运行Rust测试或真实MCP/UI/OBS；OBS连续抚摸/情绪/反应快照仍待实现。详见 ../docs/character-player-2d.md。本轮没有写AppData、安装环境、生成EXE、暂存/提交/推送或新增临时产物。下列各节是历史方案与阶段记录，冲突状态以本节及播放器说明为准。


## 通用2D动作协议本轮进度

用户授权：“按完整核查清单继续实现通用2D动作协议，把大肥鱼的动作和互动外置成可通过MCP保存、导入的角色包，保留各人物的性格差异。3D后续再做，继续不安装环境、不生成新EXE、不提交或推送。”本轮新增procedural-2d-v1 Schema、生成Rust/TS类型、数值与跨字段校验、大肥鱼/沉静性格数据、内联manifest导入、完整角色包读取及assetNotice保存。详见docs/character-motion-2d.md（相对本归档为../docs/character-motion-2d.md）。旧包无motion2d时保持兼容。

静态合同校验：2套配置、10个负例、JSON往返、生成类型一致性通过；另做Rust AST解析和离线metadata。Rust测试源码尚未执行，没有编译、实际MCP导入或写入应用数据；没有安装环境、生成EXE、Git暂存/提交/推送或新增临时产物。通用播放器、原大肥鱼切换为读协议、激活与OBS消费仍未实现；下方历史“协议尚未实现”由本节更新，仅代表当时阶段。


记录时间：2026-11-24 13:40（Asia/Shanghai）。更新日期：2026-11-24。状态：第一阶段源码实现已获授权并接入，尚未编译或运行验证。

## 大肥鱼动作与保存约定更新

用户要求完整查清大肥鱼素材、动画与互动，并已明确“先完整对齐大肥鱼的2D动作与保存格式，3D另阶段实现”。源码核查发现大肥鱼无3D，身体为四张224×278 RGBA PNG，动作/互动在专用TS与主引擎中，不能用六状态图集替代。完整证据和通用协议缺口见 `../docs/dafeiyu-reference.md`；第一阶段已增加每outfit可选bodySprites、下划线文件名及服装资源子目录，默认MCP素材示例参照大肥鱼。未实现全部程序动作、通用渲染或激活。后续动作契约须覆盖该清单的键鼠并行、抚摸、目光、手部、可选尾巴、隐私和OBS状态，不凭四图导入通过就称完整角色可用。

## 第一阶段实施记录

最新授权：“按修订后的方案开始第一阶段源码实现，先做角色包校验、注册表和 MCP 导入接口。继续保留不安装环境、不生成新 EXE、不提交或推送的限制，能做的静态检查先做。”此前仅方案分析的授权范围已由此扩大，禁止构建和环境安装的限制继续保留。

已新增独立manifest类型/校验器、PNG解码、不可变修订与注册表发布、4个MCP导入/查询工具及注册表generation轮询通知。为保持阶段行为真实，本阶段拒绝activate=true，暂不提供人物/服装切换，不写人物选择设置；旧激活兼容及settings.json跨进程补丁更新在引入激活的阶段一并实现。包格式、确定限额、失败现场恢复和实际静态验证见 `../docs/character-pack-v1.md`。源码尚未编译或运行验收。校验在锁外、已校验内容的磁盘写入在锁内串行执行；暂不实现并行磁盘复制，以减少发布状态及锁顺序复杂性。

## 方案基线（历史授权以首节更新为准）

建议新增独立的角色包存储与 Canvas 2D 渲染模块，复用原有输入、隐私事件、菜单刷新和 MCP 传输；保留现有 CatSkinConfig 与猫咪 MCP 契约。

本地源码为 5.0.1，HEAD=20be633d19c50093536f0e429943065254fc6f36。本次远端 main=825fb7a5065c533c65feb495af2bdf8a2f6ba471；GitHub compare 确认仅新增一个提交，修改 website/index.html、website/src/i18n.ts、website/src/main.ts，桌面/MCP相关源码不变。因此下列本地代码证据适用于本次核验到的最新远端。未执行 pull/fetch 或切换本地分支。后续开发前仍需重新核对上游。

用户最新授权：“走自行扩展路线，先把你指出的问题补进方案，再核验旧隔离工具链能否复用，暂时不要安装环境或生成新 EXE。”因此采用自行修改源码的扩展路线，不再以等待官方支持为前置条件；本次仅修订方案和核验已有工具，不实施功能、不安装环境、不生成新 EXE、不暂存、不提交、不推送。不得执行 tauri:dev、tauri build、cargo build、cargo check 或 cargo test；包括 cargo check 在内的检查可能编译并运行构建脚本，不能视为无 EXE 验证。只查询已有工具版本和配置不解除上述限制。

## 现有调用链：代码事实

| 位置（本地基线行号） | 观察结果 | 需要接入的职责 |
| --- | --- | --- |
| src-tauri/src/cats.rs:131、470、531 | cats.json 保存 CatSkinConfig；all_cats 合并内置和自定义；cat_exists 校验选择 | 保留原行为，新增独立角色注册表 |
| src-tauri/src/config.rs:221 | Windows 数据目录为 %APPDATA%/kuro-cat-pet | 新包落在该数据根目录的子目录 |
| src-tauri/src/mcp.rs:15、189、340 | 定义工具并经 execute_tool/handle_jsonrpc 分发，HTTP 与 stdio 共用 | 增加角色工具，不更改猫咪工具输入/输出 |
| src-tauri/src/mcp.rs:406、531 | stdio 的 on_change 是空操作；HTTP请求体限 2 MiB | 新增注册表轮询；使用本地路径导入，不传图片 base64 |
| src-tauri/src/lib.rs:291、321、943 | get_cats、设置更新、托盘切换都依赖 cat_exists | 角色选择须有独立路径，不能只把 ID 塞进 catBreed |
| src-tauri/src/lib.rs:961、1019、2329 | reload_and_emit_all 通知；400ms 轮询 settings.json/cats.json；HTTP回调直接刷新 | 加入角色注册表修订号和事件，覆盖两种 MCP 模式 |
| src/main.ts:174、750、844 | 默认 3D；大肥鱼强制 2D；启动与事件读取猫咪列表 | 新角色按渲染能力选2D，加载角色和服装 |
| src/catEngine.ts:574、2195 | setCatAppearance 将普通自定义对象解释成猫；大肥鱼有独立分层渲染分支 | 新增包渲染器及状态桥，不扩充一串角色硬编码 |
| src/menuMain.ts:336、520；src-tauri/src/tray.rs:140 | 独立菜单窗口动态读取猫咪；原生托盘内置角色硬编码 | 桌面菜单和托盘均须显示角色/服装入口 |
| src/obsMain.ts:106、259；src-tauri/src/obs.rs:96、298 | OBS 有独立2D/3D选择、快照/SSE和静态素材加载 | 同步角色元数据、隐私状态和外部素材读取 |

目前没有证据表明把任意 PNG 放进 cats.json 同目录即可导入人形角色。新增加载能力最终必须运行修改后的程序；在用户允许本地编译或官方合入前，只能完成方案、源码与受允许的非 EXE 验证。

## 包结构及存储建议

这些路径和字段是拟新增规范，不是官方已有规范。

本路线将其定义为本扩展的角色包目录与 v1 契约，不声称是上游官方规范。第一版沿用现有应用数据根目录以兼容旧猫咪数据；源码和文档中明确标识扩展格式。以后若官方推出不同格式，再单独评审适配或迁移，不提前承诺兼容未知规范。

```text
%APPDATA%/kuro-cat-pet/
  characters.json                    # 注册表：ID、当前版本、修订号
  characters/<id>/<revision>/
    character.json                   # manifest
    assets/*.png
  character-import-staging/          # 校验完成前不对列表可见
```

第一版导入“含 character.json 的本地目录”；完成后增加 ZIP，仍调用同一导入服务。注册后复制到应用管理的目录，不直接依赖创作目录，避免移动原文件后失效。不要写入 Program Files、源码目录或 cats.json。更新使用新的不可变 revision；注册表切换成功后才供新请求使用。旧版本/失败暂存的保留与清理策略单独说明，不在开发或验证脚本中擅自删除用户已有文件。

manifest v1 建议包含：schemaVersion、id、name、version、author/license、renderer=canvas2d、logicalSize、anchor、defaultOutfitId、outfits、animations、behavior。version 是作者版本，revision 是内容指纹；未知 schemaVersion 明确拒绝。角色 ID 严格校验并检查与内置猫及自定义猫重名，不沿用静默改写 ID 的方式。

- 一个包对应一个角色，服装是 outfits 子项；海梦不再在主列表里展开成八个独立角色。
- animations 描述图集相对路径、帧矩形、逐帧时长、循环方式、锚点、前后层级。先支持 PNG 图集和帧序列，不执行包内 JS、HTML 或其他脚本。
- 采用同一时间线中的 background/body/foreground 图层，让身体在键盘后、手在键盘前；同一帧各层同步。第一版支持固定锚点，并为65/108键布局提供布局覆盖；不要求一开始重做大肥鱼的程序化手臂。
- behavior 将标准事件映射到各角色动作，支持动作变体、权重、冷却和空闲触发；不是只有全局速度参数。每套服装可覆盖动画，规则仍使用同一角色定义。
- 建议必需 idle、typing、mouse、interaction、rest、privacy 六类动作；眨眼可由 idle 的变体提供。未提供必需动作在校验时报告，不用猫咪动作或其他人物素材悄悄替代。
- 图集规格不固定为旧草稿的 1536×1024，加载前校验尺寸和帧边界。旧六状态草稿可人工映射成 manifest，但不等于动作质量验收通过。

## 运行时设计与兼容

Rust 新增 characters.rs（类型、校验、注册表、查询）与 character_import.rs（目录导入、版本替换、错误恢复）。菜单导入与 MCP 导入使用同一服务，避免两套规则。所有写入者共用跨进程排他机制，因为 stdio 与桌面服务可能是不同进程；注册表用完整写入后替换的方式发布，失败不切换选择、不损坏旧版本。

settings.json 新增带默认值的 activeCharacterId: null、characterOutfits: {}；保持 catBreed 的既有含义与取值。activeCharacterId 非空时使用角色，否则使用 catBreed。旧 switch_cat、update_settings 中显式传入有效 catBreed、upsert_cat(activate=true)、桌面菜单和托盘选猫都清空 activeCharacterId，保证旧调用仍能切回猫；upsert_cat(activate=false) 以及不包含 catBreed 的普通设置更新不得改变当前角色选择。角色切换保留上一次猫咪设置。删除或损坏包时清除无效选择并回到有效猫咪，给出原因。实现时须一并检查 config 默认、lib.rs、MCP、托盘的所有写设置入口；旧 list_cats 的 activeCatId 保留 catBreed 含义，扩展的实际显示对象由新角色查询明确报告。

跨进程保护必须覆盖 settings.json 的完整“加锁→重新读取→应用本次字段补丁→保存→解锁”过程，不能只保护 characters.json 或只锁最终写文件。桌面内存快照不能直接覆盖 stdio 已保存的新值；与新角色并存的原有设置写入入口也须接入同一更新机制。通知、耗时素材预检和复制放在锁外；发布或激活前在锁内重新核对修订号。需要同时操作注册表与设置时固定锁顺序，先发布可用包，再保存选择；不宣称两个文件能原子提交，选择失败时返回“已导入、未激活”，保留原选择。验收包含桌面改缩放与 stdio 切角色并发后两项均保留。

前端新增 characterTypes.ts、characterState.ts、characterRenderer.ts、characterAssets.ts。复用键鼠/隐私事件，由独立状态机处理“隐私优先；鼠标与键盘按住状态；互动；空闲休息”的切换。不要让全局 OS 的实际键值进入角色台词、配置或日志；退出隐私时清理旧输入，恢复时不补播敏感动作。

### 待试点确认的动作契约

以下是实现建议，尚未作为用户已确认的动作表现。包格式冻结前用试点预览确认：

- privacy 抢占所有动作并隐藏按键气泡；退出时清空旧按住状态和触发队列，只响应退出后的新输入，避免补播。
- 键盘与鼠标分别维护按住状态；两者同时活动时，优先使用显式声明的组合动画或可组合图层。包未提供组合表现时，建议显示 typing，鼠标状态继续更新，键盘释放后若鼠标仍活动立即转 mouse；在 schema 中写明回退规则，不要求所有角色新增第七套必需动画。
- 实际输入可打断 interaction/rest；休息只在无按住状态且达到包声明的空闲时间后进入。短按释放后的动作收尾由包中有界时长控制，不无限重播；新的输入优先于收尾。
- 换装先完整预载当前所需素材，成功后在帧边界同时替换各层；失败保留原服装。沿用最新输入与隐私状态，重新从对应动作首帧开始，不把不同服装的帧编号强行对应；隐私期间换装不得短暂显示非隐私帧。
- 切换角色、暂停监听、OBS断线重连时清理过期输入；重连先应用快照中的隐私与选择，再展示素材。桌面和OBS可独立推进动画，不承诺逐帧一致；状态转移、服装和隐私结果须一致。

在 KuroCatEngine 的现有绘制顺序中插入角色 body/foreground 渲染；旧猫咪、大肥鱼路径保持行为兼容。桌面和 OBS 复用同一个状态机/渲染器；两处都通过能力字段决定是否使用2D，而不是继续特判更多角色ID。切回猫咪时恢复用户原 renderMode；加载慢时使用选择代次标记，丢弃过期加载结果，防止快速切换后显示错角色。素材缺失须显示诊断并回退，不让整个桌宠白屏。

资源读取共用 Rust 解析器，仅能读取已注册 ID/revision 下 manifest 引用的素材。桌面经 Tauri 命令取 PNG 字节并创建 Blob URL；切换后释放旧 URL/图像缓存。OBS 经现有 HTTP 服务新增只读 /characters/<id>/<revision>/assets/... 路由，由同一解析器返回 PNG，不能把应用数据根目录整体当静态目录开放。桌面读取不依赖 OBS 开关。OBS快照与SSE新增角色目录/修订号与服装选择，重连时可完整恢复。先不支持任意远程资源、Live2D或3D模型。

## MCP 拟新增工具

| 工具 | 输入与行为 |
| --- | --- |
| get_character_schema | 返回schema、示例、包根目录、支持的格式及限制 |
| validate_character_package | path，返回逐项错误和警告，不写应用数据 |
| import_character_package | path, replace=false, activate=false；校验→复制→发布注册表 |
| list_characters | 返回已安装角色、服装、当前选择、修订号和可用状态 |
| switch_character | id, outfitId可选；成功预检后保存选择并刷新 |
| set_character_outfit | id, outfitId；只接受已注册服装并保存 |

更新复用 import_character_package(replace=true)，默认拒绝重名覆盖。删除/导出可后续单独做，不为首轮导入增加不必要工具。导入、激活分别返回结果，避免包已存入但激活失败被误报成整个操作未执行。错误建议用稳定 code 加可读 message，例如 INVALID_MANIFEST、ASSET_MISSING、ID_CONFLICT、UNSUPPORTED_SCHEMA、IMPORT_BUSY。

本地路径指 MCP 服务所在机器的路径。HTTP工具返回后通过现有 on_change 通知；stdio导入也更新 characters.json，桌面400ms轮询加入该注册表，即使不激活也能刷新列表。仅监听 settings.json 不够。直接手工放文件不作为第一版承诺；可由 validate/import 或日后显式 rescan 注册，避免监控半写入素材。

包是外部输入，必须限制相对路径、实际解析后的根目录、符号链接/重解析点、PNG解码尺寸、累计像素/内存、文件数、包大小和帧索引；ZIP支持时额外拒绝路径穿越和解压炸弹。具体限额需用现有图集评估后定值并写入schema。只接受本地路径，不提供URL抓取或任意文件读取。新写入能力沿用loopback传输，但需评估并限制浏览器Origin/Host：当前HTTP允许CORS *，不能把新导入当成普通无副作用图片查询；这是新增导入边界的必要校验，不扩展成全项目安全重构。

## 阶段与验证计划

1. 自行扩展路线已由用户确定；评审并确定包格式、选择兼容规则、动作契约和首个试点角色。建议试点采用海梦校服与黑江雫两套服装，以同时覆盖人物动作、服装切换和分层；是否采用仍待用户确认，正片外观须另行核验。先验收一个角色两套服装，旧图集只作参考，不直接视为合格包。
2. 获实施授权后做导入/校验/注册表/MCP契约；使用临时目录验证正常、缺素材、ID冲突、路径越界、超限、并发和写入失败后原包仍可用。
3. 实现2D状态机、菜单及服装切换；用交互预览验证按下/松开、组合输入、休息唤醒、隐私优先、65/108键与前后层级，随后回归猫咪与大肥鱼。
4. 接入OBS资源、快照/SSE与stdio轮询，验证HTTP和stdio导入均能让列表刷新，重启保留、缺包回退、快速切换不串图。
5. 先用一个代表性角色验收，再映射归档的14角色/21外观。海梦服装与原作细节仍需正片核验；避免一次批量生成后再发现包契约不合适。

不生成EXE的限制下，可以在另获实施授权后做静态分析、TypeScript检查、网页预览及独立非原生测试；cargo test、tauri dev/build都会生成原生可执行产物，不应擅自运行。桌面全局键鼠、实际MCP热加载和打包后的资源访问需留为未验证，直到用户明确允许对应构建/运行。

回归清单补充：角色激活时分别调用 switch_cat、upsert_cat 的两种 activate 值及 update_settings 的两种字段组合；并发设置保存不丢字段；组合输入、动作收尾、动作中换装失败、隐私中换装、OBS重连不出现非隐私帧。第一阶段未通过前，不批量制作14角色或将21张旧草稿改称最终资产。

## 环境与移交

2026-11-24 在接收对话完成只读核验：Node 24.15.0/npm 11.12.1、MSVC、Windows SDK 10.0.26100.0、WebView2已存在；默认PATH及默认安装位置未发现Rust，当前项目尚无node_modules。

旧隔离工具链根目录：`C:\Users\江户川\Documents\Codex\2026-11-24\k\work\toolchain`。直接运行其 `rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/` 下已有程序，避免rustup代理触发工具链安装或更新；没有修改全局或当前进程的PATH、CARGO_HOME、RUSTUP_HOME。

| 核验 | 实际结果及边界 |
| --- | --- |
| rustc -vV | 成功，1.100.0，host=x86_64-pc-windows-msvc，LLVM 23.1.5 |
| cargo -Vv | 成功，1.100.0，host=x86_64-pc-windows-msvc |
| rustc --print sysroot / --print target-libdir --target x86_64-pc-windows-msvc | 均指向上述隔离目录，标准库libstd的rlib/rmeta存在 |
| 已安装组件记录 | rustc、cargo、rust-std的Windows MSVC组件存在；未确认rustfmt/clippy组件安装，cargo目录中同名代理文件不等于组件可用 |
| MSVC与SDK文件 | VS2022 MSVC 14.44及VS2026 MSVC 14.51的link.exe存在；SDK 10.0.26100.0的kernel32.lib、ucrt.lib存在；未做实际链接 |
| 缓存与当前Cargo.lock对照 | 锁文件含452个registry包；隔离缓存有258个同名同版本crate归档及其已解包源码，缺194个归档。此为全平台锁文件统计，不能等同于Windows需要补下载194个包，未执行目标平台依赖解析或校验归档校验和 |
| 已缓存依赖的rust-version | 已解包且与锁文件匹配的依赖声明中最高为1.90（含tauri 2.12.7、tauri-build 2.7.6）；1.100满足这些已检查声明，缺失依赖的要求未核验 |

结论：已有Rust/Cargo二进制可启动、目标和标准库匹配，可作为后续复用候选，无需为了本次核验重新安装Rust。尚不能称“本项目构建已通过”或“已具备完整离线环境”：依赖缓存不全，项目前端依赖未安装，未验证编译、链接、构建脚本与运行效果。后续获相应授权时，优先复用原隔离目录；在单次命令作用域指定CARGO_HOME、RUSTUP_HOME及工具链路径，避免全局配置修改。对原缓存的补下载/解包也属于环境写入，本轮不执行。

旧素材与最新约束见同目录 requirements.md/status.md；官方需求见 https://github.com/qianyiai/kurocat/issues/31#issuecomment-7122336299 。当前任务为方案修订与已有工具核验，不向GitHub再发消息。


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
