---
name: ordenes-compra
description: Reglas de proceso, controles RC1-RC10 y excepciones para preparar órdenes de compra.
---

# Órdenes de compra

- El proveedor debe existir y estar activo; busca por NIT normalizado o nombre.
- La aprobación debe contener “Aprobado” y proceder de un aprobador registrado para el centro de costo.
- El monto no puede exceder el tope autorizado. La subárea debe pertenecer al centro.
- Diferencias superiores a 2% entre cotización y solicitud, ausencia de cotización, IVA derivado, factura anterior a solicitud y aprobación anterior a solicitud requieren confirmación.
- Si faltan condiciones de pago, usa el valor por defecto del proveedor e informa el derivado.
- Cantidad por precio unitario debe coincidir con el total, con tolerancia de 1 unidad monetaria.
- No modifiques valores para resolver excepciones. La confirmación no elimina la marca de auditoría.
- La creación se protege por `solicitud_id` para evitar duplicados.
