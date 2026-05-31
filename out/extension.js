"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
let diagnosticCollection;
let statusBarItem;
let latestFindings = [];
function activate(context) {
    console.log('Spectra is now active!');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('spectra');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'spectra.scanWorkspace';
    context.subscriptions.push(diagnosticCollection, statusBarItem);
    const scanWorkspaceCommand = vscode.commands.registerCommand('spectra.scanWorkspace', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace opened.');
            return;
        }
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Spectra: Scanning Workspace",
            cancellable: false
        }, async (progress) => {
            for (const folder of workspaceFolders) {
                await runSpectraScan(folder.uri.fsPath);
            }
        });
    });
    const scanActiveFileCommand = vscode.commands.registerCommand('spectra.scanActiveFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Spectra: Scanning File",
                cancellable: false
            }, async () => {
                await runSpectraScan(editor.document.uri.fsPath);
            });
        }
    });
    // Run scan on file save
    const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'go' || document.languageId === 'python' || document.languageId === 'java') {
            await runSpectraScan(document.uri.fsPath);
        }
    });
    // Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider(['go', 'python', 'java', 'javascript', 'typescript', 'rust', 'c', 'cpp'], {
        provideHover(document, position, token) {
            const uri = document.uri.toString();
            const line = position.line;
            const finding = latestFindings.find(f => vscode.Uri.file(f.file_path).toString() === uri &&
                (f.line_number - 1 === line || f.line_number === line));
            if (finding) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**Spectra Crypto Insight**\n\n`);
                md.appendMarkdown(`Algorithm: **\${finding.algorithm}**\n\n`);
                md.appendMarkdown(`QRS Score: **\${finding.qrs}** (\${finding.risk_band})\n\n`);
                md.appendMarkdown(`*Migration Effort*: \${finding.migration_effort}\n\n`);
                md.appendMarkdown(`*\${finding.effort_rationale}*\n`);
                return new vscode.Hover(md);
            }
            return null;
        }
    });
    context.subscriptions.push(scanWorkspaceCommand, scanActiveFileCommand, onSave, hoverProvider);
    // Initial UI state
    statusBarItem.text = `$(shield) Spectra: Ready`;
    statusBarItem.show();
}
async function runSpectraScan(targetPath) {
    const config = vscode.workspace.getConfiguration('spectra');
    const binPath = config.get('executablePath') || 'spectra';
    try {
        const { stdout } = await execAsync(`"${binPath}" scan "${targetPath}" --output json --quiet`);
        processSpectraOutput(stdout);
    }
    catch (error) {
        // Spectra might exit with code 1 if it finds issues, stdout still contains JSON
        if (error.stdout) {
            processSpectraOutput(error.stdout);
        }
        else {
            console.error('Spectra scan failed:', error);
            vscode.window.showErrorMessage('Failed to run Spectra. Ensure the CLI is installed and in your PATH.');
        }
    }
}
function processSpectraOutput(jsonStr) {
    try {
        diagnosticCollection.clear();
        const result = JSON.parse(jsonStr);
        latestFindings = result.findings || [];
        if (result.aggregate_qrs !== undefined) {
            statusBarItem.text = `$(shield) QRS: ${result.aggregate_qrs}`;
            statusBarItem.tooltip = "Spectra Workspace Quantum Risk Score";
            if (result.aggregate_qrs >= 80)
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            else if (result.aggregate_qrs >= 40)
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            else
                statusBarItem.backgroundColor = undefined;
            statusBarItem.show();
        }
        if (!result.findings || result.findings.length === 0)
            return;
        const diagnosticsMap = new Map();
        for (const finding of result.findings) {
            const uri = vscode.Uri.file(finding.file_path);
            const uriStr = uri.toString();
            const line = finding.line_number > 0 ? finding.line_number - 1 : 0;
            const range = new vscode.Range(line, 0, line, 100);
            const severity = finding.risk_band === 'CRITICAL' ? vscode.DiagnosticSeverity.Error :
                finding.risk_band === 'HIGH' ? vscode.DiagnosticSeverity.Warning :
                    vscode.DiagnosticSeverity.Information;
            const diagnostic = new vscode.Diagnostic(range, `[QRS: ${finding.qrs}] ${finding.algorithm} (${finding.risk_band})\nMigration: ${finding.migration_effort} - ${finding.effort_rationale}`, severity);
            diagnostic.source = 'Spectra';
            if (!diagnosticsMap.has(uriStr)) {
                diagnosticsMap.set(uriStr, []);
            }
            diagnosticsMap.get(uriStr).push(diagnostic);
        }
        for (const [uriStr, diagnostics] of diagnosticsMap.entries()) {
            diagnosticCollection.set(vscode.Uri.parse(uriStr), diagnostics);
        }
    }
    catch (e) {
        console.error('Failed to parse spectra output', e);
    }
}
function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
//# sourceMappingURL=extension.js.map