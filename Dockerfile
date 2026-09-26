# Local MCP server for inspection/testing (production runs on Cloudflare Workers at https://mcp.dgfloors.com)
FROM node:20-slim
WORKDIR /app
COPY package.json wrangler.jsonc schema.sql ./
COPY src ./src
RUN npm install --no-audit --no-fund
EXPOSE 8787
# Local dev mode needs no Cloudflare account; the D1 usage log is simulated locally
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", "--local"]
