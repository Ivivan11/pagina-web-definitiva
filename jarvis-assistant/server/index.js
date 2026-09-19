import "dotenv/config";
import express from "express";
import { voiceRouter } from "./voiceRoutes.js";
import { handleGmailPush } from "./gmailWatcher.js";
import { triggerCallForEmail } from "./callOrchestrator.js";

const app = express();
app.use(express.urlencoded({ extended: false })); // webhooks de Twilio
app.use(express.json()); // push de Google Pub/Sub

app.use("/voice", voiceRouter);

app.post("/webhooks/gmail", async (req, res) => {
  res.sendStatus(204); // responder rápido: Pub/Sub reintenta si tardas demasiado
  try {
    await handleGmailPush(req.body);
  } catch (err) {
    console.error("[gmail webhook] error:", err);
  }
});

// Endpoint para probar el flujo de llamada sin esperar a que llegue un correo real.
// curl -X POST http://localhost:3000/dev/test-call -H 'content-type: application/json' \
//   -d '{"from":"jefe@empresa.com","subject":"Necesito el informe hoy","snippet":"..."}'
app.post("/dev/test-call", async (req, res) => {
  await triggerCallForEmail({
    emailId: `test-${Date.now()}`,
    from: req.body.from ?? "prueba@example.com",
    subject: req.body.subject ?? "Correo de prueba",
    snippet: req.body.snippet ?? "Esto es una prueba del asistente.",
  });
  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Jarvis backend escuchando en :${port}`));
