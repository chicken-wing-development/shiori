/** Build-time flag keeps native APIs out of the PWA and portable HTML. */
export const isDesktop = import.meta.env?.MODE === 'desktop';

export async function openExternalLink(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return;
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
