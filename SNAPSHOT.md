# Current Usable Version Snapshot

This repository node freezes the last verified working version before the
large-scale redesign starts.

## Version

- Tag: `v1.0.0-pre-redesign-20260727`
- Source workspace: `/Users/bytedance/Documents/Codex/new2`
- Repository: `dafei-max/refra`
- Snapshot date: `2026-07-27`

## Included In Git

- Application server and frontend source
- Prompt and pipeline configuration
- Style presets and integrated-layout references
- Material library images and metadata
- Creative method cards and Good/Bad cases
- Doudou IP references
- Fonts, overlay assets, documentation, and supporting tools
- Persisted material uploads referenced by `data/materials.json`

## Stored In The Full Snapshot Bundle

Runtime-generated KV images, split-layer outputs, and transient user reference
uploads are stored in the matching full snapshot bundle under
`release-bundles/`. They are intentionally ignored by Git so normal generation
does not dirty the source tree.

Bundle:

```text
refra-v1.0.0-pre-redesign-20260727-full.tar.gz
SHA-256 5c8ec800001c19699f8b32545e2c976e373ec057f351b555f7fd1e63b359f917
```

Earlier archives from the source workspace are not nested into this snapshot.

## Restore

Restore the application source to this exact node:

```bash
git fetch --tags
git switch --detach v1.0.0-pre-redesign-20260727
```

To create a working rollback branch:

```bash
git switch -c rollback/pre-redesign v1.0.0-pre-redesign-20260727
```

If the historical generated assets are also required, extract the matching
full snapshot bundle over the repository root after checking out the tag.

## Start

```bash
OPENAI_API_KEY="your-key" \
OPENAI_TEXT_MAX_OUTPUT_TOKENS=4096 \
PORT=5174 \
node server.mjs
```
