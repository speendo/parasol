#!/usr/bin/env python3
"""Regenerate src/prsl_assets.{h,c} from the minified UI + parasol_config.json.

Deterministic (fixed gzip mtime) so committed assets only change when the
inputs change. Layout mirrors cmake/generate_assets.cmake output; this script
is the canonical generator for the committed copy.
"""
import gzip
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def config_values():
    cfg = {}
    try:
        with open(os.path.join(ROOT, "parasol_config.json")) as fh:
            cfg = json.load(fh)
    except OSError:
        pass
    return {
        "title": cfg.get("title", "PARASOL"),
        "logo": cfg.get("logo", "/logo.png"),
        "favicon": cfg.get("favicon", "/favicon.ico"),
        "always_show_save": "1" if cfg.get("always_show_save") else "0",
    }

def load(name):
    with open(os.path.join(ROOT, name), "rb") as fh:
        return fh.read()

def main():
    out_h = os.path.join(ROOT, "src", "prsl_assets.h")
    out_c = os.path.join(ROOT, "src", "prsl_assets.c")
    vals = config_values()
    html = load("index.html").decode("utf-8")
    for key, value in (("{{TITLE}}", vals["title"]),
                       ("{{LOGO}}", vals["logo"]),
                       ("{{FAVICON}}", vals["favicon"]),
                       ("{{ALWAYS_SHOW_SAVE}}", vals["always_show_save"])):
        html = html.replace(key, value)
    pieces = [
        ("index_html_gz", "text/html", gzip.compress(html.encode("utf-8"), compresslevel=9, mtime=0)),
        ("app_min_js_gz", "application/javascript", gzip.compress(load("app.min.js"), compresslevel=9, mtime=0)),
        ("pico_jade_min_css_gz", "text/css", gzip.compress(load("pico.jade.min.css"), compresslevel=9, mtime=0)),
    ]

    header = (
        "#pragma once\n"
        "#include <stddef.h>\n"
        "#include <stdint.h>\n\n"
        "typedef struct {\n"
        "    const char *path;\n"
        "    const char *mime;\n"
        "    const uint8_t *data;\n"
        "    size_t len;\n"
        "} prsl_asset_t;\n\n"
        "extern const prsl_asset_t prsl_assets[];\n"
        "extern const size_t prsl_assets_count;\n"
    )
    with open(out_h, "w") as fh:
        fh.write(header)

    def write_array(fh, name, data):
        fh.write("const uint8_t %s[] = {\n" % name)
        col = 0
        for i, byte in enumerate(data):
            if col == 0:
                fh.write("    ")
            fh.write("0x%02x" % byte)
            if i != len(data) - 1:
                fh.write(",")
            col += 1
            if col == 12 and i != len(data) - 1:
                fh.write("\n")
                col = 0
        fh.write("\n};\n")

    with open(out_c, "w") as fh:
        fh.write('#include "prsl_assets.h"\n\n')
        for name, _, data in pieces:
            write_array(fh, name, data)
            fh.write("const size_t %s_len = %d;\n\n" % (name, len(data)))
        fh.write("const prsl_asset_t prsl_assets[] = {\n")
        for name, mime, _ in pieces:
            path = "/" if name == "index_html_gz" else \
                ("/app.min.js" if name == "app_min_js_gz" else "/pico.jade.min.css")
            fh.write('    {"%s", "%s", %s, %s_len},\n' % (path, mime, name, name))
        fh.write("};\nconst size_t prsl_assets_count = 3;\n")

if __name__ == "__main__":
    main()
