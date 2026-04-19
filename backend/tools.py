"""
Jarvis v2 — Server-Side Tool Implementations
All tools that execute on the backend (Railway server).
"""

import os
import json
import subprocess
import base64
import io
import math
import re
import socket
import platform
import shutil
import traceback
import logging
from typing import Optional
from datetime import datetime

import httpx
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("jarvis.tools")

REPO_DIR = os.getenv("REPO_DIR", "/app")
GITHUB_PAT = os.getenv("GITHUB_PAT")
GITHUB_REPO = os.getenv("GITHUB_REPO", "certifiedmalt/jarvis-ai")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY")
BINANCE_SECRET_KEY = os.getenv("BINANCE_SECRET_KEY")


# ═══════════════════════════════════════════════════════════════════
# CODE TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_list_paths(path: str = "") -> str:
    full = os.path.join(REPO_DIR, path)
    if not os.path.exists(full):
        return f"Path not found: {path}"
    entries = []
    for item in sorted(os.listdir(full)):
        if item.startswith("."):
            continue
        item_path = os.path.join(full, item)
        t = "dir" if os.path.isdir(item_path) else "file"
        size = ""
        if t == "file":
            try:
                s = os.path.getsize(item_path)
                size = f" ({s}b)" if s < 1024 else f" ({s//1024}KB)"
            except:
                pass
        entries.append(f"{'📁' if t == 'dir' else '📄'} {item}{size}")
    return f"Directory: {path or '/'}\n" + "\n".join(entries)


def tool_read_file(path: str) -> str:
    full = os.path.join(REPO_DIR, path)
    if not os.path.exists(full):
        return f"File not found: {path}"
    with open(full, "r") as f:
        content = f.read()
    lines = len(content.splitlines())
    if lines > 500:
        return f"File: {path} ({lines} lines)\n---\n{content[:15000]}\n\n... [truncated, {lines} total lines]"
    return f"File: {path} ({lines} lines)\n---\n{content}"


def tool_write_file(path: str, content: str, commit_message: str = "JARVIS write") -> str:
    full = os.path.join(REPO_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    subprocess.run(
        f'cd {REPO_DIR} && git add "{path}" && git commit -m "{commit_message}"',
        shell=True, capture_output=True, text=True, timeout=15
    )
    return f"Written: {path} ({len(content.splitlines())} lines)"


def tool_patch_file(args: dict) -> str:
    path = args.get("path", "")
    operation = args.get("operation", "")
    commit_message = args.get("commit_message", "JARVIS patch")
    full = os.path.join(REPO_DIR, path)
    if not os.path.exists(full):
        return f"File not found: {path}"
    with open(full, "r") as f:
        original = f.read()
    if operation == "replace":
        find = args.get("find", "")
        replace_with = args.get("replace_with", "")
        if not find or find not in original:
            return f"Text not found in {path}."
        new_content = original.replace(find, replace_with, 1)
    elif operation == "insert_after":
        lines = original.splitlines(keepends=True)
        insert_content = args.get("content", "")
        if not insert_content.endswith("\n"):
            insert_content += "\n"
        line_num = args.get("line", 0)
        lines.insert(line_num, insert_content)
        new_content = "".join(lines)
    else:
        return f"Unknown operation: {operation}"
    with open(full, "w") as f:
        f.write(new_content)
    subprocess.run(
        f'cd {REPO_DIR} && git add "{path}" && git commit -m "{commit_message}"',
        shell=True, capture_output=True, text=True, timeout=15
    )
    return f"Patched {path} ({operation}): success"


def tool_commit_push(message: str = "JARVIS commit") -> str:
    result = subprocess.run(
        f'cd {REPO_DIR} && git add -A && git commit -m "{message}" && git push origin main',
        shell=True, capture_output=True, text=True, timeout=30
    )
    output = (result.stdout + result.stderr).strip()
    if result.returncode == 0:
        return f'Pushed to GitHub: "{message}"'
    elif "nothing to commit" in output:
        return "Nothing to commit — working tree clean."
    else:
        return f"Git push failed: {output[-500:]}"


def tool_git_status() -> str:
    result = subprocess.run(
        f"cd {REPO_DIR} && git status --short && echo '---' && git branch --show-current",
        shell=True, capture_output=True, text=True, timeout=10
    )
    return result.stdout.strip() or "Clean working tree"


def tool_git_log(count: int = 10) -> str:
    result = subprocess.run(
        f"cd {REPO_DIR} && git log --oneline -{count}",
        shell=True, capture_output=True, text=True, timeout=10
    )
    return result.stdout.strip() or "No commits"


def tool_git_diff(path: str = "") -> str:
    cmd = f"cd {REPO_DIR} && git diff"
    if path:
        cmd += f' -- "{path}"'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
    diff = result.stdout.strip()
    if not diff:
        return "No changes" + (f" in {path}" if path else "")
    if len(diff) > 5000:
        return diff[:5000] + "\n... [truncated]"
    return diff


# ═══════════════════════════════════════════════════════════════════
# DEPLOY TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_trigger_build() -> str:
    if not GITHUB_PAT:
        return "No GitHub PAT configured."
    r = requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/build-ios.yml/dispatches",
        headers={"Authorization": f"Bearer {GITHUB_PAT}", "Accept": "application/vnd.github.v3+json"},
        json={"ref": "main", "inputs": {"action": "build_and_submit"}},
    )
    if r.status_code == 204:
        return "iOS build triggered! GitHub Actions will build and submit to TestFlight."
    return f"Build trigger failed (HTTP {r.status_code}): {r.text[:300]}"


# ═══════════════════════════════════════════════════════════════════
# WEB TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_web_search(query: str, max_results: int = 5) -> str:
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        if not results:
            return f"No results found for: {query}"
        formatted = []
        for r in results:
            formatted.append(f"**{r.get('title', 'No title')}**\n{r.get('href', '')}\n{r.get('body', '')}\n")
        return f"Search: {query}\n\n" + "\n".join(formatted)
    except Exception as e:
        return f"Search failed: {str(e)}"


def tool_scrape_url(url: str) -> str:
    try:
        r = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        title = soup.title.string if soup.title else "No title"
        if len(text) > 10000:
            text = text[:10000] + "\n... [truncated]"
        return f"Title: {title}\nURL: {url}\n\n{text}"
    except Exception as e:
        return f"Failed to scrape {url}: {str(e)}"


def tool_http_request(method: str, url: str, headers: dict = None, body: str = None) -> str:
    try:
        kwargs = {"timeout": 20}
        if headers:
            kwargs["headers"] = headers
        if body:
            kwargs["data"] = body
            if not headers or "Content-Type" not in headers:
                kwargs["headers"] = {**(headers or {}), "Content-Type": "application/json"}
        r = requests.request(method.upper(), url, **kwargs)
        response_text = r.text[:5000]
        return f"HTTP {r.status_code} {r.reason}\n\n{response_text}"
    except Exception as e:
        return f"HTTP request failed: {str(e)}"


def tool_download_file(url: str, save_path: str = "") -> str:
    try:
        if not save_path:
            filename = url.split("/")[-1].split("?")[0] or "download"
            save_path = f"/tmp/jarvis_downloads/{filename}"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        r = requests.get(url, timeout=30, stream=True)
        r.raise_for_status()
        total = 0
        with open(save_path, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
                total += len(chunk)
        size = f"{total/1024:.1f}KB" if total < 1024*1024 else f"{total/1024/1024:.1f}MB"
        return f"Downloaded: {save_path} ({size})"
    except Exception as e:
        return f"Download failed: {str(e)}"


def tool_ping_host(host: str) -> str:
    try:
        result = subprocess.run(
            f"ping -c 3 -W 5 {host}",
            shell=True, capture_output=True, text=True, timeout=20
        )
        return result.stdout.strip() or result.stderr.strip()
    except Exception as e:
        return f"Ping failed: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# SHELL / SYSTEM TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_run_shell(command: str, timeout: int = 30) -> str:
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True,
            timeout=min(timeout, 60), cwd=REPO_DIR
        )
        output = (result.stdout + result.stderr).strip()
        if len(output) > 5000:
            output = output[:5000] + "\n... [truncated]"
        return f"Exit code: {result.returncode}\n{output}"
    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout}s"
    except Exception as e:
        return f"Shell error: {str(e)}"


def tool_system_stats() -> str:
    try:
        disk = shutil.disk_usage("/")
        mem_result = subprocess.run("free -h 2>/dev/null || echo 'N/A'", shell=True, capture_output=True, text=True)
        uptime_result = subprocess.run("uptime", shell=True, capture_output=True, text=True)
        return (
            f"System: {platform.system()} {platform.machine()}\n"
            f"Disk: {disk.used/1024/1024/1024:.1f}GB / {disk.total/1024/1024/1024:.1f}GB "
            f"({disk.used/disk.total*100:.0f}% used)\n"
            f"Memory:\n{mem_result.stdout.strip()}\n"
            f"Uptime: {uptime_result.stdout.strip()}"
        )
    except Exception as e:
        return f"Stats error: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# NOTES / MEMORY TOOLS (MongoDB)
# ═══════════════════════════════════════════════════════════════════

_db = None

def _get_db():
    global _db
    if _db is None:
        from motor.motor_asyncio import AsyncIOMotorClient
        from pymongo import MongoClient
        mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
        client = MongoClient(mongo_url)
        _db = client["jarvis"]
    return _db


def tool_store_note(key: str, content: str, tags: list = None) -> str:
    try:
        db = _get_db()
        db.notes.update_one(
            {"key": key},
            {"$set": {
                "key": key,
                "content": content,
                "tags": tags or [],
                "updated_at": datetime.utcnow().isoformat(),
            }},
            upsert=True
        )
        return f"Stored note: '{key}'"
    except Exception as e:
        return f"Failed to store note: {str(e)}"


def tool_retrieve_note(key: str = "", tag: str = "") -> str:
    try:
        db = _get_db()
        if key:
            doc = db.notes.find_one({"key": key})
            if doc:
                return f"Note '{key}':\n{doc['content']}\nTags: {doc.get('tags', [])}\nUpdated: {doc.get('updated_at', 'unknown')}"
            return f"No note found with key: {key}"
        elif tag:
            docs = list(db.notes.find({"tags": tag}).limit(20))
            if docs:
                return "\n\n".join([f"**{d['key']}**: {d['content'][:200]}" for d in docs])
            return f"No notes with tag: {tag}"
        else:
            docs = list(db.notes.find().sort("updated_at", -1).limit(20))
            if docs:
                return "Recent notes:\n" + "\n".join([f"- {d['key']}: {d['content'][:100]}..." for d in docs])
            return "No notes stored yet."
    except Exception as e:
        return f"Failed to retrieve note: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# FINANCE TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_binance_price(symbol: str = "BTCUSDT") -> str:
    try:
        r = requests.get(f"https://api.binance.com/api/v3/ticker/price?symbol={symbol.upper()}", timeout=10)
        data = r.json()
        if "price" in data:
            price = float(data["price"])
            return f"{data['symbol']}: ${price:,.2f}"
        return f"Binance error: {data.get('msg', 'Unknown error')}"
    except Exception as e:
        return f"Binance price error: {str(e)}"


def tool_binance_portfolio() -> str:
    if not BINANCE_API_KEY or not BINANCE_SECRET_KEY:
        return "Binance API keys not configured."
    try:
        from binance.client import Client
        client = Client(BINANCE_API_KEY, BINANCE_SECRET_KEY)
        account = client.get_account()
        balances = [b for b in account["balances"] if float(b["free"]) > 0 or float(b["locked"]) > 0]
        if not balances:
            return "No balances found."
        lines = []
        for b in balances[:20]:
            free = float(b["free"])
            locked = float(b["locked"])
            total = free + locked
            lines.append(f"  {b['asset']}: {total:.8f}" + (f" (locked: {locked:.8f})" if locked > 0 else ""))
        return "Binance Portfolio:\n" + "\n".join(lines)
    except Exception as e:
        return f"Binance portfolio error: {str(e)}"


def tool_binance_trade(symbol: str, side: str, quantity: float, order_type: str = "MARKET") -> str:
    if not BINANCE_API_KEY or not BINANCE_SECRET_KEY:
        return "Binance API keys not configured."
    try:
        from binance.client import Client
        client = Client(BINANCE_API_KEY, BINANCE_SECRET_KEY)
        if order_type.upper() == "MARKET":
            order = client.create_order(
                symbol=symbol.upper(),
                side=side.upper(),
                type="MARKET",
                quantity=quantity
            )
        else:
            return f"Only MARKET orders supported currently. Got: {order_type}"
        return f"Order executed: {side.upper()} {quantity} {symbol}\nOrder ID: {order['orderId']}\nStatus: {order['status']}"
    except Exception as e:
        return f"Trade failed: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# WEATHER
# ═══════════════════════════════════════════════════════════════════

def tool_weather(latitude: float = 0, longitude: float = 0, city: str = "") -> str:
    try:
        if city:
            geo = requests.get(f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1", timeout=10)
            geo_data = geo.json()
            if geo_data.get("results"):
                latitude = geo_data["results"][0]["latitude"]
                longitude = geo_data["results"][0]["longitude"]
                city = geo_data["results"][0].get("name", city)
            else:
                return f"City not found: {city}"
        if latitude == 0 and longitude == 0:
            return "Provide a city name or coordinates."
        r = requests.get(
            f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}"
            f"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto",
            timeout=10
        )
        data = r.json()
        current = data.get("current", {})
        daily = data.get("daily", {})
        weather_codes = {0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
                        45: "Foggy", 51: "Light drizzle", 61: "Light rain", 63: "Rain",
                        65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
                        95: "Thunderstorm"}
        condition = weather_codes.get(current.get("weather_code", -1), "Unknown")
        result = f"Weather{f' in {city}' if city else ''}:\n"
        result += f"  Now: {current.get('temperature_2m', '?')}°C, {condition}\n"
        result += f"  Humidity: {current.get('relative_humidity_2m', '?')}%, Wind: {current.get('wind_speed_10m', '?')} km/h\n"
        if daily.get("time"):
            result += "\nForecast:\n"
            for i in range(min(5, len(daily["time"]))):
                result += (f"  {daily['time'][i]}: {daily['temperature_2m_min'][i]}°C - "
                          f"{daily['temperature_2m_max'][i]}°C, Rain: {daily['precipitation_probability_max'][i]}%\n")
        return result
    except Exception as e:
        return f"Weather error: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# EMAIL
# ═══════════════════════════════════════════════════════════════════

def tool_send_email(to: str, subject: str, body: str, smtp_server: str = "", smtp_port: int = 587,
                    smtp_user: str = "", smtp_pass: str = "") -> str:
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        if not smtp_server:
            return "SMTP not configured. Set smtp_server, smtp_user, smtp_pass in your settings."

        msg = MIMEMultipart()
        msg["From"] = smtp_user
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)

        return f"Email sent to {to}: {subject}"
    except Exception as e:
        return f"Email failed: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# IMAGE GENERATION (OpenAI DALL-E)
# ═══════════════════════════════════════════════════════════════════

def tool_generate_image(prompt: str, size: str = "1024x1024") -> str:
    if not OPENAI_API_KEY:
        return "OpenAI API key not configured."
    try:
        r = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={"model": "dall-e-3", "prompt": prompt, "n": 1, "size": size},
            timeout=60
        )
        data = r.json()
        if "data" in data and data["data"]:
            url = data["data"][0].get("url", "")
            revised = data["data"][0].get("revised_prompt", "")
            return f"Image generated!\nURL: {url}\nRevised prompt: {revised}"
        return f"Image generation failed: {data.get('error', {}).get('message', str(data))}"
    except Exception as e:
        return f"Image generation error: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# UTILITY TOOLS
# ═══════════════════════════════════════════════════════════════════

def tool_generate_qr(data: str) -> str:
    try:
        import qrcode
        qr = qrcode.make(data)
        path = f"/tmp/jarvis_qr_{hash(data) % 10000}.png"
        qr.save(path)
        return f"QR code saved: {path}\nContent: {data[:100]}"
    except Exception as e:
        return f"QR generation failed: {str(e)}"


def tool_calculate(expression: str) -> str:
    try:
        safe_chars = set("0123456789+-*/.() %^eEpiPI")
        sanitized = expression.replace("^", "**").replace("pi", str(math.pi)).replace("PI", str(math.pi)).replace("e", str(math.e) if expression.strip() == "e" else "e")
        allowed_names = {"abs": abs, "round": round, "min": min, "max": max,
                        "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos,
                        "tan": math.tan, "log": math.log, "log10": math.log10,
                        "pi": math.pi, "e": math.e, "pow": pow, "ceil": math.ceil,
                        "floor": math.floor}
        result = eval(expression, {"__builtins__": {}}, allowed_names)
        return f"{expression} = {result}"
    except Exception as e:
        return f"Calculation error: {str(e)}"


def tool_encode_base64(text: str) -> str:
    encoded = base64.b64encode(text.encode()).decode()
    return f"Base64 encoded:\n{encoded}"


def tool_decode_base64(encoded: str) -> str:
    try:
        decoded = base64.b64decode(encoded).decode()
        return f"Decoded:\n{decoded}"
    except Exception as e:
        return f"Decode error: {str(e)}"


def tool_json_prettify(text: str) -> str:
    try:
        data = json.loads(text)
        pretty = json.dumps(data, indent=2, ensure_ascii=False)
        if len(pretty) > 5000:
            pretty = pretty[:5000] + "\n... [truncated]"
        return pretty
    except Exception as e:
        return f"Invalid JSON: {str(e)}"


def tool_compress_image(input_path: str, output_path: str = "", quality: int = 70, max_width: int = 1920) -> str:
    try:
        from PIL import Image
        img = Image.open(input_path)
        orig_size = os.path.getsize(input_path)
        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)
        if not output_path:
            output_path = input_path.rsplit(".", 1)[0] + "_compressed.jpg"
        img.save(output_path, "JPEG", quality=quality, optimize=True)
        new_size = os.path.getsize(output_path)
        return f"Compressed: {orig_size//1024}KB → {new_size//1024}KB ({output_path})"
    except Exception as e:
        return f"Compression error: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# SCHEDULED TASKS (MongoDB-based)
# ═══════════════════════════════════════════════════════════════════

def tool_schedule_task(name: str, schedule: str, action: str, enabled: bool = True) -> str:
    """Store a scheduled task in MongoDB. Format: name, cron-like schedule, action description."""
    try:
        db = _get_db()
        db.scheduled_tasks.update_one(
            {"name": name},
            {"$set": {
                "name": name,
                "schedule": schedule,
                "action": action,
                "enabled": enabled,
                "created_at": datetime.utcnow().isoformat(),
            }},
            upsert=True
        )
        return f"Scheduled task '{name}': {schedule} → {action}" + (" (enabled)" if enabled else " (disabled)")
    except Exception as e:
        return f"Schedule error: {str(e)}"


def tool_list_scheduled_tasks() -> str:
    try:
        db = _get_db()
        tasks = list(db.scheduled_tasks.find())
        if not tasks:
            return "No scheduled tasks."
        lines = []
        for t in tasks:
            status = "✅" if t.get("enabled", True) else "❌"
            lines.append(f"{status} {t['name']}: {t['schedule']} → {t['action']}")
        return "Scheduled tasks:\n" + "\n".join(lines)
    except Exception as e:
        return f"List tasks error: {str(e)}"


# ═══════════════════════════════════════════════════════════════════
# ROUTER — Called by server.py
# ═══════════════════════════════════════════════════════════════════

def execute_server_tool(name: str, args: dict) -> str:
    """Route a tool call to its implementation."""
    try:
        # Code tools
        if name == "listRepoPaths":
            return tool_list_paths(args.get("path", ""))
        elif name == "readCodeFile":
            return tool_read_file(args.get("path", ""))
        elif name == "writeCodeFile":
            return tool_write_file(args.get("path", ""), args.get("content", ""), args.get("commit_message", "JARVIS write"))
        elif name == "patchCodeFile":
            return tool_patch_file(args)
        elif name == "commitAndPush":
            return tool_commit_push(args.get("message", "JARVIS commit"))
        elif name == "gitStatus":
            return tool_git_status()
        elif name == "gitLog":
            return tool_git_log(args.get("count", 10))
        elif name == "gitDiff":
            return tool_git_diff(args.get("path", ""))
        # Deploy
        elif name == "triggerIOSBuild":
            return tool_trigger_build()
        # Web
        elif name == "webSearch":
            return tool_web_search(args.get("query", ""), args.get("max_results", 5))
        elif name == "scrapeURL":
            return tool_scrape_url(args.get("url", ""))
        elif name == "httpRequest":
            return tool_http_request(args.get("method", "GET"), args.get("url", ""), args.get("headers"), args.get("body"))
        elif name == "downloadFile":
            return tool_download_file(args.get("url", ""), args.get("save_path", ""))
        elif name == "pingHost":
            return tool_ping_host(args.get("host", ""))
        # Shell / System
        elif name == "runShellCommand":
            return tool_run_shell(args.get("command", ""), args.get("timeout", 30))
        elif name == "getSystemStats":
            return tool_system_stats()
        # Notes
        elif name == "storeNote":
            return tool_store_note(args.get("key", ""), args.get("content", ""), args.get("tags", []))
        elif name == "retrieveNote":
            return tool_retrieve_note(args.get("key", ""), args.get("tag", ""))
        # Finance
        elif name == "getBinancePrice":
            return tool_binance_price(args.get("symbol", "BTCUSDT"))
        elif name == "getBinancePortfolio":
            return tool_binance_portfolio()
        elif name == "executeTrade":
            return tool_binance_trade(args.get("symbol", ""), args.get("side", ""), args.get("quantity", 0), args.get("order_type", "MARKET"))
        # Weather
        elif name == "getWeather":
            return tool_weather(args.get("latitude", 0), args.get("longitude", 0), args.get("city", ""))
        # Email
        elif name == "sendEmail":
            return tool_send_email(args.get("to", ""), args.get("subject", ""), args.get("body", ""),
                                   args.get("smtp_server", ""), args.get("smtp_port", 587),
                                   args.get("smtp_user", ""), args.get("smtp_pass", ""))
        # Image
        elif name == "generateImage":
            return tool_generate_image(args.get("prompt", ""), args.get("size", "1024x1024"))
        # Utilities
        elif name == "generateQRCode":
            return tool_generate_qr(args.get("data", ""))
        elif name == "calculateExpression":
            return tool_calculate(args.get("expression", ""))
        elif name == "encodeBase64":
            return tool_encode_base64(args.get("text", ""))
        elif name == "decodeBase64":
            return tool_decode_base64(args.get("encoded", ""))
        elif name == "jsonPrettify":
            return tool_json_prettify(args.get("text", ""))
        elif name == "compressImage":
            return tool_compress_image(args.get("input_path", ""), args.get("output_path", ""),
                                       args.get("quality", 70), args.get("max_width", 1920))
        # Scheduled tasks
        elif name == "scheduleTask":
            return tool_schedule_task(args.get("name", ""), args.get("schedule", ""), args.get("action", ""), args.get("enabled", True))
        elif name == "listScheduledTasks":
            return tool_list_scheduled_tasks()
        else:
            return f"Unknown tool: {name}"
    except Exception as e:
        logger.error(f"Tool {name} error: {traceback.format_exc()}")
        return f"Tool error: {str(e)}"
