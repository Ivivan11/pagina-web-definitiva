import { getGmailClient } from "../gmailClient.js";

export async function replyToEmail(emailId, body) {
  const gmail = getGmailClient();

  const original = await gmail.users.messages.get({
    userId: "me",
    id: emailId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Message-ID"],
  });

  const headers = original.data.payload.headers;
  const to = headers.find((h) => h.name === "From")?.value;
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
  const messageId = headers.find((h) => h.name === "Message-ID")?.value;

  const raw = buildRawReply({ to, subject: `Re: ${subject}`, body, inReplyTo: messageId });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: original.data.threadId },
  });

  return { ok: true };
}

function buildRawReply({ to, subject, body, inReplyTo }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].filter((line) => line !== null);

  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
