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
  const actionMap: Record<string, SelfUpdateAction> = {
    listRepoPaths: { action: 'list', dir_path: args.path ?? '' },
    readCodeFile: { action: 'read', file_path: args.path ?? '' },
    writeCodeFile: {
      action: 'write',
      file_path: args.path ?? '',
      content: args.content ?? '',
      commit_message: args.commit_message ?? 'JARVIS self-update',
    },
    commitAndPush: {
      action: 'write',
      commit_message: args.message ?? 'JARVIS commit',
    },
  };

  const updateAction = actionMap[name];
  if (!updateAction) return `Unknown Code function: ${name}`;
  return await executeSelfUpdate(updateAction);
}

// ── Deploy Handler ─────────────────────────────────────────────────

async function executeDeployHandler(name: string): Promise<string> {
  if (name === 'triggerIOSBuild' || name === 'submitToTestFlight') {
    return await executeSelfUpdate({ action: 'build' });
  }
  return `Unknown Deploy function: ${name}`;
}
