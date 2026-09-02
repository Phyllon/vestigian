# No dependencies, no build step: bouncer.mjs uses only Node's own global
# fetch. Alpine keeps the image in the tens-of-MB range for what is a single
# long-running poll loop.
FROM node:26-alpine

WORKDIR /app
COPY bouncer.mjs .

USER node
CMD ["node", "bouncer.mjs"]
