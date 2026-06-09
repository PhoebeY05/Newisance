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

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'avi', 'm4v', 'ogv']

/** True when a question's media should render as a <video> rather than an <img>. */
export function isVideoMedia(mediaUrl: string | null): boolean {
  if (!mediaUrl) return false
  const path = mediaUrl.split(/[?#]/, 1)[0]
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.includes(ext)
}
