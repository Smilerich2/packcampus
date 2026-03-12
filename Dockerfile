FROM node:22-alpine AS build

ARG PUBLIC_GHOST_URL
ARG PUBLIC_GHOST_CONTENT_API_KEY
ARG ADMIN_PASSWORD
ARG SITE_PASSWORD

ENV PUBLIC_GHOST_URL=$PUBLIC_GHOST_URL
ENV PUBLIC_GHOST_CONTENT_API_KEY=$PUBLIC_GHOST_CONTENT_API_KEY
ENV ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV SITE_PASSWORD=$SITE_PASSWORD

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]
