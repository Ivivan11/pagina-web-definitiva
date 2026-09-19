import twilio from "twilio";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Contexto de cada llamada saliente (de qué correo se habla), indexado por un id
// que viajará en la URL del webhook de Twilio para esa llamada concreta.
const pendingContexts = new Map();

export async function triggerCallForEmail(emailContext) {
  const contextId = emailContext.emailId;
  pendingContexts.set(contextId, emailContext);

  await client.calls.create({
    to: process.env.MY_PHONE_NUMBER,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.PUBLIC_BASE_URL}/voice/outbound-connect?contextId=${contextId}`,
  });
}

export function getContext(contextId) {
  return pendingContexts.get(contextId);
}

export function clearContext(contextId) {
  pendingContexts.delete(contextId);
}
