import os
import re
import time
import hashlib
import random
from urllib.parse import urljoin, urlparse
from http.cookiejar import MozillaCookieJar

from bs4 import BeautifulSoup
from curl_cffi import requests as crequests


# -----------------------------
# GM-PAGE ONLY IMAGE FILTERING
# -----------------------------
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
SKIP_IF_CONTAINS = (".php",)   # add more if you want


def is_wanted_image_url(u: str) -> bool:
    u_lower = u.lower()

    # skip php or other unwanted endpoints
    if any(bad in u_lower for bad in SKIP_IF_CONTAINS):
        return False

    parsed = urlparse(u)
    filename = os.path.basename(parsed.path)
    if not filename:
        return False

    _, ext = os.path.splitext(filename)

    # must be an image extension
    if ext.lower() not in ALLOWED_IMAGE_EXTS:
        return False

    # OPTIONAL: If you want ONLY Mindat photo cache images, uncomment:
    # if "/imagecache/" not in parsed.path:
    #     return False

    return True


# -----------------------------
# MINERAL IDS
# -----------------------------
MINERALS = {
    "Ulexite": "4085",
    "Aragonite": "307",
    "Azurite": "447",
    "Calcite": "859",
    "Dolomite": "1304",
    "Malachite": "2550",
    "Magnesite": "2482",
    "Rhodochrosite": "3406",
    "Siderite": "3647",
    "Copper": "1209",
    "Diamond": "1282",
    "Gold": "1720",
    "Graphite": "1740",
    "Silver": "3664",
    "Sulfur": "3826",
    "Fluorite": "1576",
    "Halite": "1804",
    "Corundum": "1136",
    "Goethite": "1719",
    "Limonite": "2402",
    "Hematite": "1856",
    "Magnetite": "2538",
    "Pyrolusite": "3318",
    "Rutile": "3486",
    "Zincite": "4410",
    "Turquoise": "4060",
    "Fluorapatite": "1572",
    "Pyromorphite": "3320",
    "Vanadinite": "4139",
    "Barite": "549",
    "Celestite": "927",
    "Alabaster": "90",
    "Satin Spar": "8573",
    "Selenite": "5527",
    "Bornite": "727",
    "Chalcopyrite": "955",
    "Galena": "1641",
    "Pyrite": "3314",
    "Sphalerite": "3727",
    "Stibnite": "3782",
    "Actinolite": "18",
    "Hornblende": "1930",
    "Tremolite": "4011",
    "Apophyllite": "283",
    "Beryl": "819",
    "Chrysocolla": "1040",
    "Dioptase": "1295",
    "Epidote": "1389",
    "Albite": "96",
    "Labradorite": "2308",
    "Amazonite": "184",
    "Orthoclase": "3026",
    "Microcline": "2704",
    "Almandine": "452",
    "Grossular": "1755",
    "Kyanite": "2303",
    "Kaolinite": "2156",
    "Biotite": "677",
    "Lepidolite": "2380",
    "Muscovite": "2815",
    "Olivine": "2983",
    "Prehnite": "3277",
    "Augite": "419",
    "Rhodonite": "3407",
    "Spodumene": "3733",
    "Aventurine": "436",
    "Agate": "51",
    "Chalcedony": "960",
    "Amethyst": "198",
    "Jasper": "2082",
    "Milky Quartz": "6129",
    "Opal": "3004",
    "Rock Crystal": "6128",
    "Rose Quartz": "3456",
    "Smoky Quartz": "3689",
    "Tiger's Eye": "3960",
    "Sodalite": "3701",
    "Staurolite": "3753",
    "Stilbite": "53661",
    "Talc": "3875",
    "Topaz": "3996",
    "Tourmaline": "4003",
    "Willemite": "4292",
    "Wollastonite": "4323",
    "Zircon": "4421",
    "Andesite": "48484",
    "Basalt": "48492",
    "Diorite": "48226",
    "Gabbro": "48275",
    "Granite": "48141",
    "Obsidian": "8519",
    "Pegmatite": "50315",
    "Peridotite": "48407",
    "Pumice": "48576",
    "Rhyolite": "48451",
    "Scoria": "48578",
    "Syenite": "48213",
    "Tuff": "48591",
    "Tuff Breccia": "48607",
    "Banded Iron Formation": "51456",
    "Bauxite": "575",
    "Breccia": "50222",
    "Chert": "994",
    "Conglomerate": "49436",
    "Diatomite": "31314",
    "Dolostone": "49219",
    "Rock Salt": "49358",
    "Rock Gypsum": "49340",
    "Shale": "49444",
    "Siltstone": "49448",
    "Anthracite": "9434",
    "Bituminous": "11368",
    "Lignite": "9354",
    "Chalk": "9073",
    "Coquina": "472051",
    "Fossil Limestone": "498704",
    "Oolitic Limestone": "50762",
    "Travertine": "39057",
    "Arkose": "49127",
    "Greywacke": "49126",
    "Quartz Sandstone": "50898",
    "Amphibolite": "48627",
    "Gneiss": "48629",
    "Marble": "9507",
    "Phyllite": "50064",
    "Quartzite": "51087",
    "Garnet Schist": "50200",
    "Mica Schist": "48645",
    "Talc Schist": "470457",
    "Serpentinite": "48762",
    "Slate": "48638",
}

BASE_GM = "https://www.mindat.org/gm/"
OUT_ROOT = "downloads_clean"

# Polite delay between minerals (gm pages can still be large)
DELAY_SECONDS = 5.0

# GM PAGE ONLY (no photo pages)
FOLLOW_PHOTO_PAGES = False  # kept for clarity; code below does not use it


# -----------------------------
# COOKIES + SESSION
# -----------------------------
COOKIES_FILE = "cookies.txt"
cookiejar = MozillaCookieJar(COOKIES_FILE)
cookiejar.load(ignore_discard=True, ignore_expires=True)

session = crequests.Session()
session.headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def get_page(url: str, referer: str = "https://www.mindat.org/"):
    return session.get(
        url,
        cookies=cookiejar,
        headers={"Referer": referer},
        timeout=30,
    )


def get_with_backoff(url: str, *, referer: str = "https://www.mindat.org/", max_tries: int = 6):
    last_exc = None
    for i in range(max_tries):
        try:
            resp = get_page(url, referer=referer)

            if resp.status_code in (403, 429):
                sleep_s = min(60, (2 ** i) + random.random() * 2)
                print(f"  -> {resp.status_code} for {url}. Sleeping {sleep_s:.1f}s, retrying...")
                time.sleep(sleep_s)
                continue

            if resp.status_code == 404:
                return resp

            resp.raise_for_status()
            return resp

        except Exception as e:
            last_exc = e
            sleep_s = min(60, (2 ** i) + random.random() * 2)
            print(f"  -> error for {url}: {e}. Sleeping {sleep_s:.1f}s, retrying...")
            time.sleep(sleep_s)

    raise last_exc


# -----------------------------
# HELPERS
# -----------------------------
def safe_name(s: str) -> str:
    s = s.strip().replace(" ", "_").replace("/", "_")
    return re.sub(r"[^A-Za-z0-9_-]+", "", s)


def stable_filename(url: str) -> str:
    parsed = urlparse(url)
    base = os.path.basename(parsed.path) or "img"
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base)

    root, ext = os.path.splitext(base)
    if not ext:
        ext = ".bin"

    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{root}_{h}{ext}"


def download_binary(url: str, dest_path: str, *, referer: str = "https://www.mindat.org/") -> bool:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return True

    last_err = None
    for attempt in range(1, 5):
        try:
            r = session.get(
                url,
                cookies=cookiejar,
                headers={"Referer": referer},
                timeout=120,
                stream=True,
            )

            if r.status_code in (403, 429, 500, 502, 503, 504):
                raise Exception(f"HTTP {r.status_code}")

            r.raise_for_status()

            tmp_path = dest_path + ".part"
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

            os.replace(tmp_path, dest_path)
            return True

        except Exception as e:
            last_err = e
            sleep_s = min(60, (2 ** (attempt - 1)) + random.random() * 2)
            print(f"    !! failed image (attempt {attempt}/4) {url}: {e} (sleep {sleep_s:.1f}s)")
            time.sleep(sleep_s)

    print(f"    !! giving up on image {url}: {last_err}")
    return False


def collect_img_urls_from_html(html: str, page_url: str) -> set[str]:
    """
    GM PAGE ONLY collection:
    - parses only this HTML
    - no photo page crawling
    """
    soup = BeautifulSoup(html, "lxml")
    urls = set()

    for img in soup.find_all("img"):
        src = img.get("src")
        if src:
            abs_u = urljoin(page_url, src)
            if is_wanted_image_url(abs_u):
                urls.add(abs_u)

        srcset = img.get("srcset")
        if srcset:
            for part in srcset.split(","):
                candidate = part.strip().split(" ")[0]
                if candidate:
                    abs_u = urljoin(page_url, candidate)
                    if is_wanted_image_url(abs_u):
                        urls.add(abs_u)

    return urls


def rewrite_img_links(html: str, page_url: str, url_to_local: dict[str, str]) -> str:
    soup = BeautifulSoup(html, "lxml")

    for img in soup.find_all("img"):
        src = img.get("src")
        if src:
            abs_u = urljoin(page_url, src)
            if abs_u in url_to_local:
                img["src"] = url_to_local[abs_u]

        srcset = img.get("srcset")
        if srcset:
            new_parts = []
            for part in srcset.split(","):
                tokens = part.strip().split()
                if not tokens:
                    continue
                abs_u = urljoin(page_url, tokens[0])
                if abs_u in url_to_local:
                    tokens[0] = url_to_local[abs_u]
                new_parts.append(" ".join(tokens))
            img["srcset"] = ", ".join(new_parts)

    return str(soup)


# -----------------------------
# MAIN PER-MINERAL
# -----------------------------
def save_page_and_images(name: str, mid: str):
    page_url = f"{BASE_GM}{mid}"
    folder = os.path.join(OUT_ROOT, f"{safe_name(name)}_{mid}")
    images_dir = os.path.join(folder, "images")
    os.makedirs(images_dir, exist_ok=True)

    print(f"\n=== {name} ({mid}) ===")
    print(f"  GET {page_url}")

    r = get_with_backoff(page_url, referer="https://www.mindat.org/")
    if r.status_code == 404:
        print("  -> 404 not found, skip")
        return

    gm_html = r.text

    # GM PAGE ONLY: collect images from this page only
    img_urls = collect_img_urls_from_html(gm_html, page_url)
    print(f"  total images to fetch (gm only): {len(img_urls)}")

    url_to_local = {}
    for u in sorted(img_urls):
        fname = stable_filename(u)
        dest = os.path.join(images_dir, fname)

        ok = download_binary(u, dest, referer="https://www.mindat.org/")
        if ok:
            url_to_local[u] = f"images/{fname}"

        time.sleep(0.05 + random.random() * 0.10)

    rewritten = rewrite_img_links(gm_html, page_url, url_to_local)

    html_path = os.path.join(folder, f"{mid}.htm")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(rewritten)

    print(f"  saved: {html_path}")
    print(f"  images: {images_dir}")


def main():
    if not os.path.exists(COOKIES_FILE):
        raise FileNotFoundError(
            f"Could not find {COOKIES_FILE}. Put cookies.txt next to this script "
            "or set COOKIES_FILE to the correct path."
        )

    os.makedirs(OUT_ROOT, exist_ok=True)

    # quick sanity check request
    resp = get_page("https://www.mindat.org/gm/4071")
    print(resp.status_code, resp.text[:200])

    for name, mid in MINERALS.items():
        try:
            save_page_and_images(name, mid)
        except Exception as e:
            print(f"!! failed mineral {name} ({mid}): {e}")
        time.sleep(DELAY_SECONDS)


if __name__ == "__main__":
    main()
