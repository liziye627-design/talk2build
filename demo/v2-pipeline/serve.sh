#!/bin/bash
P=$(ss -ltnp | rg 43123 | rg -o 'pid=\d+' | cut -d= -f2); [ -n "$P" ] && kill $P && sleep 1
rm -rf /workspace/rec2/home && mkdir -p /workspace/rec2/home
cd /workspace/t2b && export PATH=/workspace/tools/node-v22.23.3-linux-x64/bin:$PATH
TALK2BUILD_HOME=/workspace/rec2/home LLM_PROVIDER=mock TALK2BUILD_AGENT=mock MCP_DEMO_TOKEN=$(openssl rand -hex 16) TALK2BUILD_SESSION_SECRET=$(openssl rand -hex 24) TALK2BUILD_JOB_PACE_MS=${PACE:-650} nohup npm start > /workspace/rec2/server.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:43123/health >/dev/null && echo up && exit 0; sleep 1; done; echo fail
