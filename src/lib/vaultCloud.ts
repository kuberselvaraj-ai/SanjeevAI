import type { VaultFile, VaultFolder } from './types'

/**
 * Cloud vault client (hosted mode) — the file library lives on the server,
 * so every screen sees the same files. Desktop mode keeps using the local
 * IndexedDB implementation in vault.ts.
 */

interface ServerFileMeta {
  id: string
  hash: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'doc'
  folderId: number | null
  tags: string[]
  createdAt: number
  hasPayload: boolean
  hasText: boolean
}

function metaToVaultFile(m: ServerFileMeta): VaultFile {
  return {
    id: m.id,
    hash: m.hash,
    name: m.name,
    mimeType: m.mimeType,
    size: m.size,
    kind: m.kind,
    folderId: m.folderId,
    tags: m.tags,
    hasPayload: m.hasPayload,
    hasText: m.hasText,
    usedIn: [],
    createdAt: m.createdAt,
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/vault${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Vault error ${res.status}`)
  return body as T
}

export async function cloudVaultTree(): Promise<{ folders: VaultFolder[]; files: VaultFile[] }> {
  const t = await api<{ folders: VaultFolder[]; files: ServerFileMeta[] }>('/tree')
  return { folders: t.folders, files: t.files.map(metaToVaultFile) }
}

export async function cloudVaultCreateFolder(name: string, parentId: number | null): Promise<void> {
  await api('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) })
}

export async function cloudVaultDeleteFolder(id: number): Promise<void> {
  await api(`/folders/${id}`, { method: 'DELETE' })
}

/** Dedupe probe: returns the existing entry's id when this hash is already vaulted. */
export async function cloudVaultCheckHash(hash: string): Promise<ServerFileMeta | null> {
  const r = await api<{ file: ServerFileMeta | null }>('/upload', {
    method: 'POST',
    body: JSON.stringify({ checkOnly: true, name: 'probe', hash, kind: 'doc' }),
  })
  return r.file
}

/** Upload (or dedupe-hit) a file in the cloud vault. Returns the entry. */
export async function cloudVaultUpload(f: {
  name: string
  mimeType: string
  size: number
  hash: string
  kind: 'image' | 'doc'
  folderId?: number | null
  tags: string[]
  payloadB64?: string
  extractedText?: string
}): Promise<VaultFile> {
  const r = await api<{ file: ServerFileMeta }>('/upload', { method: 'POST', body: JSON.stringify(f) })
  return metaToVaultFile(r.file)
}

/** Payload on demand — attach to chat / download to device. */
export async function cloudVaultPayload(id: string): Promise<{
  name: string
  mimeType: string
  payloadB64: string | null
  extractedText: string | null
}> {
  return api(`/files/${id}/payload`)
}

export async function cloudVaultPatch(
  id: string,
  patch: { name?: string; folderId?: number | null; tags?: string[]; extractedText?: string },
): Promise<void> {
  await api(`/files/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function cloudVaultDelete(id: string): Promise<void> {
  await api(`/files/${id}`, { method: 'DELETE' })
}
