# 拾签 / Pickmark 0.1.9

2026-10-27 · 体验版。本版修复手动预览状态，尚未上架 Chrome Web Store。

## 变化

- 记录暂停或仅具备手动截图权限时，手动预览仍正确显示「正在生成」「已保存」及真实失败原因。
- 更新失败继续保留已有截图，修正问题后可重试；自动预览的开启、授权和记录限制保持不变。
- 保留精简的预览 UI、分组预览、重叠反差、条纹动效及原有分类功能。

本版不新增权限，也没有升级专用的数据迁移、重置或清空。人工分类、书签分类与规则、历史补分类、设置和预览缓存沿用原存储；原有保留期限、容量维护与排除网站规则继续生效。

## 下载与更新

- [Pickmark-0.1.9.zip 安装包](https://github.com/abelguan02/Pickmark/releases/download/v0.1.9/Pickmark-0.1.9.zip)
- [安装与保留数据的更新说明（中英文）](https://github.com/abelguan02/Pickmark/releases/download/v0.1.9/INSTALL-UPDATE-0.1.9.md)
- [SHA256 校验文件](https://github.com/abelguan02/Pickmark/releases/download/v0.1.9/Pickmark-0.1.9.sha256)
- [保留的 0.1.8 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.8)
- [保留的 0.1.7 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.7)

首次安装：解压 ZIP，在 `chrome://extensions` 开启开发者模式，加载直接包含 `manifest.json` 的文件夹。

已有安装：保持原 Chrome 配置、原目录及原插件 ID，将新版文件覆盖到原加载目录，再点击原插件的「重新加载」，确认版本 **0.1.9**。**不要卸载或加载第二份。**

## English

This manual-install preview release fixes manual preview progress and actual failure reporting when recording is paused or only a manual screenshot grant is available. Failed updates keep the previous image and can be retried. Automatic capture restrictions, concise preview UI, grouped positioning, contrast, and stripe effects remain unchanged.

Download **Pickmark-0.1.9.zip**. To preserve data when updating from **0.1.8 or 0.1.7**, overwrite the **original installation directory**, keep the same Chrome profile and extension ID, then click **Reload** on the existing extension. **Do not uninstall or load a second copy.** Existing data and settings continue using the same storage; normal retention and cleanup policies still apply. No permissions are added. The unchanged **0.1.8** and **0.1.7** releases remain available for rollback.
