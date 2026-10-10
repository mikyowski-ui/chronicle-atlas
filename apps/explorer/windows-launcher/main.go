package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed payload.zip
var payload []byte

//go:embed payload.sha256
var payloadDigest string

func main() {
	if err := run(); err != nil {
		if len(os.Args) > 1 {
			fmt.Fprintln(os.Stderr, err)
		} else {
			showError(err.Error())
		}
		os.Exit(1)
	}
}

func run() error {
	mode := ""
	if len(os.Args) > 1 {
		if len(os.Args) != 2 || (os.Args[1] != "--verify-payload" && os.Args[1] != "--extract-only") {
			return fmt.Errorf("usage: Chronicle-Teaching-Atlas-Windows-x64.exe [--verify-payload | --extract-only]")
		}
		mode = os.Args[1]
	}
	pack, err := inspectPayload(payload, strings.TrimSpace(payloadDigest))
	if err != nil {
		return fmt.Errorf("built-in application validation: %w", err)
	}
	receipt := map[string]any{"status": "PASS", "archive_sha256": pack.digest, "files": len(pack.files), "expanded_bytes": pack.total, "network_started": false}
	if mode == "--verify-payload" {
		return json.NewEncoder(os.Stdout).Encode(receipt)
	}
	base, err := os.UserCacheDir()
	if err != nil {
		return fmt.Errorf("find local application cache: %w", err)
	}
	cache, err := prepareCache(pack, filepath.Join(base, "Chronicle Explorer"))
	if err != nil {
		return fmt.Errorf("prepare local application: %w", err)
	}
	if mode == "--extract-only" {
		receipt["cache"] = cache
		return json.NewEncoder(os.Stdout).Encode(receipt)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:4173")
	if err != nil {
		// Ask the OS for one free port; do not scan or stop another application.
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
	}
	if err != nil {
		return fmt.Errorf("start local map server: %w", err)
	}
	address := "http://" + listener.Addr().String() + "/"
	server := &http.Server{Handler: staticHandler(filepath.Join(cache, "dist")), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
		_ = listener.Close()
	}()
	go func() { _ = server.Serve(listener) }()
	return platformRun(address)
}
