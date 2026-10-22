# Agente de órdenes de compra SAP (simulado)

Aplicación conversacional para leer solicitudes, contrastarlas con maestros, preparar el payload de una OC y crearla en un adaptador SAP local. El chat usa OpenAI cuando se configura una clave. El demo de herramientas no usa ningún proveedor de modelos.

## Requisitos

- Node.js 20 o superior y npm.
- Una clave OpenAI solo para utilizar el chat. No es necesaria para el demo.

## Arranque

En la raíz del proyecto:

```bash
npm install && npm run dev
```

Abre `http://localhost:3000`. Copia `.env.example` como `.env` y configura `OPENAI_API_KEY` para habilitar el chat. El backend lee `OPENAI_MODEL`, `PORT`, `MAX_TOOL_ITERATIONS` y `MAX_SESSION_TOKENS`; la clave nunca se envía al navegador ni se escribe en los logs.

Los fixtures pueden vivir en `fixtures/reto-03/solicitudes` y `fixtures/reto-03/maestros`, o directamente en `solicitudes/` y `maestros/` como los archivos entregados.

## Demo determinista sin LLM

```bash
npm run demo
```

El demo limpia `out/`, procesa los seis casos, prueba el rechazo de bloqueos y confirmaciones, simula explícitamente la confirmación de `sol-004` y ejecuta `sol-001` dos veces para verificar idempotencia. Genera `out/sap/ordenes.jsonl`, `out/control.csv`, evidencias y trazabilidad.

## API

- `GET /api/health`: proveedor y modelo (sin secretos).
- `POST /api/chat`: `{ "sessionId": "...", "message": "..." }`.
- `GET /api/sessions/:id`: mensajes y llamadas de herramientas de una sesión en memoria.

La aplicación incluye el SAP simulado local. No se ha desplegado una URL pública: requiere configurar el proveedor y publicar el proyecto en una cuenta de despliegue.
