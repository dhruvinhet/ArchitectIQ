import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ArchIQViewProvider } from './ArchIQViewProvider';
import { WorkspaceScanner } from './analyzer/WorkspaceScanner';
import { LanguageDetector } from './analyzer/LanguageDetector';
import { RIGPipeline } from './analyzer/RIGPipeline';
import { RIGViewer } from './analyzer/RIGViewer';

function debounce(fn: (...args: unknown[]) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: unknown[]) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function shouldIgnoreWatcherPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/.architectiq/') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/.git/')
  );
}

function getPreferredWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  if (folders.length === 1) return folders[0].uri.fsPath;

  const extensionPath = (
    vscode.extensions.getExtension('RIGCopilotLabs.architectiq')?.extensionPath ||
    vscode.extensions.getExtension('architectiqdev.architectiq')?.extensionPath ||
    ''
  );

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
    if (extensionPath && path.resolve(folder.uri.fsPath) === path.resolve(extensionPath)) continue;
    return folder.uri.fsPath;
  }

  return folders[0].uri.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ArchIQViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ArchIQViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('archiq.generatePrompt', () => {
      provider.focusInput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('archiq.copyLastPrompt', () => {
      provider.copyLastPrompt();
    })
  );

  let rebuildInProgress = false;
  let rebuildQueued = false;

  const rebuildGraph = debounce(async () => {
    if (rebuildInProgress) {
      rebuildQueued = true;
      return;
    }
    rebuildInProgress = true;

    const workspaceRoot = getPreferredWorkspaceRoot();
    if (!workspaceRoot) {
      rebuildInProgress = false;
      return;
    }

    try {
      const scanner = new WorkspaceScanner(workspaceRoot);
      const fileGraph = await scanner.scan();
      const stack = LanguageDetector.detect(fileGraph);
      const pipeline = new RIGPipeline();
      const rigData = await pipeline.build(fileGraph, stack, workspaceRoot);
      const rigJsonPath = path.join(workspaceRoot, '.architectiq', 'rig.json');
      const rigHtmlPath = path.join(workspaceRoot, '.architectiq', 'rig-view.html');
      fs.mkdirSync(path.join(workspaceRoot, '.architectiq'), { recursive: true });
      fs.writeFileSync(rigJsonPath, JSON.stringify(rigData, null, 2), 'utf-8');
      const viewer = new RIGViewer();
      viewer.saveHtml(rigJsonPath, rigHtmlPath);
    } catch {
      // silent fail - user may be mid-edit
    } finally {
      rebuildInProgress = false;
      if (rebuildQueued) {
        rebuildQueued = false;
        rebuildGraph();
      }
    }
  }, 3000);

  const onWorkspaceChange = (uri: vscode.Uri) => {
    if (shouldIgnoreWatcherPath(uri.fsPath)) return;
    rebuildGraph();
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,py,css,json}', false, false, false);
  watcher.onDidChange(onWorkspaceChange);
  watcher.onDidCreate(onWorkspaceChange);
  watcher.onDidDelete(onWorkspaceChange);
  context.subscriptions.push(watcher);

  const workspaceRoot = getPreferredWorkspaceRoot();
  if (workspaceRoot) {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.architectiq')) {
        fs.appendFileSync(gitignorePath, '\n# ArchitectIQ graph cache\n.architectiq/\n');
      }
    }
  }
}

export function deactivate(): void {}
