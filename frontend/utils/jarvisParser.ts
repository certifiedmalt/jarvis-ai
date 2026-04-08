/**
 * jarvisParser.ts
 *
 * Routes native tool calls from the backend to the correct device handler.
 * The backend now returns structured tool_call objects via Together.ai's
 * native function calling — no more JSON text parsing needed.
 */

import { executeDeviceAction, DeviceAction } from './deviceActions';
import { executeSelfUpdate, SelfUpdateAction } from './selfUpdate';

const BACKEND_URL = 'https://jarvis-backend-production-a86c.up.railway.app';

// ── Types ──────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// ── Tool Execution Router ──────────────────────────────────────────

/**
 * Executes a tool call and returns a human-readable result string.
 */
export async function executeToolAction(
  toolCall: ToolCall,
): Promise<{ result: string; category: string; displayName: string }> {
  const { name, arguments: args } = toolCall;

  // ── Device Actions ───────────────────────────────────────────
  if (['getContacts', 'getCalendarEvents', 'getLocation', 'copyToClipboard', 'shareContent'].includes(name)) {
    const result = await executeDeviceHandler(name, args);
    return { result, category: 'Device', displayName: name };
  }

  // ── Code Actions ─────────────────────────────────────────────
  if (['listRepoPaths', 'readCodeFile', 'writeCodeFile', 'commitAndPush'].includes(name)) {
    const result = await executeCodeHandler(name, args);
    return { result, category: 'Code', displayName: name };
  }

  // ── Deploy Actions ───────────────────────────────────────────
  if (['triggerIOSBuild', 'submitToTestFlight'].includes(name)) {
    const result = await executeDeployHandler(name);
    return { result, category: 'Deploy', displayName: name };
  }

  // ── Voice ────────────────────────────────────────────────────
  if (name === 'speak') {
    return { result: args.text || '', category: 'Voice', displayName: 'speak' };
  }

  return { result: `Unknown tool: ${name}`, category: 'Unknown', displayName: name };
}

// ── Device Handler ─────────────────────────────────────────────────

async function executeDeviceHandler(name: string, args: Record<string, any>): Promise<string> {
  const actionMap: Record<string, DeviceAction> = {
    getContacts: { action: 'get_contacts', search: args.query ?? undefined },
    getCalendarEvents: { action: 'get_calendar', days: args.days ?? 7 },
    getLocation: { action: 'get_location' },
    copyToClipboard: { action: 'clipboard', text: args.text ?? '' },
    shareContent: { action: 'share', text: args.text ?? '' },
  };

  const deviceAction = actionMap[name];
  if (!deviceAction) return `Unknown Device function: ${name}`;
  return await executeDeviceAction(deviceAction);
}

// ── Code Handler ───────────────────────────────────────────────────

async function executeCodeHandler(name: string, args: Record<string, any>): Promise<string> {
  // commitAndPush is a dedicated operation — it does NOT write files
  if (name === 'commitAndPush') {
    return await executeCommitAndPush(args.message ?? 'JARVIS commit');
  }

  // patchCodeFile uses the dedicated patch endpoint
  if (name === 'patchCodeFile') {
    return await executePatchCode(args);
  }

  const actionMap: Record<string, SelfUpdateAction> = {
    listRepoPaths: { action: 'list', dir_path: args.path ?? '' },
    readCodeFile: { action: 'read', file_path: args.path ?? '' },
    writeCodeFile: {
      action: 'write',
      file_path: args.path ?? '',
      content: args.content ?? '',
      commit_message: args.commit_message ?? 'JARVIS self-update',
    },
  };

  const updateAction = actionMap[name];
  if (!updateAction) return `Unknown Code function: ${name}`;
  return await executeSelfUpdate(updateAction);
}

async function executePatchCode(args: Record<string, any>): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/code/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: args.path ?? '',
        operation: args.operation ?? 'replace',
        find: args.find ?? null,
        replace_with: args.replace_with ?? null,
        line: args.line ?? null,
        content: args.content ?? null,
        commit_message: args.commit_message ?? 'JARVIS patch',
      }),
    });
    const data = await res.json();
    if (!res.ok) return `Patch error: ${data.detail || 'Unknown error'}`;
    if (data.status === 'not_found') return `Patch failed: ${data.message}. File has ${data.file_lines} lines.`;
    if (data.status === 'invalid_line') return `Patch failed: ${data.message}`;
    return `Patched ${data.file} (${data.operation}): ${data.status}. ${data.message || ''}`;
  } catch (err: any) {
    return `Patch failed: ${err.message || String(err)}`;
  }
}

async function executeCommitAndPush(message: string): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/code/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) return `Error pushing: ${data.detail || 'Unknown error'}`;
    if (data.status === 'pushed') return `Pushed to GitHub: "${data.message}"`;
    if (data.status === 'nothing_to_commit') return data.message || 'Nothing to commit.';
    return `Git push ${data.status}: ${data.git_output || ''}`;
  } catch (err: any) {
    return `Push failed: ${err.message || String(err)}`;
  }
}

// ── Deploy Handler (Server-side via GitHub Actions) ────────────────

async function executeDeployHandler(name: string): Promise<string> {
  const BACKEND = 'https://jarvis-backend-production-a86c.up.railway.app';

  try {
    if (name === 'triggerIOSBuild') {
      const res = await fetch(`${BACKEND}/api/deploy/build?action=build_and_submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) return `Deploy error: ${data.detail || 'Unknown error'}`;
      return `Build triggered! ${data.message || ''} Deploy ID: ${data.deploy_id || 'N/A'}`;
    }

    if (name === 'submitToTestFlight') {
      const res = await fetch(`${BACKEND}/api/deploy/build?action=submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) return `Submit error: ${data.detail || 'Unknown error'}`;
      return `TestFlight submission triggered! ${data.message || ''}`;
    }

    return `Unknown Deploy function: ${name}`;
  } catch (err: any) {
    return `Deploy request failed: ${err.message || String(err)}`;
  }
}
