export function createSlackClient(token = process.env.SLACK_BOT_TOKEN, request: typeof fetch = fetch) {
  if (!token) throw new Error('SLACK_BOT_TOKEN is required');
  // Slack's file upload methods do not accept JSON bodies, so those calls are form-encoded.
  async function api(method: string, body: Record<string, unknown>, form = false) {
    const encoded = form
      ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString()
      : JSON.stringify(body);
    const response = await request(`https://slack.com/api/${method}`, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: encoded, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Slack ${method} HTTP request failed`);
    const data = await response.json() as Record<string, any>;
    // Slack error codes are short snake_case identifiers; anything else is not echoed.
    const code = typeof data.error === 'string' && /^[a-z_]{1,64}$/.test(data.error) ? `: ${data.error}` : '';
    if (!data.ok) throw new Error(`Slack ${method} failed${code}`);
    return data;
  }
  return {
    async message(channel: string, threadTs: string, text: string): Promise<{ ts: string }> {
      const data = await api('chat.postMessage', { channel, thread_ts: threadTs, text, unfurl_links: false, unfurl_media: false });
      return { ts: String(data.ts) };
    },
    async remove(channel: string, ts: string) {
      await api('chat.delete', { channel, ts });
    },
    // All files share one completion call, so they arrive in the thread as a single message.
    async upload(channel: string, threadTs: string, files: Array<{ bytes: Uint8Array; fileName: string }>, comment: string) {
      const uploaded: Array<{ id: string; title: string }> = [];
      for (const { bytes, fileName } of files) {
        const data = await api('files.getUploadURLExternal', { filename: fileName, length: bytes.byteLength }, true);
        const url = new URL(data.upload_url);
        if (url.protocol !== 'https:' || !(url.hostname === 'files.slack.com' || url.hostname.endsWith('.slack.com'))) throw new Error('Unexpected Slack upload URL');
        const response = await request(url, { method: 'POST', redirect: 'error', body: Buffer.from(bytes),
          headers: { 'content-type': 'application/octet-stream' }, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('Slack file upload failed');
        uploaded.push({ id: data.file_id, title: fileName });
      }
      await api('files.completeUploadExternal', { files: uploaded, channel_id: channel, thread_ts: threadTs, initial_comment: comment }, true);
    },
  };
}
export type SlackClient = Pick<ReturnType<typeof createSlackClient>, 'message' | 'remove' | 'upload'>;
