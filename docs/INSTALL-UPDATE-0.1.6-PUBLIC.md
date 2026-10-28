# 拾签 / Pickmark 0.1.6：下载、安装与更新

这是可手动安装的体验版，尚未上架 Chrome Web Store。使用近期版本的桌面 Chrome；普通使用者无需安装 Node.js、Python 或运行命令。

## 下载哪个文件

- [Pickmark-0.1.6.zip](https://github.com/abelguan02/Pickmark/releases/download/v0.1.6/Pickmark-0.1.6.zip)：可直接解压加载的插件安装包。
- [Pickmark-0.1.6.sha256](https://github.com/abelguan02/Pickmark/releases/download/v0.1.6/Pickmark-0.1.6.sha256)：安装包完整性校验文件。
- 本说明可在 Release 的附件中单独下载。完整版本说明见[版本记录](https://github.com/abelguan02/Pickmark/blob/v0.1.6/docs/RELEASE-NOTES-0.1.6.md)。

GitHub 自动提供的 **Source code (zip / tar.gz)** 是项目源码。普通安装请选择上面的 **Pickmark-0.1.6.zip**；如果下载源码，需要加载其中的 `extension` 子文件夹。

## 首次安装

1. 下载 `Pickmark-0.1.6.zip`，解压到一个准备长期保留的固定文件夹。
2. 在 Chrome 地址栏输入 `chrome://extensions`，打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹；该文件夹内应直接包含 `manifest.json`。
4. 在 Chrome 工具栏的扩展菜单中固定「拾签」。点击图标打开完整面板；面板已打开时会切回现有标签页。侧边栏仍可从 Chrome 的侧边栏入口打开。
5. 可在设置中切换中英文和浅色、深色、跟随系统；新手引导可以跳过，也能从「关于与帮助」重新查看。

安装完成后保留该文件夹的位置和内容。ZIP 不是 Chrome 商店安装文件，不需要把 ZIP 拖到浏览器安装。

## 已安装用户：保留数据更新

**不要卸载原插件，也不要另加载一份新版。继续使用原 Chrome 配置、原加载目录和原插件 ID。**

1. 等待当前保存完成，关闭拾签页面和侧边栏。
2. 在 `chrome://extensions` 找到原来的拾签，记下插件 ID 和原加载目录；保留原程序文件副本，便于必要时回退。
3. 将新版 ZIP 解压到临时文件夹，再把包内文件和子文件夹覆盖到**原加载目录**。保持原目录路径不变，`manifest.json` 仍须直接位于该目录内，不能多套一层文件夹。
4. 在扩展管理页点击**原插件**的「重新加载」，确认版本为 **0.1.6**，插件 ID 与更新前相同，再重新打开面板。
5. 核对原有人工分类、分类规则、书签智能分类和保留范围内的历史记录；「继续浏览」中的历史补分类功能继续可用。

本版没有新增升级专用的数据迁移、清空、重置逻辑或权限。原有保留期限、容量维护和排除网站设置继续生效；更新不会恢复已清理或已过期的历史。书签智能分类独立保存，不移动浏览器原始书签目录。

这是手动加载的版本，后续更新需要下载新包并覆盖原目录。本地规则和人工分类不需要 AI Key；AI 功能需要自己的供应商 Key，连接测试和 AI 整理可能产生供应商费用。书签 AI 整理需要另行确认处理范围，自动网页预览需主动开启并授权。数据和权限说明见[隐私文档](https://github.com/abelguan02/Pickmark/blob/v0.1.6/PRIVACY.md)。

## 校验与回退

将 ZIP 与 SHA256 文件放在同一目录，macOS 可在该目录运行：

```sh
shasum -a 256 -c Pickmark-0.1.6.sha256
```

这仅是可选的完整性检查，不是安装步骤。

需要回退时，关闭拾签，将此前保留的完整旧版程序文件覆盖回同一加载目录，再重新加载原插件。不要通过卸载重装来回退；Chrome 对版本回退的支持及旧版对新版数据的兼容性仍以实际情况为准。

## 本版变化与验证

- 标签页和书签可在「分类与规则」内直接切换，分类与规则各自独立。
- 支持中英文、三种外观模式和窄屏布局；保留液态图标、分组预览、重叠反差和条纹动效。
- 保留人工分类、历史补分类和可重新查看的新手引导，精简重复说明。
- 153 项单元测试及语法、引用检查通过；已使用真实旧版安装包和模拟数据验证 0.1.2、0.1.5 覆盖更新到 0.1.6，以及安装包解压后的界面流程。

开发验证未访问真实书签、邮箱或个人 Chrome 配置。该说明不代表所有用户环境已实机验收；问题可通过[仓库 Issues](https://github.com/abelguan02/Pickmark/issues)反馈，提交前请去除私人内容和凭据。

## English: install and update

This is a manual-install preview release for desktop Chrome, not a Chrome Web Store installation. Download **Pickmark-0.1.6.zip** from this release rather than GitHub's automatic source archives. No Node.js, Python, or build step is required.

**First install:** extract the ZIP into a folder you will keep, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder directly containing `manifest.json`. Pin Pickmark and click its toolbar icon to open the dashboard. Language and theme controls are in Settings.

**Update:** finish pending saves and close Pickmark. Keep the same Chrome profile, extension ID, and original installation path. Extract the new ZIP elsewhere, copy its contents over the original installation directory, then click **Reload** on the existing extension. Confirm version **0.1.6** and the unchanged ID. **Do not uninstall or load a second copy.** Manual categories, bookmark category metadata, rules, and retained history continue using the existing storage; normal retention and capacity cleanup still apply. Historical classification remains available.

Updates to this unpacked version are manual. AI requires your own provider key and may incur provider charges; bookmark AI requires scope confirmation. Automatic page previews require opt-in and permission. See the linked privacy document for details. Keep your previous program files for possible rollback; compatibility with arbitrary older versions is not guaranteed.
