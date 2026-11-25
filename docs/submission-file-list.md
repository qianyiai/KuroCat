# 最终最小提交候选清单

更新：2026-11-25。共34个文件：16个新增、18个已有文件修改。用户随后明确要求先提交本地，已在独立分支创建本地提交，未推送。原工作区保留。此清单替代此前77个文件的完整维护候选；原版审查快照保留在本地tmp/precommit-review/，不随最小清单提交。

## 基线与适用条件

以下34个改动已在固定上游v5.1.0（41f3de0bc7fc3eecfd6e289988d45e81c33849a3）基线上验证。临时验证源由HEAD跟踪文件及已核验上游快照重建，再仅覆盖这34个文件，未复制清单外的工作区源码、预览或文档。相对该基线，实际文件变化集合恰好为34个。

当前本地Git HEAD仍是20be633，未改写历史、切换分支或更新Git基线。不能将本报告解释为已验证只在旧HEAD上提交这34个文件仍然可构建；未来提交须先明确并处理上游基线，纯上游README/网站/版本及3D改动不混入本功能增量。

## 新增文件（16个）

前14个为运行所需源码/协议，最后2个为内嵌Rust测试依赖。

1. [src-tauri/src/character_import.rs](../src-tauri/src/character_import.rs)
2. [src-tauri/src/character_selection.rs](../src-tauri/src/character_selection.rs)
3. [src-tauri/src/character_sync.rs](../src-tauri/src/character_sync.rs)
4. [src-tauri/src/characters.rs](../src-tauri/src/characters.rs)
5. [src-tauri/src/motion2d.rs](../src-tauri/src/motion2d.rs)
6. [src-tauri/src/motion2d_types.rs](../src-tauri/src/motion2d_types.rs)
7. [src/characterInteraction.ts](../src/characterInteraction.ts)
8. [src/characterLoader.ts](../src/characterLoader.ts)
9. [src/characterMenu.ts](../src/characterMenu.ts)
10. [src/characterMotion2d.ts](../src/characterMotion2d.ts)
11. [src/characterSync.ts](../src/characterSync.ts)
12. [src/proceduralCharacterRenderer.ts](../src/proceduralCharacterRenderer.ts)
13. [src-tauri/protocol/motion-2d.schema.json](../src-tauri/protocol/motion-2d.schema.json)
14. [src-tauri/protocol/dafeiyu-motion-2d.json](../src-tauri/protocol/dafeiyu-motion-2d.json)
15. [src-tauri/protocol/calm-motion-2d.json](../src-tauri/protocol/calm-motion-2d.json) — 内嵌Rust测试数据
16. [scripts/fixtures/dafeiyu-package.json](../scripts/fixtures/dafeiyu-package.json) — 内嵌Rust测试数据

## 已有文件修改（18个）

1. [src-tauri/src/cats.rs](../src-tauri/src/cats.rs)
2. [src-tauri/src/config.rs](../src-tauri/src/config.rs)
3. [src-tauri/src/input_hook.rs](../src-tauri/src/input_hook.rs)
4. [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)
5. [src-tauri/src/macos_window.rs](../src-tauri/src/macos_window.rs)
6. [src-tauri/src/mcp.rs](../src-tauri/src/mcp.rs)
7. [src-tauri/src/obs.rs](../src-tauri/src/obs.rs)
8. [src-tauri/src/tray.rs](../src-tauri/src/tray.rs)
9. [src-tauri/src/windows_display.rs](../src-tauri/src/windows_display.rs)
10. [src-tauri/Cargo.toml](../src-tauri/Cargo.toml)
11. [src-tauri/Cargo.lock](../src-tauri/Cargo.lock)
12. [src/catEngine.ts](../src/catEngine.ts)
13. [src/dafeiyuRenderer.ts](../src/dafeiyuRenderer.ts)
14. [src/main.ts](../src/main.ts)
15. [src/menuMain.ts](../src/menuMain.ts)
16. [src/obsMain.ts](../src/obsMain.ts)
17. [src/style.css](../src/style.css)
18. [obs.html](../obs.html)

## 为什么保留两份测试数据

calm-motion-2d.json用于Rust类型/校验回归，scripts/fixtures/dafeiyu-package.json由Rust内嵌测试直接include_str。缺少任一文件会使对应测试编译失败。后者只描述复用既有大肥鱼PNG的两种动作/性格配置，不是新人物或新美术，也不会在程序正常启动时自动导入。

原仓库内的大肥鱼PNG、MIT声明、图标、构建入口及未改动辅助模块沿用基线，不计为新增或此增量提交文件。

## 本次实际验证

| 验证 | 结果 |
| --- | --- |
| 34文件集合及内容指纹 | 与固定基线相比恰好34个变化；验证期间源文件未变化 |
| 最小快照前端生产构建 | npm run build通过，含TypeScript及Vite |
| 最小快照Rust库测试 | 72通过、0失败、1既有联网检查跳过 |
| 最小快照原生调试构建 | Windows x64、离线锁定依赖、嵌入该快照生产前端，通过 |
| 真实stdio MCP | 9项通过：初始化/七工具、校验、导入激活、配置切换、完整读取/来源、完整更新、旧猫咪退出、配置记忆、新进程恢复 |

MCP检查仅用临时Python驱动，不导入清单外的仓库测试脚本或帮助模块。测试源和AppData在独立临时目录；既有大肥鱼PNG从基线复制，不新增正式人物。测试脚本本身不是待提交文件。

保留既有Three.js大分块提示及5项Rust未使用代码警告。没有运行被排除的Node/浏览器套件，也没有重新验收物理系统输入、真实OBS软件或其他平台硬件；上述结果不扩大到这些范围。

## 明确排除

- 剩余测试脚本、夹具物化助手、协议生成器、预览源码及HTML、维护文档：不在这34个文件中。本清单文档本身也是本地交付说明，不自动追加为第35个文件。
- 正式人物包、新美术、character-packs/及design-archive/、outputs/历史材料。
- tmp/中的源码快照、报告、日志、EXE、构建产物、依赖、测试AppData和备份；无自动清理。
- AGENTS.md本机会话记录、Git元数据和纯上游整合文件。

本次未安装或下载依赖，前端node_modules只映射现有本地依赖，Rust复用已有隔离工具链与缓存。未暂存、提交、推送或丢弃已有工作。

## 验证产物位置

临时快照和报告：tmp/native-validation/minimal-submission/。report.json保存基线、34个路径、SHA-256和验证范围；frontend-build.log、rust-tests.log、native-build.log、mcp-smoke-report.json保存实际证据。源码快照约11MB，另含可重建前端产物，未重复复制工具链/依赖；主Rust缓存及调试EXE仍在tmp/native-validation/target/。


## 提交前准备补充

已准备tmp/native-validation/minimal-submission/minimal-34.patch（16新增、18修改）、patch-stat.txt、SHA256SUMS.txt及commit-message.txt草稿。补丁按Git规范化LF生成，消除CRLF整行噪声；在独立临时源上git apply --check通过，实际应用后34个文件的Git规范化内容逐一与已验证源码一致。工作区原文件和Git索引未因补丁生成改变。

已通过GitHub连接只读核对最新main为5f9969f8355f9d81d2b6bd021f7266a57a217d67；相对41f3de0仅多2个README/官网提交，7个变化路径均不在34文件内。补丁所需的34个文件基线未变化，桌面构建输入仍相同；这不声称已经在最新Git工作分支重新执行测试。

当前仓库尚无41f3de0上游提交对象，HEAD和origin/main仍保留原位置。下一步提案：获取固定最新上游对象，创建独立工作分支codex/character-pack-2d及本地worktree，在其中应用此补丁；原工作区及全部未提交材料保留。此步骤会写Git对象、引用和worktree元数据，需要明确授权，未执行。即使获准，也不暂存、提交或推送功能改动。


## 已完成本地提交

提交：`333b605e4c0f298e19fb2591ff3b390519e1179c`。

标题：`feat: 打通 2D 角色包 MCP 链路并修复菜单勾选`。

分支：`codex/character-pack-2d`，父提交：`5f9969f8355f9d81d2b6bd021f7266a57a217d67`。只包含清单34个文件（16新增、18修改），提交内容逐一与已验证源码的Git规范化内容匹配。提交分支工作区干净；原main仍为20be633、原索引为空，原有未提交工作未丢弃。未推送。

实际提交分支前端生产构建通过、Rust72通过/1既有联网跳过。固定基线最小快照的原生构建及真实stdio9项证据继续保留原范围。上文“未暂存/未提交”的叙述仅描述此前准备阶段，由本节及用户最新授权更新。
