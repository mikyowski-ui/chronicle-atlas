package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testArchive(t *testing.T, files map[string]string) ([]byte, string) {
	t.Helper()
	var data bytes.Buffer
	writer := zip.NewWriter(&data)
	for name, body := range files {
		output, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(output, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data.Bytes())
	return data.Bytes(), hex.EncodeToString(sum[:])
}
func TestPayloadRoundTripAndTamperRepair(t *testing.T) {
	data, digest := testArchive(t, map[string]string{"dist/index.html": "<h1>Map</h1>", "dist/map.pmtiles": "abcdef", "rights/LICENSE": "license"})
	pack, err := inspectPayload(data, digest)
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	cache, err := prepareCache(pack, base)
	if err != nil {
		t.Fatal(err)
	}
	again, err := prepareCache(pack, base)
	if err != nil || again != cache {
		t.Fatalf("cache not reused: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cache, "dist/index.html"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if validateCache(pack, cache) == nil {
		t.Fatal("tampering not detected")
	}
	repaired, err := prepareCache(pack, base)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCache(pack, repaired); err != nil {
		t.Fatal(err)
	}
}
func TestRejectUnsafeAndCorruptPayload(t *testing.T) {
	for _, name := range []string{"dist/../../outside", "/dist/absolute", "dist\\escape", "dist/CON.txt", "dist/file.", "other/file"} {
		data, digest := testArchive(t, map[string]string{"dist/index.html": "ok", name: "bad"})
		if _, err := inspectPayload(data, digest); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	data, digest := testArchive(t, map[string]string{"dist/index.html": "ok"})
	data[len(data)-1] ^= 1
	if _, err := inspectPayload(data, digest); err == nil {
		t.Fatal("accepted corrupt archive")
	}
	data, digest = testArchive(t, map[string]string{"dist/index.html": "ok", "dist/INDEX.HTML": "duplicate"})
	if _, err := inspectPayload(data, digest); err == nil {
		t.Fatal("accepted Windows case collision")
	}
}
func TestStaticRangeHeadAndBoundaries(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("map"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tiles.pmtiles"), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "folder"), 0700); err != nil {
		t.Fatal(err)
	}
	handler := staticHandler(root)
	cases := []struct {
		method, path, rangeHeader string
		status                    int
		body                      string
	}{
		{"GET", "/", "", 200, "map"},
		{"GET", "/tiles.pmtiles", "bytes=2-5", 206, "2345"},
		{"GET", "/tiles.pmtiles", "bytes=-3", 206, "789"},
		{"GET", "/tiles.pmtiles", "bytes=20-30", 416, ""},
		{"HEAD", "/tiles.pmtiles", "", 200, ""},
		{"POST", "/", "", 405, ""},
		{"GET", "/missing", "", 404, ""},
		{"GET", "/folder/", "", 404, ""},
		{"GET", "/../outside", "", 403, ""},
		{"GET", "/%2e%2e/outside", "", 403, ""},
	}
	for _, item := range cases {
		req := httptest.NewRequest(item.method, item.path, nil)
		req.Header.Set("Range", item.rangeHeader)
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		if out.Code != item.status {
			t.Errorf("%s %s status %d, want %d", item.method, item.path, out.Code, item.status)
		}
		if item.status < 400 && out.Body.String() != item.body {
			t.Errorf("%s: body %q", item.path, out.Body.String())
		}
		if item.status == http.StatusPartialContent && out.Header().Get("Content-Range") == "" {
			t.Fatal("missing range header")
		}
	}
}
func TestEmbeddedPayload(t *testing.T) {
	pack, err := inspectPayload(payload, string(bytes.TrimSpace([]byte(payloadDigest))))
	if err != nil {
		t.Fatal(err)
	}
	if pack.total > maxExpandedBytes || len(pack.files) == 0 {
		t.Fatal("invalid embedded bounds")
	}
}

// Exercise real packaged assets through the desktop server, including the
// byte-range access used by PMTiles. This is a Linux host check, not a claim
// that the Windows UI or GPU has been executed.
func TestEmbeddedHTTPAssets(t *testing.T) {
	pack, err := inspectPayload(payload, strings.TrimSpace(payloadDigest))
	if err != nil {
		t.Fatal(err)
	}
	cache, err := prepareCache(pack, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := staticHandler(filepath.Join(cache, "dist"))
	checked := map[string]bool{}
	wanted := map[string]bool{".html": true, ".js": true, ".css": true, ".pmtiles": true, ".jpg": true, ".json": true, ".gz": true}
	for _, file := range pack.files {
		ext := filepath.Ext(file.name)
		if !strings.HasPrefix(file.name, "dist/") || !wanted[ext] || checked[ext] {
			continue
		}
		request := httptest.NewRequest("GET", "/"+strings.TrimPrefix(file.name, "dist/"), nil)
		request.Header.Set("Range", "bytes=0-15")
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, request)
		if out.Code != http.StatusPartialContent || out.Header().Get("Content-Type") != contentTypes[ext] {
			t.Fatalf("%s: status %d, content type %q", file.name, out.Code, out.Header().Get("Content-Type"))
		}
		input, err := file.entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		expected, err := io.ReadAll(io.LimitReader(input, 16))
		_ = input.Close()
		if err != nil || !bytes.Equal(out.Body.Bytes(), expected) {
			t.Fatalf("%s: served bytes differ from embedded archive", file.name)
		}
		checked[ext] = true
	}
	for ext := range wanted {
		if !checked[ext] {
			t.Errorf("no packaged %s asset checked", ext)
		}
	}
}
