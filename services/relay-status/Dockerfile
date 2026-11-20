FROM node:24-alpine
WORKDIR /app
COPY usage.mjs providers.mjs page.mjs server.mjs ./
ENV NODE_NO_WARNINGS=1 DATA_DIR=/data PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
