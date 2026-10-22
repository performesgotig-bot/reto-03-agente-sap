const cases = [
  { id: "sol-001", vendor: "TecnoSuministros S.A.S.", amount: 11400000, date: "2026-08-20", terms: "Z030", currency: "COP", center: "CC-1010", subarea: "Infraestructura", tax: "C1", description: "Renovación licencias antivirus corporativo 120 puestos, vigencia 12 meses", quantity: 120, price: 95000 },
  { id: "sol-002", vendor: "Soluciones Digitales del Norte S.A.S.", amount: 8500000, date: "2026-08-22", terms: "Z030", currency: "COP", center: "CC-1010", subarea: "Desarrollo", tax: "C1", description: "Licencia anual herramienta de pruebas automatizadas, 5 usuarios", quantity: 5, price: 1700000 },
  { id: "sol-003", vendor: "Mobiliario Andino S.A.", amount: 74000000, date: "2026-08-24", terms: "Z030", currency: "COP", center: "CC-2020", subarea: "Servicios Generales", tax: "C1", description: "Mobiliario para nueva sede: 40 puestos de trabajo con silla ergonómica", quantity: 40, price: 1850000 },
  { id: "sol-004", vendor: "Cloud Andina S.A.S.", amount: 25000000, date: "2026-08-26", terms: "Z000", currency: "COP", center: "CC-1010", subarea: "Desarrollo", tax: "C1", description: "Bolsa de 100 horas de arquitectura de nube para migración", quantity: 100, price: 250000 },
  { id: "sol-005", vendor: "Papelería Central Ltda.", amount: 3200000, date: "2026-08-27", terms: "Z015", currency: "COP", center: "CC-2020", subarea: "Compras", tax: "C1", description: "Papelería y tóner para el trimestre", quantity: 1, price: 3200000 },
  { id: "sol-006", vendor: "TecnoSuministros S.A.S.", amount: 5400000, date: "2026-08-29", terms: "", currency: "COP", center: "CC-1010", subarea: "Soporte", tax: "", description: "Diademas con micrófono para la mesa de soporte", quantity: 30, price: 180000 },
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
    button.innerHTML = `<span class="case-id">${item.id}</span><span class="case-total">${formatAmount(item.amount)}</span><span class="case-vendor">${item.vendor}</span>`;
    button.addEventListener("click", () => {
      selectedCase = item.id;
      document.querySelector("#active-case").textContent = item.id;
      document.querySelector("#conversation-case").textContent = item.id;
      document.querySelector("#preview-vendor").value = item.vendor;
      document.querySelector("#preview-date").value = item.date.split("-").reverse().join(".");
      document.querySelector("#preview-terms").value = item.terms;
      document.querySelector("#preview-currency").value = item.currency;
      document.querySelector("#preview-request").value = item.id.toUpperCase().replace("SOL", "SOL-2026");
      document.querySelector("#preview-center").value = item.center;
      document.querySelector("#preview-subarea").value = item.subarea;
      document.querySelector("#preview-tax").value = item.tax;
      document.querySelector("#preview-total").textContent = `Total: ${formatAmount(item.amount)} ${item.currency}`;
      renderItemPreview(item);
      document.querySelectorAll(".case-button").forEach((entry) => entry.classList.toggle("active", entry === button));
      input.value = `Procesa ${item.id}. Resume las validaciones y prepara la orden, sin crearla si requiere confirmación.`;
      input.focus();
      resizeInput();
    });
    return button;
  }));
}

function formatAmount(value) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);
}

function renderItemPreview(item) {
  const row = document.createElement("tr");
  const values = ["10", "", item.description, String(item.quantity), "UN", formatAmount(item.price), item.currency, item.center.slice(-4), item.tax];
  for (const [index, value] of values.entries()) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (index === 2) cell.className = "description-cell";
    row.append(cell);
  }
  document.querySelector("#preview-items").replaceChildren(row);
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
