export const $ = (id) => document.getElementById(id);

export function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}

export function icon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const use = document.createElementNS(namespace, "use");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#" + name);
  svg.append(use);
  return svg;
}

export function button(label, className, glyph, action) {
  const node = element("button", className);
  node.type = "button";
  if (glyph) node.append(icon(glyph));
  if (className.includes("icon-button")) {
    node.setAttribute("aria-label", label);
    node.title = label;
  } else {
    node.append(document.createTextNode(label));
  }
  node.addEventListener("click", action);
  return node;
}

export function link(label, className, glyph, path) {
  const node = element("a", className);
  node.href = path;
  if (glyph) node.append(icon(glyph));
  node.append(document.createTextNode(label));
  return node;
}

export function initials(label = "") {
  const words = label.trim().split(/[\s@.]+/);
  return words.slice(0, 2).map((word) => Array.from(word)[0] || "").join("").toLocaleUpperCase("pt-BR") || "V";
}

export function avatar(label) {
  const node = element("span", "avatar sender-avatar", initials(label));
  node.dataset.tone = String(Array.from(label).reduce((sum, char) => sum + char.codePointAt(0), 0) % 5);
  node.setAttribute("aria-hidden", "true");
  return node;
}

export function when(value, full = false) {
  const date = new Date(value ?? NaN);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  const today = date.toDateString() === now.toDateString();
  const options = full
    ? { dateStyle: "medium", timeStyle: "short" }
    : today ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }) };
  return new Intl.DateTimeFormat("pt-BR", options).format(date);
}

export class MailError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", json, body, signal, allowExpired = false, timeout = 35_000 } = {}) {
  const headers = { "X-Time-Zone": Intl.DateTimeFormat().resolvedOptions().timeZone };
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers["Content-Type"] = "application/json";
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeout);
  try {
    const response = await fetch("/api/" + path, {
      method, body, headers, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (response.status === 401) {
      if (!allowExpired) {
        localStorage.removeItem("mailflare-session-token");
        location.replace("/login");
      }
      throw new MailError("Sua sessão expirou.", 401);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new MailError("O Vercuno Mail não pôde concluir a solicitação.", response.status);
    if (!result) throw new MailError("O Vercuno Mail retornou uma resposta inesperada.", response.status);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
