/**
 * jarvisParser.ts
 *
 * Parses the structured JSON that the LLM returns using the AppFramework
 * architecture and routes each action to the correct handler on the device.
 *
 * Expected LLM output formats:
 *   A) {"action": "none", "response": "Hello sir."}
 *   B) {"action": "AppFramework.Code.readCodeFile", "args": {"path": "backend/server.py"}}
 */

import { executeDeviceAction, DeviceAction } from './deviceActions';
import { executeSelfUpdate, SelfUpdateAction } from './selfUpdate';

const BACKEND_URL = 'https://jarvis-backend-production-a86c.up.railway.app';

// ── Types ──────────────────────────────────────────────────────────

export type ParsedResponse =
  | { type: 'text'; text: string }
  | { type: 'tool'; action: string; args: Record<string, any> };

// ── Main parser ────────────────────────────────────────────────────

export function parseJarvisResponse(raw: string): ParsedResponse {
  const jsonString = extractJson(raw);

  if (!jsonString) {
    return { type: 'text', text: raw };
  }

  try {
    const parsed = JSON.parse(jsonString);

    if (!parsed || typeof parsed !== 'object') {
      return { type: 'text', text: raw };
    }

    // Normal reply
    if (parsed.action === 'none' || !parsed.action) {
      return { type: 'text', text: parsed.response || parsed.text || raw };
    }

    // Tool call
    return {
      type: 'tool',
      action: parsed.action,
      args: parsed.args || {},
    };
  } catch {
    return { type: 'text', text: raw };
  }
}

/**
 * Tries to find a JSON object in the raw string.
 * Handles cases where the LLM wraps JSON in markdown fences or adds preamble.
 */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();

  // Best case: entire response is a JSON object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // LLM wrapped it in ```json ... ``` or ``` ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{')) return inner;
  }

  // Last resort: find the first { ... } block
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.substring(firstBrace, lastBrace + 1);
  }

  return null;
}

// ── Tool Execution Router ──────────────────────────────────────────

/**
 * Resolves an AppFramework action string like "AppFramework.Device.getContacts"
 * into { module: "Device", func: "getContacts" }.
 */
function resolveAction(action: string): { module: string; func: string } {
  // Handle "AppFramework.Module.function" format
  const parts = action.split('.');
  if (parts.length === 3 && parts[0] === 'AppFramework') {
    return { module: parts[1], func: parts[2] };
  }
  // Handle legacy "functionName" format (backwards compatible)
  if (parts.length === 1) {
    // Try to infer module from function name
    const func = parts[0];
    if (['getContacts', 'getCalendarEvents', 'getLocation', 'copyToClipboard', 'shareContent'].includes(func)) {
      return { module: 'Device', func };
    }
    if (['listRepoPaths', 'readCodeFile', 'writeCodeFile', 'commitAndPush'].includes(func)) {
      return { module: 'Code', func };
    }
    if (['triggerIOSBuild', 'submitToTestFlight'].includes(func)) {
      return { module: 'Deploy', func };
    }
    if (['getCryptoPrice', 'getPortfolioBalances', 'getTradeHistory', 'placeMarketOrder', 'placeLimitOrder'].includes(func)) {
      return { module: 'Trading', func };
    }
    if (func === 'speak') {
      return { module: 'Voice', func };
    }
  }
  return { module: 'Unknown', func: action };
}

/**
 * Executes a tool action and returns a human-readable result string.
 */
export async function executeToolAction(
  action: string,
  args: Record<string, any>,
): Promise<{ result: string; category: string }> {
  const { module: mod, func } = resolveAction(action);

  switch (mod) {
    case 'Device':
      return { result: await executeDeviceHandler(func, args), category: 'Device' };

    case 'Code':
      return { result: await executeCodeHandler(func, args), category: 'Code' };

    case 'Deploy':
      return { result: await executeDeployHandler(func, args), category: 'Deploy' };

    case 'Trading':
      return { result: await executeTradingHandler(func, args), category: 'Trading' };

    case 'Voice':
      // Voice is handled in index.tsx via speakText callback
      return { result: args.text || '', category: 'Voice' };

    default:
      return { result: `Unknown AppFramework module: ${mod}.${func}`, category: 'Unknown' };
  }
}

// ── Device Handler ─────────────────────────────────────────────────

async function executeDeviceHandler(func: string, args: Record<string, any>): Promise<string> {
  const actionMap: Record<string, DeviceAction> = {
    getContacts: { action: 'get_contacts', search: args.query ?? undefined },
    getCalendarEvents: { action: 'get_calendar', days: args.days ?? 7 },
    getLocation: { action: 'get_location' },
    copyToClipboard: { action: 'clipboard', text: args.text ?? '' },
    shareContent: { action: 'share', text: args.text ?? '' },
  };

  const deviceAction = actionMap[func];
  if (!deviceAction) return `Unknown Device function: ${func}`;
  return await executeDeviceAction(deviceAction);
}

// ── Code Handler ───────────────────────────────────────────────────

async function executeCodeHandler(func: string, args: Record<string, any>): Promise<string> {
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

  const updateAction = actionMap[func];
  if (!updateAction) return `Unknown Code function: ${func}`;
  return await executeSelfUpdate(updateAction);
}

// ── Deploy Handler ─────────────────────────────────────────────────

async function executeDeployHandler(func: string, _args: Record<string, any>): Promise<string> {
  if (func === 'triggerIOSBuild' || func === 'submitToTestFlight') {
    return await executeSelfUpdate({ action: 'build' });
  }
  return `Unknown Deploy function: ${func}`;
}

// ── Trading Handler ────────────────────────────────────────────────

async function executeTradingHandler(func: string, args: Record<string, any>): Promise<string> {
  try {
    let url = '';
    let method = 'GET';
    let body: string | undefined;

    switch (func) {
      case 'getCryptoPrice':
        url = `${BACKEND_URL}/api/binance/price/${args.symbol || 'BTCUSDT'}`;
        break;
      case 'getPortfolioBalances':
        url = `${BACKEND_URL}/api/binance/portfolio`;
        break;
      case 'getTradeHistory':
        url = `${BACKEND_URL}/api/binance/trades${args.symbol ? '?symbol=' + args.symbol : ''}`;
        break;
      case 'placeMarketOrder':
        url = `${BACKEND_URL}/api/binance/trade`;
        method = 'POST';
        body = JSON.stringify({
          symbol: args.symbol,
          side: args.side?.toUpperCase() || 'BUY',
          order_type: 'MARKET',
          quantity: args.quantity,
        });
        break;
      case 'placeLimitOrder':
        url = `${BACKEND_URL}/api/binance/trade`;
        method = 'POST';
        body = JSON.stringify({
          symbol: args.symbol,
          side: args.side?.toUpperCase() || 'BUY',
          order_type: 'LIMIT',
          quantity: args.quantity,
          price: args.price,
        });
        break;
      default:
        return `Unknown Trading function: ${func}`;
    }

    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = body;

    const res = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
      return `Trading error: ${data.detail || JSON.stringify(data)}`;
    }

    return JSON.stringify(data, null, 2);
  } catch (err: any) {
    return `Trading request failed: ${err.message || String(err)}`;
  }
}
