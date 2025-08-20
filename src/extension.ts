import * as vscode from "vscode";
import * as Diff from "diff";

export function activate(context: vscode.ExtensionContext) {
  const provider = new PatchViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("gitPastePatchView", provider),
    vscode.commands.registerCommand("gitPastePatch.openView", () => {
      vscode.commands.executeCommand("workbench.view.extension.gitPastePatchContainer");
    }),
    vscode.commands.registerCommand("gitPastePatch.apply", async () => {
      const patch = await vscode.env.clipboard.readText();
      await provider.applyPatch(patch);
    })
  );
}

export function deactivate() {}

/** Webview messages */
type MessageKind = "paste" | "apply";
interface WebviewMessage {
  type: MessageKind;
  text?: string;
}

/** Result model */
export type ResultKind = "ok" | "new" | "fail";
export interface ResultEntry {
  kind: ResultKind;
  text: string;
}

class PatchViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Path to node_modules/@vscode/codicons/dist */
  private codiconsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
  }

  /** URI to codicon.css, translated for the webview */
  private codiconsCssUri(webview: vscode.Webview): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this.codiconsRoot(), "codicon.css"));
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, this.codiconsRoot()],
    };

    view.title = "Git Patch";
    view.description = "Paste a diff and apply it to files";
    view.webview.html = this.mainHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg?.type === "paste") {
        const text = await vscode.env.clipboard.readText();
        view.webview.postMessage({ type: "fill", text });
      }
      if (msg?.type === "apply" && typeof msg.text === "string") {
        await this.applyPatch(msg.text);
      }
    });
  }

  /** Main view html */
  private mainHtml(webview: vscode.Webview): string {
    const codiconsHref = this.codiconsCssUri(webview);

    // CSP: allow our inline styles & scripts, fonts, and images
    const csp = [`default-src 'none'`, `img-src ${webview.cspSource} data:`, `style-src ${webview.cspSource} 'unsafe-inline'`, `font-src ${webview.cspSource}`, `script-src ${webview.cspSource} 'unsafe-inline'`].join("; ");

    const style = `
      :root { color-scheme: light dark; }
      body {
        padding: 12px;
        font-family: var(--vscode-font-family, ui-sans-serif, system-ui);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
      }
      h2 { margin: 0 0 6px 0; }
      p  { margin: 6px 0; color: var(--vscode-descriptionForeground); }
      .bar { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
      button {
        padding: 6px 10px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--vscode-font-size);
      }
      .primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .primary:hover { background: var(--vscode-button-hoverBackground); }
      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
      textarea {
        width: 97%;
        height: 48vh;
        font-family: var(--vscode-editor-font-family, ui-monospace, Consolas, monospace);
        font-size: var(--vscode-editor-font-size, 12px);
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 6px;
        padding: 8px;
      }
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="${csp}">
          <meta name="color-scheme" content="light dark" />
          <link rel="stylesheet" href="${codiconsHref}">
          <style>${style}</style>
          <title>Git Patch</title>
        </head>
        <body>
          <h2>Git Patch</h2>
          <p>Paste a <code>diff --git</code> and apply it to the workspace files.</p>

          <textarea id="patchArea" placeholder="Example: diff --git a/... b/..."></textarea>

          <div class="bar">
            <!-- Inverted order + colors: Paste is primary (left), Apply is secondary (right) -->
            <button class="primary" id="pasteButton">
              <span class="codicon codicon-copy"></span> Paste
            </button>
            <button class="secondary" id="applyButton">
              <span class="codicon codicon-check"></span> Apply
            </button>
          </div>

          <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('pasteButton').addEventListener('click', () => {
              vscode.postMessage({ type: 'paste' });
            });
            document.getElementById('applyButton').addEventListener('click', () => {
              vscode.postMessage({ type: 'apply', text: document.getElementById('patchArea').value });
            });
            window.addEventListener('message', ev => {
              if (ev.data?.type === 'fill') document.getElementById('patchArea').value = ev.data.text || '';
              if (ev.data?.type === 'clear') document.getElementById('patchArea').value = '';
            });
          </script>
        </body>
      </html>
    `;
  }

  /** Apply patch + open custom results panel */
  public async applyPatch(patchContent: string): Promise<void> {
    if (!patchContent?.trim()) {
      vscode.window.showWarningMessage("No patch detected.");
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage("Open a workspace folder first.");
      return;
    }

    let files: Diff.ParsedDiff[];
    try {
      files = Diff.parsePatch(patchContent);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Cannot read patch: ${e.message}`);
      return;
    }

    if (!files.length) {
      vscode.window.showWarningMessage("No files found in the patch.");
      return;
    }

    let ok = 0;
    let ko = 0;
    const messages: ResultEntry[] = [];

    for (const filePatch of files) {
      let relPath = filePatch.newFileName || filePatch.oldFileName;
      if (!relPath || relPath === "/dev/null") continue;
      if (relPath.startsWith("a/")) relPath = relPath.substring(2);
      if (relPath.startsWith("b/")) relPath = relPath.substring(2);
      relPath = relPath.replace(/\\/g, "/");

      const targetUri = vscode.Uri.joinPath(folder.uri, relPath);

      try {
        let document: vscode.TextDocument | undefined;
        let originalText = "";
        let existed = true;

        try {
          document = await vscode.workspace.openTextDocument(targetUri);
          originalText = document.getText();
        } catch {
          document = undefined;
          originalText = "";
          existed = false;
        }

        const normalizedOriginal = originalText.replace(/\r\n/g, "\n");
        const patchedText = Diff.applyPatch(normalizedOriginal, filePatch);

        if (patchedText === false) {
          ko++;
          messages.push({ kind: "fail", text: `${relPath}: patch failed.` });
          continue;
        }

        const edit = new vscode.WorkspaceEdit();
        if (!document) {
          edit.createFile(targetUri, { ignoreIfExists: true });
          edit.insert(targetUri, new vscode.Position(0, 0), patchedText);
        } else {
          const wholeRange = new vscode.Range(document.positionAt(0), document.positionAt(originalText.length));
          edit.replace(document.uri, wholeRange, patchedText);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
          const docToSave = document ?? (await vscode.workspace.openTextDocument(targetUri));
          await docToSave.save();

          const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === docToSave.uri.toString());
          if (editor) {
            vscode.window.showTextDocument(docToSave, {
              viewColumn: editor.viewColumn,
              preserveFocus: true,
            });
          }

          ok++;
          messages.push({
            kind: existed ? "ok" : "new",
            text: existed ? `${relPath}: patched and saved.` : `${relPath}: created and patched.`,
          });
        } else {
          ko++;
          messages.push({ kind: "fail", text: `${relPath}: could not apply edits.` });
        }
      } catch (err: any) {
        ko++;
        messages.push({ kind: "fail", text: `${relPath}: ${String(err)}` });
      }
    }

    this.showResultPanel(ok, ko, messages);

    await vscode.env.clipboard.writeText("");
    this.view?.webview.postMessage({ type: "clear" });
  }

  /** Results panel (fake modal) */
  private showResultPanel(ok: number, ko: number, messages: ResultEntry[]) {
    const panel = vscode.window.createWebviewPanel("patchResults", "Patch Result", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [this.context.extensionUri, this.codiconsRoot()],
    });

    panel.webview.html = this.resultsHtml(panel.webview, ok, ko, messages);
    panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === "close") panel.dispose();
    });
  }

  private resultsHtml(webview: vscode.Webview, ok: number, ko: number, messages: ResultEntry[]): string {
    const codiconsHref = this.codiconsCssUri(webview);

    const csp = [`default-src 'none'`, `img-src ${webview.cspSource} data:`, `style-src ${webview.cspSource} 'unsafe-inline'`, `font-src ${webview.cspSource}`, `script-src ${webview.cspSource} 'unsafe-inline'`].join("; ");

    const style = `
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 24px;
      font-family: var(--vscode-font-family, ui-sans-serif, system-ui);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .container {
      max-width: 780px;
      /* ↓ Push a bit lower: min 24px, ~10% viewport height on normal screens, max 120px */
      margin: clamp(24px, 10vh, 120px) auto 24px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.2);
      overflow: hidden;
    }
    .header {
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--vscode-titleBar-activeBackground);
      color: var(--vscode-titleBar-activeForeground);
    }
    .header .counts {
      margin-left: auto;
      display: flex;
      gap: 12px;
      align-items: center;
      font-weight: 600;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--vscode-input-border);
    }
    .ok  { color: var(--vscode-testing-iconPassed, #4caf50); }
    .ko  { color: var(--vscode-testing-iconFailed, #f44336); }
    .new { color: var(--vscode-charts-blue, #2196f3); }

    .body { padding: 14px 18px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 8px 10px; border: 1px solid var(--vscode-input-border);
      border-radius: 8px; background: var(--vscode-editor-background);
    }
    .line-icon { margin-top: 2px; }
    .footer {
      display: flex; justify-content: flex-end;
      padding: 12px 18px; background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-input-border);
    }
    button {
      padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer;
      font-size: var(--vscode-font-size);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .muted { color: var(--vscode-descriptionForeground); }
    code { font-family: var(--vscode-editor-font-family, ui-monospace, Consolas, monospace); }
  `;

    const lines = messages
      .map(m => {
        const icon = m.kind === "ok" ? `<span class="codicon codicon-check ok"></span>` : m.kind === "new" ? `<span class="codicon codicon-new-file new"></span>` : `<span class="codicon codicon-error ko"></span>`;
        return `<li>
      <div class="line-icon">${icon}</div>
      <div class="line-text">${m.text}</div>
    </li>`;
      })
      .join("");

    return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <meta name="color-scheme" content="light dark" />
        <link rel="stylesheet" href="${codiconsHref}">
        <style>${style}</style>
        <title>Patch Result</title>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="codicon codicon-diff"></span>
            <strong>Patch Result</strong>
            <div class="counts">
              <span class="chip ok"><span class="codicon codicon-check"></span> ${ok} OK</span>
              <span class="chip ko"><span class="codicon codicon-error"></span> ${ko} KO</span>
            </div>
          </div>
          <div class="body">
            ${messages.length ? `<ul>${lines}</ul>` : `<p class="muted">No details available.</p>`}
          </div>
          <div class="footer">
            <button id="close"><span class="codicon codicon-check"></span> OK</button>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('close').addEventListener('click', () => {
            vscode.postMessage({ type: 'close' });
          });
        </script>
      </body>
    </html>
  `;
  }
}
