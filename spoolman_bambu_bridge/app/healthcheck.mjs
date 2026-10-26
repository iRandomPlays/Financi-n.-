const r = await fetch(`http://127.0.0.1:${process.env.PORT || 8099}/health`).catch(() => null);
process.exit(r && r.ok ? 0 : 1);
