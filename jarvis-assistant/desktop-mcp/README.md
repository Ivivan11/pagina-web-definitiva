# jarvis-desktop-mcp

Servidor MCP que expone tu escritorio Linux como herramientas para Claude: abrir
apps, ejecutar comandos, leer/escribir archivos en una carpeta de trabajo.

## Instalar

```bash
cd desktop-mcp
npm install
```

## Registrarlo en Claude Code

```bash
claude mcp add jarvis-desktop -- node /ruta/absoluta/a/jarvis-assistant/desktop-mcp/index.js
```

Después, en cualquier sesión de Claude Code, dile por ejemplo "abre Firefox en
gmail.com" o "escribe un archivo notas.txt con..." y usará estas herramientas.

## Registrarlo en la app de escritorio Claude

Edita `~/.config/Claude/claude_desktop_config.json` y añade:

```json
{
  "mcpServers": {
    "jarvis-desktop": {
      "command": "node",
      "args": ["/ruta/absoluta/a/jarvis-assistant/desktop-mcp/index.js"]
    }
  }
}
```

Reinicia la app de Claude.

## Seguridad

`run_command` ejecuta lo que el modelo le pida en tu shell real, sin sandbox.
Es lo que hace posible el control real del ordenador, pero también el punto
más delicado: si conectas este servidor a un agente que reciba instrucciones
de fuentes no confiables (webs, correos, etc.), esas instrucciones podrían
acabar ejecutándose aquí. Para este proyecto (tú hablando por teléfono o en el
propio Claude Code) el riesgo es bajo, pero no lo expongas a nada que no
controles tú.
