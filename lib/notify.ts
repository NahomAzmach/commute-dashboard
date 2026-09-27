export async function sendPush(message: string, title = 'Commute') {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { Title: title, Priority: 'default' },
    body: message,
  });
}
