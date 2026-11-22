# Docker deployment

Kalshi Sentinel runs as a Discord bot container alongside MongoDB. The bot
connects to Discord and Kalshi over outbound connections; no host ports need
to be published. Compose pulls the prebuilt multi-platform image from GitHub
Container Registry; the server does not need to clone the repository or build
the image locally.

## Requirements

- Docker Engine with the Docker Compose plugin
- A Discord application with a bot user/token
- A 32-byte encryption key, represented as 64 hexadecimal characters

## Configure the .env file

From the directory containing `docker-compose.yml`:

```bash
cp .env.example .env
openssl rand -hex 32
```

The OpenSSL command prints a fresh 64-character hexadecimal encryption key.
Edit `.env` and set these values:

```dotenv
# Discord Developer Portal > Your Application > Bot
CLIENT_TOKEN=your_discord_bot_token
# Discord Developer Portal > Your Application > General Information
APPLICATION_ID=your_discord_application_id

# Paste the output from: openssl rand -hex 32
ENCRYPTION_KEY=64_character_hex_value_from_openssl

# Keep the demo endpoint for initial setup and testing.
KALSHI_BASE_URL=https://demo-api.kalshi.co
```

### What each variable means

- `CLIENT_TOKEN`: the Discord bot token from the Bot page in the Discord
  Developer Portal. Treat it like a password; never post it or commit it.
- `APPLICATION_ID`: the Application ID shown under General Information in
  the Discord Developer Portal. This is not the bot token.
- `ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 bytes). Generate
  it with `openssl rand -hex 32`. Keep it stable: changing it later can make
  previously encrypted credentials unreadable.
- `KALSHI_BASE_URL`: defaults to the Kalshi demo API. Leave it unchanged
  while configuring and testing.

Do not put your Kalshi API private key or API key in this file for this setup;
users link their own Kalshi credentials through the bot's `/link` command.
Keep `.env` private and do not commit it. Compose supplies the internal
MongoDB connection string automatically.

**Live-trading warning:** changing `KALSHI_BASE_URL` to a live endpoint can
enable real-money order execution, including automatic stop-loss orders.
Do not switch to live until you have independently reviewed and tested the
trading behavior and deliberately intend to use real funds.

## Start the service

After saving `.env`:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f kalshi-sentinel
```

Compose waits for MongoDB's health check before starting the bot. MongoDB
data is stored in the named `kalshi_sentinel_mongodb_data` volume and
survives container recreation and image updates.

## Update to the latest image

```bash
docker compose pull
docker compose up -d
docker compose ps
```

To stop the services:

```bash
docker compose down
```

Do not add `-v` to `docker compose down` unless you intentionally want to
delete the MongoDB data volume and its stored data.

## Published image

The workflow builds pull requests for validation. Pushes to `main` publish
the `latest` and `main` tags. Version tags beginning with `v` publish
versioned tags. The multi-platform image is:

```
ghcr.io/tw1zt3d2four7/kalshi-sentinel:latest
```
