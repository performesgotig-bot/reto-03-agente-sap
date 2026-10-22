import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  crear,
  construir_payload,
  generar_evidencia,
  leer_paquete,
  validar,
} from "./src/tools/oc.js";

type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Paquete = Parameters<typeof validar.execute>[0]["paquete"];
type Validacion = {
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, string>;
  retroactiva: boolean;
};
type PayloadConstruido = {
  payload: Parameters<typeof crear.execute>[0]["payload"];
};
type ResultadoCreacion = {
  numero_oc: string;
  fecha: string;
  idempotente: boolean;
};

const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"];

function parseToolResult<T>(raw: string, toolName: string): ToolResult<T> {
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`${toolName} devolvio una respuesta JSON invalida.`);
  }

  if (typeof result !== "object" || result === null || !("ok" in result)) {
    throw new Error(`${toolName} devolvio una respuesta fuera del contrato.`);
  }

  return result as ToolResult<T>;
}

function showArray(label: string, values: string[]): void {
  console.log(`  ${label}: ${values.length ? values.join(" | ") : "ninguno"}`);
}

async function runDemo(): Promise<void> {
  const rootDir = process.cwd();
  const outputPath = path.join(rootDir, "out");
  const ctx = { directory: rootDir, sessionId: "demo-sin-modelo" };

  try {
    await fs.access(path.join(rootDir, "maestros", "proveedores.json"));
  } catch {
    try {
      await fs.access(path.join(rootDir, "fixtures", "reto-03", "maestros", "proveedores.json"));
    } catch {
      throw new Error("No encuentro los fixtures. Esperaba maestros/ y solicitudes/ o fixtures/reto-03/.");
    }
  }

  try {
    await fs.access(path.join(rootDir, "solicitudes", "sol-001", "solicitud.json"));
  } catch {
    await fs.access(path.join(rootDir, "fixtures", "reto-03", "solicitudes", "sol-001", "solicitud.json"));
  }

  await fs.rm(outputPath, { recursive: true, force: true });
  await fs.mkdir(outputPath, { recursive: true });

  console.log("VERIFICACION DE HERRAMIENTAS - RETO 03 (SIN MODELO)");
  console.log("=====================================================");

  let sol001Creada = false;

  for (const caso of casos) {
    console.log(`\n${caso}`);

    try {
      const paqueteResult = parseToolResult<Paquete>(
        await leer_paquete.execute({ caso }, ctx),
        "oc_leer_paquete"
      );
      if (!paqueteResult.ok) {
        console.log(`  Error al leer paquete: ${paqueteResult.error}`);
        continue;
      }

      const validacionResult = parseToolResult<Validacion>(
        await validar.execute({ caso, paquete: paqueteResult.data }, ctx),
        "oc_validar"
      );
      if (!validacionResult.ok) {
        console.log(`  Error de validacion: ${validacionResult.error}`);
        continue;
      }

      const validacion = validacionResult.data;
      console.log(`  Apta: ${validacion.apta}`);
      showArray("Bloqueos", validacion.bloqueos);
      showArray("Confirmaciones", validacion.confirmaciones);
      console.log(`  Retroactiva: ${validacion.retroactiva}`);

      const payloadResult = parseToolResult<PayloadConstruido>(
        await construir_payload.execute(
          { caso, paquete: paqueteResult.data, derivados: validacion.derivados },
          ctx
        ),
        "oc_construir_payload"
      );
      if (!payloadResult.ok) {
        console.log(`  Error al construir payload: ${payloadResult.error}`);
        continue;
      }

      if (!validacion.apta) {
        const blocked = parseToolResult<ResultadoCreacion>(
          await crear.execute({ caso, payload: payloadResult.data.payload, confirmado: false }, ctx),
          "oc_crear"
        );
        console.log(`  Resultado: bloqueada; ${blocked.ok ? "ERROR: se creó una OC" : blocked.error}`);
        continue;
      }

      if (validacion.confirmaciones.length > 0 && caso !== "sol-004") {
        const pending = parseToolResult<ResultadoCreacion>(
          await crear.execute({ caso, payload: payloadResult.data.payload, confirmado: false }, ctx),
          "oc_crear"
        );
        console.log(`  Resultado: pendiente de confirmacion; ${pending.ok ? "ERROR: se creó una OC" : pending.error}`);
        continue;
      }

      if (validacion.confirmaciones.length > 0 && caso === "sol-004") {
        console.log("  Resultado: requiere confirmacion humana.");
        const pending = parseToolResult<ResultadoCreacion>(
          await crear.execute({ caso, payload: payloadResult.data.payload, confirmado: false }, ctx),
          "oc_crear"
        );
        console.log(`  Antes de confirmar: ${pending.ok ? "ERROR: se creó una OC" : "bloqueada correctamente"}`);
        console.log("  Simulando confirmacion explicita para sol-004...");
      }

      const evidenciaResult = parseToolResult<{ ruta: string; sha256: string }>(
        await generar_evidencia.execute({ caso }, ctx),
        "oc_generar_evidencia"
      );
      if (!evidenciaResult.ok) {
        console.log(`  Error al generar evidencia: ${evidenciaResult.error}`);
        continue;
      }

      const crearResult = parseToolResult<ResultadoCreacion>(
        await crear.execute(
          {
            caso,
            payload: payloadResult.data.payload,
            confirmado: validacion.confirmaciones.length > 0 && caso === "sol-004",
          },
          ctx
        ),
        "oc_crear"
      );
      if (!crearResult.ok) {
        console.log(`  Error al crear OC: ${crearResult.error}`);
        continue;
      }

      console.log(
        `  OC: ${crearResult.data.numero_oc} (${crearResult.data.fecha}); idempotente: ${crearResult.data.idempotente}`
      );
      console.log(`  Evidencia: ${evidenciaResult.data.ruta}`);
      if (caso === "sol-001") sol001Creada = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  Error: ${message}`);
    }
  }

  console.log("\nPrueba de idempotencia: sol-001");
  if (!sol001Creada) {
    console.log("  Omitida: sol-001 no se creo en el flujo principal.");
    return;
  }

  const paqueteResult = parseToolResult<Paquete>(
    await leer_paquete.execute({ caso: "sol-001" }, ctx),
    "oc_leer_paquete"
  );
  if (!paqueteResult.ok) throw new Error(paqueteResult.error);

  const validacionResult = parseToolResult<Validacion>(
    await validar.execute({ caso: "sol-001", paquete: paqueteResult.data }, ctx),
    "oc_validar"
  );
  if (!validacionResult.ok) throw new Error(validacionResult.error);

  const payloadResult = parseToolResult<PayloadConstruido>(
    await construir_payload.execute(
      {
        caso: "sol-001",
        paquete: paqueteResult.data,
        derivados: validacionResult.data.derivados,
      },
      ctx
    ),
    "oc_construir_payload"
  );
  if (!payloadResult.ok) throw new Error(payloadResult.error);

  const idempotenciaResult = parseToolResult<ResultadoCreacion>(
    await crear.execute(
      { caso: "sol-001", payload: payloadResult.data.payload },
      ctx
    ),
    "oc_crear"
  );
  if (!idempotenciaResult.ok) throw new Error(idempotenciaResult.error);

  console.log(
    `  OC: ${idempotenciaResult.data.numero_oc}; idempotente: ${idempotenciaResult.data.idempotente}`
  );
}

runDemo().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`No se pudo completar el demo: ${message}`);
  process.exitCode = 1;
});
