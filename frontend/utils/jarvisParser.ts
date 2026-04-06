/**
 * jarvisParser.ts
 *
 * Parses the structured JSON that the LLM returns and routes
 * each action to the correct handler on the device.
 *
 * Expected LLM output formats:
 *   A) {"action": "none", "response": "Hello sir."}
 *   B) {"action": "getCryptoPrice", "args": {"symbol": "BTCUSDT"}}
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
  // Try to extract JSON from the response
  const jsonString = extractJson(raw);

  if (!jsonString) {
    // Not JSON — return raw text as-is
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
 * Executes a tool action and returns a human-readable result string.
 */
export async function executeToolAction(
  action: string,
  args: Record<string, any>,
  speakFn?: (text: string, msgId: string) => void,
): Promise<{ result: string; category: string }> {
  // ── Device Actions ───────────────────────────────────────────
  if (isDeviceAction(action)) {
    const deviceAction = mapToDeviceAction(action, args);
    const result = await executeDeviceAction(deviceAction);
    return { result, category: 'device' };
  }

  // ── Self-Update / Code Actions ───────────────────────────────
  if (isSelfUpdateAction(action)) {
    const updateAction = mapToSelfUpdateAction(action, args);
    const result = await executeSelfUpdate(updateAction);
    return { result, category: 'code' };
  }

  // ── Trading Actions ──────────────────────────────────────────
  if (isTradingAction(action)) {
    const result = await executeTradingAction(action, args);
    return { result, category: 'trading' };
  }

  // ── Voice ────────────────────────────────────────────────────
  if (action === 'speak') {
    // Handled separately in index.tsx via speakFn callback
    return { result: args.text || '', category: 'voice' };
  }

  return { result: `Unknown tool: ${action}`, category: 'unknown' };
}

// ── Category Checks ────────────────────────────────────────────────

function isDeviceAction(action: string): boolean {
  return [
    'getContacts', 'getCalendarEvents', 'getLocation',
    'copyToClipboard', 'shareContent',
  ].includes(action);
}

function isSelfUpdateAction(action: string): boolean {
  return [
    'readCodeFile', 'listRepoPaths', 'writeCodeFile',
    'commitAndPush', 'triggerIOSBuild', 'submitToTestFlight',
  ].includes(action);
}

function isTradingAction(action: string): boolean {
  return [
    'getCryptoPrice', 'getPortfolioBalances', 'getTradeHistory',
    'placeMarketOrder', 'placeLimitOrder',
  ].includes(action);
}

// ── Mappers ────────────────────────────────────────────────────────

function mapToDeviceAction(action: string, args: Record<string, any>): DeviceAction {
  switch (action) {
    case 'getContacts':
      return { action: 'get_contacts', search: args.query ?? undefined };
    case 'getCalendarEvents':
      return { action: 'get_calendar', days: args.days ?? 7 };
    case 'getLocation':
      return { action: 'get_location' };
    case 'copyToClipboard':
      return { action: 'clipboard', text: args.text ?? '' };
    case 'shareContent':
      return { action: 'share', text: args.text ?? '' };
    default:
      return { action: action };
  }
}

function mapToSelfUpdateAction(action: string, args: Record<string, any>): SelfUpdateAction {
  switch (action) {
    case 'readCodeFile':
      return { action: 'read', file_path: args.path ?? '' };
    case 'listRepoPaths':
      return { action: 'list', dir_path: args.path ?? '' };
    case 'writeCodeFile':
      return {
        action: 'write',
        file_path: args.path ?? '',
        content: args.content ?? '',
        commit_message: args.commit_message ?? 'JARVIS self-update',
      };
    case 'commitAndPush':
      return { action: 'write', commit_message: args.message ?? 'JARVIS commit' };
    case 'triggerIOSBuild':
    case 'submitToTestFlight':
      return { action: 'build' };
    default:
      return { action: action };
  }
}

// ── Trading Execution ──────────────────────────────────────────────

async function executeTradingAction(
  action: string,
  args: Record<string, any>,
): Promise<string> {
  try {
    let url = '';
    let method = 'GET';
    let body: string | undefined;

    switch (action) {
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
        return `Unknown trading action: ${action}`;
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
