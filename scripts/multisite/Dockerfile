# Multi-site test agent: the built app + headless Chromium + network shaping.
# Build context is prepared by run.mjs (dist/ copied next to this file).
FROM mcr.microsoft.com/playwright:v1.65.1-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends iptables iproute2 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /agent
RUN npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.65.1
COPY dist ./dist
COPY agent.mjs netprofile.sh ./
RUN chmod +x netprofile.sh
ENTRYPOINT ["/agent/netprofile.sh"]
