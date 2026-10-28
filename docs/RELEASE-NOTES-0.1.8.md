# 拾签 / Pickmark 0.1.8

2026-10-27 · 体验版。本版精简预览 UI，尚未上架 Chrome Web Store。

## 变化

- 正常预览仅保留「待浏览」「正在生成」「已保存」，删除重复解释。
- 失败合并为一句具体原因，更新失败继续保留已有截图。
- 授权提示按需显示，使用方法和缓存说明集中在设置详情；必要的权限、隐私、费用及删除提示保留在对应位置。
- 保留分组预览、重叠反差、条纹动效、关于页入口和原有分类功能。

本版不新增权限，也没有升级专用的数据迁移、重置或清空。人工分类、书签分类与规则、历史补分类、设置和预览缓存沿用原存储；原有保留期限、容量维护与排除网站规则继续生效。

## 下载与更新

- [Pickmark-0.1.8.zip 安装包](https://github.com/abelguan02/Pickmark/releases/download/v0.1.8/Pickmark-0.1.8.zip)
- [安装与保留数据的更新说明（中英文）](https://github.com/abelguan02/Pickmark/releases/download/v0.1.8/INSTALL-UPDATE-0.1.8.md)
- [SHA256 校验文件](https://github.com/abelguan02/Pickmark/releases/download/v0.1.8/Pickmark-0.1.8.sha256)
- [保留的 0.1.7 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.7)

首次安装：解压 ZIP，在 `chrome://extensions` 开启开发者模式，加载直接包含 `manifest.json` 的文件夹。

已有安装：保持原 Chrome 配置、原目录及原插件 ID，将新版文件覆盖到原加载目录，再点击原插件的「重新加载」，确认版本 **0.1.8**。**不要卸载或加载第二份。**

## English

This manual-install preview release simplifies preview UI while keeping its three states, failure reasons, saved screenshots, grouped positioning, contrast, and stripe effects. Required permission, privacy, and fee notices remain in the relevant settings or confirmations.

Download **Pickmark-0.1.8.zip**. To preserve data, overwrite the **original installation directory**, keep the same Chrome profile and extension ID, then click **Reload** on the existing extension. **Do not uninstall or load a second copy.** Existing data and settings continue using the same storage; normal retention and cleanup policies still apply. The unchanged **0.1.7** release remains available for rollback.
