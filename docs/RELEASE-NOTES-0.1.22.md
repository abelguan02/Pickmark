# 拾签 / Pickmark 0.1.22

## 自上一公开版 0.1.9 以来

- 标签页和书签支持按网站或主题整理，分别记住视图选择。书签保留 Chrome 原文件夹。
- 「补全预览」按当前列表筛选范围处理缺图网页，书签限当前分页。0.1.22 使用一个静音的后台标签页，支持查看进度、取消和保留已完成的图片。Chrome 会显示调试提示条。
- 预览图片保存在本机独立缓存，最多 500 张、50 MB，保留 7 天。已有预览、常见邮箱和排除网站会跳过。批量访问沿用 Chrome 的登录状态，可能出现在浏览器自身的历史记录中。
- 保留每日页面清单、「继续浏览」和分类。**升级后会清理旧版的停留时长、切换轨迹及视频计时数据，回退程序无法恢复这些统计。**
- 更新时请覆盖原加载目录并重新加载同一个插件。如 Chrome 提示新增的必需调试权限，请查看并确认。完整步骤和校验方式见 Release 附件 `INSTALL-UPDATE-0.1.22.md`。

## Changes since 0.1.9

- Group tabs or bookmarks by website or topic. Each remembers its own view, and original bookmark folders remain available.
- **Fill previews** opens a muted background tab for missing screenshots in the filtered list or current bookmark page. You can follow progress or cancel and keep completed captures. Chrome displays a debugging banner while the temporary tab is attached.
- The local preview cache holds up to 500 images or 50 MB for up to seven days. Captured pages, known webmail sites, and excluded domains are skipped on subsequent batches. Background visits use the current Chrome profile and may appear in its history.
- Daily page lists and **Continue browsing** are retained. Upgrading removes legacy duration, switching-path, and video timing data permanently.
- Update in place and reload the existing extension. Review Chrome’s prompt for the new required debugging permission if shown. The attached `INSTALL-UPDATE-0.1.22.md` includes installation and checksum instructions.
