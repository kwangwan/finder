"""
SVG sanitizer for inline preview serving.

SVG files are classified as images and served with `Content-Disposition: inline`
by /api/storage/preview, meaning the browser renders (executes) them in the app's
own origin. Since SVG is XML, it can carry <script> tags, event-handler attributes
(onload, onclick, ...), SMIL-based event abuse (<animate>/<set>), and
javascript:/data: URIs in href attributes — all of which run with full access to
the page, including the JWT stored in localStorage. This strips those vectors
before an SVG is ever served inline.
"""
import re
import xml.etree.ElementTree as ET
from typing import Optional

# Cheap guard against entity-expansion ("billion laughs") DoS via a crafted SVG —
# ElementTree/expat doesn't resolve external entities, but internal entity
# expansion can still blow up memory on parse. Real SVGs are tiny vector documents.
MAX_SVG_BYTES = 2 * 1024 * 1024

_DANGEROUS_TAGS = {"script", "foreignobject", "iframe", "embed", "object", "animate", "animatetransform", "set"}
_EVENT_ATTR_RE = re.compile(r"^on", re.IGNORECASE)
_DANGEROUS_URI_RE = re.compile(r"^\s*(javascript:|data:text/html|vbscript:)", re.IGNORECASE)


def _local_name(tag: str) -> str:
    return tag.split("}", 1)[-1].lower() if "}" in tag else tag.lower()


def _clean_attrs(elem: ET.Element) -> None:
    for attr in list(elem.attrib.keys()):
        local_attr = _local_name(attr)
        value = elem.attrib.get(attr) or ""
        if _EVENT_ATTR_RE.match(local_attr):
            del elem.attrib[attr]
        elif local_attr == "href" and _DANGEROUS_URI_RE.match(value):
            del elem.attrib[attr]


def _clean(elem: ET.Element) -> None:
    _clean_attrs(elem)
    for child in list(elem):
        if _local_name(child.tag) in _DANGEROUS_TAGS:
            elem.remove(child)
            continue
        _clean(child)


def sanitize_svg(data: bytes) -> Optional[bytes]:
    """Return a sanitized copy of an SVG document, or None if it can't be safely
    parsed (caller should refuse to serve it inline in that case)."""
    if not data or len(data) > MAX_SVG_BYTES:
        return None
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return None

    _clean(root)
    try:
        # Use the standard unprefixed default namespace on output instead of
        # ElementTree's auto-generated "ns0:" prefixes, so the re-serialized
        # markup looks like ordinary SVG rather than a generic XML document.
        ET.register_namespace("", "http://www.w3.org/2000/svg")
        ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
        return ET.tostring(root, encoding="utf-8")
    except Exception:
        return None
