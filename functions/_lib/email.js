const safeSubject = (value) => String(value).replace(/[\r\n]+/g, " ").slice(0, 180);

export async function sendOutlookMail(env, { to, subject, html }, fetchImpl = fetch) {
  if (!env.OUTLOOK_ACCESS_TOKEN || !to) return false;
  try {
    const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OUTLOOK_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: safeSubject(subject),
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    });
    if (!response.ok) {
      console.error(`Outlook email delivery failed with status ${response.status}.`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Outlook email delivery failed.", error);
    return false;
  }
}
