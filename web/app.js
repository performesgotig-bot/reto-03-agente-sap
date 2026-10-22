const cases = [
  { id: "sol-001", vendor: "TecnoSuministros", amount: "$11.400.000" },
  { id: "sol-002", vendor: "Soluciones Digitales del Norte", amount: "$8.500.000" },
  { id: "sol-003", vendor: "Mobiliario Andino", amount: "$74.000.000" },
  { id: "sol-004", vendor: "Cloud Andina", amount: "$25.000.000" },
  { id: "sol-005", vendor: "Papelería Central", amount: "$3.200.000" },
  { id: "sol-006", vendor: "TecnoSuministros", amount: "$5.400.000" },
];

const thread = document.querySelector("#thread");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const thinking = document.querySelector("#thinking");
const sendButton = document.querySelector("#send-button");
const confirmationPanel = document.querySelector("#confirmation-panel");
let sessionId = createSessionId();
let selectedCase = "";
let busy = false;

function createSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderCases() {
  const list = document.querySelector("#case-list");
  list.replaceChildren(...cases.map((item) => {
    const button = document.createElement("button");
    button.className = "case-button";
    button.type = "button";
    button.innerHTML = `<span class="case-id">${item.id}</span><span class="case-total">${item.amount}</span><span class="case-vendor">${item.vendor}</span>`;
    button.addEventListener("click", () => {
      selectedCase = item.id;
      document.querySelector("#active-case").textContent = item.id;
      document.querySelectorAll(".case-button").forEach((entry) => entry.classList.toggle("active", entry === button));
      input.value = `Procesa ${item.id}. Resume las validaciones y prepara la orden, sin crearla si requiere confirmación.`;
      input.focus();
      resizeInput();
    });
    return button;
  }));
}

function addMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "AN" : "PX";
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span>${role === "user" ? "ANALISTA" : "ASISTENTE"}</span><time>AHORA</time>`;
  const text = document.createElement("p");
  text.textContent = content;
  body.append(meta, text);
  article.append(avatar, body);
  thread.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return article;
}

function addToolCall(call) {
  const detail = document.createElement("details");
  detail.className = "tool-call";
  const summary = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = call.tool;
  const resultSummary = document.createElement("span");
  resultSummary.className = "tool-summary";
  resultSummary.textContent = call.summary ?? "Resultado disponible";
  summary.append(name, resultSummary);
  const content = document.createElement("div");
  content.className = "tool-content";
  content.append(makeCodeBlock("ARGUMENTOS", call.arguments), makeCodeBlock("RESULTADO", call.result));
  detail.append(summary, content);
  thread.append(detail);
}

function makeCodeBlock(title, value) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const code = document.createElement("pre");
  code.textContent = JSON.stringify(value, null, 2);
  section.append(heading, code);
  return section;
}

function setBusy(value) {
  busy = value;
  thinking.hidden = !value;
  sendButton.disabled = value;
  input.disabled = value;
}

function setConfirmation(value) {
  confirmationPanel.hidden = !value;
}

async function sendMessage(message) {
  if (busy || !message.trim()) return;
  addMessage("user", message.trim());
  input.value = "";
  resizeInput();
  setBusy(true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: message.trim() }),
    });
    const data = await response.json();
    for (const call of data.toolCalls ?? []) addToolCall(call);
    addMessage("assistant", data.reply ?? data.error ?? "No se recibió una respuesta.");
    setConfirmation(Boolean(data.needsConfirmation));
  } catch (error) {
    addMessage("assistant", `No se pudo conectar con el agente: ${error.message}`);
    setConfirmation(false);
  } finally {
    setBusy(false);
    input.focus();
  }
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});
input.addEventListener("input", resizeInput);
document.querySelector("#confirm-creation").addEventListener("click", () => void sendMessage("Confirmo la creación de la orden."));
document.querySelector("#cancel-confirmation").addEventListener("click", () => void sendMessage("Cancelo la creación."));
document.querySelector("#new-session").addEventListener("click", () => {
  sessionId = createSessionId();
  selectedCase = "";
  document.querySelector("#active-case").textContent = "Sin solicitud seleccionada";
  document.querySelectorAll(".case-button").forEach((button) => button.classList.remove("active"));
  thread.replaceChildren();
  addMessage("assistant", "Sesión nueva. Selecciona una solicitud o escribe su identificador.");
  setConfirmation(false);
});

document.querySelector("#service-status").textContent = "Verificando servicio";
fetch("/api/health").then((response) => response.json()).then((health) => {
  document.querySelector("#service-status").textContent = health.provider === "no configurado" ? "LLM sin configurar" : `${health.provider} · ${health.model}`;
}).catch(() => {
  document.querySelector("#service-status").textContent = "Servicio desconectado";
});

renderCases();
