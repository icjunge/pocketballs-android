#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "${1:-.}" && pwd)"
sdk_root="${POCKETBALLS_ANDROID_SDK:?Set POCKETBALLS_ANDROID_SDK}"
main_dir="$project_dir/app/src/main"
work_dir="$project_dir/build/manual"
output_dir="$project_dir/dist"
if [[ -f "$sdk_root/platforms/android-35/android.jar" ]]; then
 android_jar="$sdk_root/platforms/android-35/android.jar"; build_tools="$sdk_root/build-tools/35.0.0"
else
 android_jar="$sdk_root/android-35/android.jar"; build_tools="$sdk_root/android-15"
fi
for p in "$android_jar" "$build_tools/aapt2" "$build_tools/zipalign" "$build_tools/lib/d8.jar" "$build_tools/lib/apksigner.jar"; do
 [[ -f "$p" ]] || { echo "Missing prerequisite: $p" >&2; exit 2; }
done
mkdir -p "$work_dir" "$output_dir"
rm -rf "$work_dir/classes" "$work_dir/gen" "$work_dir/dex"
mkdir -p "$work_dir/classes" "$work_dir/gen" "$work_dir/dex"
"$build_tools/aapt2" compile --dir "$main_dir/res" -o "$work_dir/resources.zip"
"$build_tools/aapt2" link -o "$work_dir/resources.apk" -I "$android_jar" --manifest "$main_dir/AndroidManifest.xml" --java "$work_dir/gen" --min-sdk-version 26 --target-sdk-version 35 --auto-add-overlay "$work_dir/resources.zip" -A "$main_dir/assets"
python3 - "$main_dir/java" "$work_dir/gen" "$work_dir/java-sources.txt" <<'PY'
from pathlib import Path
import sys
files=sorted(p for root in sys.argv[1:3] for p in Path(root).rglob('*.java'))
Path(sys.argv[3]).write_text('\n'.join('"'+str(p)+'"' for p in files))
PY
java -m jdk.compiler/com.sun.tools.javac.Main -encoding UTF-8 --release 8 -classpath "$android_jar" -d "$work_dir/classes" "@$work_dir/java-sources.txt"
python3 - "$work_dir/classes" "$work_dir/classes.jar" <<'PY'
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys
root=Path(sys.argv[1])
with ZipFile(sys.argv[2],'w',ZIP_DEFLATED) as z:
 for p in sorted(root.rglob('*.class')):z.write(p,p.relative_to(root).as_posix())
PY
java -cp "$build_tools/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 26 --lib "$android_jar" --output "$work_dir/dex" "$work_dir/classes.jar"
python3 - "$work_dir/resources.apk" "$work_dir/dex" "$work_dir/unaligned.apk" <<'PY'
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys,shutil
shutil.copyfile(sys.argv[1],sys.argv[3])
with ZipFile(sys.argv[3],'a',ZIP_DEFLATED) as z:
 for p in sorted(Path(sys.argv[2]).glob('*.dex')):z.write(p,p.name)
PY
"$build_tools/zipalign" -f -P 16 4 "$work_dir/unaligned.apk" "$output_dir/PocketBalls-0.1.0-aligned-unsigned.apk"
"$build_tools/zipalign" -c -P 16 4 "$output_dir/PocketBalls-0.1.0-aligned-unsigned.apk"
"$build_tools/aapt2" dump badging "$output_dir/PocketBalls-0.1.0-aligned-unsigned.apk" > "$output_dir/apk-badging.txt"
cp "$build_tools/lib/apksigner.jar" "$output_dir/apksigner.jar"
python3 - "$output_dir" <<'PY'
from pathlib import Path
from hashlib import sha256
import json,sys
p=Path(sys.argv[1]); files={f.name:sha256(f.read_bytes()).hexdigest() for f in sorted(p.iterdir()) if f.is_file() and f.name!='sha256.json'}
(p/'sha256.json').write_text(json.dumps(files,indent=2))
print(json.dumps(files,indent=2))
PY
