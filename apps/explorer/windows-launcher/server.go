package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gz": "application/gzip", ".json": "application/json", ".pmtiles": "application/vnd.pmtiles", ".woff2": "font/woff2", ".pbf": "application/x-protobuf",
}

func staticHandler(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		name := r.URL.Path
		if name == "/" {
			name = "/index.html"
		}
		if strings.ContainsAny(name, "\\:\x00") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		for _, part := range strings.Split(name, "/") {
			if part == ".." {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
		}
		relative := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(name, "/")))
		if relative == "." || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		filename := filepath.Join(root, relative)
		input, err := os.Open(filename)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer input.Close()
		info, err := input.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		contentType := contentTypes[strings.ToLower(filepath.Ext(filename))]
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Accept-Ranges", "bytes")
		// ServeContent streams from disk and supports PMTiles byte ranges and HEAD.
		http.ServeContent(w, r, info.Name(), info.ModTime(), input)
	})
}
