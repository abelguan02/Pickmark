# 拾签 / Pickmark 0.1.7

2026-10-27 · 体验版，包含关于页真实入口和预览状态更新。尚未上架 Chrome Web Store。

## 本版变化

- 开源入口连接到 `abelguan02/Pickmark` 首页，反馈入口连接到 Issues；均在独立标签页打开，保留键盘操作和当前关于页。赞赏二维码继续留待配置。
- 悬停预览、预览窗口和网格展示真实的「待浏览」「正在生成」「已保存」状态；无法生成时说明未授权、记录暂停、排除范围、截图失败、超时或空间不足等原因。
- 截图保存后实时刷新状态和图片；更新失败保留已有截图。截图处理超时后停止本次尝试，迟到的图片不写回缓存；清空缓存后取消已保存标记。
- 保留分组预览、重叠反差、条纹动效、Logo、液态图标和原有分类功能。

本版保持原存储键与权限，没有新增升级专用的数据迁移、重置或清理。保留人工分类、书签分类与规则、历史及补分类；原有保留期限、容量维护和排除网站设置继续生效。更新请覆盖原加载目录并重新加载原插件，不要卸载或加载第二份。

## 下载与安装

下载本 Release 附件中的 **Pickmark-0.1.7.zip**，先解压再加载；GitHub 的自动 Source code 压缩包包含整个项目。

- [直接下载安装包](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/Pickmark-0.1.7.zip)
- [安装与保留数据的更新说明（中英文）](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/INSTALL-UPDATE-0.1.7.md)
- [SHA256 校验文件](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/Pickmark-0.1.7.sha256)
- [保留的 0.1.6 回退版本](https://github.com/abelguan02/Pickmark/releases/tag/v0.1.6)

首次安装：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择直接包含 `manifest.json` 的目录。

已有安装：使用原 Chrome 配置和原插件 ID，将新版文件覆盖到原加载目录，再点击原插件的「重新加载」，确认版本 **0.1.7**。不要卸载原插件。规则导出或程序 ZIP 不能代替完整数据备份。

预览图片只保存在本机；AI 为可选功能，供应商可能收费，书签 AI 整理仍需确认处理范围。隐私说明和完整安装指南也包含在安装包中。

## English

Download **Pickmark-0.1.7.zip** for manual installation in desktop Chrome. This preview release adds working repository/Issues links and live preview states with actionable failures; the support QR remains unconfigured.

To preserve existing data, overwrite the **original installation directory**, keep the same Chrome profile and extension ID, and click **Reload** on the existing extension. **Do not uninstall or load a second copy.** Existing manual categories, bookmark metadata, retained history, rules, keys, preferences, and cached previews continue using the original storage. Normal retention and cleanup policies still apply. The unchanged **0.1.6** release remains available.
