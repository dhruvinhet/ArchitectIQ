import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getNonce } from './utils/getNonce';
import { WorkspaceScanner } from './analyzer/WorkspaceScanner';
import { LanguageDetector } from './analyzer/LanguageDetector';
import { DependencyMapper } from './analyzer/DependencyMapper';
import { RIGPipeline } from './analyzer/RIGPipeline';
import { RIGViewer } from './analyzer/RIGViewer';
import { RIGData } from './analyzer/GraphStore';
import { PromptGenerator } from './engine/PromptGenerator';

export class ArchIQViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'archiq.mainView';

  private _view?: vscode.WebviewView;
  private _lastGeneratedPrompt = '';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    // CRITICAL: These options must be set BEFORE setting HTML content
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set the HTML content — this renders the UI
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.command) {
        case 'generate':
          await this._handleGenerate(message.text ?? '');
          break;
        case 'openGraph':
          await this._openGraphInBrowser();
          break;
        case 'copy':
          await this._copyToClipboard(message.text ?? '');
          break;
        case 'showError':
          vscode.window.showErrorMessage(message.text ?? 'Unknown error');
          break;
      }
    });
  }

  private async _handleGenerate(userInput: string): Promise<void> {
    if (!this._view) return;
    if (!userInput.trim()) {
      this._view.webview.postMessage({ command: 'error', text: 'Please enter a feature request first.' });
      return;
    }

    this._view.webview.postMessage({ command: 'loading', text: 'Scanning files...' });

    try {
      const workspaceRoot = this._getWorkspaceFolder();
      if (!workspaceRoot) {
        this._view.webview.postMessage({ command: 'error', text: 'No workspace folder open.' });
        return;
      }

      const rigJsonPath = path.join(workspaceRoot, '.architectiq', 'rig.json');
      const rigHtmlPath = path.join(workspaceRoot, '.architectiq', 'rig-view.html');

      const scanner = new WorkspaceScanner(workspaceRoot);
      const fileGraph = await scanner.scan();

      this._view.webview.postMessage({ command: 'loading', text: 'Building dependency graph...' });
      const pipeline = new RIGPipeline();
      const stack = LanguageDetector.detect(fileGraph);
      const rigData: RIGData = await pipeline.build(fileGraph, stack, workspaceRoot);

      // Always rewrite graph artifacts on generate so users can trust timestamps and freshness.
      this._view.webview.postMessage({ command: 'loading', text: 'Saving graph to .architectiq/...' });
      fs.mkdirSync(path.join(workspaceRoot, '.architectiq'), { recursive: true });
      fs.writeFileSync(rigJsonPath, JSON.stringify(rigData, null, 2), 'utf-8');

      const viewer = new RIGViewer();
      viewer.saveHtml(rigJsonPath, rigHtmlPath);

      this._view.webview.postMessage({ command: 'loading', text: 'Analyzing relationships...' });
      const depMap = DependencyMapper.build(fileGraph);
      const generator = new PromptGenerator(fileGraph, rigData, depMap);
      const prompt = generator.generate(userInput);
      const analysis = generator.generateAnalysis(userInput);

      this._lastGeneratedPrompt = prompt;
      this._view.webview.postMessage({ command: 'result', text: prompt, analysis });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._view.webview.postMessage({
        command: 'error',
        text: `Analysis failed: ${errorMessage}`,
      });
    }
  }

  private _getWorkspaceFolder(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    if (folders.length === 1) return folders[0].uri.fsPath;

    const extensionPath = this._getExtensionPath();

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const activeFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
      if (activeFolder) {
        const fp = activeFolder.uri.fsPath;
        if (!extensionPath || path.resolve(fp) !== path.resolve(extensionPath)) {
          return fp;
        }
      }
    }

    for (const folder of folders) {
      const fp = folder.uri.fsPath;
      if (extensionPath && path.resolve(fp) === path.resolve(extensionPath)) continue;
      return fp;
    }

    return folders[0].uri.fsPath;
  }

  private _getExtensionPath(): string {
    return (
      vscode.extensions.getExtension('RIGCopilotLabs.architectiq')?.extensionPath ||
      vscode.extensions.getExtension('architectiqdev.architectiq')?.extensionPath ||
      ''
    );
  }

  private async _copyToClipboard(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('Prompt copied to clipboard!');
  }

  private async _openGraphInBrowser(): Promise<void> {
    const workspaceRoot = this._getWorkspaceFolder();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('Open a workspace first, then generate the graph.');
      return;
    }

    const rigHtmlPath = path.join(workspaceRoot, '.architectiq', 'rig-view.html');
    if (!fs.existsSync(rigHtmlPath)) {
      vscode.window.showWarningMessage('Graph HTML not found yet. Generate once, then open it.');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(rigHtmlPath));
  }

  public focusInput(): void {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ command: 'focus' });
    }
  }

  public copyLastPrompt(): void {
    if (this._lastGeneratedPrompt) {
      vscode.env.clipboard.writeText(this._lastGeneratedPrompt);
      vscode.window.showInformationMessage('Last prompt copied to clipboard!');
    } else {
      vscode.window.showWarningMessage('No prompt generated yet. Use the ArchitectIQ panel first.');
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ArchitectIQ</title>
    <style nonce="${nonce}">
      :root {
        --bg: var(--vscode-sideBar-background, #1e1e2e);
        --panel: var(--vscode-editor-background, #181825);
        --border: var(--vscode-panel-border, #313244);
        --text: var(--vscode-foreground, #cdd6f4);
        --muted: var(--vscode-descriptionForeground, #6c7086);
        --accent: var(--vscode-button-background, #89b4fa);
        --accent-text: var(--vscode-button-foreground, #1e1e2e);
        --input-bg: var(--vscode-input-background, #313244);
        --input-border: var(--vscode-input-border, #45475a);
        --focus: var(--vscode-focusBorder, #89b4fa);
        --success: var(--vscode-terminal-ansiGreen, #a6e3a1);
        --error: var(--vscode-errorForeground, #f38ba8);
        --radius: 6px;
        --font: var(--vscode-font-family, system-ui, sans-serif);
        --mono: var(--vscode-editor-font-family, monospace);
        --size: var(--vscode-font-size, 13px);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: var(--font); font-size: var(--size); color: var(--text); background: transparent; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
      .header { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
      .header-title { font-weight: 700; font-size: 14px; letter-spacing: 0.05em; color: var(--accent); }
      .header-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--border); color: var(--muted); margin-left: auto; }
      label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); display: block; margin-bottom: 6px; }
      textarea { width: 100%; min-height: 80px; background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border); border-radius: var(--radius); padding: 8px 10px; font-family: var(--font); font-size: var(--size); resize: vertical; outline: none; line-height: 1.5; transition: border-color 0.15s; }
      textarea:focus { border-color: var(--focus); }
      textarea::placeholder { color: var(--muted); font-style: italic; }
      .btn { width: 100%; padding: 8px 16px; background: var(--accent); color: var(--accent-text); border: none; border-radius: var(--radius); font-family: var(--font); font-size: var(--size); font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
      .btn:hover { opacity: 0.9; }
      .btn:active { opacity: 0.8; }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
      .btn-secondary:hover { background: var(--border); opacity: 1; }
      .status { display: none; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); font-size: 12px; }
      .status.loading { display: flex; background: var(--panel); color: var(--muted); border: 1px solid var(--border); }
      .status.error { display: flex; background: rgba(243,139,168,0.1); color: var(--error); border: 1px solid rgba(243,139,168,0.3); }
      .spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .output-section { display: none; flex-direction: column; gap: 8px; }
      .output-section.visible { display: flex; }
      .output-header { display: flex; align-items: center; justify-content: space-between; }
      .output-stats { font-size: 11px; color: var(--success); }
      .output-box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; font-family: var(--mono); font-size: 12px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow-y: auto; user-select: text; }
      .output-box::-webkit-scrollbar { width: 4px; }
      .output-box::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      .analysis-box { max-height: 260px; margin-top: 8px; }
      .copy-row { display: flex; gap: 8px; }
      .tip { font-size: 11px; color: var(--muted); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; line-height: 1.5; }
      .tip strong { color: var(--accent); }
    </style>
</head>
<body>
    <div class="header">
      <span class="header-title">ArchitectIQ</span>
      <span class="header-badge">v1.0</span>
    </div>
    <div>
      <label for="request-input">What do you want to build?</label>
      <textarea id="request-input" placeholder="e.g. add user authentication with JWT"></textarea>
    </div>
    <button class="btn" id="generate-btn">Generate Architectural Prompt</button>
    <div class="status" id="status-bar">
      <div class="spinner"></div>
      <span id="status-text">Scanning workspace...</span>
    </div>
    <div class="output-section" id="output-section">
      <div class="output-header">
        <label style="margin:0">Agent Prompt</label>
        <span class="output-stats" id="output-stats">Ready</span>
      </div>
      <div class="output-box" id="output-box"></div>
      <div class="output-header" style="margin-top:8px;">
        <label style="margin:0">Analysis Panel</label>
      </div>
      <div class="output-box analysis-box" id="analysis-box"></div>
      <div class="copy-row">
        <button class="btn" id="copy-btn">Copy Prompt</button>
        <button class="btn btn-secondary" id="open-graph-btn">Open Graph in Browser</button>
        <button class="btn btn-secondary" id="reset-btn">Reset</button>
      </div>
    </div>
    <div class="tip"><strong>How to use:</strong> Type your request above, click Generate, copy the output, paste into GitHub Copilot Chat.</div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const generateBtn = document.getElementById('generate-btn');
      const copyBtn = document.getElementById('copy-btn');
      const openGraphBtn = document.getElementById('open-graph-btn');
      const resetBtn = document.getElementById('reset-btn');
      const requestInput = document.getElementById('request-input');
      const statusBar = document.getElementById('status-bar');
      const statusText = document.getElementById('status-text');
      const outputSection = document.getElementById('output-section');
      const outputBox = document.getElementById('output-box');
      const analysisBox = document.getElementById('analysis-box');
      const outputStats = document.getElementById('output-stats');

      function setLoading(msg) {
        generateBtn.disabled = true;
        statusBar.className = 'status loading';
        statusText.textContent = msg;
        outputSection.className = 'output-section';
      }
      function setError(msg) {
        generateBtn.disabled = false;
        statusBar.className = 'status error';
        statusText.textContent = msg;
        outputSection.className = 'output-section';
      }
      function setResult(text, analysis) {
        generateBtn.disabled = false;
        statusBar.className = 'status';
        outputBox.textContent = text;
        analysisBox.textContent = analysis || 'No analysis available.';
        var words = text.split(/\s+/).length;
        outputStats.textContent = words + ' words';
        outputSection.className = 'output-section visible';
        outputBox.scrollTop = 0;
        analysisBox.scrollTop = 0;
      }

      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg.command === 'loading') { setLoading(msg.text); }
        if (msg.command === 'result') { setResult(msg.text, msg.analysis); }
        if (msg.command === 'error') { setError(msg.text); }
        if (msg.command === 'focus') { requestInput.focus(); }
      });

      generateBtn.addEventListener('click', function() {
        var text = requestInput.value.trim();
        if (!text) { requestInput.focus(); return; }
        vscode.postMessage({ command: 'generate', text: text });
      });

      requestInput.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { generateBtn.click(); }
      });

      copyBtn.addEventListener('click', function() {
        vscode.postMessage({ command: 'copy', text: outputBox.textContent });
        copyBtn.textContent = 'Copied!';
        setTimeout(function() { copyBtn.textContent = 'Copy Prompt'; }, 2000);
      });

      openGraphBtn.addEventListener('click', function() {
        vscode.postMessage({ command: 'openGraph' });
      });

      resetBtn.addEventListener('click', function() {
        requestInput.value = '';
        outputSection.className = 'output-section';
        statusBar.className = 'status';
        generateBtn.disabled = false;
        requestInput.focus();
      });
    </script>
</body>
</html>`;
  }
}

// Internal types for message passing
interface WebviewMessage {
  command: 'generate' | 'copy' | 'openGraph' | 'showError';
  text?: string;
}
