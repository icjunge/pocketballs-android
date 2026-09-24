#!/usr/bin/env python3
"""Check the local update feed/APK; --remote also checks anonymous public downloads.

Python standard library only. Reads the APK's compiled AndroidManifest.xml, so a
matching filename alone cannot pass the version/package/minSdk checks.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

BASE = "https://raw.githubusercontent.com/icjunge/pocketballs-android/main/"
FEED_URL = BASE + "updates/latest.json"
MAX_APK = 16 * 1024 * 1024
MAX_FEED = 64 * 1024
ANDROID = "http://schemas.android.com/apk/res/android"
VERSION_FIELDS = ("packageName", "versionCode", "versionName", "minSdk")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_feed(raw):
    require(len(raw) <= MAX_FEED, "Update feed exceeds 64 KiB")
    feed = json.loads(raw)
    require(isinstance(feed, dict), "Update feed must be an object")
    for key, low, high in (("versionCode", 1, 2147483647),
                           ("minSdk", 26, 1000), ("sizeBytes", 1, MAX_APK)):
        require(type(feed.get(key)) is int and low <= feed[key] <= high,
                "Invalid " + key)
    name = feed.get("versionName")
    require(isinstance(name, str) and len(name) <= 48
            and re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}(?:-[A-Za-z0-9.-]+)?", name),
            "Invalid versionName")
    require(feed.get("packageName") == "com.idleballs.pocket", "Unexpected packageName")
    require(isinstance(feed.get("sha256"), str)
            and re.fullmatch(r"[A-Fa-f0-9]{64}", feed["sha256"]), "Invalid SHA-256")
    require(isinstance(feed.get("notes"), str) and len(feed["notes"]) <= 4000,
            "Invalid release notes")
    prefix = BASE + "releases/v" + name + "/"
    url = feed.get("url")
    require(isinstance(url, str) and url.startswith(prefix)
            and ".." not in url
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.apk", url[len(prefix):]),
            "APK URL must point to this version in the public repository")
    return feed


def binary_manifest(data):
    """Read string-pool/start-element chunks defined in AOSP ResourceTypes.h."""
    require(len(data) >= 8, "Truncated APK manifest")
    kind, header_size, total_size = struct.unpack_from("<HHI", data)
    require(kind == 3 and header_size >= 8 and total_size == len(data),
            "APK manifest is not compiled Android XML")
    strings, found = [], {}

    def string(index):
        require(0 <= index < len(strings), "Bad manifest string index")
        return strings[index]

    offset = header_size
    while offset < total_size:
        kind, header, size = struct.unpack_from("<HHI", data, offset)
        require(8 <= header <= size and offset + size <= total_size,
                "Invalid manifest chunk")
        chunk = data[offset:offset + size]
        if kind == 1:  # RES_STRING_POOL_TYPE
            require(header >= 28, "Invalid string-pool header")
            count, _, flags, start, _ = struct.unpack_from("<IIIII", chunk, 8)
            require(header + count * 4 <= size and start <= size, "Invalid string pool")
            strings = []
            for i in range(count):
                position = start + struct.unpack_from("<I", chunk, header + i * 4)[0]
                if flags & 0x100:  # UTF-8: UTF-16 character length, then byte length.
                    def utf8_length(position):
                        value = chunk[position]
                        if value & 0x80:
                            return ((value & 0x7f) << 8) | chunk[position + 1], position + 2
                        return value, position + 1
                    _, position = utf8_length(position)
                    length, position = utf8_length(position)
                    require(position + length < size, "Truncated UTF-8 manifest string")
                    strings.append(chunk[position:position + length].decode("utf-8"))
                else:
                    length = struct.unpack_from("<H", chunk, position)[0]
                    position += 2
                    if length & 0x8000:
                        length = ((length & 0x7fff) << 16) | struct.unpack_from("<H", chunk, position)[0]
                        position += 2
                    require(position + length * 2 + 2 <= size, "Truncated UTF-16 manifest string")
                    strings.append(chunk[position:position + length * 2].decode("utf-16le"))
        elif kind == 0x102:  # RES_XML_START_ELEMENT_TYPE
            require(header >= 16 and header + 20 <= size, "Invalid start-element chunk")
            _, name, attr_start, attr_size, count = struct.unpack_from("<IIHHH", chunk, header)
            tag = string(name)
            require(attr_size >= 20 and header + attr_start + count * attr_size <= size,
                    "Invalid manifest attributes")
            if tag in ("manifest", "uses-sdk"):
                attrs = {}
                for i in range(count):
                    position = header + attr_start + i * attr_size
                    namespace, name, raw, value_size, _, value_type, value = struct.unpack_from(
                        "<IIIHBBI", chunk, position)
                    require(value_size >= 8, "Invalid typed manifest value")
                    namespace = "" if namespace == 0xffffffff else string(namespace)
                    if value_type == 3:
                        decoded = string(value)
                    elif value_type in (0x10, 0x11):
                        decoded = value
                    elif raw != 0xffffffff:
                        decoded = string(raw)
                    else:
                        continue
                    attrs[(namespace, string(name))] = decoded
                if tag == "manifest":
                    found.update(packageName=attrs.get(("", "package")),
                                 versionCode=attrs.get((ANDROID, "versionCode")),
                                 versionName=attrs.get((ANDROID, "versionName")))
                else:
                    found["minSdk"] = attrs.get((ANDROID, "minSdkVersion"))
        offset += size
    return found


def check_versions(actual, feed, label):
    for key in VERSION_FIELDS:
        require(actual.get(key) == feed[key],
                f"{label}: {key}={actual.get(key)!r}, feed expects {feed[key]!r}")


def check_apk(data, feed, label):
    require(len(data) == feed["sizeBytes"] and len(data) <= MAX_APK,
            label + ": APK size mismatch")
    require(hashlib.sha256(data).hexdigest() == feed["sha256"].lower(),
            label + ": APK SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as apk:
        require(apk.namelist().count("AndroidManifest.xml") == 1,
                label + ": APK must contain one manifest")
        info = apk.getinfo("AndroidManifest.xml")
        require(info.file_size <= 1024 * 1024, label + ": APK manifest too large")
        check_versions(binary_manifest(apk.read(info)), feed, label)


def download(url, limit):
    request = urllib.request.Request(url, headers={
        "User-Agent": "PocketBalls-UpdateVerifier/1", "Cache-Control": "no-cache"})
    started = time.monotonic()
    # Anonymous request deliberately verifies that a phone needs no GitHub token.
    with urllib.request.urlopen(request, timeout=15) as response:
        require(response.status == 200 and response.geturl() == url,
                "Update download must return HTTP 200 without redirect")
        length = response.headers.get("Content-Length")
        require(length is None or int(length) <= limit, "Download exceeds size limit")
        result = bytearray()
        while True:
            require(time.monotonic() - started < 45, "Download exceeded total time limit")
            block = response.read(min(65536, limit + 1 - len(result)))
            if not block:
                return bytes(result)
            result.extend(block)
            require(len(result) <= limit, "Download exceeds size limit")


def verify_remote(local_feed):
    for attempt in range(3):
        try:
            remote_feed = read_feed(download(FEED_URL, MAX_FEED))
            require(remote_feed == local_feed, "Public feed differs from this checkout")
            check_apk(download(remote_feed["url"], MAX_APK), remote_feed, "Public APK")
            print("PASS: anonymous public feed and APK match the verified local release")
            return
        except Exception as error:
            if attempt == 2:
                raise
            delay = (3, 8)[attempt]
            print(f"Public check {attempt + 1}/3 failed: {error}; retry in {delay}s", file=sys.stderr)
            time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote", action="store_true", help="also verify anonymous public downloads")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    feed = read_feed((args.root / "updates/latest.json").read_bytes())
    apk_path = args.root / feed["url"][len(BASE):]
    require(apk_path.stat().st_size <= MAX_APK, "Local APK exceeds 16 MiB")
    check_apk(apk_path.read_bytes(), feed, "Local APK")
    source = ET.parse(args.root / "app/src/main/AndroidManifest.xml").getroot()
    sdk = source.find("uses-sdk")
    require(sdk is not None, "Source manifest is missing uses-sdk")
    check_versions({"packageName": source.get("package"),
                    "versionCode": int(source.get("{" + ANDROID + "}versionCode", "0")),
                    "versionName": source.get("{" + ANDROID + "}versionName"),
                    "minSdk": int(sdk.get("{" + ANDROID + "}minSdkVersion", "0"))},
                   feed, "Source manifest")
    print(f"PASS: local v{feed['versionName']} ({feed['versionCode']}), "
          f"{feed['sizeBytes']} bytes, SHA-256 and APK/source manifests match")
    if args.remote:
        verify_remote(feed)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
