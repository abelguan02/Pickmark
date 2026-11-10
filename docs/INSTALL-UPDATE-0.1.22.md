# 拾签 0.1.22 安装与更新 / Installation and updates

## 新安装

1. 从 [v0.1.22 Release](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.22) 下载 `Pickmark-0.1.22.zip`，解压到准备长期保留的文件夹。
2. 在桌面 Chrome 打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的文件夹。若下载的是整个源码归档，选择其中的 `extension/`。
3. 固定拾签并点击工具栏图标打开工作区。扩展管理页应显示版本 **0.1.22**。

## 更新已有安装

1. 如有补全预览任务，先取消，再关闭旧面板。将新 ZIP 的内容覆盖到原加载目录，保留原目录路径。
2. 在 `chrome://extensions` 对原扩展点击「重新加载」。如 Chrome 提示新增调试权限，请查看并确认，再打开拾签。卸载会删除该扩展的本地数据。
3. 0.1.22 使用 Chrome 的 `debugger` 权限在临时后台标签页截图。运行时会出现调试提示条。书签读取和网站截图访问仍单独授权。
4. **从 0.1.9 等带时长统计的版本升级会清理旧时长和轨迹，回退程序也无法恢复这部分数据。** 每日页面清单、分类、规则、书签和设置可在原安装中继续使用。

可将 ZIP 和同一 Release 的 `Pickmark-0.1.22.sha256` 放在同一目录，在 macOS 终端执行 `shasum -a 256 -c Pickmark-0.1.22.sha256` 核对下载。

## English

Download and extract `Pickmark-0.1.22.zip` from the release. Open `chrome://extensions` in desktop Chrome, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. For a source archive, select the `extension/` subfolder.

To update, cancel any preview batch, close the old dashboard, and replace the files in the original installation folder. Click **Reload** on the same extension, review any new permission prompt, and reopen Pickmark. Confirm version **0.1.22**. Uninstalling deletes local extension data.

The required `debugger` permission captures previews in the temporary background tab created for the batch. Chrome displays a debugging banner during capture. Bookmark access and screenshot access to websites require separate authorization. Upgrading from 0.1.9 removes legacy duration and activity-path data permanently. Daily page lists, categories, rules, bookmarks, and settings are retained.

To verify the download on macOS, keep the ZIP and checksum together and run `shasum -a 256 -c Pickmark-0.1.22.sha256`.
