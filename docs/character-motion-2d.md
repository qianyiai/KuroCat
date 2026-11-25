# 通用2D动作协议与MCP存取

2026-11-24。协议ID：`procedural-2d-v1`，位于角色包v1的 `outfits[].motion2d`。数据类型、参数保存、校验、MCP内联导入及读取已接入。现已新增共享播放器，内置大肥鱼直接读取外置协议；人物/服装激活、菜单及OBS资源也已接入源码。实际验证与未验证边界见 [播放器说明](character-player-2d.md)。3D不在本轮范围，OBS连续快照现已接入源码及浏览器模拟传输验证，原生服务的实际验证以当前交付状态为准，见 [同步说明](character-sync-2d.md)。

## 入口和单一契约

- `src-tauri/protocol/motion-2d.schema.json`：字段、类型、枚举、数值/资源边界和隐私常量的来源。
- `src-tauri/src/motion2d_types.rs`、`src/characterMotion2d.ts`：从Schema生成的Rust/TypeScript类型，修改Schema后执行 `python scripts/generate-motion-types.py` 更新。
- `src-tauri/src/motion2d.rs`：校验固定内置Schema及跨字段关系。包不能传入Schema、远程引用、表达式、脚本或回调。自定义hex-color/slug/logical-key格式由本地校验器强制执行，不能仅靠通用JSON Schema工具的format提示。
- `src-tauri/protocol/dafeiyu-motion-2d.json`：从现有2D代码提取的迁移参考；`calm-motion-2d.json`：不同性格/动作的示例。它们不是已完成视觉验收的人物资源，也不是逐像素、逐帧重现的实测结果。

原v1帧/图集包和只有bodySprites的包继续接受，不自动添加动作参数。只有显式声明motion2d才启用协议校验，并要求同服装存在224×278 RGBA bodySprites。每套服装分别保存完整配置，避免位置或服饰变化后沿用不合适的肩眼锚点。

## 外置的数据

| 对象 | 已保存的内容 |
| --- | --- |
| rig | 源画布、肩/眼/腰、捂眼目标；两眼轮廓、虹膜半径；刘海裁剪区域、色阈值及透明度阈值 |
| layouts | 65%/108各自逻辑画布、人物中心/绘制宽度/枢轴、键盘中心/尺寸/倾斜、鼠标位置/身体偏移、抚摸椭圆 |
| body | 呼吸、拍键弹动及压缩、打字摇摆、控鼠前倾/下潜、位置与倾斜各自弹簧 |
| blink/mood | 首次/循环眨眼区间、闭眼时长；手速采样窗、升降温、两级滞回阈值和停留时间、分层腮红 |
| gaze | 横纵目光范围、目标比例、活跃/返回速率、瞳孔视差、眼白/虹膜非均匀渐变、瞳孔/高光颜色 |
| hands | 手部跟随/保持/忙碌、各布局鼠标伸手范围、待机与举手姿态；袖口渐变、花边/纽扣/轮廓、肤色、圆手与压缩 |
| tail | 独立开关、伸出/保持/回收、相位/跟随、待机/打字/高热度/开心摆动、前后段分界、尾部渐变和尾鳍曲线 |
| bindings | smart/custom/edge/off、逻辑键别名、鼠标/打字窗口、Enter收尾窗口、边缘阈值；左右手/鼠标/尾巴允许并行，系统repeat不重复触发 |
| petting | 每步移动范围、笔划距离、反转次数/方向判定、能量增长/内外衰减、开心阈值；按住鼠标不计抚摸 |
| personality | 身份和待机/打字/抚摸各自的动作池；动作类型、表情、权重、冷却、时长、位移与转角 |
| privacy | 固定最高优先级、blink、捂眼/摇摆及匿名输入反馈；清理旧按住/队列，隐藏按键/鼠标徽标，退出不补播 |
| particles | 爱心/水滴开关、每秒生成率、生命周期、上限、速度、水纹扩散与颜色 |
| presentation/sync | 固定前后层级、两种朝向、气泡开关；未来快照版本、抚摸/情绪状态与切服装/重连清理要求，不保存真实按键 |

位置和尺寸使用明确的源像素或逻辑像素；rig中肩、尾根、捂眼与命中椭圆使用0..1归一化坐标。转角是弧度，持续时间是毫秒，跟随/衰减速率是每秒速率。原实现的按帧粒子概率已转换成参考60fps下的每秒期望值，不继续把动作绑定到帧数。隐私清理规则比旧实现更严格，不继承旧短时状态残留。

## 播放器消费语义

协议约束保存动作数据。以下语义由共享播放器消费，连续OBS状态同步的原生运行仍待验收；源码接入不代表现有安装版已升级：

1. 左手、右手、鼠标、尾巴各自维护按住/目标/释放状态；键鼠并行优先保留左手鼠标、右手打字，符合尾键策略时由尾巴补位。repeat只保持，不再次生成击打或手速计数。
2. 普通动作和表情在隐私下全部被抢占。表情顺序为隐私blink→抚摸开心/高热度→中热度→眨眼→idle；人物反应池可在非隐私状态覆盖普通表情，不能覆盖隐私。手部顺序为捂眼→抚摸反应→输入→待机。
3. 护眼目标根据当前服装rig和布局投影，不根据固定大肥鱼像素硬编码。退出隐私/切换服装/重连时清理旧输入，保留合法的角色选择与配置，不补播输入队列。
4. 眨眼在区间随机取值；热度采用采样窗与升降温平滑，情绪按滞回及停留时间迁移，不能把每次typing直接映射happy。
5. 抚摸需先完成反转/画圈笔划识别，再增长能量；静止悬停无能量奖励。离开加速衰减。命中区来自当前服装布局，不默认把所有人物的整张透明PNG作为可摸区域。
6. 反应池按所属事件选择：先排除冷却中的候选，再按正权重选择一个，持续durationMs，结束返回当前输入/待机状态。没有可用候选时沿用基础动作，避免每帧重新抽样。普通反应可被输入打断，privacy总能立即打断。
7. `tilt`表示身体/头部转角与位移，`nod`表示周期性低头/回正，`bounce`表示弹动，`cheer`表示双手回应，`settle`表示缓和回待机；offsetPx/rotationRad决定姿态幅度，时长/冷却决定节奏。渲染器使用平滑起止包络，不能只改全局播放速度。
8. 背景尾巴→身体→眼睛→腮红→键鼠→水纹→前段尾巴→手→粒子→徽标，属于固定安全绘制顺序。原始身体四图和程序部件分别处理，不复制外部JS执行。
9. snapshotVersion=1表示消费方需要同步抚摸能量和情绪等连续状态；配置字段不是当前已有OBS同步的证据。真实输入键值不进入保存的角色包或角色台词。

尾巴是可选能力：普通人物可以enabled=false，但tailMode须为off。关闭后尾巴参数可保留作编辑数据，播放器不得渲染鲸尾。变体与部件参数允许各人物独立设计；不会把14个人物套成同一姿势/配色。

## MCP保存、读取和更新

工具现有七个：get_character_schema、list_characters、get_character_package、validate_character_package、import_character_package、switch_character、set_character_outfit。激活/换装行为见播放器说明。

`validate_character_package` 与 `import_character_package` 新增可选 `manifest` 对象。提供时读取该对象及path下引用的PNG，不要求源目录有character.json；不提供时沿用原目录导入。两条路径共用类型、动作、图片及发布校验。

| 参数 | 含义 |
| --- | --- |
| path | 运行MCP服务的机器上，图片目录的绝对路径 |
| manifest（可选） | get_character_schema返回的example或dafeiyuReferencePackage，经修改后的完整JSON对象 |
| replace | import时是否更新已有角色，默认false |
| activate | 默认false；true在发布后尝试激活程序式2D服装，失败以activationError单独报告 |

正常步骤：取Schema/示例→配置人物与每套服装的motion2d→调用validate→调用import。动作、互动、性格和assetNotice与图片一起发布到同一不可变revision；内容指纹覆盖完整规范化manifest，不修改来源文件。

编辑已保存人物：`get_character_package({id})` 返回验证过内容指纹的完整manifest及packagePath。保留未知于编辑者但仍属于当前Schema的字段，只修改目标服装/性格字段，然后以packagePath为素材根目录，传完整manifest、replace=true。旧版本保留；校验失败不会更新注册表。读取会校验PNG与完整修订，不只是返回列表摘要。

大肥鱼参考包无需在工程里重复复制图片：get_character_schema返回 `dafeiyuReferencePackage`，其服装id为dafeiyu、引用assets/dafeiyu/notail_*.png，含motion2d及原始MIT资产声明。以项目的绝对 `src` 目录作为path，传这个完整对象给validate_character_package及import_character_package即可保存；不覆盖内置id=dafeiyu，导入参考id为dafeiyu-reference。2026-11-25已通过真实stdio MCP完成校验、导入、激活、四张图片逐字节比对及协议/声明读回，源码PNG未变。应用在独立数据目录保存所需资源，未要求用户手工拼JSON。该检查证明存取和激活，不替代包模式逐帧视觉验收；复现方式见[通用验证说明](character-fixture-validation.md)，结果见[当前状态](character-system-status.md)。

`assetNotice`（可选，最多16KiB纯文本）保存来源声明；参考包包含原文件的完整许可与版权文本，导入后随manifest保留。仍只复制引用PNG，不把源码目录整体安装。自定义人物需填写实际作者/素材许可，不能照抄参考包的来源声明冒充自己的来源。

新增错误码INVALID_MOTION、CHARACTER_NOT_FOUND；旧错误契约继续使用。HTTP新增角色工具同样经过Origin/Host边界；内联参数不会绕过原有路径、体积或文件锁校验。activate=true的发布与选择分开返回结果。

## 检查和边界

可重复的静态检查：

```powershell
python scripts/generate-motion-types.py --check
python scripts/check-motion-contract.py
```

实际运行：生成结果一致性检查、两套人物配置的静态校验与JSON往返、10个负例（隐私降级、原始键值、脚本字段、坏滞回、眼睛越界、反向区间、坏渐变、非有限值、关闭尾巴却启用绑定、未知动作）。另进行了Rust AST解析和离线锁定cargo metadata。没有安装任何Python/Node/Rust新依赖。

Rust测试源码另覆盖：类型化配置往返、人物差异、坏隐私/眼位拒绝、MCP内联配置发布/读取保留性格与许可、不修改源文件、坏更新保留旧角色、大肥鱼参考复用源码PNG。Rust库、Node播放器、类型检查和真实MCP已分别运行，实际结果与未覆盖边界见[当前状态](character-system-status.md)。Python静态检查不替代Rust运行或真实视觉验收。

当前交付包含协议/存取及共享播放器、人物/服装切换源码和参考数据。Node验证范围、TS缺失依赖、原生与OBS待验收项以播放器说明为准；连续OBS快照现已接入源码，实际覆盖范围及原生未验收边界见character-sync-2d.md。四PNG必须配套有效motion2d才能使用当前播放器。没有新增临时产物或备份。


## 通用夹具与向后兼容袖口扩展

当前使用大肥鱼与通用测试夹具，复现入口及验证范围见 [通用验证说明](character-fixture-validation.md)。已删除人物的旧资源不再作为前置依赖。

袖口兼容性：hands.style.cuffStyle可选ruffled/plain/ribbed，省略时保留原花边；测试夹具两种配置验证可选样式和性格数据独立保存。
