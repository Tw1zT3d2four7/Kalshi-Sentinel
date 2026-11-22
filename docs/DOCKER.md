# Docker deployment

Kalshi Sentinel runs as a Discord bot container alongside MongoDB. The bot
connects to Discord and Kalshi over outbound connections; no host ports need
to be published.

## Requirements

- Docker Engine with the Compose plugin
- A Discord application and bot token
- A 32-byte encryption key, represented as 64 hexadecimal characters

## Configure

From the repository root:

```bash
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `ENCRYPTION_KEY` in `.env`, then fill in
`CLIENT_TOKEN` and `APPLICATION_ID`. Keep `.env` private and do not commit
it. The Compose file supplies the internal MongoDB URI automatically.

The default `KALSHI_BASE_URL` is the Kalshi demo API. Keep this setting for
initial testing. Changing it to a live endpoint can enable real-money order
execution, including automatic stop-loss orders. Do not switch to live until
you have independently reviewed and tested the trading behavior.

## Build and start

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f kalshi-sentinel
```

MongoDB has a health check, and Compose waits for it to become healthy before
starting the bot. MongoDB data is stored in the named
`kalshi_sentinel_mongodb_data` volume and survives container recreation.

## Stop and update

```bash
docker compose down
docker compose build --pull
docker compose up -d
```

Do not add `-v` to `docker compose down` unless you intentionally want to
delete the MongoDB data volume.

## Build a standalone image

```bash
docker build -t kalshi-sentinel:latest .
```

The image expects `CLIENT_TOKEN`, `APPLICATION_ID`, `ENCRYPTION_KEY`, and
`MONGODB_URI` at runtime. For a standalone container, supply these through a
secure environment file or secret manager and point `MONGODB_URI` at a
reachable MongoDB instance.

## GitHub Container Registry

The GitHub Actions workflow builds the image for pull requests. Pushes to
`main` and version tags publish it to GHCR. The published image name is
`ghcr.io/tw1zt3d2four7/kalshi-sentinel`.
