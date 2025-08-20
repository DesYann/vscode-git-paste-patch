# Git Paste Patch

Paste a `diff --git` in a side view and apply it directly to your workspace files.

## Highlights

- ✅ Handles **multi-file** patches
- 🆕 **Creates missing files and folders** before applying
- 🔧 Uses a **pure TypeScript** patcher (no Git commands required)
- 🖼️ VS Code-themed UI with Codicons
- 🖥️ Works offline, no network calls

## How to use

1. Open the **Git Paste Patch** view from the Activity Bar (left).
2. Paste a unified diff (`diff --git ...`) into the textarea.
3. Click **Apply**.  
   A result panel shows which files were created/updated or failed.

Notes:

- Patches with `a/` and `b/` prefixes are supported.
- Line endings are normalized to avoid CRLF/LF mismatches.
- In multi-root workspaces, the first folder is used as the root.

## Supported patch format

- Unified diff (e.g., `git diff`, `git format-patch`, `git show` outputs)
- Entries like `--- a/path` / `+++ b/path`, `@@` hunks, etc.

## Commands

- **Git Paste Patch: Open view** — `gitPastePatch.openView`
- **Git Paste Patch: Apply patch** — `gitPastePatch.apply` (applies patch from clipboard)

## Troubleshooting

- **Nothing happens** → Open a folder in VS Code; the extension targets the first workspace folder.

> ⚠️ **Warning**  
> Applying patches overwrites files in your workspace. Review the diff and make sure you trust the source before proceeding.

## Support

If this extension saves you time:

[![Rate on VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-Rate%20%E2%AD%90-5c2d91)](https://marketplace.visualstudio.com/items?itemName=DesYann.vscode-git-paste-patch&ssr=false#review-details)
[![GitHub Stars](https://img.shields.io/github/stars/DesYann/vscode-git-paste-patch?style=social)](https://github.com/DesYann/vscode-git-paste-patch)

> _Made by a French developer (with a touch of AI), for developers. Minimalism, efficiency, and practicality above all 🚀_ > _Fait par un développeur français (avec un brin d’IA), pour les développeurs. Minimalisme, efficacité et praticité avant tout 🚀_
