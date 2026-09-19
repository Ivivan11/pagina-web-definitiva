import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execAsync = promisify(exec);

// Todo lo que este servidor lee/escribe queda dentro de esta carpeta, nunca fuera.
const WORKDIR = process.env.JARVIS_WORKDIR || path.join(os.homedir(), "jarvis-files");

const tools = {
  open_app: {
    description: "Abre una aplicación, archivo o URL en el escritorio Linux (usa xdg-open).",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "Nombre de app, ruta de archivo o URL a abrir." } },
      required: ["target"],
    },
    handler: async ({ target }) => {
      await execAsync(`xdg-open ${JSON.stringify(target)}`);
      return { ok: true };
    },
  },

  run_command: {
    description:
      "Ejecuta un comando de shell en el ordenador del usuario. Solo para tareas que el usuario haya pedido " +
      "explícitamente; nunca acciones destructivas (borrar archivos, apagar el equipo, etc.) sin confirmación.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    handler: async ({ command }) => {
      console.error(`[jarvis-desktop] ejecutando: ${command}`);
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000 });
      return { stdout, stderr };
    },
  },

  write_file: {
    description: `Escribe un archivo de texto dentro de ${WORKDIR}.`,
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" },
      },
      required: ["filename", "content"],
    },
    handler: async ({ filename, content }) => {
      await fs.mkdir(WORKDIR, { recursive: true });
      const target = path.join(WORKDIR, path.basename(filename));
      await fs.writeFile(target, content, "utf8");
      return { ok: true, path: target };
    },
  },

  read_file: {
    description: `Lee un archivo de texto dentro de ${WORKDIR}.`,
    inputSchema: {
      type: "object",
      properties: { filename: { type: "string" } },
      required: ["filename"],
    },
    handler: async ({ filename }) => {
      const target = path.join(WORKDIR, path.basename(filename));
      return { content: await fs.readFile(target, "utf8") };
    },
  },
};

const server = new Server({ name: "jarvis-desktop", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools[request.params.name];
  if (!tool) throw new Error(`Herramienta desconocida: ${request.params.name}`);

  const result = await tool.handler(request.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
