import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { requireSpace } from '../lib/http.js';
import { getUser, getRole } from '../lib/http.js';
import { TOOLS, toolList, callTool } from './tools.js';
import {
  issuerUrl, storeCode, takeCode, pkceMatches, issueTokenPair, verifyMcpToken, isRevoked, touchToken, sha,
} from './oauth.js';

/**
 * MCP 2025-11-25 server: Streamable HTTP JSON-RPC at POST /api/mcp,
 * OAuth 2.1 authorization server (RFC 9728 discovery + RFC 7591 DCR + PKCE),
 * plus management endpoints (stats/logs) and a machine-readable tool manifest.
 */

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'set', version: '2.1.0' };

const rpcError = (id: any, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

async function handleRpc(req: FastifyRequest, reply: FastifyReply, message: any, auth: { userId: string; spaceId: string; clientId: string; scope: string; role: string; token: string }) {
  const { method, id, params } = message ?? {};
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
            logging: {},
          },
          serverInfo: SERVER_INFO,
        },
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      reply.status(202);
      return null; // notification — no response body
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'logging/setLevel':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolList() } };
    case 'tools/call': {
      const started = Date.now();
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        const { scope: needed, result } = await callTool(name, args, { userId: auth.userId, spaceId: auth.spaceId, role: auth.role });
        if (!auth.scope.split(' ').includes(needed)) {
          throw new Error(`Tool requires the ${needed} scope (granted: ${auth.scope})`);
        }
        const duration = Date.now() - started;
        void q(
          `INSERT INTO mcp_calls (user_id, space_id, client_id, tool, ok, duration_ms) VALUES ($1,$2,$3,$4,true,$5)`,
          [auth.userId, auth.spaceId, auth.clientId, name, duration]
        ).catch(() => {});
        void touchToken(auth.token, auth.userId, auth.clientId);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false },
        };
      } catch (e: any) {
        const duration = Date.now() - started;
        void q(
          `INSERT INTO mcp_calls (user_id, space_id, client_id, tool, ok, duration_ms, error) VALUES ($1,$2,$3,$4,false,$5,$6)`,
          [auth.userId, auth.spaceId, auth.clientId, name ?? 'unknown', duration, e.message ?? String(e)]
        ).catch(() => {});
        // tool execution errors are RESULTS (isError), not protocol errors
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true },
        };
      }
    }
    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            { uri: 'set://mytasks', name: 'My tasks', description: 'Assigned paths and open checkbox tasks', mimeType: 'application/json' },
            { uri: 'set://pages', name: 'Pages index', description: 'All workspace pages (id, title)', mimeType: 'application/json' },
          ],
        },
      };
    case 'resources/read': {
      const uri = String(params?.uri ?? '');
      if (uri === 'set://mytasks') {
        const tool = TOOLS.find((t) => t.name === 'list_my_tasks')!;
        const result = await tool.run({}, { userId: auth.userId, spaceId: auth.spaceId, role: auth.role });
        return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result) }] } };
      }
      if (uri === 'set://pages') {
        const rows = await q(`SELECT id, title FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false ORDER BY title`, [auth.spaceId]);
        return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ pages: rows }) }] } };
      }
      const pageMatch = uri.match(/^set:\/\/pages\/([0-9a-f-]{36})$/);
      if (pageMatch) {
        const page = await one<any>(`SELECT title, markdown FROM pages WHERE id = $1 AND space_id = $2 AND deleted_at IS NULL`, [pageMatch[1], auth.spaceId]);
        if (!page) return rpcError(id, -32002, 'Resource not found');
        return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'text/markdown', text: `# ${page.title}\n\n${page.markdown}` }] } };
      }
      return rpcError(id, -32002, 'Unknown resource URI');
    }
    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'set/daily-brief',
              title: 'Daily brief',
              description: 'Summarize my tasks, due assignments and unread notifications into a morning brief.',
              arguments: [],
            },
            {
              name: 'set/research-brief',
              title: 'Research brief',
              description: 'Answer a question grounded in a notebook\u2019s sources with citations.',
              arguments: [{ name: 'question', description: 'The question to research', required: true }, { name: 'notebookId', description: 'Notebook id (optional)', required: false }],
            },
            {
              name: 'set/page-outline',
              title: 'Page outline',
              description: 'Produce a structured Markdown outline for a new page on a topic.',
              arguments: [{ name: 'topic', description: 'Topic of the page', required: true }],
            },
          ],
        },
      };
    case 'prompts/get': {
      const name = String(params?.name ?? '');
      const args = params?.arguments ?? {};
      if (name === 'set/daily-brief') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Daily brief',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: 'Use list_my_tasks and list_notifications, then write a concise daily brief: what is due, what to work on first, and anything needing my attention.',
                },
              },
            ],
          },
        };
      }
      if (name === 'set/research-brief') {
        const nbArg = args.notebookId ? `, notebookId: ${args.notebookId}` : '';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Research brief',
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: `Use search_knowledge (query: ${JSON.stringify(args.question ?? '')}${nbArg}) and answer with citations to the returned source names.` },
              },
            ],
          },
        };
      }
      if (name === 'set/page-outline') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Page outline',
            messages: [
              { role: 'user', content: { type: 'text', text: `Draft a Markdown outline for a page about: ${args.topic}. Then use create_page with the title and the outline.` } },
            ],
          },
        };
      }
      return rpcError(id, -32002, 'Unknown prompt');
    }
    case 'completion/complete':
      return { jsonrpc: '2.0', id, result: { completion: { values: [], total: 0, hasMore: false } } };
    default:
      if (String(method ?? '').startsWith('notifications/')) {
        reply.status(202);
        return null;
      }
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function mcpRoutes(app: FastifyInstance) {
  // ---- MCP endpoint (Streamable HTTP) ----
  app.post('/mcp', async (req, reply) => {
    if (!config.mcpEnabled) return reply.code(404).send({ error: 'MCP is disabled on this server' });
    reply.header('content-type', 'application/json');

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      reply.status(401).header('www-authenticate', 'Bearer resource_metadata="' + issuerUrl(req) + '/.well-known/oauth-protected-resource"');
      return { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unauthorized: MCP requires a Bearer access token' } };
    }
    const claims = verifyMcpToken(token);
    if (!claims || (await isRevoked(token))) {
      reply.status(401).header('www-authenticate', 'Bearer');
      return { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Invalid or revoked access token' } };
    }
    const role = await getRole(claims.sub, claims.space);
    if (!role) {
      reply.status(403);
      return { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No access to this workspace' } };
    }
    const auth = { userId: claims.sub, spaceId: claims.space, clientId: claims.client_id, scope: claims.scope, role, token };

    const body: any = req.body;
    if (Array.isArray(body)) {
      const out: any[] = [];
      for (const message of body) {
        const res = await handleRpc(req, reply, message, auth);
        if (res) out.push(res);
      }
      return out;
    }
    const res = await handleRpc(req, reply, body, auth);
    return res ?? reply.status(202).send();
  });

  // ---- RFC 9728 / AS metadata + DCR ----
  app.get('/.well-known/oauth-protected-resource', async (req) => ({
    resource: issuerUrl(req) + '/api/mcp',
    authorization_servers: [issuerUrl(req)],
  }));

  app.get('/.well-known/oauth-authorization-server', async (req) => {
    const iss = issuerUrl(req);
    return {
      issuer: iss,
      authorization_endpoint: iss + '/api/oauth/authorize',
      token_endpoint: iss + '/api/oauth/token',
      revocation_endpoint: iss + '/api/oauth/revoke',
      registration_endpoint: iss + '/api/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['mcp:read', 'mcp:write'],
    };
  });

  app.post('/oauth/register', async (req, reply) => {
    const body = z
      .object({
        client_name: z.string().min(1).max(120).default('MCP client'),
        redirect_uris: z.array(z.string().url()).min(1).max(10),
      })
      .passthrough()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_client_metadata', error_description: 'client_name and redirect_uris are required' });
    const clientId = crypto.randomBytes(16).toString('hex');
    await q(`INSERT INTO mcp_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`, [
      clientId,
      body.data.client_name,
      JSON.stringify(body.data.redirect_uris),
    ]);
    return {
      client_id: clientId,
      client_name: body.data.client_name,
      redirect_uris: body.data.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      code_challenge_method: 'S256',
    };
  });

  // ---- Authorization endpoint (renders consent via the web app) ----
  app.get('/oauth/authorize', async (req, reply) => {
    const u = new URL(req.url, issuerUrl(req));
    const clientId = u.searchParams.get('client_id') ?? '';
    const redirectUri = u.searchParams.get('redirect_uri') ?? '';
    const challenge = u.searchParams.get('code_challenge') ?? '';
    const method = u.searchParams.get('code_challenge_method') ?? '';
    const state = u.searchParams.get('state') ?? '';
    const resource = u.searchParams.get('resource') ?? '';
    if (!clientId || !redirectUri || !challenge) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'client_id, redirect_uri and code_challenge are required' });
    }
    if (method !== 'S256') {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'code_challenge_method must be S256' });
    }
    const client = await one<any>(`SELECT * FROM mcp_clients WHERE client_id = $1`, [clientId]);
    if (!client || !(client.redirect_uris ?? []).includes(redirectUri)) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'Unknown client or redirect_uri not registered' });
    }
    const user = getUser(req);
    if (!user) {
      const next = encodeURIComponent(req.url);
      return reply.redirect(`/login?next=${next}`);
    }
    // authenticated: serve the consent page (web app route) with query passthrough
    const consent = `/oauth/consent?client_id=${encodeURIComponent(clientId)}&client_name=${encodeURIComponent(client.client_name)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}&resource=${encodeURIComponent(resource)}`;
    return reply.redirect(consent);
  });

  // Consent decision (called by the consent page after the user picks scope + space)
  app.post('/oauth/consent', async (req, reply) => {
    const user = getUser(req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const body = z
      .object({
        clientId: z.string(),
        spaceId: z.string(),
        scope: z.enum(['mcp:read', 'mcp:read mcp:write']),
        redirectUri: z.string().url(),
        codeChallenge: z.string(),
        state: z.string().default(''),
      })
      .parse(req.body);
    const role = await getRole(user.id, body.spaceId);
    if (!role) return reply.code(403).send({ error: 'No access to that workspace' });
    const client = await one<any>(`SELECT * FROM mcp_clients WHERE client_id = $1`, [body.clientId]);
    if (!client || !(client.redirect_uris ?? []).includes(body.redirectUri)) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'Unknown client or redirect_uri' });
    }
    const code = storeCode(user.id, body.spaceId, body.clientId, body.scope, body.codeChallenge, body.redirectUri);
    const sep = body.redirectUri.includes('?') ? '&' : '?';
    const target = `${body.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(body.state)}`;
    return { redirect_to: target };
  });

  app.post('/oauth/token', async (req, reply) => {
    const b = req.body as any;
    if (b?.grant_type === 'authorization_code') {
      const rec = takeCode(String(b.code ?? ''));
      if (!rec) return reply.code(400).send({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' });
      if (!b.redirect_uri || b.redirect_uri !== rec.redirectUri) {
        return reply.code(400).send({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }
      if (!pkceMatches(rec.challenge, String(b.code_verifier ?? ''))) {
        return reply.code(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
      return issueTokenPair(rec.userId, rec.spaceId, rec.clientId, rec.scope);
    }
    if (b?.grant_type === 'refresh_token') {
      let claims: any = null;
      try {
        claims = jwt.verify(String(b.refresh_token ?? ''), config.jwtSecret);
      } catch {
        return reply.code(400).send({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' });
      }
      if (claims.typ !== 'refresh') return reply.code(400).send({ error: 'invalid_grant' });
      const stored = await one<{ status: string }>(`SELECT status FROM mcp_tokens WHERE refresh_hash = $1`, [sha(b.refresh_token)]);
      if (!stored || stored.status !== 'active') return reply.code(400).send({ error: 'invalid_grant', error_description: 'Token revoked' });
      await q(`UPDATE mcp_tokens SET status = 'revoked' WHERE refresh_hash = $1`, [sha(b.refresh_token)]);
      return issueTokenPair(claims.sub, claims.space, claims.client_id, claims.scope);
    }
    return reply.code(400).send({ error: 'unsupported_grant_type' });
  });

  app.post('/oauth/revoke', async (req, reply) => {
    const b = req.body as any;
    if (b?.token) {
      await q(`UPDATE mcp_tokens SET status = 'revoked' WHERE token_hash = $1 OR refresh_hash = $1`, [sha(b.token)]).catch(() => {});
    }
    reply.status(200);
    return {};
  });

  // ---- Management: stats, logs, token revoke (owner role via session JWT) ----
  app.get('/spaces/:spaceId/mcp/stats', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const perTool = await q(
      `SELECT tool, count(*)::int AS calls, round(100.0 * count(*) FILTER (WHERE ok) / greatest(count(*),1))::int AS success_rate,
        percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
       FROM mcp_calls WHERE space_id = $1 AND created_at > now() - interval '7 days' GROUP BY tool ORDER BY calls DESC`,
      [spaceId]
    );
    const clients = await q(
      `SELECT c.client_id, c.client_name, c.last_seen_at, count(t.id)::int AS active_tokens
       FROM mcp_clients c LEFT JOIN mcp_tokens t ON t.client_id = c.client_id AND t.status = 'active'
       GROUP BY c.client_id, c.client_name, c.last_seen_at ORDER BY c.last_seen_at DESC NULLS LAST`,
    );
    const totals = await one(
      `SELECT count(*)::int AS calls_7d, round(100.0 * count(*) FILTER (WHERE ok) / greatest(count(*),1))::int AS success_rate
       FROM mcp_calls WHERE space_id = $1 AND created_at > now() - interval '7 days'`,
      [spaceId]
    );
    return { perTool, clients, totals };
  });

  app.get('/spaces/:spaceId/mcp/logs', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const rows = await q(
      `SELECT l.tool, l.ok, l.duration_ms, l.error, l.created_at, c.client_name, u.name AS user_name
       FROM mcp_calls l LEFT JOIN mcp_clients c ON c.client_id = l.client_id
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.space_id = $1 ORDER BY l.created_at DESC LIMIT 200`,
      [spaceId]
    );
    return { logs: rows };
  });

  app.get('/spaces/:spaceId/mcp/tokens', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const rows = await q(
      `SELECT t.id, t.client_id, c.client_name, t.scope, t.status, t.created_at, t.last_used_at
       FROM mcp_tokens t LEFT JOIN mcp_clients c ON c.client_id = t.client_id
       WHERE t.space_id = $1 AND t.status = 'active' ORDER BY t.last_used_at DESC NULLS LAST`,
      [spaceId]
    );
    return { tokens: rows };
  });

  app.post('/spaces/:spaceId/mcp/tokens/:tokenId/revoke', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    await q(`UPDATE mcp_tokens SET status = 'revoked' WHERE id = $1 AND space_id = $2`, [(req.params as any).tokenId, spaceId]);
    return { ok: true };
  });

  // Machine-readable tool manifest (store review material)
  app.get('/mcp/docs.json', async (req) => ({
    server: SERVER_INFO,
    protocolVersion: PROTOCOL_VERSION,
    endpoint: issuerUrl(req) + '/api/mcp',
    auth: {
      flow: 'OAuth 2.1 authorization code + PKCE (S256)',
      discovery: issuerUrl(req) + '/.well-known/oauth-authorization-server',
      dynamicRegistration: issuerUrl(req) + '/api/oauth/register',
      scopes: ['mcp:read', 'mcp:write'],
    },
    tools: toolList(),
    prompts: ['set/daily-brief', 'set/research-brief', 'set/page-outline'],
    resources: ['set://pages', 'set://pages/{id}', 'set://mytasks'],
  }));
}
