const safeSubject = (value) => String(value).replace(/[\r\n]+/g, " ").slice(0, 180);

const configured = (env) =>
  env.MICROSOFT_TENANT_ID &&
  env.MICROSOFT_CLIENT_ID &&
  env.MICROSOFT_CLIENT_SECRET &&
  env.OUTLOOK_SENDER_EMAIL;

const accessToken = async (env) => {
  const tenant = encodeURIComponent(env.MICROSOFT_TENANT_ID);
  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Microsoft token request failed (${response.status}).`);
  const result = await response.json();
  if (!result.access_token) throw new Error("Microsoft token response did not include an access token.");
  return result.access_token;
};

export const sendOutlookMail = async (env, to, subject, content) => {
  if (!configured(env) || !to) return false;
  try {
    const token = await accessToken(env);
    const sender = encodeURIComponent(env.OUTLOOK_SENDER_EMAIL);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: safeSubject(subject),
          body: { contentType: "HTML", content },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!response.ok) throw new Error(`Microsoft sendMail request failed (${response.status}).`);
    return true;
  } catch (error) {
    console.error("Outlook notification failed.", error);
    return false;
  }
};
