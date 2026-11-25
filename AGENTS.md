# KuroCat 开发约定

- 当前目标收敛（2026-11-25）：用户要求“不用接入人物，把链路打通就行”，并要求调整目标。当前以docs/character-system-goal.txt的通用2D角色包/MCP链路为准，只用现有样例或隔离夹具验证；不新增正式人物、不配置当前客户端、不把额外菜单优化作为链路前置条件。旧的14人物扩展与客户端接入计划不再执行。

- 当前范围更新（2026-11-25）：用户明确要求“不要新建角色”。停止新增人物及其素材制作，继续通用系统与大肥鱼的开发和验证；归档其他人物不作为自动制作任务。用户随后明确删除源码目录中的02包及雷电待机草图，已执行；不恢复或重建人物素材。验证使用scripts/fixtures/dafeiyu-package.json与既有大肥鱼PNG，仅在临时目录物化测试夹具。此前扩展其他人物的计划由本次指令收缩。

- 修改角色包或 MCP 导入前，阅读 `design-archive/implementation-plan.md`；实际接口与阶段限制见 `docs/character-pack-v1.md`。
- 桌面 Rust 代码沿用 `src-tauri/src/`，包格式与导入逻辑独立于 `CatSkinConfig`。旧猫咪接口保持兼容。
- 动作数据协议与MCP存取见 `docs/character-motion-2d.md`；共享播放器、激活和当前验证边界见 `docs/character-player-2d.md`。未经用户解除限制，不安装依赖、不生成新 EXE、不运行 Cargo build/check/test 或 Tauri dev/build、不暂存、提交或推送。
- 临时验证产物放 `tmp/`；验证报告记录实际执行方式及未编译验证的边界。
- 修改动作协议时编辑 `src-tauri/protocol/motion-2d.schema.json`，用 `python scripts/generate-motion-types.py` 更新类型，并运行该脚本的 `--check` 及 `python scripts/check-motion-contract.py`；这些静态检查不能替代Rust编译和运行验收。
- 当前会话授权更新（2026-11-24）：用户明确回复“允许本地原生编译和测试”。可复用已有隔离工具链/缓存离线编译、测试、生成并运行本地调试EXE，核验真实MCP、系统输入、重启和OBS；测试数据/端口隔离，主产物固定在 `tmp/native-validation/`；stdio目录发布在工作区失败时，可使用系统临时目录内的独立测试夹具定位，必须记录实际路径并保留现场。仍不安装或下载依赖、不暂存/提交/推送；缓存缺项先报告，不自动补装。此授权仅适用于该本地原生验收范围。
- 前端依赖授权更新（2026-11-24）：用户明确回复“允许补齐本地前端依赖”。可按现有package-lock.json在 `tmp/native-validation/frontend-deps/` 本地安装前端依赖，优先旧npm缓存、缺项联网下载，用于全量前端与原生OBS静态资源验收；不全局安装、不修改正式锁文件、不暂存/提交/推送。Rust工具链与其他软件的安装/下载仍未授权。
- OBS验收授权更新（2026-11-24）：用户明确回复“允许便携版 OBS 验收”。可下载并运行官方OBS Studio 33.0.3 Windows x64 ZIP（约225MB），校验官方SHA-256后解压到 `tmp/native-validation/obs-portable-33.0.3/`，用独立便携配置仅验证KuroCat本地浏览器源；不安装到系统、不登录账户、不录制或推流、不暂存/提交/推送。其他软件/工具链安装仍未授权。

- 上游整合授权更新（2026-11-24）：用户选择“整合 v5.1.0 并保留人物扩展（建议）”。以固定上游41f3de0bc7fc3eecfd6e289988d45e81c33849a3源码整合，保留角色包/MCP/通用2D与并发兼容改动，接入上游菜单与穿透锁持久化并重做受影响回归。不提交、推送或丢弃已有工作。整合快照、基线与候选在tmp/upstream-v5.1.0；本地Git HEAD未因源码整合改变。
