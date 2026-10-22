# Conocimiento del proceso de órdenes de compra

- Los maestros de proveedores y centros de costo son la fuente autorizada para proveedor activo, aprobadores, topes y subáreas.
- Nunca corregir ni estimar montos. Usar los valores de la solicitud y exponer cualquier diferencia con la cotización.
- Bloqueos impiden crear una orden. Confirmaciones exigen una respuesta afirmativa de la analista en un turno posterior.
- Cuando falta el indicador de IVA, proponer el valor por defecto del proveedor y solicitar confirmación. Las condiciones de pago faltantes se derivan del proveedor y se informan.
- Una factura anterior a la solicitud marca la compra como retroactiva y requiere confirmación.
- La creación es idempotente por `solicitud_id`; una repetición devuelve el número existente.
- El mock local no representa una conexión a SAP real. Las trazas y el log de control son evidencia para la revisión del reto.
