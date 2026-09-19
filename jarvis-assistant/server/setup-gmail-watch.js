import "dotenv/config";
import { getGmailClient } from "./gmailClient.js";

// Registra (o renueva) la suscripción de Gmail a tu topic de Pub/Sub.
// Gmail deja de avisar a los 7 días, así que hay que volver a ejecutar esto
// periódicamente (un cron semanal, por ejemplo).
//
// Uso: GOOGLE_PUBSUB_TOPIC="projects/tu-proyecto/topics/gmail-jarvis" node setup-gmail-watch.js

const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
if (!topicName) {
  console.error("Falta la variable GOOGLE_PUBSUB_TOPIC (projects/<proyecto>/topics/<topic>)");
  process.exit(1);
}

const gmail = getGmailClient();

const result = await gmail.users.watch({
  userId: "me",
  requestBody: { topicName, labelIds: ["INBOX"] },
});

console.log("Watch registrada:", result.data);
