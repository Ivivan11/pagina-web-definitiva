import { google } from "googleapis";

let cachedGmail = null;

export function getGmailClient() {
  if (cachedGmail) return cachedGmail;

  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  cachedGmail = google.gmail({ version: "v1", auth });
  return cachedGmail;
}

export function getGoogleAuth() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}
