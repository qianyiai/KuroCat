# 自定义角色包：格式、接口与阶段记录

2026-11-24。自行扩展格式，不是上游官方导入规范。隔离测试版已完成原生编译及部分MCP、桌面和OBS验收，逐项证据与剩余项目见 [当前状态](character-system-status.md)。现有安装版和既有客户端连接不会自动获得这些接口；下面历史阶段记录仅表示当时状态。

## 当前范围

提供 `get_character_schema`、`validate_character_package`、`import_character_package`、`get_character_package`、`list_characters`、`switch_character` 和 `set_character_outfit`。程序式2D播放器、激活、服装、菜单、托盘与OBS资源已接入源码，见 [播放器说明](character-player-2d.md)。仅帧/图集包仍不能激活。人物选择独立保存于character-selection.json；下面第一阶段记录中的旧限制仅代表历史阶段。

开发与测试使用已有兼容Rust、Node和Python环境；测试不会自动安装依赖。复现步骤和独立数据目录见 [通用验证说明](character-fixture-validation.md)。

## 包目录与契约

输入为运行MCP服务的机器上的绝对目录，不是客户端机器路径。第一版只接受本地磁盘目录，不接受ZIP、URL、网络共享或符号链接/Windows重解析点。

```text
my-character/
  character.json
  assets/
    default/
      notail_idle.png
      notail_blink.png
      notail_shy.png
      notail_happy2.png
```

`get_character_schema` 返回结构化JSON Schema、默认大肥鱼式素材示例example、旧通用图集示例genericExample、reference2d行为清单及限额。manifest的严格类型在 `src-tauri/src/characters.rs`；跨字段、路径及图片检查在 `character_import.rs`。Schema不能单独替代实际校验器。

动作协议更新：每outfit可选motion2d已支持通用2D的rig/动作/互动/性格与隐私数据，MCP可内联manifest保存并读取完整配置，详见 [动作协议](character-motion-2d.md)。共享播放器已消费协议；源码检查与原生运行边界见播放器说明。

manifest必需字段：schemaVersion=1、id、name、version、author、license、renderer=canvas2d、logicalSize、anchor、defaultOutfitId、outfits、animations、behavior。可选assetNotice保存最多16KiB来源声明。未知字段拒绝。角色/服装/动画/素材文件名使用小写字母开头、后续小写字母/数字/短横线、最多48字节的ID，排除Windows保留名。

- `outfits`：每项有id、name和actions；必需idle、typing、mouse、interaction、rest、privacy，combo可选。每个动作对应1至16个 `{animation, weight, cooldownMs}` 变体；动画引用必须存在。服装ID唯一，defaultOutfitId须有效。
- `animations`：以动画ID为键，每项含looping和frames；每帧含durationMs和layers，各层共用当前帧时间。layer含asset、rect=[x,y,w,h]、anchor=[x,y]、plane，可选layoutAnchors（65/108键布局各自目标锚点）。plane取background/body/foreground，同帧不可重复。
- `asset`：允许 `assets/<filename>.png` 或 `assets/<outfit-id>/<filename>.png`；文件名可含下划线，角色/服装ID规则保持。图集和帧序列均使用帧矩形引用；序列帧可引用不同PNG。仅复制manifest与实际引用的素材，其他源文件不安装、不执行，也不计入安装包限额。
- `bodySprites`（outfit下可选）：profile=dafeiyu-body-v1，idle/blink/shy/happy分别指向该服装目录中的notail_idle/notail_blink/notail_shy/notail_happy2.png；四张必须是224×278、8位RGBA，并被动画引用。导入按原相对路径保存。它仅描述身体表情素材，不代表完整程序动作。
- `behavior`：restAfterMs为1000至3600000，inputReleaseMs为0至2000。为后续帧状态机保留并校验；当前程序式播放器的时序与隐私/组合输入由motion2d控制。
- 图片要求：静态、8位RGB/RGBA PNG；完整解码并检查结束数据，不接受APNG。校验通过只说明格式有效，不代表人物辨识度、动作质量或素材授权已验收。

限额按单包计：原始及规范化manifest各不超过256KiB、规范化manifest加引用PNG总计不超过64MiB、128张PNG、每边4096像素、累计32Mi像素。画布每边1至2048，锚点坐标±4096；32套服装、128动画、每动画256帧、全包4096帧、每帧1至3层、帧时长1至10000ms。权重1至1000、冷却0至3600000ms。注册表上限256角色、4MiB。

## MCP调用示例

以下是将来运行扩展程序后传给 `tools/call` 的参数示例，不是本轮已执行的导入：

```json
{"name":"validate_character_package","arguments":{"path":"D:\\Characters\\my-character"}}
```

```json
{"name":"import_character_package","arguments":{"path":"D:\\Characters\\my-character","replace":false,"activate":false}}
```

`replace=false` 拒绝已注册ID；更新使用replace=true，也不能覆盖任何猫咪ID。成功返回entry、generation、activated和activationSupported；playableOutfits列出可激活服装。activate默认false，true时在发布后尝试选择，失败另报activationError。list返回注册条目及manifestPresent；该标记只表示manifest文件存在，不代表素材完整或可渲染。导入与猫咪upsert/delete共用发布锁，避免并发占用同一ID及猫咪目录的读改写覆盖。猫咪ID保留原来的清洗/36字符规则，人物ID按完整值比较，不截断为猫咪ID。

验证返回valid、id、revision、服装与素材数量；首个失败检查通过MCP的isError=true返回JSON文本 `{code,message}`，当前不收集全部错误。常见code：INVALID_ARGUMENT、UNSUPPORTED_SCHEMA、INVALID_MANIFEST、UNSAFE_PATH、ASSET_MISSING、INVALID_PNG、LIMIT_EXCEEDED、ID_CONFLICT、INVALID_REGISTRY、INVALID_CAT_CATALOG、IMPORT_BUSY、RECOVERY_REQUIRED、ACTIVATION_UNAVAILABLE、IO_ERROR。

HTTP的新增角色工具只接受没有Origin头的原生客户端，Host须精确为localhost或127.0.0.1加实际监听端口。批量请求中含不合规角色调用时整批403，避免部分执行。stdio不受HTTP头限制。旧猫咪工具和原有HTTP CORS行为保持；这不是对旧端点的整体安全审计。本服务仍是无身份认证的本机接口，不能区分同用户下的其他本地进程。

## 存储、刷新与恢复

采用应用数据根目录下的characters.json和characters/<id>/<revision>/。revision是规范化manifest及引用PNG的SHA-256；源目录移动不影响已安装资源。导入只写经过校验的内存字节，不在复制期间重新读取来源。已存在修订必须逐文件与本次字节一致才复用。

流程：内存校验→获取OS文件锁→重新加载注册表/检查重名→核对未登记revision中已有字节并补齐缺失资源→所有文件sync完成→写characters.next.json并sync→rename原子替换注册表。读取接口只服务注册表当前修订，未提交的目录不构成可读取的已安装包；不再移动整个资源目录。文件锁随进程退出释放；锁文件长期保留，不用删除锁文件来解锁。完整写入和注册表替换用于避免普通写入失败暴露半个包，不承诺断电下跨目录事务的持久化。

耗时解码在锁外完成；校验后的磁盘写入在发布锁内串行执行，因此第二个导入或猫咪upsert/delete可能因锁忙失败，客户端可稍后重试。默认导入不改变选择；activate=true在发布后另写character-selection.json。HTTP成功后通知刷新；桌面400ms轮询检查characters.json及选择，刷新时发kuro-characters。前端/独立菜单已消费事件，托盘打开时刷新人物服装列表。

发布前失败不会替换旧注册表。历史暂存目录及未被注册表引用的revision保留，不自动删除。未登记的中断revision可在相同完整包再次导入时补齐缺失文件，前提是所有已存在的引用文件逐字节匹配；不覆盖已有文件。已登记的缺失/损坏修订和不匹配的未登记内容均拒绝写入，保留现场，须重新准备不同内容修订或人工核验后按授权处理。characters.next.json存在时，在写入新revision前返回RECOVERY_REQUIRED：保留现场，先核对现有注册表、候选generation和对应revision完整性，再决定发布或清理；不要盲目覆盖。旧版本保留以便后续回退，不实现垃圾回收或自动回滚。

## 验证与边界

[当前验证状态](character-system-status.md)分别列出Rust、Node、浏览器、真实MCP和桌面传输的结果，不能用静态或模拟检查替代其他范围。测试通过通用声明及已有大肥鱼PNG物化临时源目录，不依赖已删除人物资源。

最低Rust版本以Cargo.toml为准，png/sha2直接依赖及其锁文件随源码提交。复现命令、前置条件和本地报告位置见[通用验证说明](character-fixture-validation.md)。正式运行时不读取测试声明或tmp目录。

第一版仍不支持ZIP、远程地址或帧/图集播放。失败现场和旧修订保留，不自动删除或回滚；需要清理时先核对实际数据和授权。
