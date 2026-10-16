import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { nodeStartupError } from "../../scripts/check-node.mjs";
import { routeHttp } from "@/server/routes";
import { assertProductionToken } from "@/server/oauth";

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function toRequest(req: IncomingMessage, body: Buffer, port: number) {
  const host = req.headers.host || `127.0.0.1:${port}`;
  const url = `http://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else headers.set(key, value);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: body.length > 0 && req.method !== "GET" && req.method !== "HEAD" ? new Uint8Array(body) : undefined,
  });
}

async function writeResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export function startServer(port = 0, host = "127.0.0.1") {
  const nodeMessage = nodeStartupError();
  if (nodeMessage) throw new Error(nodeMessage);
  assertProductionToken();
  const server = createServer(async (req, res) => {
    try {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      const body = await readBody(req);
      const request = toRequest(req, body, bound);
      const response = await routeHttp(request);
      await writeResponse(res, response);
    } catch {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });

  return new Promise<{ port: number; url: string; close: () => Promise<void> }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        port: bound,
        url: `http://127.0.0.1:${bound}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

const invoked = process.argv[1]?.includes("standalone");
if (invoked) {
  const port = Number(process.env.PORT || 43123);
  const host = process.env.HOST || "127.0.0.1";
  startServer(port, host).then((server) => {
    console.log(`Talk2Build MCP listening on ${server.url}/mcp`);
  });
}
