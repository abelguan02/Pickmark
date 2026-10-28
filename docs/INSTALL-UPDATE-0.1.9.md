# 拾签 / Pickmark 0.1.9：安装与保留数据更新

桌面 Chrome 手动安装体验版，尚未上架 Chrome Web Store，无需安装开发工具。

## 下载

- [Pickmark-0.1.9.zip](https://github.com/abelguan02/Pickmark/releases/download/v0.1.9/Pickmark-0.1.9.zip)：解压后可加载的安装包。
- [Pickmark-0.1.9.sha256](https://github.com/abelguan02/Pickmark/releases/download/v0.1.9/Pickmark-0.1.9.sha256)：完整性校验文件。
- [0.1.8 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.8)与 [0.1.7 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.7)：原安装包、校验文件和说明完整保留。

GitHub 自动生成的 **Source code (zip / tar.gz)** 包含整个项目。普通安装请选择 **Pickmark-0.1.9.zip**；下载源码时，应加载其中的 `extension` 子文件夹。

## 首次安装

1. 将安装包解压到准备长期保留的固定文件夹。
2. 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的目录，确认版本为 **0.1.9**。
4. 在工具栏固定「拾签」，点击图标打开面板。已打开时会切回原面板，侧边栏入口仍保留。

## 从 0.1.8 或 0.1.7 更新

**继续使用原 Chrome 配置、原加载目录和原插件 ID。不要卸载，也不要另加载第二份。**

1. 等待当前保存完成，关闭拾签页面和侧边栏。
2. 在 `chrome://extensions` 记下原插件的 ID 和加载目录，保留旧程序文件或对应的 0.1.8 / 0.1.7 安装包。
3. 将 0.1.9 解压到临时目录，把包内文件和子文件夹覆盖到**原加载目录**。不要移动或重命名原目录；`manifest.json` 仍应直接位于原目录内，不能多套一层文件夹。
4. 在扩展管理页点击**原插件**的「重新加载」，确认版本为 **0.1.9**、ID 未变，再打开拾签。
5. 核对人工分类、书签分类与规则、保留范围内的历史记录及补分类入口；原有预览开关和截图缓存继续可用。

本版不新增升级专用的数据迁移、清空、重置或权限。原有存储继续使用，供应商 Key、语言偏好等设置沿用；原保留期限、容量维护和排除网站设置继续生效。更新不会恢复已删除或已过期的历史，也不会移动浏览器原始书签目录。程序 ZIP 和规则导出不是完整个人数据备份。

这是手动加载的扩展，后续更新仍需覆盖原目录并重新加载。

## 本版变化与必要提示

修复记录暂停或仅具备手动截图权限时，手动预览的进度与真实失败原因被自动预览条件遮住的问题。自动截图仍遵守开启、授权和记录状态等限制。预览保留「待浏览」「正在生成」「已保存」和一句失败原因；更新失败继续保留旧图。分组叠放、反差、条纹动效及中英文、深浅色、窄屏支持保留。

自动预览需主动开启并授权，仅采集符合条件的当前可见网页，截图保存在本机。AI 为可选功能，需自己的 Key，连接测试和整理可能产生供应商费用；书签 AI 仍需确认处理范围。详见[隐私说明](https://github.com/abelguan02/Pickmark/blob/v0.1.9/PRIVACY.md)。

## 校验与回退

将 ZIP 与 SHA256 文件放在同一目录，macOS 可运行以下可选检查：

```sh
shasum -a 256 -c Pickmark-0.1.9.sha256
```

需要回退时，关闭拾签，将保留的完整 0.1.8 或 0.1.7 程序文件覆盖回同一加载目录，再重新加载原插件，不要卸载。0.1.8 和 0.1.7 安装包及校验值不被本次发布覆盖；Chrome 的回退行为及旧版本对较新数据的兼容性仍以实际环境为准，不承诺任意版本间回退。

## English

Download **Pickmark-0.1.9.zip**, extract it into a permanent folder, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the directory directly containing `manifest.json`. No build tools are required. This is a manual-install preview release, not a Chrome Web Store installation.

**To update from 0.1.8 or 0.1.7:** finish pending saves and close Pickmark. Keep the same Chrome profile, original installation path, and extension ID. Extract the new ZIP elsewhere, copy its contents over the original directory, then click **Reload** on the existing extension. Confirm version **0.1.9** and the unchanged ID. **Do not uninstall or load a second copy.**

Manual categories, bookmark metadata and rules, retained history and historical classification, keys, preferences, the preview setting, and cached images continue using the same storage. Normal retention, capacity cleanup, and exclusions still apply. This version adds no permissions or upgrade-specific data reset.

Manual preview progress and actual failure reasons remain visible when recording is paused or only a manual screenshot grant is available. Automatic capture still requires opt-in, authorization, and active recording. The three preview states, concise failure reasons, and retained old images are unchanged. Permission notices appear when needed; privacy and fee information remain in their relevant settings or confirmations. Automatic previews require opt-in and permission; AI remains optional and provider fees may apply. Bookmark AI still requires scope confirmation.

The unchanged **0.1.8** and **0.1.7** releases remain available for rollback. If needed, overwrite the same installation directory with its program files and reload the existing extension without uninstalling. An installation ZIP is not a full backup of browser data; downgrade compatibility depends on the actual environment.
