package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxExpandedBytes = 400 << 20
const maxArchiveBytes = 128 << 20
const maxPayloadFiles = 20000

type payloadFile struct {
	name   string
	size   int64
	digest string
	entry  *zip.File
}
type inspectedPayload struct {
	digest string
	files  []payloadFile
	total  int64
}

func safeName(name string) bool {
	if name == "THIRD_PARTY_NOTICES.txt" || name == "LICENSE-Historical-Basemaps-GPL-3.0.txt" {
		return true
	}
	if name == "" || strings.ContainsAny(name, "\\:\x00") || path.IsAbs(name) || path.Clean(name) != name {
		return false
	}
	if !strings.HasPrefix(name, "dist/") && !strings.HasPrefix(name, "rights/") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." || strings.TrimRight(part, " .") != part {
			return false
		}
		stem := strings.ToUpper(strings.Split(part, ".")[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || (len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9') {
			return false
		}
	}
	return true
}

func inspectPayload(data []byte, expected string) (*inspectedPayload, error) {
	if len(data) > maxArchiveBytes {
		return nil, fmt.Errorf("archive exceeds 128 MiB")
	}
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	if len(expected) != 64 || digest != expected {
		return nil, fmt.Errorf("archive SHA-256 mismatch")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	if len(reader.File) > maxPayloadFiles {
		return nil, fmt.Errorf("too many archive entries")
	}
	result := &inspectedPayload{digest: digest}
	seen := make(map[string]bool)
	foundIndex := false
	for _, entry := range reader.File {
		name := strings.TrimSuffix(entry.Name, "/")
		if entry.FileInfo().IsDir() {
			if name != "dist" && name != "rights" && !safeName(name) {
				return nil, fmt.Errorf("unsafe directory %q", entry.Name)
			}
			continue
		}
		if !safeName(name) || entry.Mode()&os.ModeType != 0 {
			return nil, fmt.Errorf("unsafe archive member %q", entry.Name)
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, fmt.Errorf("duplicate archive member %q", entry.Name)
		}
		seen[key] = true
		if entry.UncompressedSize64 > maxExpandedBytes || uint64(result.total)+entry.UncompressedSize64 > maxExpandedBytes {
			return nil, fmt.Errorf("expanded payload exceeds 400 MiB")
		}
		size := int64(entry.UncompressedSize64)
		stream, err := entry.Open()
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		count, readErr := io.Copy(hash, io.LimitReader(stream, size+1))
		closeErr := stream.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if count != size {
			return nil, fmt.Errorf("size mismatch for %s", name)
		}
		result.files = append(result.files, payloadFile{name, size, hex.EncodeToString(hash.Sum(nil)), entry})
		result.total += size
		if name == "dist/index.html" {
			foundIndex = true
		}
	}
	if !foundIndex {
		return nil, fmt.Errorf("missing dist/index.html")
	}
	return result, nil
}

func validateCache(pack *inspectedPayload, root string) error {
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("invalid cache root")
	}
	expected := make(map[string]payloadFile, len(pack.files))
	for _, file := range pack.files {
		expected[file.name] = file
	}
	count := 0
	err = filepath.WalkDir(root, func(current string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("cache contains symbolic link")
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, current)
		if err != nil {
			return err
		}
		file, ok := expected[filepath.ToSlash(rel)]
		if !ok {
			return fmt.Errorf("unexpected cache file")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Size() != file.size {
			return fmt.Errorf("cache size mismatch")
		}
		input, err := os.Open(current)
		if err != nil {
			return err
		}
		hash := sha256.New()
		n, readErr := io.Copy(hash, io.LimitReader(input, file.size+1))
		_ = input.Close()
		if readErr != nil {
			return readErr
		}
		if n != file.size || hex.EncodeToString(hash.Sum(nil)) != file.digest {
			return fmt.Errorf("cache SHA-256 mismatch")
		}
		count++
		return nil
	})
	if err != nil {
		return err
	}
	if count != len(pack.files) {
		return fmt.Errorf("incomplete cache")
	}
	return nil
}

func prepareCache(pack *inspectedPayload, base string) (string, error) {
	if err := os.MkdirAll(base, 0700); err != nil {
		return "", err
	}
	cache := filepath.Join(base, "history-"+pack.digest[:24])
	if validateCache(pack, cache) == nil {
		return cache, nil
	}
	staging, err := os.MkdirTemp(base, "extract-")
	if err != nil {
		return "", err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(staging)
		}
	}()
	for _, file := range pack.files {
		target := filepath.Join(staging, filepath.FromSlash(file.name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return "", err
		}
		input, err := file.entry.Open()
		if err != nil {
			return "", err
		}
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			_ = input.Close()
			return "", err
		}
		n, copyErr := io.Copy(output, io.LimitReader(input, file.size+1))
		closeErr := output.Close()
		_ = input.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if n != file.size {
			return "", fmt.Errorf("extracted size mismatch")
		}
	}
	if err := validateCache(pack, staging); err != nil {
		return "", err
	}
	if err := os.Rename(staging, cache); err == nil {
		keep = true
		return cache, nil
	}
	// Another instance may have completed the same extraction concurrently.
	if validateCache(pack, cache) == nil {
		return cache, nil
	}
	// Preserve a damaged or in-use cache; this verified private directory is safe.
	keep = true
	return staging, nil
}
