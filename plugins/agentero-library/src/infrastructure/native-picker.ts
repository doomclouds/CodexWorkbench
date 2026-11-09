import { spawn as spawnProcess, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { FilePickerInput, FilePickerResult } from '../contracts/picker.js';

const REQUEST_ENV = 'CODEXWORKBENCH_PICKER_REQUEST';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const CANCELLED_REQUEST_TTL_MS = 300_000;
const MAX_REQUEST_RECORDS = 256;

export class NativePickerError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'NativePickerError'; }
}

type SpawnPicker = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export interface NativePickerOptions {
  /** App-generated identity for explicit cancellation across the host bridge. */
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection points for platform/process contract tests; not MCP input fields. */
  platform?: NodeJS.Platform;
  spawn?: SpawnPicker;
}

interface PreparedPicker extends FilePickerInput { initialDirectory: string; fileName: string }
interface ActivePicker { stop(error: NativePickerError): void; completed: Promise<void> }
interface RequestRecord { job?: ActivePicker; expiresAt?: number }
const active = new Set<ActivePicker>();
const requests = new Map<string, RequestRecord>();
let reserved = false;
let generation = 0;

function validateRequestId(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器请求标识不正确。');
  return value.toLowerCase();
}

function pruneRequests() {
  const now = Date.now();
  for (const [id, record] of requests) if (!record.job && record.expiresAt !== undefined && record.expiresAt <= now) requests.delete(id);
}

/** Acknowledge only after this request's owned helper has exited, or prevent a delayed start. */
export async function cancelNativePicker(value: string): Promise<{ requestId: string; closed: true }> {
  const requestId = validateRequestId(value);
  pruneRequests();
  let record = requests.get(requestId);
  if (!record) {
    if (requests.size >= MAX_REQUEST_RECORDS) throw new NativePickerError('PICKER_BUSY', '选择器取消记录已满，请稍后重试。');
    record = {};
    requests.set(requestId, record);
  }
  record.expiresAt = Date.now() + CANCELLED_REQUEST_TTL_MS;
  const job = record.job;
  job?.stop(new NativePickerError('PICKER_ABORTED', '已取消选择。'));
  await job?.completed;
  return { requestId, closed: true };
}

// Static scripts receive user data through JSON in the child environment, never shell text.
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$request = ConvertFrom-Json -InputObject $env:CODEXWORKBENCH_PICKER_REQUEST
$owner = New-Object System.Windows.Forms.Form
$dialog = $null
try {
  $owner.Text = 'CodexWorkbench — ' + $request.title
  $owner.ShowInTaskbar = $false
  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Opacity = 0
  $owner.TopMost = $true
  $owner.Show()
  [void]$owner.Activate()
  if ($request.mode -eq 'open-directory') {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $request.title
    $dialog.RootFolder = [Environment+SpecialFolder]::MyComputer
    $dialog.SelectedPath = $request.initialDirectory
    $dialog.ShowNewFolderButton = $true
  } else {
    if ($request.mode -eq 'save-file') {
      $dialog = New-Object System.Windows.Forms.SaveFileDialog
      $dialog.OverwritePrompt = $true
      $dialog.CreatePrompt = $false
      $dialog.AddExtension = $true
      $dialog.FileName = $request.fileName
      if (@($request.filters).Count -gt 0 -and @($request.filters[0].extensions).Count -gt 0) {
        $dialog.DefaultExt = $request.filters[0].extensions[0]
      }
    } else {
      $dialog = New-Object System.Windows.Forms.OpenFileDialog
      $dialog.Multiselect = [bool]$request.multiple
      $dialog.CheckFileExists = $true
    }
    $dialog.Title = $request.title
    $dialog.InitialDirectory = $request.initialDirectory
    $dialog.CheckPathExists = $true
    $dialog.RestoreDirectory = $true
    $dialog.DereferenceLinks = $true
    $parts = @()
    foreach ($filter in @($request.filters)) {
      $patterns = @($filter.extensions | ForEach-Object { '*.' + $_ })
      $parts += $filter.name
      $parts += ($patterns -join ';')
    }
    $dialog.Filter = if ($parts.Count -gt 0) { $parts -join '|' } else { '所有文件 (*.*)|*.*' }
    $dialog.FilterIndex = 1
  }
  $answer = $dialog.ShowDialog($owner)
  if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
    $paths = if ($request.mode -eq 'open-directory') { @($dialog.SelectedPath) } elseif ($request.mode -eq 'save-file') { @($dialog.FileName) } else { @($dialog.FileNames) }
    $result = @{ cancelled = $false; paths = @($paths) }
  } else { $result = @{ cancelled = $true; paths = @() } }
  [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 6))
} catch {
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{ error = @{ code = 'PICKER_FAILED'; message = '系统选择器无法打开，请确认桌面已解锁并重试。' } }))
  exit 1
} finally {
  if ($null -ne $dialog) { $dialog.Dispose() }
  $owner.Close()
  $owner.Dispose()
}
`;

const MACOS_SCRIPT = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
function run() {
  try {
    var raw = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('CODEXWORKBENCH_PICKER_REQUEST'));
    var request = JSON.parse(raw);
    var application = $.NSApplication.sharedApplication;
    application.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    var panel = request.mode === 'save-file' ? $.NSSavePanel.savePanel : $.NSOpenPanel.openPanel;
    panel.title = request.title;
    panel.canCreateDirectories = true;
    panel.directoryURL = $.NSURL.fileURLWithPath(request.initialDirectory);
    panel.level = $.NSFloatingWindowLevel;
    if (request.mode === 'save-file') panel.nameFieldStringValue = request.fileName || '';
    else {
      panel.canChooseFiles = request.mode === 'open-file';
      panel.canChooseDirectories = request.mode === 'open-directory';
      panel.allowsMultipleSelection = request.mode === 'open-file' && Boolean(request.multiple);
      panel.resolvesAliases = true;
    }
    var extensions = [];
    (request.filters || []).forEach(function (filter) { extensions = extensions.concat(filter.extensions); });
    if (request.mode !== 'open-directory' && extensions.length) {
      panel.allowedFileTypes = extensions;
      panel.allowsOtherFileTypes = false;
    }
    application.activateIgnoringOtherApps(true);
    var response = panel.runModal;
    if (Number(response) !== Number($.NSModalResponseOK)) return JSON.stringify({ cancelled: true, paths: [] });
    var paths = [];
    if (request.mode === 'save-file') paths.push(ObjC.unwrap(panel.URL.path));
    else {
      var urls = panel.URLs;
      for (var index = 0; index < Number(urls.count); index++) paths.push(ObjC.unwrap(urls.objectAtIndex(index).path));
    }
    return JSON.stringify({ cancelled: false, paths: paths });
  } catch (error) {
    return JSON.stringify({ error: { code: 'PICKER_FAILED', message: '系统选择器无法打开，请确认桌面可用并重试。' } });
  }
}
`;

export function validatePickerInput(value: FilePickerInput): FilePickerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器参数不正确。');
  if (Object.keys(value).some(key => !['mode', 'title', 'defaultPath', 'multiple', 'filters'].includes(key))) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器包含未知参数。');
  if (!['open-file', 'open-directory', 'save-file'].includes(value.mode)) throw new NativePickerError('PICKER_INVALID_INPUT', '不支持该选择器类型。');
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 160 || /[\u0000-\u001f]/.test(value.title))) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器标题不正确。');
  if (value.defaultPath !== undefined && (typeof value.defaultPath !== 'string' || value.defaultPath.length > 4096 || value.defaultPath.includes('\0'))) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器初始路径不正确。');
  if (value.multiple !== undefined && typeof value.multiple !== 'boolean') throw new NativePickerError('PICKER_INVALID_INPUT', '多选参数不正确。');
  if (value.multiple && value.mode !== 'open-file') throw new NativePickerError('PICKER_INVALID_INPUT', '只有打开文件支持多选。');
  if (value.filters !== undefined && (!Array.isArray(value.filters) || value.filters.length > 12 || value.filters.some(filter => !filter || typeof filter.name !== 'string' || !filter.name.trim() || filter.name.length > 80 || /[|\u0000-\u001f]/.test(filter.name) || !Array.isArray(filter.extensions) || !filter.extensions.length || filter.extensions.length > 20 || filter.extensions.some(extension => typeof extension !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_+-]{0,19}$/.test(extension))))) throw new NativePickerError('PICKER_INVALID_INPUT', '文件类型筛选不正确。');
  if (value.mode === 'open-directory' && value.filters?.length) throw new NativePickerError('PICKER_INVALID_INPUT', '目录选择不使用文件扩展名筛选。');
  return { ...value, title: value.title?.trim() || (value.mode === 'open-directory' ? '选择文件夹' : value.mode === 'save-file' ? '选择保存位置' : '选择文件'), filters: value.filters?.map(filter => ({ name: filter.name.trim(), extensions: [...new Set(filter.extensions.map(extension => extension.toLowerCase()))] })) ?? [] };
}

async function prepare(input: FilePickerInput): Promise<PreparedPicker> {
  const home = homedir();
  const documents = join(home, 'Documents');
  let fallback = home;
  try { if ((await stat(documents)).isDirectory()) fallback = documents; } catch {}
  const value = input.defaultPath?.replace(/^~(?=$|[/\\])/, home) ?? '';
  let directory = isAbsolute(value) ? value : fallback;
  let fileName = input.mode === 'save-file' && value ? basename(value) : '';
  for (let attempts = 0; attempts < 64; attempts++) {
    try { if ((await stat(directory)).isDirectory()) { if (directory === value) fileName = ''; break; } } catch {}
    const parent = dirname(directory);
    if (parent === directory) { directory = fallback; break; }
    directory = parent;
  }
  return { ...input, initialDirectory: directory, fileName };
}

export function nativePickerLaunch(platform: NodeJS.Platform) {
  if (platform === 'win32') return { command: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')] };
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MACOS_SCRIPT] };
  throw new NativePickerError('PICKER_UNAVAILABLE', '原生选择器目前支持 Windows 和 macOS。');
}

export async function validatePickerResult(value: unknown, input: FilePickerInput): Promise<FilePickerResult> {
  const result = value as Partial<FilePickerResult> & { error?: { message?: string } };
  if (result?.error) throw new NativePickerError('PICKER_FAILED', result.error.message || '系统选择器执行失败。');
  if (!result || typeof result.cancelled !== 'boolean' || !Array.isArray(result.paths)) throw new NativePickerError('PICKER_FAILED', '系统选择器没有返回有效结果。');
  if (result.cancelled) return { cancelled: true, paths: [] };
  if (!result.paths.length || result.paths.length > 100 || (!input.multiple && result.paths.length !== 1)) throw new NativePickerError('PICKER_INVALID_SELECTION', '选择的项目数量不正确。');
  const paths: string[] = [];
  const extensions = new Set(input.filters?.flatMap(filter => filter.extensions.map(extension => extension.toLowerCase())) ?? []);
  for (const path of result.paths) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.length > 32768) throw new NativePickerError('PICKER_INVALID_SELECTION', '选择器返回的路径不正确。');
    const normalized = resolve(path);
    if (input.mode === 'save-file') {
      if (!(await stat(dirname(normalized))).isDirectory()) throw new NativePickerError('PICKER_INVALID_SELECTION', '保存目录不存在。');
      try { if ((await stat(normalized)).isDirectory()) throw new NativePickerError('PICKER_INVALID_SELECTION', '保存位置必须是文件。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    } else {
      const metadata = await stat(normalized);
      if (input.mode === 'open-directory' ? !metadata.isDirectory() : !metadata.isFile()) throw new NativePickerError('PICKER_INVALID_SELECTION', '请选择正确的文件或目录。');
    }
    if (input.mode !== 'open-directory' && extensions.size && !extensions.has(extname(normalized).slice(1).toLowerCase())) throw new NativePickerError('PICKER_INVALID_SELECTION', '选择的文件类型不符合要求。');
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return { cancelled: false, paths };
}

export async function pickNativePath(input: FilePickerInput, options: NativePickerOptions = {}): Promise<FilePickerResult> {
  const request = validatePickerInput(input);
  const requestId = options.requestId === undefined ? undefined : validateRequestId(options.requestId);
  const platform = options.platform ?? process.platform;
  const launch = nativePickerLaunch(platform);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new NativePickerError('PICKER_INVALID_INPUT', '选择器等待时间不正确。');
  if (options.signal?.aborted) throw new NativePickerError('PICKER_ABORTED', '已取消选择。');
  pruneRequests();
  if (requestId && requests.get(requestId)?.expiresAt !== undefined) throw new NativePickerError('PICKER_ABORTED', '已取消选择。');
  if (requestId && requests.has(requestId)) throw new NativePickerError('PICKER_BUSY', '该选择器请求仍在处理中。');
  if (reserved) throw new NativePickerError('PICKER_BUSY', '已有一个系统选择器打开，请先完成或取消。');
  if (requestId && requests.size >= MAX_REQUEST_RECORDS) throw new NativePickerError('PICKER_BUSY', '选择器取消记录已满，请稍后重试。');
  reserved = true;
  const capturedGeneration = generation;
  const spawn = options.spawn ?? spawnProcess;
  let stopped: NativePickerError | undefined;
  let stopChild: (() => void) | undefined;
  let childClosed: Promise<void> | undefined;
  let completed!: () => void;
  const completion = new Promise<void>(resolve => { completed = resolve; });
  const job: ActivePicker = { stop(error) { stopped ??= error; stopChild?.(); }, completed: completion };
  const record: RequestRecord = { job };
  active.add(job);
  if (requestId) requests.set(requestId, record);
  const abort = () => job.stop(new NativePickerError('PICKER_ABORTED', '已取消选择。'));
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const prepared = await prepare(request);
    if (stopped) throw stopped;
    if (capturedGeneration !== generation || options.signal?.aborted) throw new NativePickerError('PICKER_ABORTED', '已取消选择。');
    let child: ChildProcess;
    try {
      child = spawn(launch.command, launch.args, { cwd: prepared.initialDirectory, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, [REQUEST_ENV]: JSON.stringify(prepared) } });
    } catch { throw new NativePickerError('PICKER_UNAVAILABLE', '无法启动系统选择器，请检查系统组件是否可用。'); }
    let terminate: Promise<void> | undefined;
    // An error (for example a failed kill) is not proof that an existing helper exited.
    const closed = childClosed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
    async function stopProcess() {
      terminate ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        if (platform === 'win32') {
          await new Promise<void>(resolve => {
            const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
            const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 2500);
            const finish = () => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); resolve(); };
            killer.once('error', finish); killer.once('close', finish);
          });
        } else {
          child.kill('SIGTERM');
          await Promise.race([closed, new Promise<void>(resolve => { const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); resolve(); }, 1500); void closed.then(() => { clearTimeout(timer); resolve(); }); })]);
        }
        await closed;
      })();
      return terminate;
    }
    return await new Promise<FilePickerResult>((resolve, reject) => {
      let settled = false;
      let output = '';
      let outputBytes = 0;
      const finish = (error?: unknown, result?: FilePickerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(result!);
      };
      stopChild = () => { void stopProcess().then(() => finish(stopped), () => finish(stopped)); };
      const timer = setTimeout(() => job.stop(new NativePickerError('PICKER_TIMEOUT', '系统选择器等待超时，已关闭；请重新选择。')), timeoutMs);
      if (options.signal?.aborted) abort();
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => { outputBytes += Buffer.byteLength(chunk); if (outputBytes > MAX_OUTPUT_BYTES) job.stop(new NativePickerError('PICKER_FAILED', '系统选择器返回的数据过大。')); else output += chunk; });
      child.stderr?.on('data', () => { /* Native diagnostics are not leaked into model/tool results. */ });
      child.on('error', () => { if (!stopped) finish(new NativePickerError('PICKER_UNAVAILABLE', '无法启动系统选择器，请检查系统组件是否可用。')); });
      child.once('close', code => {
        // stopChild awaits the owned tree terminator as well as the dialog's close.
        if (stopped) return;
        if (code !== 0) { finish(new NativePickerError('PICKER_FAILED', '系统选择器未能完成，请确认桌面可用并重试。')); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(output.replace(/^\uFEFF/, '').trim()); } catch { finish(new NativePickerError('PICKER_FAILED', '系统选择器返回格式不正确。')); return; }
        void validatePickerResult(parsed, request).then(result => finish(stopped, result), finish);
      });
    });
  } finally {
    await childClosed;
    options.signal?.removeEventListener('abort', abort);
    active.delete(job);
    if (requestId) {
      if (record.expiresAt !== undefined) { record.job = undefined; record.expiresAt = Date.now() + CANCELLED_REQUEST_TTL_MS; }
      else requests.delete(requestId);
    }
    reserved = false;
    completed();
  }
}

export async function closeNativePickers(): Promise<void> {
  generation++;
  const jobs = [...active];
  for (const job of jobs) job.stop(new NativePickerError('PICKER_ABORTED', '插件关闭，已取消选择。'));
  await Promise.allSettled(jobs.map(job => job.completed));
}
