# Screaming Frog Local Bridge

Screaming Frog runs on your Windows desktop; the SEO Operator runs in the cloud.
This tiny bridge lets the two talk to each other.

## What it does
- Exposes a small HTTP API around `ScreamingFrogSEOSpiderCli.exe`.
- The cloud app sends crawl requests; the bridge runs SF locally and returns
  the CSV exports.

## One-time setup
1. **Install Python 3.10+** for Windows: <https://www.python.org/downloads/windows/>
   (tick "Add Python to PATH" during install).
2. **Install Screaming Frog SEO Spider** v19+ with a valid license.
3. **Install ngrok**: <https://ngrok.com/download> and sign in once (`ngrok config add-authtoken …`).
4. **Install bridge dependencies** in PowerShell:
   ```powershell
   pip install fastapi uvicorn
   ```

## Run it
Pick a random shared secret (any string, e.g. a UUID). Then in two PowerShell
windows:

**Window 1 — bridge:**
```powershell
python sf_bridge.py --token "MY-SECRET-123" --port 8765
```

**Window 2 — tunnel:**
```powershell
ngrok http 8765
```

Copy the `https://…ngrok-free.app` URL ngrok prints out.

## Paste into SEO Operator
In the app go to **Integrations → Screaming Frog bridge**:
- **Bridge URL**: the ngrok `https://…` URL
- **Token**: the same secret you passed to `--token`

Click **Test connection**. You should see "Connected".

## Notes
- The bridge stores crawl outputs in `./sf_jobs/<job-id>/` next to the script.
- Each crawl returns CSV files (Issues, Internal:All, Page Titles, etc.) which
  the SEO Operator parses automatically into the Technical Audit pipeline.
- Keep both PowerShell windows open while you want the bridge reachable.
- Leaving ngrok running on a free plan rotates the URL each session — paste
  the fresh URL back into the app if you restart.
