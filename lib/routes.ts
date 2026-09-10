export function conversationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function conversationDetailId(pathname: string): string | null {
  const match = pathname.match(/^\/backend-api\/(?:f\/)?conversation(?:s)?\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
