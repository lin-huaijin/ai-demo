# Foreplay MCP wrapper

A small local [MCP](https://modelcontextprotocol.io) server that wraps the
[Foreplay](https://www.foreplay.co) Ad Library REST API, so a local AI
workflow can **search competitor ads by keyword / niche /
format** instead of scraping a single URL.

Why local instead of Foreplay's hosted MCP? The official endpoint
(`https://public.api.foreplay.co/mcp`) authenticates via OAuth sign-in and does
not accept an API key in a header, so it can't be wired up head-lessly. This
wrapper uses your REST API key (env var), exposes clean typed tools, and is
reproducible / version-controlled with the repo.

## Tools

| Tool | Source | Key params |
|------|--------|-----------|
| `foreplay_search_ads` | Discovery (200M+ ad library) | `query`, `niches[]`, `product_category`, `display_format` (video\|image), `publisher_platform`, `market_target`, `languages`, `live`, `order`, `limit`, `offset`, `cursor` |
| `foreplay_swipefile_ads` | Your saved swipe file | same filters + `start_date` / `end_date` |
| `foreplay_spyder_brands` | Brands you track in Spyder | `limit`, `offset` |

Each returned ad is trimmed to a rich-but-compact set: `name` / `headline` /
`description`, `full_transcription`, `image` / `video` / `thumbnail`,
`is_video`, `publisher_platform`, `niches` / `product_category`,
`emotional_drivers`, `persona`, `live`, `started_running`, `running_duration`.
Pass `raw: true` to get the full ad objects.

## Setup

```bash
cd mcp/foreplay
npm install
```

Get your API key at [app.foreplay.co/api-overview](https://app.foreplay.co/api-overview),
then add this server to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "foreplay": {
      "command": "node",
      "args": ["<repo>/mcp/foreplay/index.mjs"],
      "env": { "FOREPLAY_API_KEY": "<your key>" }
    }
  }
}
```

Reload MCP in **Cursor Settings → MCP & Integrations**; the three tools should
appear under `foreplay`.

## Verify

```bash
# Tool listing only (no network, no key needed)
node smoke-test.mjs

# Live call (needs a valid key)
FOREPLAY_API_KEY=<your key> node -e "import('@modelcontextprotocol/sdk/client/index.js')" # or just use the tool from Cursor
```

Auth is sent as `Authorization: <key>` (no `Bearer` prefix). Each ad returned by
Discovery / Swipe File costs 1 Foreplay credit; `x-credits-remaining` is surfaced
in every tool response as `creditsRemaining`.

## Env

| Var | Required | Default |
|-----|----------|---------|
| `FOREPLAY_API_KEY` | yes | — |
| `FOREPLAY_BASE_URL` | no | `https://public.api.foreplay.co` |
