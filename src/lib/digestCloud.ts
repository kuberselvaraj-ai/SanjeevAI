/**
 * Digest cloud sync — the portable memory of each thread.
 *
 * Conversations themselves stay on the device; their digests (summary,
 * labels, open loops, watermark) mirror to the hosted DB. On another device
 * the thread's full history isn't there, but its DIGEST is — so cross-chat
 * recall still works: you can ask your laptop about the thread you had on
 * your phone, and the AI answers from the synced label set.
 */

export interface CloudDigest {
  convId: string
  digest: string
  labels: string[]
  openLoops: string[]
  digestThrough: string
  updatedAt: number
}

export async function cloudDigestsPull(): Promise<CloudDigest[]> {
  try {
    const res = await fetch('/api/hosted/digests', { credentials: 'include' })
    if (!res.ok) return []
    const j = (await res.json()) as { digests?: CloudDigest[] }
    return Array.isArray(j.digests) ? j.digests : []
  } catch {
    return []
  }
}

export async function cloudDigestPut(
  convId: string,
  patch: { digest: string; labels: string[]; openLoops: string[]; digestThrough: string },
): Promise<void> {
  try {
    await fetch('/api/hosted/digests', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        convId,
        digest: patch.digest,
        labels: patch.labels,
        openLoops: patch.openLoops,
        digestThrough: patch.digestThrough,
      }),
    })
  } catch {
    /* offline — the local digest still works; the next refresh re-syncs */
  }
}

export async function cloudDigestDelete(convId: string): Promise<void> {
  try {
    await fetch(`/api/hosted/digests/${encodeURIComponent(convId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch {
    /* best effort */
  }
}
