import { $, api, button, element, icon, MailError } from "./ui.js";

const form = $("compose-form");
const fileInput = $("files");
const leave = $("leave-compose");
let composer;

function senders(mailboxes) {
  return mailboxes.flatMap((box) => (box.permission === "read_only" ? [] : (box.senderAddresses ?? [])
    .map((email) => ({ mailboxId: box.id, email }))));
}

export function availableSenders(mailboxes) {
  return senders(mailboxes).length > 0;
}

export function openComposer(mailboxes, preferred, reply, onClose) {
  const identities = senders(mailboxes);
  if (!identities.length) return false;
  form.reset();
  $("compose-error").hidden = true;
  $("sender").replaceChildren(...identities.map(({ email }, index) => new Option(email, String(index))));
  const defaultIndex = identities.findIndex(({ mailboxId, email }) =>
    mailboxId === (reply?.mailboxId ?? preferred) && (!reply?.toAddr || reply.toAddr.toLowerCase().includes(email.toLowerCase())));
  const mailboxIndex = identities.findIndex(({ mailboxId }) => mailboxId === (reply?.mailboxId ?? preferred));
  $("sender").selectedIndex = defaultIndex >= 0 ? defaultIndex : Math.max(0, mailboxIndex);
  $("compose-title").textContent = reply ? "Responder" : "Nova mensagem";
  if (reply) {
    $("recipient").value = reply.replyTo || reply.fromAddr;
    const subject = reply.subject || "(Sem assunto)";
    $("subject").value = /^re:/i.test(subject) ? subject : "Re: " + subject;
  }
  composer = { identities, reply, onClose, files: [], savedId: null, busy: false, dirty: false };
  renderFiles();
  $("compose").hidden = false;
  $("compose-title").setAttribute("tabindex", "-1");
  $("compose-title").focus();
  return true;
}

export function closeComposer() {
  if (!composer || composer.busy) return;
  if (composer.dirty) leave.showModal();
  else finish();
}

function finish(notice) {
  leave.close();
  $("compose").hidden = true;
  form.reset();
  const onClose = composer.onClose;
  composer = undefined;
  renderFiles();
  onClose(notice);
}

function renderFiles() {
  $("files-list").replaceChildren(...(composer?.files ?? []).map((file, index) => {
    const item = element("li", "file-item");
    const remove = button("Remover " + file.name, "icon-button", "close", () => {
      composer.files.splice(index, 1);
      renderFiles();
    });
    remove.disabled = composer.busy;
    item.append(icon("clip"), element("span", null, file.name), remove);
    return item;
  }));
}

function fields() {
  const identity = composer.identities[$("sender").selectedIndex];
  const reply = composer.reply;
  const parent = reply?.providerMessageId?.trim().replace(/^<|>$/g, "");
  const chain = (reply?.references || "").split(/\s+/).map((id) => id.replace(/^<|>$/g, "")).filter(Boolean);
  if (parent && !chain.includes(parent)) chain.push(parent);
  return {
    mailboxId: identity.mailboxId,
    from: identity.email,
    to: $("recipient").value.trim(),
    subject: $("subject").value.trim(),
    text: $("body").value,
    ...(parent && { inReplyTo: parent }),
    ...(chain.length && { references: chain.join(" ") }),
    ...((reply?.threadId || parent) && { threadId: reply?.threadId || parent }),
  };
}

function fileForm(values = {}) {
  const submission = new FormData();
  for (const [key, value] of Object.entries(values)) submission.set(key, value);
  for (const file of composer.files) submission.append("attachments", file);
  return submission;
}

function report(message) {
  const error = $("compose-error");
  error.textContent = message;
  error.hidden = false;
  error.scrollIntoView({ block: "nearest" });
}

function setBusy(busy) {
  composer.busy = busy;
  for (const control of document.querySelectorAll("#compose button, #compose input, #compose select, #compose textarea")) {
    control.disabled = busy;
  }
}

async function submit(event) {
  event.preventDefault();
  if (!composer || composer.busy) return;
  $("compose-error").hidden = true;
  const values = fields();
  if (!values.to || !values.subject || !values.text.trim()) {
    report("Preencha o destinatário, o assunto e a mensagem.");
    return;
  }
  const draft = composer.savedId;
  const payload = fileForm({ ...values, ...(draft && { draftId: draft }) });
  setBusy(true);
  try {
    await api("send", { method: "POST", body: payload, allowExpired: true, timeout: 75_000 });
  } catch (error) {
    setBusy(false);
    if (error.status === 401) report("Sua sessão expirou. Copie o texto antes de entrar novamente.");
    else if (!(error instanceof MailError) || error.status >= 500) report("Envio sem confirmação. Confira a pasta Enviados antes de tentar novamente.");
    else if (error.status === 413) report("Os arquivos excedem o limite de tamanho permitido.");
    else report("Não foi possível enviar. Confira os destinatários, a caixa de envio e os anexos.");
    return;
  }
  if (draft) void api("drafts/" + encodeURIComponent(draft), { method: "DELETE", allowExpired: true }).catch(() => {});
  setBusy(false);
  finish("Mensagem enviada.");
}

async function save() {
  if (!composer || composer.busy) return;
  leave.close();
  $("compose-error").hidden = true;
  const values = fields();
  if (!values.to && !values.subject && !values.text.trim() && !composer.files.length) {
    report("Escreva algo antes de salvar o rascunho.");
    return;
  }
  setBusy(true);
  try {
    const id = composer.savedId;
    const endpoint = id ? "drafts/" + encodeURIComponent(id) : "drafts";
    const { draft } = await api(endpoint, { method: id ? "PATCH" : "POST", json: values, allowExpired: true });
    composer.savedId = draft.id;
    if (composer.files.length) {
      await api("drafts/" + encodeURIComponent(draft.id) + "/attachments", {
        method: "POST", body: fileForm(), allowExpired: true, timeout: 75_000,
      });
    }
    setBusy(false);
    finish("Rascunho salvo.");
  } catch (error) {
    setBusy(false);
    if (error.status === 401) report("Sua sessão expirou. Copie o texto antes de entrar novamente.");
    else if (composer.savedId) report("O texto foi salvo, mas os anexos ainda precisam ser adicionados ao rascunho.");
    else report("Não foi possível salvar o rascunho. Verifique sua conexão.");
  }
}

form.addEventListener("input", () => { if (composer) composer.dirty = true; });
form.addEventListener("submit", submit);
$("pick-files").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (!composer) return;
  composer.files.push(...Array.from(fileInput.files));
  composer.dirty = true;
  fileInput.value = "";
  renderFiles();
});
$("save-draft").addEventListener("click", save);
$("confirm-save").addEventListener("click", save);
$("discard").addEventListener("click", () => finish());
