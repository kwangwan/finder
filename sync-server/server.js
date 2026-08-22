import { Server } from '@hocuspocus/server';

const PORT = Number(process.env.PORT || 1234);
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:8001';
// How often already-open connections are asked to re-prove access. Bounds
// the window between "removed from a workspace" and "actually disconnected"
// for a session that was already open at that moment (a brand new connection
// attempt is always checked immediately via onAuthenticate, regardless of
// this interval).
const REVALIDATE_INTERVAL_MS = 2 * 60 * 1000;

// This server only relays Yjs updates between connected clients — it never
// persists document state itself. The durable copy of a document always
// stays the `content` markdown column in Postgres, written by whichever
// client's autosave fires (see NoteEditor.jsx); a document with no
// connected clients simply has no live room, and the next client to join
// re-seeds it from that markdown. This keeps the sync server stateless and
// avoids needing BlockNote's ProseMirror schema (a browser-oriented
// dependency) inside this Node process just to convert Y.Doc <-> markdown.
//
// Authorization is delegated entirely to the existing backend rather than
// re-implemented here: a connecting client's document name is a file id,
// and its token is the same JWT the REST API already accepts, so asking the
// backend's own `GET /api/files/{id}` "can this user see this file" check
// is both correct (single source of truth for access rules) and requires
// zero new backend code.
async function canAccessFile(token, fileId) {
  if (!token) return false;
  try {
    const res = await fetch(`${BACKEND_INTERNAL_URL}/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

const server = new Server({
  port: PORT,
  async onAuthenticate({ token, documentName }) {
    if (!(await canAccessFile(token, documentName))) {
      throw new Error('문서에 접근할 권한이 없습니다.');
    }
  },
  // Fires when a client responds to connection.requestToken() (see the
  // periodic sweep below) with its current token. Re-runs the exact same
  // access check as onAuthenticate — a workspace removal that happens while
  // someone already has the document open wouldn't otherwise be noticed
  // until they disconnect on their own (onAuthenticate only runs once, at
  // the initial handshake).
  async onTokenSync({ token, documentName, connection }) {
    if (!(await canAccessFile(token, documentName))) {
      connection.close();
    }
  },
  async onConnect({ documentName }) {
    console.log(`[sync] client connected: ${documentName}`);
  },
  async onDisconnect({ documentName }) {
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
