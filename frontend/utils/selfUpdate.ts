const BACKEND_URL = 'https://jarvis-backend-production-a86c.up.railway.app';

export type SelfUpdateAction = {
  action: string;
  file_path?: string;
  dir_path?: string;
  content?: string;
  commit_message?: string;
  files?: Array<{ file_path: string; content: string }>;
  trigger_build?: boolean;
};

export function parseSelfUpdateActions(text: string): { cleanText: string; actions: SelfUpdateAction[] } {
  const actions: SelfUpdateAction[] = [];
  let cleanText = text;

  const regex = /```selfupdate\s*([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      actions.push(parsed);
      cleanText = cleanText.replace(match[0], '').trim();
    } catch (e) {
      console.log('Failed to parse selfupdate action:', e);
    }
  }

  return { cleanText, actions };
}

export async function executeSelfUpdate(action: SelfUpdateAction): Promise<string> {
  try {
    switch (action.action) {
      case 'read':
        return await readFile(action.file_path || '');
      case 'list':
        return await listDir(action.dir_path || '');
      case 'write':
        return await writeFile(action.file_path || '', action.content || '', action.commit_message || 'JARVIS update');
      case 'multi_write':
        return await multiWrite(action.files || [], action.commit_message || 'JARVIS update', action.trigger_build || false);
      case 'build':
        return await triggerBuild();
      default:
        return `Unknown self-update action: ${action.action}`;
    }
  } catch (err: any) {
    return `Self-update failed: ${err.message || String(err)}`;
  }
}

async function readFile(filePath: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/code/read/${filePath}`);
  const data = await res.json();
  if (!res.ok) return `Error reading ${filePath}: ${data.detail || 'Unknown error'}`;
  return `File: ${data.file_path} (${data.size} bytes)\n---\n${data.content}`;
}

async function listDir(dirPath: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/code/list/${dirPath}`);
  const data = await res.json();
  if (!res.ok) return `Error listing ${dirPath}: ${data.detail || 'Unknown error'}`;
  const items = data.files.map((f: any) => `  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}${f.size ? ` (${f.size}b)` : ''}`).join('\n');
  return `Directory: ${data.path || '/'}\n${items}`;
}

async function writeFile(filePath: string, content: string, commitMessage: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/code/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath, content, commit_message: commitMessage }),
  });
  const data = await res.json();
  if (!res.ok) return `Error writing ${filePath}: ${data.detail || 'Unknown error'}`;
  return `${data.status === 'pushed' ? 'Pushed to GitHub' : 'Committed locally'}: ${data.file} — "${data.message}"`;
}

async function multiWrite(files: Array<{ file_path: string; content: string }>, commitMessage: string, triggerBuild: boolean): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/code/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: files.map(f => ({ ...f, commit_message: commitMessage })), commit_message: commitMessage, trigger_build: triggerBuild }),
  });
  const data = await res.json();
  if (!res.ok) return `Error updating files: ${data.detail || 'Unknown error'}`;
  let result = `${data.status === 'pushed' ? 'Pushed to GitHub' : 'Failed'}: ${data.files_updated.join(', ')}`;
  if (data.build) result += `\nBuild: ${data.build.status}`;
  return result;
}

async function triggerBuild(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/build/trigger`, { method: 'POST' });
  const data = await res.json();
  return `Build: ${data.status}${data.build_url ? '\nURL: ' + data.build_url : ''}${data.submitted_to_testflight ? '\nSubmitted to TestFlight' : ''}`;
}
