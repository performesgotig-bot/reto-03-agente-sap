import path from "node:path";

export function getOutputDirectory(projectDirectory: string): string {
  return process.env.VERCEL === "1"
    ? path.join("/tmp", "reto-03-agente-sap", "out")
    : path.join(projectDirectory, "out");
}
