# 贡献指南

欢迎反馈问题、改进文档和提交修复。当前是实验性 Chrome 扩展；请先阅读 [README](README.md)、[产品说明](docs/PRODUCT.md) 和 [隐私说明](PRIVACY.md)，了解已实现功能及数据边界。

## 反馈与提议

普通问题可在本仓库 Issues 中选择问题反馈或功能建议模板。说明 Chrome／系统／扩展版本、发生位置（侧边栏、完整面板或网页演示）、复现步骤和预期结果。截图、标题和网址请先去除私人信息；优先用虚构数据复现。

涉及新功能或明显改变产品行为时，先讨论使用场景和范围，再实现。不要把文档中的设想当作已同意的开发计划。

安全问题不要直接在公开 Issue 中提供可利用细节或凭据。如果仓库 Security 页面提供“Report a vulnerability”，使用该私密入口；否则先仅询问维护者可用的私密联系方式。本项目尚未公布独立安全邮箱，也不承诺固定响应时限。

## 开发环境

- Node.js 20+：运行基础测试和静态检查。
- Python 3：运行本机预览服务和生成扩展 ZIP。
- 桌面 Chrome：手动加载扩展；浏览器回归另需 Playwright。

扩展以原生 JavaScript、HTML 和 CSS 实现，无构建步骤或运行时 npm 依赖。`package.json` 中的 `private: true` 用于防止误发布到 npm，不影响 GitHub 仓库公开。

所有命令均在项目根目录执行。

```sh
npm test
npm run check
```

基础检查无需先执行 `npm install`。需要在真实扩展中查看修改时，在 `chrome://extensions` 加载 `extension/`；改动后重新加载扩展并重新打开面板，无需常驻网页脚本；补全预览使用按需主框架检查。

## 网页演示

```sh
npm run preview
```

保持终端运行，再打开 [本机预览](http://localhost:4173/dashboard.html)。这是带人工示例数据的普通网页，不调用 AI，也不能验证真实 Chrome 标签操作。

脚本调用的是 `python3`。如果系统只有 `python` 或 Windows 的 `py` 命令，可改用：

```sh
python -m http.server 4173 --directory extension
# Windows 也可使用：py -3 -m http.server 4173 --directory extension
```

清除预览站点的 localStorage 可恢复初始示例。`npm run preview` 使用 Python 默认监听方式；只允许本机访问时可显式运行 `python3 -m http.server 4173 --bind 127.0.0.1 --directory extension`。

## 浏览器回归

先安装可选工具，并在另一个终端保持预览服务运行：

```sh
npm install --no-save --package-lock=false playwright
```

macOS／Linux：

```sh
PREVIEW_URL=http://127.0.0.1:4173 node scripts/ui-check.mjs
PREVIEW_URL=http://127.0.0.1:4173 node scripts/history-check.mjs
PREVIEW_URL=http://127.0.0.1:4173 node scripts/design-check.mjs
PREVIEW_URL=http://127.0.0.1:4173 node scripts/language-check.mjs
```

Windows PowerShell：

```powershell
$env:PREVIEW_URL = 'http://127.0.0.1:4173'
node scripts/ui-check.mjs
node scripts/history-check.mjs
node scripts/design-check.mjs
node scripts/language-check.mjs
```

这些脚本使用本机安装的 Google Chrome，会覆盖 `docs/` 中部分截图。提交前核对截图是否符合本次改动。`PLAYWRIGHT_MODULE` 可指定 Playwright 模块路径，通常无需设置。

真实扩展冒烟脚本使用独立浏览器配置目录：

```sh
npx playwright install chromium
node scripts/extension-check.mjs
node scripts/event-storage-check.mjs
```

`event-storage-check.mjs` 使用独立无界面浏览器和虚构页面，验证标题事件合并、记录稳定性、键盘关闭重复标签、过期关闭请求和 AI 基准校验；不使用个人浏览器数据。

`node scripts/preview-batch-check.mjs` 使用独立无界面浏览器、本地合成页面和临时扩展副本，检查当前列表/书签分页范围、截图像素、画廊更新、窄屏、取消及临时页面隔离。仅在测试副本中预授予截图与书签权限，不覆盖 Chrome 授权弹窗。`preview-visible-check.mjs` 检查本机 Chrome 中正式扩展的后台截图、窗口和标签焦点事件、取消与调试断开；`preview-loading-check.mjs` 检查慢附属资源不会阻塞截图。当前后台截图原型的真实桌面验证使用 `node scripts/debugger-preview-probe.mjs --headed`，运行前须确认使用者当前空闲；无参数时无界面运行。旧 `background-preview-probe.mjs` 仅保留用于对照原可见窗口截图机制。

可通过 `CHROMIUM_EXECUTABLE` 指向支持命令行侧载的浏览器。该脚本检查真实扩展和标签 API，但 AI 网络仍被拦截为模拟响应；它也不验证真实账户的模型权限。项目截至 2026-09-20 尚未完成该侧载脚本的环境验收。

## 代码导览

| 路径 | 职责 |
| --- | --- |
| `extension/background.js` | 串行处理扩展操作、本地存储、页面恢复与跳转 |
| `extension/core.js` | 页面清单、规则、工作区与分类提交校验 |
| `extension/organize-workflow.js`、`ai.js`、`providers.js` | 规则优先流程、分批 AI 请求、供应商适配 |
| `extension/dashboard*`、`offset-ui.js` | 工作区、继续浏览和书签界面 |
| `extension/i18n.js`、`translations.js`、`_locales/` | 面板翻译与扩展元数据翻译 |
| `tests/` | Node 逻辑测试，包含模拟 Chrome／网络边界 |
| `scripts/` | 静态检查、浏览器回归、打包 |

## 提交 Pull Request

1. Fork 仓库，在自己的分支中完成改动。
2. 一次提交聚焦一个明确问题。涉及分类、存储、隐私或历史记录时补有意义的回归测试。
3. 运行 `npm test` 和 `npm run check`；界面改动运行相关浏览器回归。
4. 修改界面文案时同时检查中文／英文；布局需检查两套主题、深浅色和窄屏。
5. 同步修改受影响的产品和隐私文档。不要把模拟测试描述为真实供应商或休眠恢复已通过。
6. 通过 PR 模板说明问题、改动、验证和未覆盖场景。

不提交 Key、个人导出的数据、浏览器用户目录、`node_modules/` 或 `dist/`。扩展素材来源说明见 [素材清单](docs/ASSETS.md)。

## 打包

```sh
npm run package
```

输出 `dist/Pickmark-版本号.zip` 和 SHA-256 校验文件，包含程序、安装说明、隐私和许可文件。打包要求 `package.json` 与 manifest 版本一致；脚本不会自动运行测试。只有 `python` 或 `py` 时，使用 `python scripts/package.py` 或 `py -3 scripts/package.py`。

维护者发布流程见 [发布指南](docs/RELEASE.md)。
