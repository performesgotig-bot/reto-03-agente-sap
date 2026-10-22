{
  "name": "reto-03-agente-sap",
  "version": "1.0.0",
  "description": "Agente conversacional para la automatización de Órdenes de Compra en SAP - Periferia IT Group",
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "demo": "tsx demo.ts"
  },
  "keywords": [
    "sap",
    "ai-agent",
    "typescript",
    "periferia"
  ],
  "author": "Perxia 2.0 Candidate",
  "license": "ISC",
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "typescript": "^5.5.2",
    "tsx": "^4.15.7"
  }
}