import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Vigil SIEM instrumentation middleware
// Runs on the Edge — no Node.js APIs. Fire-and-forget only.
// Mirrors the field schema of collector_weblog.go so existing Sigma rules fire.
// ---------------------------------------------------------------------------

const SCANNER_UAS = [
  "sqlmap", "nikto", "nmap", "masscan", "gobuster", "dirbuster",
  "nuclei", "wfuzz", "ffuf", "burpsuite", "burp suite", "acunetix",
  "nessus", "openvas", "zgrab", "libwww-perl", "lwp-trivial",
  "python-requests", "scrapy", "mechanize", "httpclient",
];

const BOT_UAS = [
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "facebookexternalhit", "twitterbot", "linkedinbot",
  "ahrefsbot", "semrushbot", "mj12bot", "dotbot",
];

const ADMIN_PREFIXES = [
  "/admin", "/wp-admin", "/administrator", "/phpmyadmin", "/pma",
  "/manage", "/management", "/dashboard", "/console", "/cpanel",
  "/webmin", "/plesk",
];

const SENSITIVE_SUBSTRINGS = [
  "/.env", "/.git", "/.ssh", "/backup", "/wp-config",
  "/config", "/credentials", "/secrets", "/private",
  "/etc/passwd", "/proc/", "/server-status", "/server-info",
  "/.htaccess", "/.htpasswd", "/web.config", "/appsettings",
];

const SQL_PATTERN =
  /(\bselect\b|\bunion\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bexec\b|--|'.*;|xp_|\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+)/i;

const TRAVERSAL_TOKENS = ["../", "..\\", "%2e%2e", "%2f..", "..%2f", "..%5c"];

function classifyUA(ua: string): string {
  const lower = ua.toLowerCase();
  if (!lower) return "unknown";
  if (SCANNER_UAS.some((s) => lower.includes(s))) return "scanner";
  if (BOT_UAS.some((b) => lower.includes(b))) return "bot";
  if (
    lower.includes("mozilla") ||
    lower.includes("webkit") ||
    lower.includes("gecko")
  )
    return "browser";
  return "tool";
}

function hasTraversal(path: string, query: string): boolean {
  const combined = (path + " " + query).toLowerCase();
  return TRAVERSAL_TOKENS.some((t) => combined.includes(t));
}

function hasSQLChars(path: string, query: string): boolean {
  return SQL_PATTERN.test(path + " " + query);
}

function isAdminPath(path: string): boolean {
  const lower = path.toLowerCase();
  return ADMIN_PREFIXES.some((p) => lower.startsWith(p));
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_SUBSTRINGS.some(
    (p) => lower.startsWith(p) || lower.includes(p)
  );
}

function pathDepth(path: string): number {
  return path.replace(/\/$/, "").split("/").length - 1;
}

function pathExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot + 1).toLowerCase() : "";
}

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;
  const query = url.search.slice(1);
  const ua = request.headers.get("user-agent") ?? "";

  // x-forwarded-for may be a comma-separated list; take first (client) IP.
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "";

  const event = {
    source: "web:vigilsec.io",
    timestamp: new Date().toISOString(),
    event: {
      // channel MUST be "web" — Sigma rules use this for routing
      channel: "web",
      app_name: "vigilsec.io",
      log_format: "middleware",
      method: request.method,
      path,
      query,
      request_line: `${request.method} ${url.pathname}${url.search}`,
      client_ip: clientIp,
      user_agent: ua,
      ua_category: classifyUA(ua),
      referer: request.headers.get("referer") ?? "",
      host: request.headers.get("host") ?? "",
      protocol: "HTTP/1.1",
      // Status code is not available pre-response in Edge middleware.
      // The Sigma rules that need status_code can be handled via log drains.
      status_code: 0,
      status_class: "unknown",
      bytes_sent: 0,
      path_depth: pathDepth(path),
      extension: pathExtension(path),
      has_traversal: hasTraversal(path, query),
      has_sql_chars: hasSQLChars(path, query),
      is_admin_path: isAdminPath(path),
      is_sensitive_path: isSensitivePath(path),
      is_error: false,
    },
  };

  const apiUrl = process.env.VIGIL_API_URL;
  const apiKey = process.env.VIGIL_API_KEY;

  if (apiUrl) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["X-Vigil-Key"] = apiKey;

    // Fire and forget. SIEM instrumentation must NEVER block or error the response.
    fetch(`${apiUrl}/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    }).catch(() => {});
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files, images, and font/media assets.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2?|webp|css|js\\.map|txt|xml)).*)",
  ],
};
