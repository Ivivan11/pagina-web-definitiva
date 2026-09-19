import { Router } from "express";
import twilio from "twilio";
import { getContext, clearContext } from "./callOrchestrator.js";
import { startConversation, converse, endConversation } from "./claudeAgent.js";

const { VoiceResponse } = twilio.twiml;
export const voiceRouter = Router();

// Twilio llama a esta URL en cuanto el usuario descuelga la llamada saliente.
voiceRouter.post("/outbound-connect", (req, res) => {
  const { contextId } = req.query;
  const context = getContext(contextId);
  const callSid = req.body.CallSid;

  const twiml = new VoiceResponse();

  if (!context) {
    twiml.say({ language: "es-ES" }, "No encuentro el contexto de esta llamada. Colgando.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  startConversation(
    callSid,
    "Eres el asistente personal del usuario, llamándole por teléfono para avisarle de un correo importante. " +
      `Correo: de ${context.from}, asunto "${context.subject}". Resumen: ${context.snippet}. ` +
      "Habla en español, de forma breve y natural, como en una llamada real, no como leyendo un informe. " +
      "Puedes usar las herramientas para responder el correo o crear un evento en el calendario si el usuario " +
      "te lo pide explícitamente. En cuanto no haya nada más que hacer, usa la herramienta end_call.",
    context
  );

  twiml.say(
    { language: "es-ES", voice: "Polly.Conchita" },
    `Hola. Te llamo porque ha llegado un correo importante de ${context.from}, con el asunto: ${context.subject}.`
  );
  twiml.gather({
    input: "speech",
    language: "es-ES",
    action: `/voice/gather?contextId=${contextId}`,
    speechTimeout: "auto",
  });

  res.type("text/xml").send(twiml.toString());
});

// Twilio llama a esta URL cada vez que el usuario termina de hablar durante la llamada.
voiceRouter.post("/gather", async (req, res) => {
  const { contextId } = req.query;
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult ?? "";

  const twiml = new VoiceResponse();
  const { text, hangUp } = await converse(callSid, userSpeech || "(el usuario no ha dicho nada)");

  twiml.say({ language: "es-ES", voice: "Polly.Conchita" }, text);

  if (hangUp) {
    endConversation(callSid);
    clearContext(contextId);
    twiml.hangup();
  } else {
    twiml.gather({
      input: "speech",
      language: "es-ES",
      action: `/voice/gather?contextId=${contextId}`,
      speechTimeout: "auto",
    });
  }

  res.type("text/xml").send(twiml.toString());
});
