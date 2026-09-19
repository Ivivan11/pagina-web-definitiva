import { getGmailClient } from "./gmailClient.js";
import { classifyEmail } from "./classifyEmail.js";
import { triggerCallForEmail } from "./callOrchestrator.js";

// MVP: guardamos el último historyId en memoria. Si el servidor se reinicia se
// pierde y se retoma desde el historyId que venga en el siguiente push de Gmail
// (verás el aviso en el log). Para producción, persiste esto en un archivo o base de datos.
let lastHistoryId = null;

export async function handleGmailPush(pushData) {
  const decoded = JSON.parse(Buffer.from(pushData.message.data, "base64").toString("utf8"));
  const gmail = getGmailClient();

  const startHistoryId = lastHistoryId ?? decoded.historyId;
  lastHistoryId = decoded.historyId;

  const history = await gmail.users.history.list({
    userId: "me",
    startHistoryId,
    historyTypes: ["messageAdded"],
  });

  const addedMessages = history.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? [];

  for (const { message } of addedMessages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });

    const headers = full.data.payload.headers;
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const snippet = full.data.snippet ?? "";

    const { important, reason } = await classifyEmail({ from, subject, snippet });
    console.log(`[gmail] "${subject}" de ${from} -> importante=${important} (${reason})`);

    if (important) {
      await triggerCallForEmail({ emailId: message.id, from, subject, snippet });
    }
  }
}
