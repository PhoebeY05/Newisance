/**
 * Resolve game question media URLs to absolute paths.
 * Local uploads (media_uploads/...) are routed through the API proxy.
 * External URLs (http/https) pass through unchanged.
 */
export function gameMediaUrl(mediaUrl: string | null): string {
  if (!mediaUrl) return ''
  
  // External URLs (e.g., Unsplash) pass through unchanged
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    return mediaUrl
  }
  
  // Local media_uploads paths need to go through the API proxy
  return `/api/game/${mediaUrl}`
}
