#!/usr/bin/env python3
"""Build the MCP guide-search index (D1 FTS5) from live WordPress.

  python3 -u cf_route.py dgfloors-mcp/build_guides_index.py fetch   # ~10 min, paced; writes data/guides.jsonl
  python3 dgfloors-mcp/build_guides_index.py sql                    # writes data/guides_*.sql chunks
  then (owner): for f in dgfloors-mcp/data/guides_*.sql; do npx wrangler d1 execute dgfloors-mcp --remote -y --file=$f; done

Why: the Worker's live WP REST search gets 403 "Request forbidden by administrative rules"
from the origin (found 2026-11-13), and WP search ranks loosely. A bundled FTS index needs no WP call.
"""
import html, json, os, re, sys, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
JSONL = os.path.join(DATA, "guides.jsonl")
API = "https://dgfloors.com/wp-json/wp/v2"
UA = {"User-Agent": "curl/8.4.0", "Accept": "*/*"}
ROWS_PER_SQL = 2000


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 400:  # past the last page
                return [], {}
            wait = 30 * (i + 1) if e.code in (429, 503) else 5 * (i + 1)
            print(f"  HTTP {e.code} on {url[-60:]}; retry in {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:
            print(f"  {e!r}; retry", flush=True)
            time.sleep(5 * (i + 1))
    raise SystemExit("giving up: " + url)


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def fetch():
    os.makedirs(DATA, exist_ok=True)
    cats, _ = get(f"{API}/categories?per_page=100&_fields=id,name")
    cat = {c["id"]: clean(c["name"]) for c in cats}
    state = {"page": 0, "rows": 0}
    stop = threading.Event()

    def beat():
        while not stop.wait(60):
            print(f"  … page {state['page']}, {state['rows']} posts", flush=True)
    threading.Thread(target=beat, daemon=True).start()

    tmp = JSONL + ".tmp"
    with open(tmp, "w") as out:
        page = 1
        while True:
            state["page"] = page
            posts, _ = get(f"{API}/posts?per_page=100&page={page}&orderby=id&order=asc"
                           "&_fields=id,link,title,excerpt,categories")
            if not posts:
                break
            for p in posts:
                out.write(json.dumps({
                    "id": p["id"], "url": p["link"], "title": clean(p["title"]["rendered"]),
                    "excerpt": clean(p["excerpt"]["rendered"])[:300],
                    "category": ", ".join(cat.get(c, "") for c in p.get("categories", []) if cat.get(c)),
                }) + "\n")
            state["rows"] += len(posts)
            page += 1
            time.sleep(1.0)
    stop.set()
    os.replace(tmp, JSONL)
    print(f"done: {state['rows']} posts → {JSONL}")


def sq(s):
    return "'" + str(s).replace("'", "''") + "'"


def sql():
    rows = [json.loads(l) for l in open(JSONL)]
    for f in os.listdir(DATA):
        if f.startswith("guides_") and f.endswith(".sql"):
            os.remove(os.path.join(DATA, f))
    head = open(os.path.join(HERE, "schema_guides.sql")).read() + "\nDELETE FROM guides;\n"
    for n, i in enumerate(range(0, len(rows), ROWS_PER_SQL)):
        body = "".join(
            f"INSERT INTO guides (id,url,title,excerpt,category) VALUES "
            f"({r['id']},{sq(r['url'])},{sq(r['title'])},{sq(r['excerpt'])},{sq(r['category'])});\n"
            for r in rows[i:i + ROWS_PER_SQL])
        tail = "INSERT INTO guides_fts(guides_fts) VALUES('rebuild');\n" if i + ROWS_PER_SQL >= len(rows) else ""
        open(os.path.join(DATA, f"guides_{n:03d}.sql"), "w").write((head if n == 0 else "") + body + tail)
    print(f"{len(rows)} rows → {n + 1} SQL files in {DATA}")


if __name__ == "__main__":
    {"fetch": fetch, "sql": sql}[sys.argv[1] if len(sys.argv) > 1 else "fetch"]()
