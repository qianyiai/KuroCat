# 通用角色包链路验证

2026-11-25。仅复用内置大肥鱼素材及通用测试数据，不创建正式角色或新美术。

## 测试数据

`scripts/fixtures/dafeiyu-package.json` 是测试声明，标识为 `motion-fixture`，包含 `primary` / `alternate` 两种动作配置。两者复用 `src/assets/dafeiyu/notail_*.png` 四张原图及其原始 MIT 声明，使用基准/沉静性格和不同袖口设置验证数据差异，不声称是两套新服装或新人物。

`scripts/character-test-fixture.mjs` 提供只读声明及临时物化助手。只有显式运行 `node scripts/prepare-character-fixture.mjs` 才在 `tmp/character-fixture/` 写入导入测试目录；不写入正式角色目录或用户 AppData，不自动导入/激活。原生测试各自使用独立数据目录。

## 静态与单元检查

在项目根目录、已有兼容 Node/Python/Rust 环境中执行；不自动安装依赖。

```text
python scripts/generate-motion-types.py --check
python scripts/check-motion-contract.py
python scripts/check-character-fixture.py
python scripts/check-settings-writers.py
node --test scripts/test-character-player.mjs scripts/test-character-sync.mjs scripts/test-engine-integration.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib --offline --locked
npm run build
```

固定的隔离工具链环境和 Windows target 参数按实际环境设置，不要求修改系统 PATH。库测试包含真实四图的临时导入、双配置选择及保存、旧猫咪兼容、并发发布和损坏恢复。Node包含852组配列/朝向按键映射。

## 浏览器验证

```text
node scripts/preview-character-2d.mjs <已有node_modules绝对路径>
node scripts/test-character-menu.cjs <已有Playwright所在node_modules> <已有TypeScript所在node_modules>
node scripts/test-character-fixture-preview.cjs <已有Playwright所在node_modules>
node scripts/test-visual-preview.cjs <已有Playwright所在node_modules>
node scripts/test-visual-sync.cjs <已有Playwright所在node_modules>
```

预览为本机 `http://127.0.0.1:1422/visual-character-pack.html`。正式CharacterLoader加载测试声明，图片直接读取已有大肥鱼目录。测试配置切换、四图解码/眨眼、预览按钮驱动的打字/抚摸、隐私抢占及恢复、布局和显式重试；旧人物美术的轮廓相似度要求不适用于此夹具。普通输入/抚摸的直接事件和绘制覆盖由Node及基准/同步浏览器用例承担，不将夹具预览检查描述为全量物理输入验收。

## 真实MCP与桌面

```text
node scripts/test-native-character-mcp.mjs <隔离调试EXE路径> tmp/native-validation --source-edit
node scripts/run-native-character.mjs
node scripts/test-native-character-desktop.cjs <已有Playwright所在node_modules>
node scripts/test-native-character-update.cjs <已有Playwright所在node_modules>
node scripts/test-native-character-recovery.cjs <已有Playwright所在node_modules>
```

先编译嵌入生产前端的调试EXE。stdio脚本将测试声明和已有四图复制到自己的临时目录（8条分配置引用），测试11项导入/选择/完整更新/并发/源独立性/错误/重启恢复。桌面启动器拒绝已有记录进程仍存活时重复启动；新会话使用stdio报告中的独立AppData，已有会话恢复须显式 `--resume`。

原生后续脚本仅操作该独立会话中的测试夹具，先核对路径归属；更新及损坏测试恢复原资源，不修改源码图像。报告和截图在 `tmp/native-validation/`；浏览器夹具报告在 `tmp/motion-fixture/`。当前客户端连接、物理系统输入及真实OBS应用视觉另行验收，不能用HTTP/浏览器替代。

## 当前范围

已删除人物的制作、专用资源导出及原目录不再作为运行或测试前置条件。既有验收长记录保留当时角色和版本的历史事实，不作为当前复现命令。最新实际结果以character-system-status.md为准。
