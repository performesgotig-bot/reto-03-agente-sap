# SOLUCION — Reto 03

## 1. Problema

La digitación manual de órdenes de compra expone a errores de captura y controles inconsistentes; la solución ayuda a la analista administrativa a preparar órdenes con datos trazables y excepciones visibles.

## 2. Arquitectura

```text
web (chat) -> Express API -> ciclo de agente -> adaptador OpenAI
                                 |
                                 +-> src/tools/oc.ts -> fixtures/ (lectura)
                                 |                  -> out/ (auditoría)
                                 +-> src/sap/mock.ts -> out/sap/ordenes.jsonl
```

El comportamiento está en `agent/prompt.md`, el conocimiento de proceso en `src/knowledge/ordenes-compra.md`, la ejecución y reglas en `src/tools/oc.ts`. Las herramientas Zod son funciones importables tanto desde el servidor como desde `demo.ts`.

## 3. Ciclo del agente

El servidor conserva mensajes y llamadas a herramientas por sesión en memoria, envía hasta `MAX_TOOL_ITERATIONS` ciclos y limita tokens acumulados por `MAX_SESSION_TOKENS`. Las llamadas quedan visibles en la sesión y se agregan a `out/log.jsonl`. Al solicitar crear una orden, el backend fuerza `confirmado: false`; si la herramienta devuelve confirmaciones, conserva el payload pendiente y solo permite crear tras una respuesta afirmativa en un mensaje posterior. Una negativa cancela la preparación. La herramienta `crear` vuelve a cargar y validar el fixture y compara el payload recibido con el reconstruido antes de escribir en SAP mock.

## 4. Modelo y costo

Proveedor: OpenAI, con `gpt-4o-mini` como valor inicial configurable mediante `OPENAI_MODEL`. Se eligió un modelo económico con llamadas a herramientas y salida estructurada; el demo y las reglas de negocio no requieren modelo. Estimación orientativa: presupuestar hasta USD 0.01 por caso para una conversación con varias llamadas, sujeto a longitud, número de iteraciones y tarifas vigentes. El costo debe medirse con `usage` real antes de producción; las claves viven únicamente en el backend vía `OPENAI_API_KEY`.

## 5. Matriz de controles

| Regla | Resultado | Implementación |
|---|---|---|
| RC1 | Bloqueo | Búsqueda por NIT normalizado o nombre; proveedor activo. |
| RC2 | Bloqueo | Aprobación con “Aprobado” y email autorizado en el centro. |
| RC3 | Bloqueo | Total contra tope del aprobador. |
| RC4 | Bloqueo | Subárea contra centro de costo. |
| RC5 | Confirmación | Diferencia porcentual >2% o ausencia de cotización. |
| RC6 | Confirmación + derivado | IVA por defecto del proveedor. |
| RC7 | Derivado | Condición de pago por defecto del proveedor. |
| RC8 | Confirmación + marca | Factura previa a solicitud, marcada retroactiva en CSV. |
| RC9 | Confirmación | Fecha de aprobación anterior a solicitud. |
| RC10 | Bloqueo | Cantidad por valor unitario con tolerancia de 1. |

La parte más delicada es impedir que un payload alterado o una llamada del modelo eluda los controles: `oc_crear` recarga el fixture, vuelve a validar y compara con el payload reconstruido.

## 6. Adaptador SAP real

Primero haría una prueba de viabilidad con SAP Basis y seguridad. Si el landscape expone el servicio, elegiría OData `API_PURCHASEORDER_PROCESS_SRV` detrás de SAP Integration Suite o del gateway corporativo: facilita contratos HTTP, observabilidad y despliegue desacoplado. Mapearía sociedad y organización de compras a los campos de cabecera; proveedor, moneda y condiciones de pago a los datos de cabecera; cada posición a material/texto breve, cantidad, precio, centro de costo, indicador fiscal y distribución contable. Los campos `referencia` y `excepciones` se conservarían como referencia externa/texto y evidencia adjunta según capacidad del tenant.

Las credenciales serían OAuth/client credentials o el mecanismo aprobado por SAP, guardadas en un secret manager del backend/integration runtime, con mínimo privilegio y rotación. No vivirían en el prompt, navegador ni logs. La idempotencia usaría `solicitud_id` como referencia externa única y una consulta previa; ante timeout se consultaría esa referencia antes de reintentar. Errores parciales se clasificarían por posición y código SAP, sin afirmar éxito hasta recibir el número definitivo; se guardaría correlación para conciliación. Si la integración no es viable, el plan B genera un paquete validado listo para carga masiva/pega en SAP GUI con evidencia y trazabilidad descargables.

## 7. Lectura del proceso

Las órdenes retroactivas deben medirse como una señal de proceso, no solo como una falla individual. El fixture retroactivo detecta factura con fecha anterior a la solicitud, exige confirmación y la registra como `retroactiva = true` en el control. Dirección debería observar el porcentaje por centro, proveedor y periodo, además del tiempo entre solicitud, aprobación, factura y orden. El agente no debe normalizar el incumplimiento: una confirmación permite registrar la excepción, pero la medición debe conservarla y quedar disponible para auditoría.

Propondría que la cotización y la aprobación estén adjuntas antes de comprometer el gasto, y que la OC se genere antes de recibir la factura. Para evitar que el control sea una carga aislada de administración, acordaría responsables y SLA para aprobación y compra, con un flujo de excepción documentado para urgencias. Una reducción sostenida de retroactivas sería el indicador de adopción; también revisaría los casos en que la factura llega antes por causas operativas legítimas para no incentivar datos artificiales.

## 8. Decisiones y trade-offs

- Archivos locales y SAP mock frente a base de datos: cumple el alcance y permite inspeccionar salidas; no aporta concurrencia ni durabilidad de producción.
- Reglas deterministas en herramientas frente a delegarlas al LLM: mayor testabilidad y control; requiere mantener explícitamente el esquema de entrada.
- OpenAI mediante adaptador frente a acoplar el ciclo al SDK: permite cambiar proveedor sin modificar herramientas; requiere un mapeo de mensajes específico por implementación.
- Sesiones en memoria frente a persistirlas: sencilla para demo; reiniciar el servidor pierde la conversación y no soporta múltiples réplicas.

## 9. Supuestos

- Los maestros entregados son la autoridad para validar proveedor, centro, aprobador y topes.
- El NIT se compara eliminando puntuación y dígito de verificación cuando el fixture no coincide exactamente.
- `aprobacion.json` es la evidencia fuente y el archivo requerido P0 es TXT; el PDF queda pendiente P1.
- “Aprobado” se busca sin distinguir mayúsculas; el email del aprobador sí debe estar registrado.
- Una confirmación autoriza la excepción preparada, no modifica montos ni datos del payload.

## 10. Cobertura

| Historia | Estado | Pendiente para producción |
|---|---|---|
| HU-1 Leer paquete | Hecho para fixtures JSON/TXT | Lectura de Excel/PDF real, adjuntos ausentes detallados al usuario. |
| HU-2 Validar controles | Hecho RC1–RC10 | Maestros en vivo, pruebas de política y revisión de auditoría. |
| HU-3 Construir payload | Hecho; esquema Zod y trazabilidad | Contrato SAP real y revisión de campos/unidades. |
| HU-4 Evidencia | Parcial: TXT con SHA-256 | Generación PDF y almacenamiento firmado. |
| HU-5 Crear OC | Hecho en mock; idempotencia local | Adaptador OData, concurrencia transaccional y adjuntos. |
| HU-6 Errores | Parcial | Telemetría, recuperación durable y pruebas de fallos/reintentos. |

## 11. Uso de IA

Se usó GitHub Copilot para analizar el PRD, implementar módulos TypeScript, proponer la estructura de herramientas y revisar tipos y flujo. Se conservaron validaciones deterministas en las herramientas y se descartó confiar al modelo el permiso de creación sin una segunda validación del backend. Las decisiones y archivos generados deben revisarse y explicarse por la persona que entrega el reto.

## 12. Riesgos

- Exposición o abuso de la clave LLM: secret manager, límites de sesión, rotación y control de gasto.
- Payloads o fixtures malformados: validación Zod, errores legibles y pruebas negativas.
- Reintento duplicado en SAP: referencia externa idempotente y conciliación antes de reintentar.
- Aprobación como evidencia insuficiente: conservar el original y validar firma y retención con auditoría.
- Confirmación ambigua: controles explícitos en backend y registro de usuario/fecha en una versión autenticada.
- Datos personales o financieros: control de acceso, retención mínima y redacción de logs en producción.
