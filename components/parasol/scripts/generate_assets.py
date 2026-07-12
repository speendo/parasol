#!/usr/bin/env python3
import gzip
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..", "..", "..")
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "src")
FILES = [
    ("index.html", "text/html"),
    ("app.min.js", "application/javascript"),
    ("pico.jade.min.css", "text/css"),
]

def generate():
    os.makedirs(OUT_DIR, exist_ok=True)
    sources = []
    for filename, mime in FILES:
        src_path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(src_path):
            print(f"WARNING: {src_path} not found, skipping")
            continue
        with open(src_path, "rb") as f:
            raw = f.read()
        compressed = gzip.compress(raw, 9)
        sources.append((filename, compressed, mime))

    with open(os.path.join(OUT_DIR, "prsl_assets.c"), "w") as f:
        f.write('#include "prsl_assets.h"\n\n')
        for filename, data, mime in sources:
            varname = filename.replace(".", "_")
            f.write(f"const uint8_t {varname}_gz[] = {{\n")
            for i in range(0, len(data), 12):
                chunk = data[i:i+12]
                f.write("    " + ",".join(f"0x{b:02x}" for b in chunk) + ",\n")
            f.write(f"}};\n")
            f.write(f"const size_t {varname}_gz_len = {len(data)};\n\n")

        f.write("const prsl_asset_t prsl_assets[] = {\n")
        for filename, _, mime in sources:
            varname = filename.replace(".", "_")
            path = "/" + filename if filename != "index.html" else "/"
            f.write(f'    {{"{path}", "{mime}", {varname}_gz, {varname}_gz_len}},\n')
        f.write("};\n")
        f.write(f"const size_t prsl_assets_count = {len(sources)};\n")

    with open(os.path.join(OUT_DIR, "prsl_assets.h"), "w") as f:
        f.write("""#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *path;
    const char *mime;
    const uint8_t *data;
    size_t len;
} prsl_asset_t;

extern const prsl_asset_t prsl_assets[];
extern const size_t prsl_assets_count;
""")
    print(f"Generated {len(sources)} asset files to {OUT_DIR}")

if __name__ == "__main__":
    generate()
