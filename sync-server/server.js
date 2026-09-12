import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';

const PORT = Number(process.env.PORT || 1234);
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:8001';
// How often already-open connections are asked to re-prove access. Bounds
// the window between "removed from a workspace" and "actually disconnected"
// for a session that was already open at that moment (a brand new connection
// attempt is always checked immediately via onAuthenticate, regardless of
// this interval).
const REVALIDATE_INTERVAL_MS = Number(process.env.REVALIDATE_INTERVAL_MS || 2 * 60 * 1000);

// The durable copy of a document is still the `content` markdown column in
// Postgres, written by the clients (see useNoteEditor.js). This server does not
// produce that: converting a Y.Doc to markdown would need BlockNote's
// ProseMirror schema, a browser-oriented dependency, and a second
// implementation of the document format is the last thing this app needs.
//
// What it does keep is the room itself. A room used to exist only while
// somebody was in it, so an edit that no client managed to save — every client
// asleep, offline, or signed out — went with the room when the last one left,
// and the document reopened at whatever had last been stored. The room is now
// loaded from the backend when it opens and written back while it is in use and
// as it closes, as an opaque Yjs update: no schema needed, nothing lost.
// `content` stays the document; this is only how the room comes back.
//
// Authorization is delegated entirely to the existing backend rather than
// re-implemented here: a connecting client's document name is a file id,
// and its token is the same JWT the REST API already accepts, so asking the
// backend's own `GET /api/files/{id}` "can this user see this file" check
// is both correct (single source of truth for access rules) and requires
// zero new backend code.

// The tokens of the clients currently in each document, newest first, used to
// write the room back on somebody's behalf. The room is written with a
// person's own credentials rather than through a back door: only someone who
// may write the document may keep its room.
//
// A set rather than one token, because "the last person who arrived" is not
// the same as "somebody who may write". A reader — anyone in the shared
// workspace without write access, or someone looking at a colleague's folder
// — arriving in a room would otherwise become the account every save was
// attempted as, and every save would be refused for as long as they stayed.
// The room would then live only in this server's memory, which is the whole
// thing this exists to prevent.
const documentTokens = new Map();

function rememberToken(documentName, token) {
  if (!token) return;
  const tokens = documentTokens.get(documentName) || [];
  const without = tokens.filter((t) => t !== token);
  without.unshift(token);
  documentTokens.set(documentName, without);
}

function forgetToken(documentName, token) {
  const tokens = documentTokens.get(documentName);
  if (!tokens) return;
  const left = tokens.filter((t) => t !== token);
  if (left.length) documentTokens.set(documentName, left);
  else documentTokens.delete(documentName);
}

function tokensFor(documentName, preferred) {
  const tokens = documentTokens.get(documentName) || [];
  return preferred ? [preferred, ...tokens.filter((t) => t !== preferred)] : tokens;
}

async function loadCollabState(token, fileId) {
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND_INTERNAL_URL}/api/files/${fileId}/collab-state`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    // 204 is "no room kept yet" and 404 is "no such document any more" — in
    // both the first client seeds a room from the document's markdown, exactly
    // as before. Anything else is the backend having trouble, and answering
    // that with an empty room would let a client seed over what is kept.
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`backend answered ${res.status}`);
    const buffer = await res.arrayBuffer();
    return buffer.byteLength ? new Uint8Array(buffer) : null;
  } catch (error) {
    // Reading failed, so nothing is known about the room. Starting empty would
    // let the first client seed it from markdown and overwrite what is kept, so
    // the load is refused instead and the client retries.
    console.warn(`[sync] could not load state for ${fileId}: ${error.message}`);
    throw error;
  }
}

async function storeCollabState(fileId, state, preferredToken) {
  if (!state?.byteLength) return;
  const tokens = tokensFor(fileId, preferredToken);
  if (!tokens.length) throw new Error('nobody here can write this document');

  let lastStatus = null;
  for (const token of tokens) {
    const res = await fetch(`${BACKEND_INTERNAL_URL}/api/files/${fileId}/collab-state`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: state,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return;
    lastStatus = res.status;
    // This person cannot write it — either not allowed or no longer signed
    // in. Somebody else in the room may be able to, so try them; and stop
    // counting on this one.
    if (res.status === 401 || res.status === 403) {
      forgetToken(fileId, token);
      continue;
    }
    // Anything else is the backend having trouble, which the next person's
    // token will not fix.
    break;
  }
  // Thrown on purpose: Hocuspocus keeps a document whose store failed in
  // memory rather than unloading it, and tries again.
  throw new Error(`backend answered ${lastStatus ?? 'nothing usable'}`);
}

// Three answers, not two. "The backend says no" and "the backend could not be
// asked" are different things, and treating the second as the first is what
// made a deploy throw everyone out of the document they were editing: the
// backend restarts for a few seconds, every check fails, and every client is
// told it has no permission — which is both untrue and, for a connection that
// was already allowed, the wrong thing to do about it.
const ALLOWED = 'allowed';
const REFUSED = 'refused';
const UNKNOWN = 'unknown';

async function checkFileAccess(token, fileId) {
  if (!token) return REFUSED;
  try {
    const res = await fetch(`${BACKEND_INTERNAL_URL}/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) return ALLOWED;
    if (res.status === 401 || res.status === 403 || res.status === 404) return REFUSED;
    return UNKNOWN;   // 500, 502, anything else the backend says while unwell
  } catch {
    return UNKNOWN;   // never answered at all
  }
}

async function canAccessFile(token, fileId) {
  // A new connection is only let in on a clear yes, but one unlucky moment
  // should not turn somebody away, so an unclear answer is asked again.
  let verdict = await checkFileAccess(token, fileId);
  if (verdict === UNKNOWN) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    verdict = await checkFileAccess(token, fileId);
  }
  return verdict === ALLOWED;
}

const server = new Server({
  port: PORT,
  async onAuthenticate({ token, documentName }) {
    if (!(await canAccessFile(token, documentName))) {
      throw new Error('문서에 접근할 권한이 없습니다.');
    }
    rememberToken(documentName, token);
    // Handed to every hook for this connection, so a store triggered by this
    // person's edit is written as them.
    return { token };
  },

  async onLoadDocument({ documentName, document, context }) {
    if (document.isEmpty('blocknote')) {
      const state = await loadCollabState(context?.token || tokensFor(documentName)[0], documentName);
      if (state) Y.applyUpdate(document, state);
    }
    return document;
  },

  async onStoreDocument({ documentName, document, context }) {
    await storeCollabState(documentName, Y.encodeStateAsUpdate(document), context?.token);
  },

  async afterUnloadDocument({ documentName }) {
    documentTokens.delete(documentName);
  },
  // Fires when a client responds to connection.requestToken() (see the
  // periodic sweep below) with its current token. Re-runs the exact same
  // access check as onAuthenticate — a workspace removal that happens while
  // someone already has the document open wouldn't otherwise be noticed
  // until they disconnect on their own (onAuthenticate only runs once, at
  // the initial handshake).
  async onTokenSync({ token, documentName, connection }) {
    // Only an actual refusal ends a session that is already under way. If the
    // backend cannot be reached, the person carries on editing and is asked
    // again at the next sweep — the same as any other minute in which nothing
    // was checked at all.
    if (await checkFileAccess(token, documentName) === REFUSED) {
      console.log(`[sync] access withdrawn, closing: ${documentName}`);
      connection.close();
    }
  },
  async onConnect({ documentName }) {
    console.log(`[sync] client connected: ${documentName}`);
  },
  async onDisconnect({ documentName }) {
    // Deliberately keeps their token. The room's last save happens *after*
    // the last person leaves — that is the whole point of keeping it — and
    // taking their credentials away as they go would leave that save with
    // nobody to make it. They are dropped when the room itself is
    // (afterUnloadDocument), and a token that has since expired is skipped
    // by the store, which simply tries the next person's.
    console.log(`[sync] client disconnected: ${documentName}`);
  }
});

setInterval(() => {
  for (const document of server.hocuspocus.documents.values()) {
    for (const connection of document.connections.keys()) {
      connection.requestToken();
    }
  }
}, REVALIDATE_INTERVAL_MS);

server.listen();
