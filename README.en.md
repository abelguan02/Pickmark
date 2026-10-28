# Pickmark · 拾签

[简体中文](README.md) | **English**

**Organize scattered tabs into topic workspaces, retrace your browsing, and pick up where you left off.**

Pickmark (formerly Tabtrail) is a desktop Chrome extension. It organizes tabs and bookmarks into categories, with local keyword rules, manual adjustments, and optional AI classification. It also keeps daily page lists and estimated browsing time on your device, helping you find your way back to earlier pages.

Current version: **0.1.7 · Preview release**. It is not yet available in the Chrome Web Store. Download the [0.1.7 installation ZIP](https://github.com/abelguan02/Pickmark/releases/download/v0.1.7/Pickmark-0.1.7.zip) and follow the [installation and in-place update guide (Chinese / English)](docs/INSTALL-UPDATE-0.1.7.md). AI features require your own provider API key. Local rules, manual classification, daily review, and resume browsing work without AI.

![Workspaces demo: open tabs organized into topic cards](docs/dashboard-preview-en.png)

Browse your open pages by topic and click a page to return to its tab.

*Screenshots and the web demo use familiar websites and independently written fictional titles. They do not use personal browsing history or represent those websites’ current pages. Classifications, browsing paths, and durations are sample data, not evidence of real AI classification quality. The English screenshots use translated sample titles and workspace names; switching the extension language does not translate your own page titles or workspace names.*

## Why Pickmark exists

Pickmark began with a familiar problem for its developer: opening many tabs throughout the day, starting with one question, then being drawn toward something else. By evening, the browser still held plenty of pages, but it was hard to remember where that day’s attention had gone or how one topic had led to another.

The original idea was called **Attention Atlas**: leaving a few traces that help you look back at the different things that caught your attention. The question was not only how to tidy up tabs, but also what you explored, where your thinking went, and which page you wanted to return to next.

**Pickmark is the extension’s current name; Attention Atlas remains its inspiration and vision.** The current version supports your own reflection through topic workspaces, estimated browsing time, and page-switching paths. These records do not directly measure attention or automatically judge focus, distraction, or task completion. The vision is not a claim that these capabilities already exist.

## What you can do

| Feature | How it works |
| --- | --- |
| Workspaces | View web pages currently open in regular browser windows by topic and return to their tabs; entries with the same full URL are combined into one page record |
| Automatic organization | While the workspace is visible and recording is enabled, apply local rules first, then use configured AI for pages that need classification |
| Daily review | Explore time distribution by website or workspace, inspect switching paths by hour or 15-minute interval, and open pages from the details view |
| Resume browsing | Start with yesterday’s page list or select another date; reopen listed pages that are no longer open |
| Bookmark categories | Read bookmarks after permission is granted; save categories independently without moving original folders; confirm the scope before using bookmark AI |
| Categories and rules | Switch between tabs and bookmarks to manage their categories and rules independently; back up rules and set AI preferences |
| Interface and controls | Chinese / English; compact list / comfortable list / preview gallery; light / dark / system theme; About & help and a replayable introduction |

Organization happens inside the extension panel. Existing browser tab order and tab groups stay as they are. Pickmark does not automatically close tabs or replace your new-tab page.

A daily list means “pages that were open when collected,” **not pages you necessarily read**. Time estimates and switching paths help you review your browsing; they do not judge your focus or productivity. There are currently no AI daily summaries, notes, task statuses, cloud sync, or user accounts.

## Daily review: retrace your browsing

View time distribution by website or workspace for a selected date. Use the timeline to explore page switches and recorded visits. Durations are estimates to help you recall your browsing, not measures of concentration.

![Daily review demo: time distribution and browsing paths](docs/review-preview-en.png)

## Resume browsing: return to earlier pages

The view starts with yesterday’s pages, and you can choose another date. Browse that day’s list by topic, open an individual page, or reopen listed pages that are not currently open.

![Resume browsing demo: a dated page list organized by topic](docs/resume-preview-en.png)

All screenshots use fictional demo data. Resume browsing restores retained page URLs, not scroll positions, forms, or window layouts.

## Install: no coding required

Use a recent desktop version of Chrome. You do not need Node.js, Python, or terminal commands to use the extension.

1. On this repository’s page, select **Code → Download ZIP**. Extract it to a folder you plan to keep.
2. Open `chrome://extensions` in Chrome and enable **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the project’s **`extension` folder**. This folder should directly contain `manifest.json`.
4. Pin Pickmark from Chrome’s Extensions menu, then click its icon to open the full dashboard. If it is already open, the existing dashboard tab is brought forward.
5. To use the side panel, select Pickmark from Chrome’s side panel selector.
6. Select **English** in Settings if needed. The extension supports both Chinese and English.

If this repository’s Releases page offers `Pickmark-VERSION.zip`, you can download and extract that package, then load its extracted folder directly. This differs from GitHub’s automatically generated **Source code (zip)**, which contains the entire project and requires you to select its `extension` subfolder.

**Updating an existing installation:** replace the extension files in the original installation folder, click **Reload** on Chrome’s extensions page, and reopen the panel. When video-detection scripts change, refresh any open pages you are testing. Do not uninstall and reinstall to update: uninstalling deletes the extension’s local data.

## First steps

Open a few regular web pages, then open the extension’s workspace. Without configured rules or AI, pages generally appear in **Unsorted**.

- **Start with local rules:** open **Categories & rules**, choose tabs or bookmarks, add keywords, and select a category. Keywords match page titles and domains, with no AI charges.
- **Enable AI classification:** choose a provider and enter your API key and model in Settings. You can test the connection before saving. The test itself may incur a small charge. Bookmark AI requires a separate scope confirmation.
- **Adjust a result:** manually change a page’s category, or create, rename, and delete categories in **Categories & rules**. Deleting a category does not close tabs or delete original bookmarks; the confirmation explains how page assignments are handled.
- **Classify historical pages:** select a date in **Resume**, click **Classify unsorted**, and confirm the scope. Local rules run first; optionally use AI for the remaining pages. Existing categories and manual assignments are preserved without reopening tabs. Retry after a failure to process the remainder; search narrows the scope.
- **Reclassify pages:** choose **More → Regroup**, review the scope, and confirm. This can also change manual assignments. Use search to narrow the scope.

Available adapters include DeepSeek, OpenAI, Anthropic Claude, Google Gemini, Qwen (Bailian, Beijing), and Kimi (China). Model names are editable; successful requests depend on your account, the model, and your network. Additional provider notes are available in the [AI configuration guide (Chinese)](docs/AI-PROVIDERS.md).

## Does automatic organization use tokens?

Local keyword matching does not. Once you configure a key, pages that need AI classification are sent to your selected provider and billed according to that provider’s terms.

Previously classified, unchanged pages generally reuse their results. New pages or informative title changes may also trigger another check of pending Unsorted pages. Each batch handles up to 200 pages; larger sets are split into batches. **Opening one new tab does not necessarily send only that tab’s information**: the request may also include classification context.

Routine automatic organization preserves manual assignments. Closing a tab changes the page list but does not itself require cached classifications to be redone. Remaining candidates may still be processed after synchronization. Automatic retries are paused for five minutes after a failure; use **More → Sync tabs** to retry manually.

## Where is the data stored?

**Recording is enabled by default and uses the extension’s local storage in your current browser.** Closing the panel does not pause background local recording. Automatic AI classification requires the workspace to be open and visible. There is no developer-operated relay server or cross-device cloud sync.

| Data | Current handling |
| --- | --- |
| Page lists | Titles, full URLs, workspace assignments, and related fields; up to the most recent 30 local calendar days and 5,000 daily page records, with an additional storage budget of about 4 MB |
| Browsing visits | Estimated foreground page time and switching order; up to 30 days and 12,000 visits, with an additional estimated storage budget of about 4 MB |
| AI classification input | Titles, domains, random record IDs, workspace names and reference pages, confirmed rules, and applied preferences; no separate full-URL field, page body text, or browsing duration |
| API keys | Stored locally per provider and retained across restarts; excluded from rule backups and not protected by operating-system keychain encryption |

Count and size limits can remove records earlier; a complete 30-day history is not guaranteed. Titles, workspace names, rules, and preferences may themselves contain private information, even without a separate full-URL field.

Use **More → AI settings & privacy** to pause recording, exclude websites, remove keys, or clear browsing records and pause recording. AI requests already sent cannot be recalled. Further data-handling and permission details are in the [privacy policy (Chinese)](PRIVACY.md).

## Limitations and common questions

- **Why is time estimated?** On ordinary pages, recording pauses after five minutes without activity by default; you can choose 1, 5, 10, or 15 minutes. Foreground video playback can continue contributing time. Locking the screen or leaving Chrome pauses it. Quiet reading, autoplay, and unusual video players can affect accuracy.
- **Can it recover history from before installation?** No. It only records pages collected after installation while recording is enabled. It does not read Chrome’s full browsing history.
- **Does it restore an entire browsing session?** It restores retained page URLs and workspace assignments, not scroll positions, forms, login states, or window layouts.
- **Why do old classifications remain after I delete a rule?** Removing a rule does not undo existing assignments. Use **Regroup** if you want to classify those pages again.
- **Can I back up everything?** Import and export currently cover classification rules and optional saved AI preferences, not browsing history or all settings.
- **Why does the local web preview not show my tabs?** The web preview uses sample data only. Load the extension through Chrome’s extensions page to access real tabs.

Additional behavior details are in the [product guide (Chinese)](docs/PRODUCT.md).

## Development and feedback

The extension has no third-party npm dependencies at runtime. Development checks require Node.js 20+; local preview and packaging also require Python 3. Run these commands from the project root:

```sh
npm test
npm run check
```

To run the web preview (sample data only):

```sh
npm run preview
```

Open [the local preview](http://localhost:4173/dashboard.html). Stop the server with Ctrl+C when finished. To create an installable ZIP:

```sh
npm run package
```

The package is written to `dist/Pickmark-0.1.7.zip`, with a SHA256 checksum file. Neither previewing nor packaging publishes anything to GitHub.

For additional preview, browser-test, and packaging instructions, see the [contributing guide (Chinese)](CONTRIBUTING.md). Report ordinary issues and suggestions in this repository’s Issues section. Use fictional pages to reproduce problems, and do not upload API keys or private browsing records.

As of September 20, 2026, 68 Node tests, static checks, and three browser-based web regression suites passed. Some Chrome API and AI request boundaries are mocked. Real extension suspension and recovery, live provider calls, unusual video players, and storage pressure still need acceptance testing. See the [validation record (Chinese)](docs/CODE-AUDIT-20260920.md).

## Documentation and license

Both README versions cover installation, everyday use, costs, privacy essentials, and limitations. The supplementary guides linked below are currently in Chinese.

- [Privacy policy (Chinese)](PRIVACY.md) — data, permissions, and deletion controls
- [Changelog (Chinese)](CHANGELOG.md) — changes in the current version
- [Documentation index (Chinese)](docs/README.md) — product, development, and maintenance guides
- [Release guide (Chinese)](docs/RELEASE.md) — GitHub publishing steps for maintainers

The project uses the [MIT License](LICENSE) and retains its original attribution, Attention Atlas contributors. The [asset inventory (Chinese)](docs/ASSETS.md) records what is known about the provenance of brand graphics and demo assets.
