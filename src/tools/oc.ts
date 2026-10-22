import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { getOutputDirectory } from "../runtime/storage.js";
import { SapMockAdapter } from "../sap/mock.js";
import type { OrdenCompra } from "../sap/adapter.js";

const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().finite(),
  valor_unitario: z.number().finite(),
  valor_total: z.number().finite(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().min(1),
});

const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: z.object({
    proveedor: z.string(),
    nit: z.string().nullable(),
    total: z.number().finite(),
    moneda: z.string(),
    validez_hasta: z.string().nullable(),
    texto: z.string(),
  }).nullable(),
  aprobacion: z.object({
    de: z.string(),
    fecha: z.string(),
    aprobado: z.boolean(),
    texto: z.string(),
    para: z.string().optional(),
    asunto: z.string().optional(),
  }).nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), total: z.number().finite() }).nullable(),
  faltantes: z.array(z.string()).default([]),
});

const OrdenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z.array(z.object({
    numero: z.number().int().positive(),
    descripcion: z.string().max(40),
    cantidad: z.number().positive(),
    unidad: z.enum(["UN", "H", "MES"]),
    precio_unitario: z.number().nonnegative(),
    centro_costo: z.string(),
    subarea: z.string(),
    indicador_iva: z.string(),
  })).min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});

export type Solicitud = z.infer<typeof SolicitudSchema>;
export type Paquete = z.infer<typeof PaqueteSchema>;
export type Validacion = {
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, string>;
  retroactiva: boolean;
};

type Contexto = { directory: string; sessionId: string };
type MaestroProveedor = {
  codigo_sap: string;
  nit: string;
  nombre: string;
  condiciones_pago_default: string;
  indicador_iva_default: string;
  activo: boolean;
};
type CentroCosto = {
  centro_costo: string;
  subareas: string[];
  aprobadores: Array<{ email: string; tope: number }>;
};

function ok<T>(data: T): string {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown): string {
  return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

function safeCase(caso: string): void {
  if (!/^sol-\d{3}$/i.test(caso)) throw new Error("El caso debe tener formato sol-001.");
}

async function locateFixtures(directory: string): Promise<{ cases: string; masters: string }> {
  const candidates = [
    { cases: path.join(directory, "fixtures", "reto-03", "solicitudes"), masters: path.join(directory, "fixtures", "reto-03", "maestros") },
    { cases: path.join(directory, "solicitudes"), masters: path.join(directory, "maestros") },
  ];
  for (const candidate of candidates) {
    try {
      await readFile(path.join(candidate.masters, "proveedores.json"), "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No se encontraron los fixtures. Se esperaba fixtures/reto-03/{solicitudes,maestros} o las carpetas solicitudes/ y maestros/ en la raíz.");
}

async function readJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo leer ${path.basename(file)}: ${detail}`);
  }
}

function parseMoney(text: string | undefined): number | null {
  if (!text) return null;
  const normalized = text.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTotal(text: string): number | null {
  const match = text.match(/TOTAL(?:\s*\([^)]*\))?\s*:\s*(?:COP|USD)?\s*([\d.,]+)/i);
  return match ? parseMoney(match[1]) : null;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function normalizeNit(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

async function readPackage(directory: string, caso: string): Promise<Paquete> {
  safeCase(caso);
  const fixtures = await locateFixtures(directory);
  const caseDirectory = path.join(fixtures.cases, caso.toLowerCase());
  const missing: string[] = [];

  const readOptionalJson = async <T>(name: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path.join(caseDirectory, name), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push(name);
        return null;
      }
      throw new Error(`${name} no contiene JSON valido.`);
    }
  };
  const readOptionalText = async (name: string): Promise<string | null> => {
    try {
      return await readFile(path.join(caseDirectory, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push(name);
        return null;
      }
      throw error;
    }
  };

  const correoRaw = await readOptionalJson<{ id?: string; de?: string; asunto?: string; fecha?: string }>("correo.json");
  const solicitudRaw = await readOptionalJson<unknown>("solicitud.json");
  const aprobacionRaw = await readOptionalJson<{ de?: string; para?: string; fecha?: string; asunto?: string; cuerpo?: string }>("aprobacion.json");
  const cotizacionText = await readOptionalText("cotizacion.txt");
  const facturaText = await readOptionalText("factura.txt");
  if (!correoRaw || !solicitudRaw) throw new Error(`Paquete incompleto: ${missing.filter((name) => ["correo.json", "solicitud.json"].includes(name)).join(" y ") || "correo.json o solicitud.json"}.`);

  const solicitud = SolicitudSchema.safeParse(solicitudRaw);
  if (!solicitud.success) throw new Error(`solicitud.json inválido: ${solicitud.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  const correo = {
    id: correoRaw.id ?? "sin-id",
    de: correoRaw.de ?? "",
    asunto: correoRaw.asunto ?? "",
    fecha: correoRaw.fecha ?? "",
  };
  const cotizacionTotal = cotizacionText ? extractTotal(cotizacionText) : null;
  const cotizacion = cotizacionText
    ? {
        proveedor: cotizacionText.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? solicitud.data.proveedor_nombre,
        nit: cotizacionText.match(/NIT:\s*([\d.\-]+)/i)?.[1] ?? solicitud.data.proveedor_nit ?? null,
        total: cotizacionTotal ?? Number.NaN,
        moneda: cotizacionText.match(/TOTAL[^\n]*\b(COP|USD)\b/i)?.[1] ?? solicitud.data.moneda,
        validez_hasta: null,
        texto: cotizacionText,
      }
    : null;
  if (cotizacion && !Number.isFinite(cotizacion.total)) throw new Error("No se pudo leer un total numérico de cotizacion.txt.");

  const aprobacion = aprobacionRaw
    ? {
        de: aprobacionRaw.de ?? "",
        fecha: aprobacionRaw.fecha ?? "",
        aprobado: /\baprobado\b/i.test(aprobacionRaw.cuerpo ?? ""),
        texto: aprobacionRaw.cuerpo ?? "",
        para: aprobacionRaw.para,
        asunto: aprobacionRaw.asunto,
      }
    : null;
  let factura: Paquete["factura"] = null;
  if (facturaText) {
    const invoiceNumber = facturaText.match(/(?:No\.|número|numero)\s*([A-Z0-9-]+)/i)?.[1] ?? "no-identificada";
    const invoiceDate = facturaText.match(/Fecha de emisi[oó]n:\s*([\d-]+)/i)?.[1];
    const invoiceTotal = extractTotal(facturaText);
    if (!invoiceDate || invoiceTotal === null) throw new Error("factura.txt debe incluir fecha de emisión y total numérico.");
    factura = { numero: invoiceNumber, fecha: invoiceDate, total: invoiceTotal };
  }

  return PaqueteSchema.parse({ correo, solicitud: solicitud.data, cotizacion, aprobacion, factura, faltantes: missing });
}

async function loadMasters(directory: string): Promise<{ providers: MaestroProveedor[]; centers: CentroCosto[] }> {
  const fixtures = await locateFixtures(directory);
  const [providers, centers] = await Promise.all([
    readJson<MaestroProveedor[]>(path.join(fixtures.masters, "proveedores.json")),
    readJson<CentroCosto[]>(path.join(fixtures.masters, "centros-costo.json")),
  ]);
  return { providers, centers };
}

async function validatePackage(directory: string, paquete: Paquete): Promise<Validacion> {
  const { providers, centers } = await loadMasters(directory);
  const solicitud = paquete.solicitud;
  const bloqueos: string[] = [];
  const confirmaciones: string[] = [];
  const derivados: Record<string, string> = {};
  let retroactiva = false;
  const provider = providers.find((item) => {
    if (normalizeNit(solicitud.proveedor_nit) !== "") {
      return normalizeNit(item.nit) === normalizeNit(solicitud.proveedor_nit);
    }
    return normalizeText(item.nombre) === normalizeText(solicitud.proveedor_nombre);
  });

  if (!provider || !provider.activo) {
    bloqueos.push(`RC1: El proveedor '${solicitud.proveedor_nombre}' no existe o está inactivo. Solicita el alta o la activación en el maestro.`);
  } else {
    derivados.codigo_sap_proveedor = provider.codigo_sap;
    derivados.proveedor_nit = provider.nit;
    derivados.proveedor_nombre = provider.nombre;
  }

  const center = centers.find((item) => item.centro_costo === solicitud.centro_costo);
  if (!center || !center.subareas.includes(solicitud.subarea)) {
    bloqueos.push(`RC4: La subárea '${solicitud.subarea}' no pertenece al centro de costo '${solicitud.centro_costo}'. Verifica el centro y la subárea con el solicitante.`);
  }

  const approval = paquete.aprobacion;
  const approver = approval && center
    ? center.aprobadores.find((item) => item.email.toLocaleLowerCase() === approval.de.toLocaleLowerCase())
    : undefined;
  if (!approval || !approval.aprobado || !approver) {
    bloqueos.push(`RC2: No se encontró una aprobación válida de un aprobador autorizado para '${solicitud.centro_costo}'. Solicita aprobación al responsable registrado.`);
  } else if (solicitud.valor_total > approver.tope) {
    bloqueos.push(`RC3: El total ${solicitud.valor_total} supera el tope ${approver.tope} del aprobador ${approval.de}. Solicita aprobación de un nivel con mayor autoridad.`);
  }

  if (!Number.isFinite(solicitud.cantidad) || !Number.isFinite(solicitud.valor_unitario) || !Number.isFinite(solicitud.valor_total)) {
    bloqueos.push("RC10: La cantidad y los valores deben ser numéricos.");
  } else if (Math.abs(solicitud.cantidad * solicitud.valor_unitario - solicitud.valor_total) > 1) {
    bloqueos.push("RC10: El total no coincide con cantidad por valor unitario (tolerancia: 1 unidad monetaria). Pide corregir la solicitud.");
  }

  if (!paquete.cotizacion) {
    confirmaciones.push("RC5: No hay cotización adjunta. Confirma que se debe continuar sin ella.");
  } else {
    const difference = solicitud.valor_total === 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(paquete.cotizacion.total - solicitud.valor_total) / Math.abs(solicitud.valor_total);
    if (difference > 0.02) {
      confirmaciones.push(`RC5: La cotización (${paquete.cotizacion.total} ${paquete.cotizacion.moneda}) difiere de la solicitud (${solicitud.valor_total} ${solicitud.moneda}) en ${(difference * 100).toFixed(2)}%. Confirma el valor que debe registrarse; el agente no lo ajustará.`);
    }
  }

  if (!solicitud.indicador_iva) {
    if (provider) {
      derivados.indicador_iva = provider.indicador_iva_default;
      confirmaciones.push(`RC6: Falta indicador de IVA; se propone '${provider.indicador_iva_default}' según el maestro del proveedor. Confirma este valor.`);
    } else {
      bloqueos.push("RC6: Falta el indicador de IVA y no se pudo derivar porque el proveedor no está en el maestro.");
    }
  } else {
    derivados.indicador_iva = solicitud.indicador_iva;
  }

  if (solicitud.condiciones_pago) {
    derivados.condiciones_pago = solicitud.condiciones_pago;
  } else if (provider) {
    derivados.condiciones_pago = provider.condiciones_pago_default;
  }

  if (paquete.factura && new Date(paquete.factura.fecha) < new Date(solicitud.fecha_solicitud)) {
    retroactiva = true;
    confirmaciones.push(`RC8: La factura ${paquete.factura.fecha} es anterior a la solicitud ${solicitud.fecha_solicitud}. La OC se marcará como retroactiva; confirma para continuar.`);
  }

  if (approval && new Date(approval.fecha) < new Date(solicitud.fecha_solicitud)) {
    confirmaciones.push(`RC9: La aprobación (${approval.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}). Confirma que la evidencia corresponde a este gasto.`);
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}

function approvalContent(paquete: Paquete): string {
  const approval = paquete.aprobacion;
  if (!approval) throw new Error("Falta aprobacion.json; no se puede generar evidencia.");
  return [
    `De: ${approval.de}`,
    `Para: ${approval.para ?? ""}`,
    `Fecha: ${approval.fecha}`,
    `Asunto: ${approval.asunto ?? ""}`,
    "",
    approval.texto,
  ].join("\n");
}

function buildOrder(
  paquete: Paquete,
  derivados: Record<string, string>,
  sha256: string,
  confirmaciones: string[] = []
): OrdenCompra {
  const solicitud = paquete.solicitud;
  const approval = paquete.aprobacion;
  if (!approval) throw new Error("Falta la aprobación necesaria para construir el payload.");
  const order: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion ? "cotizacion.txt" : null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: derivados.codigo_sap_proveedor ?? "",
      nit: derivados.proveedor_nit ?? solicitud.proveedor_nit ?? "",
      nombre: derivados.proveedor_nombre ?? solicitud.proveedor_nombre,
    },
    moneda: solicitud.moneda,
    condiciones_pago: derivados.condiciones_pago ?? "",
    aprobador: { email: approval.de, fecha_aprobacion: approval.fecha, evidencia_sha256: sha256 },
    posiciones: [{
      numero: 10,
      descripcion: solicitud.descripcion.slice(0, 40),
      cantidad: solicitud.cantidad,
      unidad: "UN",
      precio_unitario: solicitud.valor_unitario,
      centro_costo: solicitud.centro_costo,
      subarea: solicitud.subarea,
      indicador_iva: derivados.indicador_iva ?? "",
    }],
    excepciones: confirmaciones.map((detalle) => ({
      codigo: detalle.match(/^RC\d+/)?.[0] ?? "CONFIRMACION",
      detalle,
      confirmado_por: null,
    })),
  };
  const parsed = OrdenCompraSchema.safeParse(order);
  if (!parsed.success) throw new Error(`Payload de OC inválido: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return parsed.data;
}

async function appendControl(directory: string, row: {
  solicitudId: string;
  resultado: string;
  numeroOc?: string;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
}): Promise<void> {
  const file = path.join(getOutputDirectory(directory), "control.csv");
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await readFile(file, "utf8");
  } catch {
    await writeFile(file, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n", "utf8");
  }
  const fields = [
    row.solicitudId,
    row.resultado,
    row.numeroOc ?? "",
    String(row.retroactiva),
    JSON.stringify(row.bloqueos),
    JSON.stringify(row.confirmaciones),
    new Date().toISOString(),
  ];
  await appendFile(file, `${fields.map(csvCell).join(",")}\n`, "utf8");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const leer_paquete = {
  description: "Lee y normaliza el correo, la solicitud, la cotización, la aprobación y la factura opcional de un caso.",
  args: { caso: z.string().describe("Carpeta del caso, por ejemplo sol-001") },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    try {
      return ok(await readPackage(ctx.directory, args.caso));
    } catch (error) {
      return fail(error);
    }
  },
};

export const validar = {
  description: "Valida el paquete contra los maestros y las reglas RC1 a RC10, devolviendo bloqueos, confirmaciones y valores derivados.",
  args: {
    caso: z.string().describe("Carpeta del caso, por ejemplo sol-001"),
    paquete: PaqueteSchema.describe("Paquete devuelto por oc_leer_paquete"),
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: Contexto): Promise<string> {
    try {
      safeCase(args.caso);
      PaqueteSchema.parse(args.paquete);
      const canonicalPackage = await readPackage(ctx.directory, args.caso);
      const validation = await validatePackage(ctx.directory, canonicalPackage);
      return ok(validation);
    } catch (error) {
      return fail(error);
    }
  },
};

export const construir_payload = {
  description: "Construye y valida el payload de la OC, y guarda la trazabilidad de cada campo.",
  args: {
    caso: z.string().describe("Carpeta del caso, por ejemplo sol-001"),
    paquete: PaqueteSchema.describe("Paquete devuelto por oc_leer_paquete"),
    derivados: z.record(z.string()).describe("Valores derivados devueltos por oc_validar"),
  },
  async execute(
    args: { caso: string; paquete: Paquete; derivados: Record<string, string> },
    ctx: Contexto
  ): Promise<string> {
    try {
      safeCase(args.caso);
      PaqueteSchema.parse(args.paquete);
      const paquete = await readPackage(ctx.directory, args.caso);
      const validation = await validatePackage(ctx.directory, paquete);
      const derivados = validation.derivados;
      const content = approvalContent(paquete);
      const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
      const payload = buildOrder(paquete, derivados, sha256, validation.confirmaciones);
      const trace = {
        payload,
        fuentes: {
          "referencia.solicitud_id": "solicitud.solicitud_id",
          "referencia.correo_id": "correo.id",
          "referencia.cotizacion_ref": paquete.cotizacion ? "cotizacion.txt" : "derivado",
          sociedad: "derivado: política fija del reto",
          organizacion_compras: "derivado: política fija del reto",
          proveedor: "maestro.proveedores + solicitud",
          moneda: "solicitud.moneda",
          condiciones_pago: derivados.condiciones_pago === paquete.solicitud.condiciones_pago ? "solicitud.condiciones_pago" : "maestro.proveedores",
          aprobador: "aprobacion.json",
          "aprobador.evidencia_sha256": "derivado: SHA-256 de aprobacion.txt",
          posiciones: "solicitud + derivados + maestro.proveedores",
          excepciones: "derivado: confirmaciones RC5-RC9",
        },
      };
      const outputDirectory = path.join(getOutputDirectory(ctx.directory), args.caso.toLowerCase());
      await mkdir(outputDirectory, { recursive: true });
      const tracePath = path.join(outputDirectory, "trazabilidad.json");
      await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
      return ok({ payload, trazabilidad_ruta: tracePath });
    } catch (error) {
      return fail(error);
    }
  },
};

export const generar_evidencia = {
  description: "Genera aprobacion.txt con encabezados y devuelve la ruta y el SHA-256 del contenido.",
  args: { caso: z.string().describe("Carpeta del caso, por ejemplo sol-001") },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    try {
      const paquete = await readPackage(ctx.directory, args.caso);
      const content = approvalContent(paquete);
      const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
      const outputDirectory = path.join(getOutputDirectory(ctx.directory), args.caso.toLowerCase());
      await mkdir(outputDirectory, { recursive: true });
      const evidencePath = path.join(outputDirectory, "aprobacion.txt");
      await writeFile(evidencePath, `${content}\n\nSHA-256: ${sha256}\n`, "utf8");
      return ok({ ruta: evidencePath, sha256 });
    } catch (error) {
      return fail(error);
    }
  },
};

export const crear = {
  description: "Crea una orden en el SAP simulado solo si no hay bloqueos y todas las confirmaciones fueron dadas.",
  args: {
    caso: z.string().describe("Carpeta del caso, por ejemplo sol-001"),
    payload: OrdenCompraSchema.describe("Payload validado devuelto por oc_construir_payload"),
    confirmado: z.boolean().optional().describe("true únicamente después de la confirmación humana explícita"),
  },
  async execute(
    args: { caso: string; payload: OrdenCompra; confirmado?: boolean },
    ctx: Contexto
  ): Promise<string> {
    let solicitudId = "desconocida";
    let validation: Validacion = { apta: false, bloqueos: [], confirmaciones: [], derivados: {}, retroactiva: false };
    try {
      const paquete = await readPackage(ctx.directory, args.caso);
      solicitudId = paquete.solicitud.solicitud_id;
      validation = await validatePackage(ctx.directory, paquete);
      if (args.payload.referencia.solicitud_id !== solicitudId) {
        throw new Error("El payload no corresponde a la solicitud indicada.");
      }
      if (!validation.apta) {
        await appendControl(ctx.directory, { solicitudId, resultado: "BLOQUEADO", retroactiva: validation.retroactiva, bloqueos: validation.bloqueos, confirmaciones: validation.confirmaciones });
        return fail(new Error(`OC bloqueada: ${validation.bloqueos.join(" ")}`));
      }
      if (validation.confirmaciones.length > 0 && args.confirmado !== true) {
        await appendControl(ctx.directory, { solicitudId, resultado: "PENDIENTE_CONFIRMACION", retroactiva: validation.retroactiva, bloqueos: [], confirmaciones: validation.confirmaciones });
        return fail(new Error(`Se requiere confirmación explícita: ${validation.confirmaciones.join(" ")}`));
      }
      const evidenceSha = createHash("sha256").update(approvalContent(paquete), "utf8").digest("hex");
      const expected = buildOrder(paquete, validation.derivados, evidenceSha, validation.confirmaciones);
      const supplied = OrdenCompraSchema.parse(args.payload);
      if (!isDeepStrictEqual(supplied, expected)) {
        throw new Error("El payload fue alterado o no coincide con el paquete y la validación. Vuelve a construirlo.");
      }
      const confirmedOrder: OrdenCompra = {
        ...expected,
        excepciones: validation.confirmaciones.map((detalle) => ({
          codigo: detalle.match(/^RC\d+/)?.[0] ?? "CONFIRMACION",
          detalle,
          confirmado_por: validation.confirmaciones.length > 0 ? "analista" : null,
        })),
      };
      const adapter = new SapMockAdapter(ctx.directory);
      const existing = await adapter.buscarOrdenPorReferencia(solicitudId);
      const result = await adapter.crearOrden(confirmedOrder);
      await appendControl(ctx.directory, {
        solicitudId,
        resultado: "EXITOSO",
        numeroOc: result.numero_oc,
        retroactiva: validation.retroactiva,
        bloqueos: [],
        confirmaciones: validation.confirmaciones,
      });
      return ok({ ...result, idempotente: existing !== null });
    } catch (error) {
      try {
        await appendControl(ctx.directory, {
          solicitudId,
          resultado: "ERROR",
          retroactiva: validation.retroactiva,
          bloqueos: [error instanceof Error ? error.message : String(error)],
          confirmaciones: validation.confirmaciones,
        });
      } catch {
        // Preserve the original tool error if the audit file cannot be written.
      }
      return fail(error);
    }
  },
};

export const toolSchemas = { leer_paquete, validar, construir_payload, generar_evidencia, crear };
