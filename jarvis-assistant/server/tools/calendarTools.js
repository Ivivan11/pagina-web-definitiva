import { google } from "googleapis";
import { getGoogleAuth } from "../gmailClient.js";

export async function createCalendarEvent({ title, startIso, durationMinutes = 30 }) {
  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });

  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  return { ok: true, eventLink: event.data.htmlLink };
}
