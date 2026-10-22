La aplicación usa la detección de Express de Vercel desde `src/server.ts`. Ese módulo exporta `app` como default; Vercel ignora `express.static()`, por lo que los assets del chat viven en `public/`.

`vercel.json` incluye los maestros, solicitudes, prompt y conocimiento como archivos de la función. El adaptador escribe las salidas de ejecución bajo `/tmp/reto-03-agente-sap/out`; el almacenamiento de Vercel es temporal y no debe usarse como evidencia persistente en producción.

Configura `OPENAI_API_KEY` como variable de entorno en Project Settings. La Deployment Protection del proyecto puede requerir SSO y se debe desactivar si el enlace de prueba tiene que ser público.