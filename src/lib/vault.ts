import type { VaultFile } from './types'
import { uid } from './storage'

/**
 * Mission Vault — one organized file library across all chats.
 * Payloads (image data URLs, extracted doc text) live in IndexedDB;
 * files are deduped by content hash, so attaching the same PDF twice
 * costs zero extraction calls.
 */

const DB_NAME = 'sanjeev-vault'
const STORE = 'files'
const MAX_ENTRIES = 60

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('hash', 'hash', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export function listVaultFiles(): Promise<VaultFile[]> {
  return tx<VaultFile[]>('readonly', (s) => s.getAll() as IDBRequest<VaultFile[]>)
    .then((all) => all.sort((a, b) => b.createdAt - a.createdAt))
    .catch(() => [])
}

export function putVaultFile(file: VaultFile): Promise<void> {
  return tx('readwrite', (s) => s.put(file)).then(() => evictIfNeeded())
}

export function deleteVaultFile(id: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(id)).then(() => undefined)
}

export async function findVaultByHash(hash: string): Promise<VaultFile | null> {
  const all = await listVaultFiles()
  return all.find((f) => f.hash === hash) ?? null
}

async function evictIfNeeded(): Promise<void> {
  const all = await listVaultFiles()
  if (all.length <= MAX_ENTRIES) return
  // Evict oldest entries that no chat has used recently.
  const victims = all
    .slice(MAX_ENTRIES)
    .sort((a, b) => (a.usedIn.at(-1)?.at ?? a.createdAt) - (b.usedIn.at(-1)?.at ?? b.createdAt))
  for (const v of victims) await deleteVaultFile(v.id)
}

/** sha-256 hex of a File's bytes — the dedupe key. */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const TAG_KEYWORDS: [RegExp, string][] = [
  [/invoice|receipt|bill|payment/i, 'finance'],
  [/contract|agreement|nda|terms/i, 'legal'],
  [/resume|cv|cover.?letter/i, 'career'],
  [/report|analysis|review|audit/i, 'report'],
  [/meeting|minutes|agenda/i, 'meeting'],
  [/spec|design|architecture|rfp/i, 'spec'],
  [/data|dataset|export|dump/i, 'data'],
  [/slides?|presentation|deck/i, 'deck'],
  [/paper|journal|study|research/i, 'research'],
]

/** Derive useful tags from the filename, type, and (for docs) the text head. */
export function autoTags(name: string, mimeType: string, textHead = ''): string[] {
  const tags = new Set<string>()
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (ext) tags.add(ext)
  if (mimeType.startsWith('image/')) tags.add('image')
  else if (ext === 'pdf') tags.add('pdf')
  else if (['csv', 'xls', 'xlsx', 'json'].includes(ext)) tags.add('data')
  else if (['py', 'js', 'ts', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) tags.add('code')
  else tags.add('doc')
  const hay = `${name} ${textHead.slice(0, 2000)}`
  for (const [re, tag] of TAG_KEYWORDS) if (re.test(hay)) tags.add(tag)
  return [...tags].slice(0, 6)
}

/** Build a vault entry from a freshly processed attachment + its source file hash. */
export function vaultEntryFrom(
  hash: string,
  a: { name: string; mimeType: string; size: number; kind: 'image' | 'doc'; dataUrl?: string; extractedText?: string },
): VaultFile {
  return {
    id: uid(),
    hash,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    kind: a.kind,
    dataUrl: a.dataUrl,
    extractedText: a.extractedText,
    tags: autoTags(a.name, a.mimeType, a.extractedText),
    usedIn: [],
    createdAt: Date.now(),
  }
}
