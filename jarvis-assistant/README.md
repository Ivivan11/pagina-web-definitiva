# Jarvis personal — asistente que te llama y controla tu ordenador

Proyecto separado de la web de la pizzería. Dos piezas independientes:

- **`server/`**: backend siempre encendido. Vigila tu Gmail, decide si un
  correo es importante y, si lo es, te llama por teléfono (Twilio) para
  contártelo. Durante la llamada puede responder el correo o crear eventos
  de calendario si se lo pides de viva voz.
- **`desktop-mcp/`**: servidor MCP que corre en tu Linux y le da a Claude
  (Claude Code o la app de escritorio) herramientas reales para abrir apps,
  ejecutar comandos y leer/escribir archivos en tu máquina.

```
Gmail ──push──▶ server/gmailWatcher ──Claude(Haiku)──▶ ¿importante?
                                              │ sí
                                              ▼
                                     Twilio te llama
                                              │
                              hablas ◀────────┴────────▶ Claude decide
                                                          (responder correo,
                                                           crear evento...)

Tu Linux ◀── Claude Code / Claude Desktop ── desktop-mcp (abrir apps, comandos, archivos)
```

## ¿Se puede hacer gratis teniendo ya Claude pagado?

Corto: **casi todo sí, pero no el 100%, y tu suscripción de claude.ai no
cubre esto.** La suscripción de claude.ai (Pro/Max) es para chatear y usar
Claude Code; el backend de `server/` necesita llamar a la **API** de
Anthropic, que se factura por separado, por tokens. La parte buena: con el
modelo más barato (Haiku) el uso real de este proyecto (clasificar unos
pocos correos al día + un par de llamadas cortas) cuesta céntimos al mes.

Desglose real:

| Pieza | Coste |
|---|---|
| Gmail API + Google Cloud Pub/Sub | **Gratis** en este volumen de uso |
| Hosting del backend | **Gratis** si lo corres tú mismo en tu Linux y lo expones con **Cloudflare Tunnel** (gratis, sin límite de tiempo, sin necesidad de servidor en la nube) |
| Anthropic API (clasificar correos + hablar en la llamada) | No cubierto por tu suscripción a claude.ai. Con Haiku, unos **céntimos al mes** para uso personal. Las cuentas nuevas de API suelen recibir algo de crédito gratis para empezar a probar. |
| Voz en la llamada (texto→voz y voz→texto) | **Gratis**: usamos las funciones nativas de Twilio (`<Say>` y `<Gather input="speech">`), incluidas en el precio por minuto de la llamada. Así evitamos pagar aparte a ElevenLabs/Deepgram. |
| Número de teléfono de Twilio | ~1-2 $/mes de alquiler. Twilio da ~15 $ de crédito de prueba al crear la cuenta, suficiente para probar bastante antes de gastar nada real. |
| Minutos de llamada | Unos céntimos por llamada (varía por país destino) |
| `desktop-mcp` (control del ordenador) | **100% gratis siempre** — corre localmente, no llama a ningún servicio de pago |

En la práctica: el único gasto recurrente real es Twilio (número + minutos),
del orden de 1-3 $/mes para uso personal. Todo lo demás es gratuito o
prácticamente gratuito. No hay forma de eliminar el coste de Twilio del todo
porque nadie ofrece telefonía real ilimitada gratis, pero el crédito de
prueba te deja construir y probar todo el sistema sin pagar nada al
principio.

## Puesta en marcha

### 1. Anthropic (el cerebro)
1. Crea una cuenta en [console.anthropic.com](https://console.anthropic.com) (distinta de tu login de claude.ai) y genera una API key.
2. Añádela como `ANTHROPIC_API_KEY` en `server/.env`.

### 2. Google Cloud (Gmail + Calendar)
1. Crea un proyecto en Google Cloud Console, activa **Gmail API** y **Google Calendar API**.
2. Crea credenciales OAuth 2.0 de tipo "Desktop app" → te da `client_id` y `client_secret`.
3. Genera un `refresh_token` una vez (con [OAuth Playground](https://developers.google.com/oauthplayground) o un script propio) pidiendo los scopes `gmail.modify` y `calendar.events`.
4. Crea un topic de Pub/Sub (p. ej. `projects/tu-proyecto/topics/gmail-jarvis`) y dale permiso de publicar a `gmail-api-push@system.gserviceaccount.com`.
5. Crea una suscripción push de ese topic apuntando a `https://tu-tunel/webhooks/gmail`.
6. Rellena `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` en `server/.env`.

### 3. Twilio (la llamada)
1. Crea cuenta en [twilio.com](https://www.twilio.com), compra o activa un número de prueba.
2. Verifica tu propio móvil como número de destino (obligatorio en cuentas de prueba).
3. Copia `Account SID`, `Auth Token` y el número Twilio a `server/.env` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`), y pon tu móvil en `MY_PHONE_NUMBER`.

### 4. Exponer el servidor gratis con Cloudflare Tunnel
```bash
# una vez
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# cada vez que arranques el servidor
cloudflared tunnel --url http://localhost:3000
```
Esto te da una URL pública (`https://algo.trycloudflare.com`). Ponla en
`PUBLIC_BASE_URL` de `server/.env` y en la suscripción push de Pub/Sub.

### 5. Arrancar el backend
```bash
cd server
npm install
cp .env.example .env   # y rellénalo
node setup-gmail-watch.js   # una vez, y luego cada ~7 días (Gmail caduca la watch)
npm start
```

### 6. Probar sin esperar un correo real
```bash
curl -X POST http://localhost:3000/dev/test-call \
  -H 'content-type: application/json' \
  -d '{"from":"jefe@empresa.com","subject":"Necesito el informe hoy","snippet":"El cliente lo pide para esta tarde."}'
```
Tu móvil debería sonar en segundos.

### 7. Control del ordenador
Ver `desktop-mcp/README.md` — se instala aparte y se conecta a Claude Code
o a la app de escritorio de Claude, no al backend de llamadas.

## Limitaciones de este MVP (a sabiendas)
- El progreso de Gmail (`historyId`) se guarda en memoria: si reinicias el
  servidor, se retoma desde el siguiente correo que llegue. Para algo serio,
  persístelo en disco o una base de datos pequeña.
- El clasificador de "importante" es un prompt simple; ajústalo en
  `classifyEmail.js` a tu propio criterio (remitentes VIP, palabras clave, etc.).
- No hay reintentos ni cola si Twilio o Gmail fallan momentáneamente.
