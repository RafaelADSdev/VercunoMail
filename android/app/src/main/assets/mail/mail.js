import { $, api, avatar, button, element, icon, initials, link, when } from "./ui.js";
import { availableSenders, closeComposer, openComposer } from "./compose.js";

const folders = [
  { label: "Caixa de entrada", glyph: "inbox", params: { status: "received", direction: "inbound" }, filter: true },
  { label: "Com estrela", glyph: "star", params: { starred: "true" } },
  { label: "Enviados", glyph: "send", params: { status: "sent" } },
  { label: "Rascunhos", glyph: "draft", params: { status: "draft" } },
  { label: "Arquivados", glyph: "archive", params: { status: "archived" } },
  { label: "Spam", glyph: "spam", params: { status: "spam" } },
  { label: "Lixeira", glyph: "trash", params: { status: "trash" } },
];
const inbox = folders[0];
const state = {
  folder: inbox, query: "", unread: false, mailboxId: "", mailboxes: [], customFolders: [],
  limit: 35, offset: 0, request: null, detailRequest: null, toastTimer: 0, fresh: false,
};

const displayName = (header) => (header || "").split("<")[0].replace(/^"|"$/g, "").trim() || "Remetente";
const webMessage = (message) => {
  const route = ["sent", "archived", "trash", "spam"].includes(message.status) ? message.status : "inbox";
  return "/" + route + "/" + encodeURIComponent(message.id);
};

function toast(message) {
  const status = $("toast");
  clearTimeout(state.toastTimer);
  status.textContent = message;
  status.hidden = false;
  state.toastTimer = setTimeout(() => { status.hidden = true; }, 4_000);
}

async function boot() {
  $("startup-retry").hidden = true;
  $("startup-status").textContent = "Conectando à sua caixa de e-mail…";
  try {
    const { user } = await api("auth/me");
    const { mailboxes } = await api("mailboxes");
    state.mailboxes = mailboxes;
    const name = user.name || user.email;
    $("account").textContent = initials(name);
    $("profile-avatar").textContent = initials(name);
    $("profile-name").textContent = name;
    $("profile-email").textContent = user.email;
    $("compose-button").hidden = !availableSenders(mailboxes);
    $("mailbox-field").hidden = mailboxes.length <= 1;
    $("mailbox").replaceChildren(new Option("Todas as caixas", ""), ...mailboxes.map((box) =>
      new Option(box.senderAddresses?.[0] || box.displayName || box.localPart, box.id)));
    await loadCustomFolders();
    $("startup").hidden = true;
    $("mail").hidden = false;
    void loadList();
  } catch (error) {
    if (error.status === 401) return;
    $("startup-status").textContent = "Não foi possível conectar. Verifique a internet e tente novamente.";
    $("startup-retry").hidden = false;
  }
}

async function loadCustomFolders() {
  const mailboxes = state.mailboxId ? state.mailboxes.filter((box) => box.id === state.mailboxId) : state.mailboxes;
  const result = await Promise.allSettled(mailboxes.map(async (box) => {
    const data = await api("folders?mailboxId=" + encodeURIComponent(box.id));
    return data.folders.map((folder) => ({
      label: folder.name, glyph: "folder", params: { folderId: folder.id, status: "received", mailboxId: box.id },
    }));
  }));
  state.customFolders = result.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  renderFolders();
}

function renderFolders() {
  $("folder-nav").replaceChildren(...[...folders, ...state.customFolders].map((folder) => {
    const row = button(folder.label, "nav-row", folder.glyph, () => selectFolder(folder));
    if (folder === state.folder && !state.query) row.setAttribute("aria-current", "page");
    return row;
  }));
}

function selectFolder(folder) {
  state.folder = folder;
  state.query = "";
  state.unread = false;
  $("query").value = "";
  $("folders").close();
  void loadList();
}

function listStatus(title, description, glyph, retry = false) {
  $("empty-title").textContent = title;
  $("empty-description").textContent = description;
  $("empty-icon").replaceChildren(icon(glyph));
  $("list-retry").hidden = !retry;
  $("list-state").hidden = false;
}

async function loadList(more = false) {
  state.request?.abort();
  const controller = new AbortController();
  state.request = controller;
  const list = $("list");
  const previousOffset = state.offset;
  const offset = more ? previousOffset : 0;
  const scope = state.query ? { q: state.query } : state.folder.params;
  const params = new URLSearchParams({
    ...(state.mailboxId && { mailboxId: state.mailboxId }), ...scope,
    limit: String(state.limit), offset: String(offset),
    ...(state.unread && { read: "unread" }),
  });
  list.setAttribute("aria-busy", "true");
  $("folder-title").textContent = state.query ? "Resultados da busca" : state.folder.label;
  $("clear-search").hidden = !state.query && !$("query").value;
  $("filters").hidden = !state.folder.filter || Boolean(state.query);
  for (const filter of $("filters").children) {
    filter.setAttribute("aria-pressed", String((filter.dataset.filter === "unread") === state.unread));
  }
  $("load-more").hidden = true;
  $("list-state").hidden = true;
  if (!more) {
    $("list-scroll").scrollTop = 0;
    list.replaceChildren(...Array.from({ length: 5 }, () => {
      const item = element("li", "skeleton");
      item.setAttribute("aria-hidden", "true");
      return item;
    }));
  }
  try {
    const { messages, total } = await api("messages?" + params, { signal: controller.signal });
    if (state.request !== controller) return;
    if (!more) list.replaceChildren();
    list.append(...messages.map(messageRow));
    state.offset = offset + messages.length;
    $("load-more").hidden = !messages.length || state.offset >= total;
    if (!state.offset) {
      if (state.query) listStatus("Nenhuma mensagem encontrada", "Tente buscar outro nome, endereço ou assunto.", "search");
      else if (state.unread) listStatus("Tudo lido por aqui", "Novas mensagens aparecerão nesta lista.", "inbox");
      else listStatus("Nenhuma mensagem", "Esta pasta está vazia.", state.folder.glyph);
    }
    state.fresh = true;
  } catch (error) {
    if (state.request !== controller || error.status === 401) return;
    if (!more) list.replaceChildren();
    listStatus("Falha ao carregar", "Verifique sua conexão e tente novamente.", "refresh", true);
  } finally {
    if (state.request === controller) list.removeAttribute("aria-busy");
  }
}

function messageRow(message) {
  const unread = !message.read && message.direction !== "outbound";
  const item = element("li", unread ? "email-row unread" : "email-row");
  const outgoing = message.direction === "outbound";
  const party = outgoing ? message.toContactName || displayName(message.toAddr) : message.fromContactName || displayName(message.fromAddr);
  const title = message.subject || "(Sem assunto)";
  const open = button("", "message-button", null, () => {
    if (message.status === "draft") location.assign("/drafts/" + encodeURIComponent(message.id));
    else void showMessage(message);
  });
  open.setAttribute("aria-label", (unread ? "Não lida. " : "") + party + ", " + title);
  const first = element("span", "from-line");
  first.append(element("span", "from", outgoing ? "Para " + party : party), element("time", "message-date", when(message.createdAt)));
  const lines = element("span", "message-lines");
  lines.append(first, element("span", "subject", title), element("span", "snippet", message.snippet || ""));
  open.append(avatar(party), lines);
  item.append(open, starButton(message, "row-star"));
  return item;
}

function starButton(message, extraClass = "") {
  const label = () => message.starred ? "Remover estrela" : "Marcar com estrela";
  const star = button(label(), "icon-button star-button " + extraClass, "star", async () => {
    star.disabled = true;
    try {
      const result = await api("messages/" + encodeURIComponent(message.id) + "/star", { method: "POST" });
      message.starred = result.starred;
      star.setAttribute("aria-pressed", String(message.starred));
      star.setAttribute("aria-label", label());
      star.title = label();
      if (state.folder.glyph === "star" && !message.starred && !$("mail").hidden) void loadList();
    } catch {
      toast("Não foi possível alterar a estrela.");
    } finally {
      star.disabled = false;
    }
  });
  star.setAttribute("aria-pressed", String(Boolean(message.starred)));
  return star;
}

async function showMessage(row) {
  $("mail").hidden = true;
  $("detail").hidden = false;
  $("message-actions").replaceChildren();
  $("message-content").replaceChildren(element("p", "hero-state", "Abrindo mensagem…"));
  state.detailRequest?.abort();
  const controller = new AbortController();
  state.detailRequest = controller;
  const path = "messages/" + encodeURIComponent(row.id);
  try {
    const data = await api(path, { signal: controller.signal });
    if (state.detailRequest !== controller) return;
    renderMessage(data);
    if (!data.message.read && data.message.direction !== "outbound") {
      void api(path + "/read", { method: "POST" }).catch(() => {});
    }
  } catch (error) {
    if (state.detailRequest !== controller || error.status === 401) return;
    const retry = element("section", "hero-state");
    retry.append(element("p", null, "Não foi possível abrir a mensagem."),
      button("Tentar novamente", "secondary", null, () => void showMessage(row)));
    $("message-content").replaceChildren(retry);
  }
}

function renderMessage({ message, body, attachments = [] }) {
  const content = $("message-content");
  const title = element("h1", null, message.subject || "(Sem assunto)");
  title.tabIndex = -1;
  const sender = message.fromContactName || displayName(message.fromAddr);
  const reader = element("article", "reader-card");
  const who = element("div", "reader-name");
  const address = element("div");
  address.append(element("strong", null, sender), element("p", "reader-address", message.fromAddr));
  who.append(avatar(sender), address);
  reader.append(who, element("p", "reader-time", when(message.createdAt, true)));
  reader.append(element("p", "reader-address", "Para " + message.toAddr));
  if (body?.textBody) reader.append(element("div", "email-text", body.textBody));
  else if (body?.htmlBody) {
    reader.append(element("p", "email-text", "Esta mensagem está em formato HTML. Abra a mensagem completa para ver o conteúdo."));
  } else reader.append(element("p", "email-text", "Mensagem sem texto."));

  if (attachments.length) {
    const files = element("ul", "files-list");
    for (const file of attachments) files.append(attachmentRow(message, file));
    reader.append(files);
  }
  const tools = element("div", "detail-tools");
  const canReply = message.direction === "inbound" && availableSenders(state.mailboxes.filter((box) => box.id === message.mailboxId));
  if (canReply) tools.append(button("Responder", "primary", "reply", () => launchComposer(message)));
  tools.append(link("Abrir no webmail", "secondary", "external", webMessage(message)));
  reader.append(tools);
  content.replaceChildren(title, reader);
  content.scrollTop = 0;
  title.focus({ preventScroll: true });

  const actions = $("message-actions");
  actions.append(starButton(message));
  if (message.status !== "archived" && message.status !== "trash" && message.status !== "spam") {
    actions.append(button("Arquivar", "icon-button", "archive", (event) => moveMessage(event.currentTarget, message, "archive")));
  }
  if (message.status !== "trash") {
    actions.append(button("Mover para a lixeira", "icon-button", "trash", (event) => moveMessage(event.currentTarget, message, "trash")));
  }
}

function attachmentRow(message, file) {
  const row = element("li", "file-item");
  const path = "/api/messages/" + encodeURIComponent(message.id) + "/attachments/" + encodeURIComponent(file.id);
  const download = button("Salvar " + file.filename, "icon-button", "download", async () => {
    download.disabled = true;
    try {
      const risk = await api(path.slice(5) + "?risk=1");
      if (risk.level === "ok") location.assign(path + "?download=1");
      else {
        toast("Abra a mensagem no webmail para revisar o aviso do anexo.");
        $("message-content").querySelector(".detail-tools a")?.focus();
      }
    } catch {
      toast("Não foi possível verificar este anexo.");
    } finally {
      download.disabled = false;
    }
  });
  row.append(icon("clip"), element("span", null, file.filename), download);
  return row;
}

async function moveMessage(control, message, action) {
  const tools = $("message-actions");
  for (const child of tools.children) child.disabled = true;
  try {
    await api("messages/bulk", { method: "POST", json: { messageIds: [message.id], action } });
    if (!$("detail").hidden) closeDetail();
    else void loadList();
    toast(action === "archive" ? "Mensagem arquivada." : "Mensagem movida para a lixeira.");
  } catch {
    toast("Não foi possível mover a mensagem.");
    for (const child of tools.children) child.disabled = false;
    control.focus();
  }
}

function closeDetail() {
  state.detailRequest?.abort();
  state.detailRequest = null;
  $("detail").hidden = true;
  $("mail").hidden = false;
  $("folder-title").focus();
  void loadList();
}

function launchComposer(reply) {
  const restore = reply ? $("detail") : $("mail");
  restore.hidden = true;
  if (!openComposer(state.mailboxes, state.mailboxId, reply, (notice) => {
    restore.hidden = false;
    if (notice) {
      toast(notice);
      if (!reply) void loadList();
    }
  })) restore.hidden = false;
}

window.mailBack = () => {
  const dialog = document.querySelector("dialog[open]");
  if (dialog) dialog.close();
  else if (!$("compose").hidden) closeComposer();
  else if (!$("detail").hidden) closeDetail();
  else if (state.query || state.folder !== inbox || state.unread) selectFolder(inbox);
  else return false;
  return true;
};

$("startup-retry").addEventListener("click", boot);
$("menu-button").addEventListener("click", () => {
  renderFolders();
  $("folders").showModal();
});
$("mailbox").addEventListener("change", async (event) => {
  state.mailboxId = event.target.value;
  selectFolder(inbox);
  await loadCustomFolders();
});
$("account").addEventListener("click", () => $("profile").showModal());
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = $("query").value.trim();
  state.unread = false;
  $("query").blur();
  void loadList();
});
$("query").addEventListener("input", () => { $("clear-search").hidden = !state.query && !$("query").value; });
$("clear-search").addEventListener("click", () => selectFolder(state.folder));
for (const filter of $("filters").children) filter.addEventListener("click", () => {
  state.unread = filter.dataset.filter === "unread";
  void loadList();
});
$("refresh-button").addEventListener("click", () => void loadList());
$("list-retry").addEventListener("click", () => void loadList());
$("load-more").addEventListener("click", () => void loadList(true));
$("compose-button").addEventListener("click", () => launchComposer());
for (const node of document.querySelectorAll("[data-back]")) node.addEventListener("click", window.mailBack);
for (const node of document.querySelectorAll("[data-close]")) node.addEventListener("click", () => node.closest("dialog").close());
for (const dialog of [$("folders"), $("profile")]) dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const { left, right, top, bottom } = dialog.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
});
$("logout").addEventListener("click", async () => {
  $("logout").disabled = true;
  try {
    const result = await api("auth/logout", { method: "POST" });
    if (result.token) {
      localStorage.setItem("mailflare-session-token", result.token);
      location.reload();
    } else {
      localStorage.removeItem("mailflare-session-token");
      location.replace("/login");
    }
  } catch {
    toast("Não foi possível sair da conta. Tente novamente.");
    $("logout").disabled = false;
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && state.fresh) location.reload();
});
void boot();
