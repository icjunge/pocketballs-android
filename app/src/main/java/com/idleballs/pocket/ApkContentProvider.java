package com.idleballs.pocket;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Serves only completed, verified update APKs in this app's private update directory. */
public final class ApkContentProvider extends ContentProvider {
    static File updateDirectory(Context context) {
        return new File(context.getFilesDir(), "verified-updates");
    }

    static Uri uriFor(Context context, File apk) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".updates")
            .appendPath(apk.getName()).build();
    }

    @Override public boolean onCreate() { return true; }

    private File resolve(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null || !"content".equals(uri.getScheme())
                || !(context.getPackageName() + ".updates").equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null
                || uri.getPathSegments().size() != 1)
            throw new FileNotFoundException("Invalid update URI");
        String name = uri.getPathSegments().get(0);
        if (!name.matches("verified-[0-9]+-[a-f0-9]{64}\\.apk"))
            throw new FileNotFoundException("Invalid update file");
        File directory = updateDirectory(context), file = new File(directory, name);
        try {
            if (!directory.getCanonicalFile().equals(file.getCanonicalFile().getParentFile())
                    || !file.isFile()) throw new FileNotFoundException("Update unavailable");
        } catch (IOException invalid) { throw new FileNotFoundException("Update unavailable"); }
        return file;
    }

    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
            String[] selectionArgs, String sortOrder) {
        try {
            File file = resolve(uri);
            if (projection == null) projection = new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor cursor = new MatrixCursor(projection, 1);
            Object[] row = new Object[projection.length];
            for (int i = 0; i < projection.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(projection[i])) row[i] = "PocketBalls-update.apk";
                else if (OpenableColumns.SIZE.equals(projection[i])) row[i] = file.length();
            }
            cursor.addRow(row);
            return cursor;
        } catch (FileNotFoundException missing) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException("Read only");
    }
}
