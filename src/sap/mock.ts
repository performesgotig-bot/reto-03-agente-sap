import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDirectory } from "../runtime/storage.js";
import type { OrdenCompra, SapAdapter } from "./adapter.js";

type StoredOrder = {
  numero_oc: string;
  fecha: string;
  referencia?: { solicitud_id?: string };
};

export class SapMockAdapter implements SapAdapter {
  constructor(private readonly directory: string) {}

  async consultarProveedor(
    nit: string
  ): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const candidates = [
      path.join(this.directory, "fixtures", "reto-03", "maestros", "proveedores.json"),
      path.join(this.directory, "maestros", "proveedores.json"),
    ];
    for (const file of candidates) {
      try {
        const providers = JSON.parse(await readFile(file, "utf8")) as Array<{
          nit: string;
          codigo_sap: string;
          activo: boolean;
        }>;
        const provider = providers.find((item) => normalizeNit(item.nit) === normalizeNit(nit));
        return provider ? { codigo_sap: provider.codigo_sap, activo: provider.activo } : null;
      } catch {
        continue;
      }
    }
    return null;
  }

  async buscarOrdenPorReferencia(
    solicitudId: string
  ): Promise<{ numero_oc: string } | null> {
    const orders = await this.readOrders();
    const existing = orders.find((item) => item.referencia?.solicitud_id === solicitudId);
    return existing ? { numero_oc: existing.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existing = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id);
    if (existing) {
      const order = (await this.readOrders()).find(
        (item) => item.numero_oc === existing.numero_oc
      );
      return { numero_oc: existing.numero_oc, fecha: order?.fecha ?? new Date().toISOString() };
    }

    const orders = await this.readOrders();
    const highestNumber = orders.reduce((highest, item) => {
      const current = Number(item.numero_oc);
      return Number.isFinite(current) ? Math.max(highest, current) : highest;
    }, 4500000000);
    const numero_oc = String(highestNumber + 1);
    const fecha = new Date().toISOString();
    const outputDirectory = path.join(getOutputDirectory(this.directory), "sap");
    await mkdir(outputDirectory, { recursive: true });
    await appendFile(
      path.join(outputDirectory, "ordenes.jsonl"),
      `${JSON.stringify({ numero_oc, fecha, ...orden })}\n`,
      "utf8"
    );
    return { numero_oc, fecha };
  }

  private async readOrders(): Promise<StoredOrder[]> {
    try {
      const contents = await readFile(
        path.join(getOutputDirectory(this.directory), "sap", "ordenes.jsonl"),
        "utf8"
      );
      return contents
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredOrder);
    } catch {
      return [];
    }
  }
}

function normalizeNit(value: string): string {
  return value.replace(/\D/g, "");
}
