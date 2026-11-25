# 大肥鱼完整 2D 行为与角色包对齐清单

核验日期：2026-11-24。源码基线20be633，版本5.0.1。本轮只读取现有实现并补充素材保存约定；没有运行程序、构建或生成新EXE。下文“已有”均指代码中的可达逻辑，不代表本轮实际操作验收。

用户范围：MCP人物应参照大肥鱼的素材、动画和互动保存；已明确选择先完整对齐2D，真正3D另阶段实现。人物原有性格差异要求保留，不能把所有人物变成同一个大肥鱼配色替换。

## 当前迁移状态

本清单记录20be633原实现的代码事实，以下表格中的专用入口属于迁移前基线。共享播放器阶段已将原程序绘制迁入proceduralCharacterRenderer.ts，dafeiyuRenderer.ts保留内置素材/外置JSON适配；抚摸及反应在characterInteraction.ts。人物激活与OBS资源已接入源码，验证和当前限制见 [播放器说明](character-player-2d.md)。未做真实视觉对齐和原生运行验收，OBS连续抚摸/情绪同步现已接入源码及浏览器模拟传输验证，范围见character-sync-2d.md，原生服务未验收。

## 1. 真实组成和入口

大肥鱼没有通用character.json、动画文件或可导入的3D模型。它由以下部分共同实现：

| 文件 | 职责 |
| --- | --- |
| src/assets/dafeiyu/notail_{idle,blink,shy,happy2}.png | 四张静态身体/表情，均224×278、8位RGBA；无完整手臂、鲸尾 |
| src/assets/dafeiyu/*.webp | 同名替代素材，当前DaFeiYuRenderer实际import的是PNG，不是WebP动画 |
| src/dafeiyuRenderer.ts | 专用Canvas2D渲染器：左右手、袖口、鲸尾、表情、眼球、动作物理、粒子、防窥 |
| src/catEngine.ts | 输入分发、尾巴选键、抚摸识别、键鼠绘制、按键气泡、布局和渲染节流 |
| src/main.ts、src-tauri/src/lib.rs | 原生全局输入、角色区域命中、鼠标穿透/Alt、拖动、右键菜单 |
| src/obsMain.ts、src-tauri/src/obs.rs | 独立OBS引擎、输入SSE和快照；并非直接捕获桌面的渲染状态 |
| src/catSkins.ts、src-tauri/src/cats.rs | 内置id=dafeiyu与名称、色彩元数据；这些字段没有描述完整人物或动作 |

main.ts的wants3DNow与obsMain.ts的syncObs3D都显式排除dafeiyu。Three.js引擎是程序化猫咪，并不是大肥鱼的3D版本。所谓Live2D-style是Canvas局部绘制，没有导入Cubism模型。

## 2. 素材与分层的真实约定

四张图必须在同一224×278画布中对齐头发、脸、身体和服装，透明边缘一致。编号happy2是当前文件名，运行时表情键为happy。不能把四张当作四帧连续动画；它们由状态条件选择。

实际绘制顺序：尾根/尾部后段→身体PNG→动态眼球和头发遮挡补绘→腮红→主引擎鼠标/键盘→水纹→拍键时的鲸尾前段→袖口/左右手→爱心/水滴→非隐私状态下的按键气泡/鼠标徽标。

身体会被键盘后缘裁剪。鲸尾分前后两次绘制以保持根部在身体后、拍键末端在键盘前；不能用一个固定“前景尾巴PNG”替代。renderForeground会绘制手部目标和粒子，renderBody负责表情与眼球。

## 3. 动画、键盘和鼠标：逐项追踪

| 行为 | 触发/保持/退出 | 实现与保存时需要表达的内容 |
| --- | --- | --- |
| 待机呼吸 | 每帧computeGeom | sin(now×0.0034)×2.2的上下呼吸，加bodyBob和bodyDiveY；身体枢轴、宽高比和裁剪 |
| 自然眨眼 | 首次3.6–6.2秒；之后4.5–7.2秒，闭眼135ms | blink PNG，表情优先级；不是固定每帧切换 |
| 左右手打字 | onKeyDown，按键在键盘左/右侧分手；heldVks保持，onKeyUp释放 | 键帽坐标→舒适伸手范围→手臂插值、拍下压缩；最近380ms或持续按住维持动作 |
| 按住与系统重复 | 主引擎repeat提前返回，首次按下才进入专用击打 | 连续长按保持，不因repeat反复生成手势、手速计数或拍击 |
| 打字身体摇摆 | 按键相对键盘中心的位置 | 倾斜normX×0.095、左右移动、bodyBob及回弹；不是整张图来回平移即可 |
| 手速表情升级 | 最近2.8秒首次按键计数 | typingCPS/热度平滑，idle→shy→happy及滞回；不把每次typing直接映射happy |
| 腮红 | 热度、moodTier、抚摸、隐私共同影响 | 独立覆盖层；两颊渐变和高热度短线，不依赖换一张脸红图 |
| 鼠标移动 | 主引擎全屏归一化坐标；过滤微抖 | 鼠标模型偏移，大肥鱼身体向左/前倾，左手跟鼠标；最近900ms或左右键按住维持鼠标态 |
| 左/右键 | 鼠标左右键独立down/up | 主引擎按键高亮、LMB/RMB徽标，左手目标根据实际按钮投影；按住时手部下压2.5 |
| 中键/滚轮 | onMouseDown(middle)、onMouseWheel | 主引擎中键状态/徽标、滚轮闪烁；专用渲染器只显式接收左右按住标记，滚轮/中键通过活动时间进入鼠标反馈，不存在独立“滚轮手动画文件” |
| 键鼠同时 | 鼠标忙且有键盘输入 | 左手保留在鼠标，右手打字；双手忙时尾巴可接第三个键，三者可以并行 |
| 目光追踪 | 活跃鼠标点击、最近按键/尾拍；二者都活跃时比较时间，鼠标态也提供目标 | 局部眼睑轮廓裁剪、虹膜/瞳孔移动、刘海遮挡重绘；happy/隐私时不追踪，只有idle图片上叠绘动态眼球 |
| 尾巴待机 | computeGeom/update持续运行 | 以腰部锚点做摆动，热度/打字/开心改变摆速；不是固定循环PNG |
| 尾巴拍键 | 主引擎选中尾键，或previewTailTap | 路径曲线、目标键、65ms伸出、至少260ms保持、释放后220ms回收；heldVks及releaseAt保持真实状态 |
| 尾拍水花 | 尾键按下或预览 | 双水纹、3滴水、身体弹动；water ripple随时间扩散消失 |
| 键帽与气泡 | 主引擎先高亮按键，再分发人物动作 | 键帽凹陷/弹跳、键名气泡、鼠标徽标；showKeyBubbles控制气泡，隐私时不绘制气泡 |

手速滞回精确基线：heatTarget=clamp((CPS−2.4)/5.4,0,1)，升温速率2.2、降温0.65。tier0在热度≥0.40且停留≥1400ms升tier1；tier1在≥0.78且≥1800ms升tier2，或<0.22且≥2200ms回tier0；tier2在<0.55且≥2200ms回tier1。腮红再以速率3.2平滑。复制静态“打字开心图”不等于保留此行为。

## 4. 抚摸和其他交互

| 交互 | 实际识别 | 反馈/边界 |
| --- | --- | --- |
| 悬停 | Rust区域命中→kuro-cursor→onWindowCursor | 只进入可互动区域和手形指针，不直接给petEnergy |
| 来回抚摸/画圈 | overCat=true，且没有按住左右鼠标键；单步距离1.5–80逻辑像素；每段至少14像素；方向反转或转弯累计两次 | 此后按移动距离×0.015积累petEnergy，上限1。单次直线经过、静止悬停、按住拖动不能当成已完成抚摸 |
| 开心回应 | 非隐私且petEnergy>0.25 | happy表情、双手在肩边交替上下摆5像素、身体/尾巴更活跃、爱心粒子；不是只换PNG |
| 抚摸结束 | 停止反复抚摸后能量持续衰减；按键本身未立即清零能量 | 光标在角色区每秒衰减0.22，离开为1.15；降到阈值后退出开心，不靠永久状态开关 |
| 头部/身体命中 | is_over_interactive_silhouette | 通用椭圆：(65%中心0.48/0.49、半径0.25/0.27；108中心0.51/0.49、半径0.21/0.27)。不是人物PNG的像素级头部命中，也不是单独五官热区 |
| 拖动 | 桌面canvas左键→start_pet_drag/原生拖动 | 移动窗口；穿透锁定时需Alt解除。没有额外“被拎起”“抓头发”“点击某身体部位”的人物动画 |
| 右键 | canvas contextmenu | 打开独立菜单，不是人物表情动作 |
| 尾键录制/预览 | 键盘点击选中→previewTailTap→triggerTailPreview | 预览拍击并显示水花；smart/custom/edge/off四模式与预设沿用主引擎 |

尾键smart判断：鼠标+右手忙、双手各有按键、或合计占用至少两个键时可用尾巴；一串打字后Enter/小键盘Enter也可作为收尾动作。edge避开WASD等保护键，65%与108采用不同边缘阈值。custom按保存的逻辑键ID，off停止分配新尾键。鼠标忙的900ms窗口与手部忙的135ms窗口均参与判断。

## 5. 隐私与优先级

进入隐私时主引擎清理heldKeys、按键按下状态、气泡和主引擎尾状态；专用渲染器清理左右手/尾巴heldVks及水纹。表情强制blink，双手覆盖眼睛并轻微错相上下摆，身体保持羞涩摇摆与腮红。键盘防窥遮罩来自主引擎，非人物PNG；键名气泡不绘制。privacyTyping只提供匿名打字反馈，增加小幅bodyBob和短时摇摆，不应保存真实键值到人物包。

表情顺序：隐私blink > 抚摸开心或tier2 happy > tier1 shy > 自然blink > idle。手势顺序：隐私捂眼 > 抚摸开心举手 > 鼠标/各手打字 > 肩边待机。鼠标+键盘+尾巴是并行部件状态，不能压成互斥的六状态机；隐私必须同时抢占各部件。

需区分现状与以后安全契约：当前专用onPrivacyModeChanged只在进入时清heldVks/水纹，未重置所有lastAt、keyTimes或粒子；退隐私后部分短时视觉状态可能尚在。新通用状态机仍按已评审的“退出隐私清旧输入、不补播敏感动作”实现，不照抄这些残留状态。

## 6. 几何、服装、颜色与表现形式

65%画布420×440、108画布540×456；专用身体中心x分别192/268，基准y364/366，绘制宽262/268，高度保持278/224，枢轴偏移48。肩部是sprite归一化坐标(0.39,0.653)/(0.61,0.653)，腰尾根(0.56,0.785)，防窥双眼目标约(0.390,0.476)/(0.598,0.476)。键盘、鼠标位置和猫/观众双朝向由主引擎投影计算；不能把贴图像素坐标直接当窗口坐标。

动态眼睛还包含固定的像素轮廓、瞳孔中心、渐变和刘海提取色阈值。袖口有深色渐变、白色花边和金点，手为无拇指圆手，拍下有压缩；鲸尾包含粗细渐变、曲线控制点及前后层。手、袖口、眼睛、腮红、尾巴等颜色大多直接写在专用TS中，并非cats.json就能完整改色。因此新人物必须把锚点、遮罩、部件外观和性格参数外置，不能仅换四张PNG或复制猫咪色彩字段。普通人形角色没有鲸尾时须明确关闭该部件，不能强加鲸尾。

当前大肥鱼只有一套内置服装，没有通用服装包。新包每套服装独立保存四张对齐图片及自己的动作引用；包根的角色身份保持一个。多服装的身体/肩眼位置改变时需对应自己的rig数据，不能沿用上一套衣服的固定像素。

## 7. 它没有的能力与OBS差异

- 没有真正3D、GLB/GLTF模型或骨骼动画；没有Cubism模型。当前PNG也不是动画PNG。
- 没有启用普通猫咪的28秒打瞌睡、Zzz、激光点好奇、生气拍桌/飞机耳和闲置小动作；catEngine用isCatMode排除了大肥鱼，pokeAnnoy/recordPointerSpeed也提前返回。旧通用包的rest字段不是“大肥鱼已有睡觉动画”的证据。
- 大肥鱼的呼噜强度被明确设为0；游戏自动戴电竞耳机也被排除。没有大肥鱼专属语音、台词文件或点击叫声。
- OBS复用同一2D渲染器并接收键鼠、隐私、设置快照/SSE，但鼠标位置被传给onWindowCursor时overCat=false；没有petEnergy/抚摸状态同步，不能声称桌面摸头与OBS开心反馈已一致。两边的随机眨眼、粒子与时间线也不保证逐帧同步。官网试玩则用舞台内矩形头部区域（x=0.30–0.72、y=0.14–0.52）传入overHead，和桌面通用椭圆不同，相关入口见website/src/main.ts。
- 主引擎在3秒无活动后转定时低频绘制；这属于节流，不是角色睡着。粒子产生概率和部分位移目前按帧计算，表现会随帧率变化，不能宣称是现成的时间无关动作数据。拖动、穿透、多显示器、缩放20%–150%、暂停监听/隐藏和OBS仅显示属于应用能力，不应伪装为人物动画文件。

## 8. MCP保存约定与仍缺的完整动作协议

第一阶段源码已补充每套outfit可选的bodySprites/profile=dafeiyu-body-v1：

```text
character.json
assets/<outfit-id>/notail_idle.png
assets/<outfit-id>/notail_blink.png
assets/<outfit-id>/notail_shy.png
assets/<outfit-id>/notail_happy2.png
```

get_character_schema默认example采用此约定；genericExample保留原分层/图集示例以兼容已有v1包。校验要求四个路径与所属服装对应、图片224×278/8位RGBA，并实际被动画引用，导入时保留目录和文件名。结构、尺寸、格式可由代码核验；透明边缘、人物外观和四图视觉对齐仍需视觉验收。

更新：bodySprites本身仍只解决素材识别与持久化；新增outfits[].motion2d已承载和校验第3–6节的通用动作/互动数据，可经MCP保存、导入和读取，详见character-motion-2d.md。未声明motion2d的旧包仍只有帧表和简要behavior。通用动作播放器尚未实现，不能宣称这些数据已经能在桌面播放。默认example中的帧映射只是格式样例，不是对表情优先级、手速滞回、捂眼和组合输入的替代实现；activate仍然不可用。

完整2D数据协议现已按下表实现字段和校验，播放器仍须按清单逐项接入：

| 保存对象 | 至少要覆盖的字段/规则 |
| --- | --- |
| 身体和表情 | 四图、源画布、枢轴、裁剪、表情优先级、眨眼/手速滞回；每套服装分别声明 |
| rig与部件 | 肩/眼/腰锚点、眼轮廓/遮挡、手臂长度、手/袖口外观、可选尾巴及分层；人体不强制鲸尾 |
| 连续动作 | 呼吸、摇摆、下潜、回弹、目光范围/插值、手部跟随、尾拍伸出/保持/释放 |
| 并行与触发 | 左/右手/鼠标/尾巴分状态；按下/释放/重复；smart/custom/edge/off；互动优先级与退出 |
| 互动性格 | 抚摸命中/笔划/阈值/衰减、开心举手、表情和粒子变体；人物的时序/姿态差异 |
| 隐私 | 闭眼、捂眼锚点、匿名反馈、清旧状态、不生成真实键值、禁止泄露的气泡/特效 |
| 展示与同步 | 65/108、双朝向、DPI/缩放、桌面与OBS动作快照/事件、服装切换与重连恢复 |

上表的数据已由motion2d承载，Schema及类型见character-motion-2d.md。动态消费、真实交互和同步仍待播放器实现/验收。包内不加载JS/HTML脚本；不会通过复制专用TS到外部目录执行来绕过通用契约。先用一个人物两套服装，把上述每一行逐项验收，再制作其余角色。

## 9. 代码证据入口与验证边界

专用渲染器的全部公开入口：constructor、onPrivacyModeChanged、onPrivacyTyping、resetLeftHandForMouse、onMouseAction、getHandBusyState、triggerTailPreview、onKeyDown、onKeyUp、update、renderBody、renderForeground。内部计算/绘制：spawnParticles、computeGeom、ensureHairBangsCanvas、traceClosedSpline、renderLiveEyes、drawWhaleTail、drawChubbyArm，均已阅读。

主引擎已追踪setPrivacyMode、setTailKeyConfig、previewTailTap、shouldUseTailForKey、syncLayoutPositions、setCatAppearance、buildDaFeiYuLayout、onKeyDown/Up、onGlobalMouseMove、鼠标各事件、onWindowCursor、update及render；桌面/OBS事件路由和Rust椭圆命中也已核对。

实际执行的验证仅为本地源代码阅读、PNG头尺寸/颜色格式检查与原图查看，以及保存格式改动的静态源码检查。没有启动桌宠、运行交互或做OBS实测；没有安装依赖、生成EXE或Git暂存/提交/推送。
