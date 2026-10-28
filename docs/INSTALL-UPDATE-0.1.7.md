# 拾签 / Pickmark 0.1.7：安装与保留数据更新

这是桌面 Chrome 的手动安装体验版，尚未上架 Chrome Web Store。普通使用者无需安装 Node.js、Python 或运行命令。

## 下载

- [Pickmark-0.1.7.zip](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/Pickmark-0.1.7.zip)：可解压加载的插件安装包。
- [Pickmark-0.1.7.sha256](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/Pickmark-0.1.7.sha256)：安装包校验文件。
- [0.1.6 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.6)：原安装包、校验文件和说明继续保留。

GitHub 自动提供的 **Source code (zip / tar.gz)** 是项目源码。普通安装请选择 **Pickmark-0.1.7.zip**；如果下载源码，则需要加载其中的 `extension` 子文件夹。

## 首次安装

1. 下载 ZIP，解压到一个准备长期保留的固定文件夹。
2. 在 Chrome 地址栏输入 `chrome://extensions`，打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹；该文件夹内应直接有 `manifest.json`，版本为 **0.1.7**。
4. 在工具栏的扩展菜单中固定「拾签」，点击图标打开完整面板；已打开时会切回现有面板标签页。侧边栏仍可从 Chrome 的侧边栏入口打开。
5. 语言和外观可在设置中切换；新手引导可跳过，也能从「关于与帮助」重新查看。

安装完成后保留该文件夹的位置和内容。此 ZIP 需要先解压，再通过「加载已解压的扩展程序」安装。

## 从 0.1.6 更新：覆盖原目录

**不要卸载原插件，也不要另加载第二份。继续使用原 Chrome 配置、原加载目录和原插件 ID。**

1. 等待当前保存完成，关闭拾签页面和侧边栏。
2. 在 `chrome://extensions` 找到原来的拾签，记下插件 ID 和原加载目录，保留原程序文件副本或下载 0.1.6 回退包。
3. 将 0.1.7 ZIP 解压到临时目录，再把包内文件和子文件夹覆盖到**原加载目录**。保持原目录路径不变，`manifest.json` 仍须直接位于该目录内，不能多套一层文件夹。
4. 在扩展管理页点击**原插件**的「重新加载」，确认版本为 **0.1.7**，插件 ID 与更新前相同，再重新打开拾签。
5. 核对人工分类、分类规则、书签智能分类和保留范围内的历史记录；「继续浏览」中的历史补分类入口继续可用。

本次更新没有新增升级专用的数据迁移、清空、重置逻辑或权限。人工分类、书签分类元数据、历史与规则、供应商 Key、语言偏好、预览开关和现有截图缓存沿用原存储。原有保留期限、容量维护及排除网站设置继续生效，更新不会恢复已清理或已过期的历史。书签智能分类独立保存，不移动浏览器原始书签目录。

这是手动加载的版本，后续仍需下载新包并覆盖原目录。程序文件副本或 ZIP 是安装文件备份，不包含浏览器内的完整个人数据；不要把它当作数据备份。

## 0.1.7 的变化

- 「关于与帮助」的开源入口打开 [Pickmark 仓库首页](https://github.com/abelguan02/Pickmark)，反馈入口打开 [Issues](https://github.com/abelguan02/Pickmark/issues)。赞赏二维码继续留待配置。
- 预览显示「待浏览」「正在生成」「已保存」；无法生成时说明授权、暂停、排除、空间不足、截图失败或超时等原因。更新截图失败时保留旧图，清理缓存后不会继续标为已保存。
- 自动截图仅针对已授权、记录开启、加载完成且位于前台的普通网页。切到网页并短暂停留即可，不必读完或滚到底；不会为了生成预览自动打开后台标签、历史页面或书签。截图处理超过 15 秒未完成会提示超时。
- 保留分组叠放、重叠反差、条纹动效及中英文、深浅色、窄屏适配。

AI 需要自己的供应商 Key，连接测试和 AI 整理可能产生供应商费用；书签 AI 需另行确认处理范围。自动预览仍需主动开启并授权，截图仅存本机，不发送给 AI。详见[隐私说明](https://github.com/abelguan02/Pickmark/blob/v0.1.7/PRIVACY.md)。

## 校验和回退

将 ZIP 与 SHA256 文件放在同一目录，macOS 可在该目录运行以下可选完整性检查：

```sh
shasum -a 256 -c Pickmark-0.1.7.sha256
```

需要回退时，关闭拾签，将保留的完整 0.1.6 程序文件覆盖回同一加载目录，再重新加载原插件；不要卸载。0.1.6 已公开的安装包和校验值不会被本次发布覆盖。旧版本对较新数据的兼容性、Chrome 对回退的支持仍以实际情况为准，不承诺任意版本间回退。

## English: install and preserve data when updating

Download **Pickmark-0.1.7.zip**, extract it into a folder you will keep, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder directly containing `manifest.json`. No build tools are required. This is a manual-install preview release, not a Chrome Web Store installation.

**Existing users:** finish pending saves and close Pickmark. Keep the same Chrome profile, extension ID, and original installation path. Extract the new ZIP elsewhere, copy its contents over the original installation folder, then click **Reload** on the existing extension. Confirm version **0.1.7** and the unchanged ID. **Do not uninstall or load a second copy.**

Manual categories, bookmark category metadata, rules, retained history, provider keys, language preferences, the automatic-preview setting, and existing screenshot cache continue using the original storage. Normal retention, capacity cleanup, and website exclusions still apply. Historical classification remains available. The update adds no permissions or upgrade-specific data reset.

This release connects Source code and Feedback to the new Pickmark repository and Issues. Support QR remains unconfigured. Preview states show awaiting visit, generating, saved, or an actionable failure reason, while retaining existing images after a failed refresh. Automatic previews capture only eligible foreground pages you actually visit; AI is optional and may incur provider charges.

The unchanged **0.1.6** release remains available for rollback. Keep its program files if needed; an installation ZIP is not a full backup of browser data. Reuse the same installation directory and extension ID for a rollback, without uninstalling. Compatibility and Chrome's downgrade behavior still depend on the actual environment.
